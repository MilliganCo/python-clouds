"""Personal archive restore on disposable data: trust, concurrency, loss and histories."""
from test_platform import client, register
import copy
from contextlib import contextmanager
import json
import sqlite3
from pathlib import Path
import subprocess
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest


@contextmanager
def database():
    import server
    conn = sqlite3.connect(server.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        with conn: yield conn
    finally: conn.close()


def seed(client):
    register(client)
    with database() as conn:
        uid = conn.execute("SELECT id FROM users WHERE username='tester'").fetchone()[0]
        for table, value in {
            'progress': dict(task_id='2.9', solved_at='2026-10-20'),
            'notes': dict(task_id='2.9', text='archive note <script>', updated_at='2026-10-20'),
            'ai_messages': dict(task_id='2.9', role='user', text='private question', created_at='2026-10-20'),
            'ai_memory': dict(key='questions_total', value='11', updated_at='2026-10-20'),
            'project_course_progress': dict(course_id='chatbot_to_telegram', status='started', current_stage_id='hello_name', started_at='2026-10-20', updated_at='2026-10-20'),
            'project_stage_progress': dict(course_id='chatbot_to_telegram', stage_id='hello_name', status='started', current_code="print('archive project')", template_version=1, started_at='2026-10-20', updated_at='2026-10-20', local_evidence_json='{"checked":[],"reflection":"my original reflection"}'),
            'project_code_snapshots': dict(course_id='chatbot_to_telegram', stage_id='hello_name', version=1, kind='manual', code='archived snapshot', template_version=1, created_at='2026-10-20'),
            'project_course_events': dict(course_id='chatbot_to_telegram', stage_id='hello_name', event_type='stage_saved', payload_json='{}', created_at='2026-10-20'),
            'chest_grants': dict(grant_key='welcome', launches=5, used=2),
        }.items():
            cols = ['user_id', *value]
            conn.execute(f'INSERT INTO {table} (' + ','.join(cols) + ') VALUES (' + ','.join('?' for _ in cols) + ')', (uid, *value.values()))
        for _ in range(2):
            conn.execute("INSERT INTO attempts(user_id,task_id,verdict,code,created_at) VALUES (?,'2.9','неверно','same code','2026-10-20')", (uid,))
        conn.execute('INSERT OR REPLACE INTO wallet(user_id,drops,freezes) VALUES (?,123,2)', (uid,))
    assert client.put('/api/drafts', json=dict(scope='sandbox', code='', starter='# template', base_version=0,
        base_mutation_id=None, mutation_id='a'*32)).status_code == 200
    return uid


def exported(client):
    response = client.get('/api/learning-archive')
    assert response.status_code == 200, response.get_json()
    assert response.headers['Cache-Control'] == 'no-store'
    assert 'attachment' in response.headers['Content-Disposition']
    return response.get_json()


def preview(client, archive, choice='keep_current'):
    response = client.post('/api/learning-archive/preview', json=dict(archive=archive, choice=choice))
    assert response.status_code == 200, response.get_json()
    return response.get_json()


def restore(client, archive, plan, choice='keep_current'):
    return client.post('/api/learning-archive/restore', json=dict(archive=archive, choice=choice, token=plan['token']))


def test_personal_export_is_complete_read_only_and_credential_free(client):
    uid = seed(client)
    register(client, name='another_user')
    client.post('/api/notes', json={'task_id':'2.9', 'text':'FOREIGN_PRIVATE'})
    client.post('/api/login', json={'username':'tester', 'password':'secret123'})
    import learning_archive as archive
    with database() as conn: before = archive.capture(conn, uid)
    saved = exported(client)
    assert set(saved['payload']['tables']) == set(archive.TABLES)
    assert saved['payload']['tables'] == before['tables']
    raw = json.dumps(saved)
    assert 'FOREIGN_PRIVATE' not in raw
    for forbidden in ('password_hash', 'secret_key', 'access_token_hash', 'refresh_token_hash', 'mobile_sessions'):
        assert forbidden not in raw
    with database() as conn:
        assert archive.capture(conn, uid) == before
        assert conn.execute('SELECT COUNT(*) FROM learning_archive_restores').fetchone()[0] == 0


def test_restore_missing_work_preserves_money_and_is_idempotent(client):
    uid = seed(client); saved = exported(client)
    import learning_archive as archive
    with database() as conn:
        for table in set(archive.KEYS) | archive.APPEND:
            if table != 'atlas_tasks': conn.execute(f'DELETE FROM {table} WHERE user_id=?', (uid,))
    plan = preview(client, saved)
    assert plan['add'] > 0 and plan['conflict_count'] == 0
    response = restore(client, saved, plan)
    assert response.status_code == 200, response.get_json()
    assert response.get_json()['replayed'] is False
    with database() as conn:
        assert conn.execute('SELECT drops,freezes FROM wallet WHERE user_id=?', (uid,)).fetchone()[:] == (123, 2)
        assert conn.execute('SELECT COUNT(*) FROM attempts WHERE user_id=?', (uid,)).fetchone()[0] == 2
        assert conn.execute('SELECT text FROM notes WHERE user_id=?', (uid,)).fetchone()[0] == 'archive note <script>'
        assert conn.execute('SELECT code,version,mutation_id FROM editor_drafts WHERE user_id=?', (uid,)).fetchone()[:] == ('', 1, conn.execute('SELECT mutation_id FROM editor_drafts WHERE user_id=?', (uid,)).fetchone()[0])
        before = archive.capture(conn, uid)
    repeated = restore(client, saved, plan)
    assert repeated.status_code == 200 and repeated.get_json()['replayed'] is True
    with database() as conn:
        assert archive.capture(conn, uid) == before
        assert conn.execute('SELECT COUNT(*) FROM learning_archive_restores').fetchone()[0] == 1
    assert client.post('/api/progress', json={'task_id':'2.9', 'solved':True}).status_code == 200
    assert client.get('/api/wallet').get_json()['drops'] == 123


def test_explicit_conflicts_preserve_both_project_copies_and_draft_version(client):
    uid = seed(client); saved = exported(client)
    with database() as conn:
        conn.execute("UPDATE notes SET text='new manual note' WHERE user_id=?", (uid,))
        conn.execute("UPDATE project_stage_progress SET current_code='new manual project',local_evidence_json='{}' WHERE user_id=?", (uid,))
        conn.execute('UPDATE chest_grants SET used=5 WHERE user_id=?', (uid,))
    assert client.put('/api/drafts', json=dict(scope='sandbox', code='new draft', starter='# template', base_version=1,
        base_mutation_id='a'*32, mutation_id='b'*32)).status_code == 200
    plan = preview(client, saved)
    assert plan['conflict_count'] == 3
    assert restore(client, saved, plan).status_code == 200
    with database() as conn:
        assert conn.execute('SELECT current_code FROM project_stage_progress').fetchone()[0] == 'new manual project'
    plan = preview(client, saved, 'use_archive')
    response = restore(client, saved, plan, 'use_archive')
    assert response.status_code == 200, response.get_json()
    receipt = response.get_json()['receipt_id']
    with database() as conn:
        assert conn.execute('SELECT current_code,local_evidence_json FROM project_stage_progress').fetchone()[:] == ("print('archive project')", '{"checked":[],"reflection":"my original reflection"}')
        snapshots = conn.execute('SELECT version,code FROM project_code_snapshots ORDER BY version').fetchall()
        assert [r[0] for r in snapshots] == [1, 2, 3]
        assert {r[1] for r in snapshots} == {'archived snapshot', 'new manual project', "print('archive project')"}
        draft = conn.execute('SELECT code,version,mutation_id FROM editor_drafts').fetchone()
        assert draft[0] == '' and draft[1] == 3 and draft[2] not in ('a'*32, 'b'*32)
        assert conn.execute('SELECT used FROM chest_grants').fetchone()[0] == 5
    previous = client.get(f'/api/learning-archive/history/{receipt}/before').get_json()
    assert previous['payload']['tables']['notes'][0]['text'] == 'new manual note'
    assert client.get(f'/api/learning-archive/history/{receipt}/incoming').get_json() == saved


@pytest.mark.parametrize('kind', ['tamper','other_account','other_installation','future','preview','stale','expired'])
def test_rejects_untrusted_or_stale_restore_without_mutation(client, kind):
    import learning_archive as archive, server
    uid = seed(client); saved = exported(client); plan = preview(client, saved)
    if kind == 'tamper': saved['payload']['tables']['progress'][0]['task_id'] = '0.1'
    elif kind == 'other_account':
        register(client, name='different_owner')
    elif kind == 'other_installation':
        saved['signature'] = archive.mac('different installation secret', archive.FORMAT, saved['payload'])
    elif kind == 'future':
        saved['payload']['version'] = archive.VERSION+1
        saved['signature'] = archive.mac(server.app.secret_key, archive.FORMAT, saved['payload'])
    elif kind == 'preview': plan['token']['proof']['choice'] = 'use_archive'
    elif kind == 'stale':
        client.post('/api/notes', json={'task_id':'2.9', 'text':'typed after preview'})
    else:
        plan['token']['proof']['expires'] = 1
        plan['token']['signature'] = archive.mac(server.app.secret_key, 'learning-restore-preview-v1', plan['token']['proof'])
    with database() as conn: before = archive.capture(conn, uid)
    response = restore(client, saved, plan)
    assert response.status_code in (400, 403, 409), response.get_json()
    assert response.headers['Cache-Control'] == 'no-store'
    with database() as conn:
        assert archive.capture(conn, uid) == before
        assert conn.execute('SELECT COUNT(*) FROM learning_archive_restores').fetchone()[0] == 0


def test_restore_rolls_back_all_sections_on_late_failure(client):
    import learning_archive as archive
    uid = seed(client); saved = exported(client)
    with database() as conn:
        conn.execute('DELETE FROM notes'); conn.execute('DELETE FROM progress')
        conn.execute("CREATE TRIGGER refuse_progress BEFORE INSERT ON progress BEGIN SELECT RAISE(ABORT,'synthetic archive failure'); END")
        before = archive.capture(conn, uid)
    plan = preview(client, saved)
    with pytest.raises(sqlite3.IntegrityError, match='synthetic archive failure'):
        restore(client, saved, plan)
    with database() as conn:
        assert archive.capture(conn, uid) == before
        assert conn.execute('SELECT COUNT(*) FROM learning_archive_restores').fetchone()[0] == 0


def test_history_is_private_and_future_schema_or_quota_never_truncates(client, monkeypatch):
    import learning_archive as archive
    uid = seed(client); saved = exported(client); plan = preview(client, saved)
    response = restore(client, saved, plan); receipt = response.get_json()['receipt_id']
    register(client, name='archive_other')
    assert client.get('/api/learning-archive/history').get_json() == {'history':[]}
    assert client.get(f'/api/learning-archive/history/{receipt}/before').status_code == 404
    client.post('/api/login', json={'username':'tester','password':'secret123'})
    monkeypatch.setattr(archive, 'MAX_ROWS', 1)
    assert client.get('/api/learning-archive').status_code == 413
    monkeypatch.setattr(archive, 'MAX_ROWS', 50000)
    monkeypatch.setattr(archive, 'MAX_HISTORY_BYTES', 1)
    next_archive = exported(client); next_plan = preview(client, next_archive)
    with database() as conn: before = archive.capture(conn, uid)
    assert restore(client, next_archive, next_plan).status_code == 413
    with database() as conn: assert archive.capture(conn, uid) == before


def test_history_multiset_dedup_survives_new_export_and_remapped_ids(client):
    uid = seed(client); first = exported(client)
    with database() as conn:
        conn.execute('DELETE FROM attempts')
        conn.execute("INSERT INTO attempts(user_id,task_id,verdict,code,created_at) VALUES (?,'2.9','неверно','new history','2026-10-21')", (uid,))
    assert restore(client, first, preview(client, first)).status_code == 200
    assert restore(client, first, preview(client, first), 'use_archive').status_code == 409
    second = exported(client)
    assert restore(client, second, preview(client, second)).status_code == 200
    with database() as conn:
        assert conn.execute('SELECT COUNT(*) FROM attempts').fetchone()[0] == 3
        assert conn.execute('SELECT COUNT(*) FROM attempts WHERE code=?', ('same code',)).fetchone()[0] == 2


def test_archive_request_limit_does_not_raise_other_api_limits(client):
    import server, learning_archive as archive
    register(client)
    oversized = b'x' * (server.app.config['MAX_CONTENT_LENGTH'] + 1)
    assert client.post('/api/notes', data=oversized, content_type='application/json').status_code == 413
    assert client.post('/api/learning-archive/preview', data=oversized, content_type='application/json').status_code == 400
    assert server.app.config['MAX_CONTENT_LENGTH'] < archive.REQUEST_BYTES


def test_local_file_model_preserves_untrusted_and_future_copy_boundaries():
    subprocess.run(['node',str(Path(__file__).resolve().parents[1]/'scripts/verify_learning_archive_unit.cjs')],check=True)


def test_public_daily_context_conflict_is_not_republished_or_overwritten(client):
    uid=seed(client)
    with database() as conn:
        conn.execute("INSERT INTO daily_ai_solves(user_id,day,difficulty) VALUES (?,'2026-10-20','expert')",(uid,))
        conn.execute("INSERT INTO daily_ai_tasks(day,difficulty,payload) VALUES ('2026-10-20','expert','{\"title\":\"old task\"}')")
    saved=exported(client)
    with database() as conn: conn.execute("UPDATE daily_ai_tasks SET payload='{\"title\":\"new public task\"}'")
    response=client.post('/api/learning-archive/preview',json=dict(archive=saved,choice='use_archive'))
    assert response.status_code==409 and response.get_json()['code']=='archive_context_changed'
    with database() as conn:
        assert 'new public task' in conn.execute('SELECT payload FROM daily_ai_tasks').fetchone()[0]
        assert conn.execute('SELECT COUNT(*) FROM learning_archive_restores').fetchone()[0]==0


def test_restore_state_limit_is_atomic_even_when_each_snapshot_fits(client,monkeypatch):
    import learning_archive as archive
    uid=seed(client);saved=exported(client)
    with database() as conn:
        conn.execute('DELETE FROM notes')
        conn.execute("INSERT INTO notes(user_id,task_id,text,updated_at) VALUES (?,'3.1','new note','2026-10-21')",(uid,))
        before=archive.capture(conn,uid)
    count=sum(len(rows) for group in before.values() for rows in group.values())
    monkeypatch.setattr(archive,'MAX_ROWS',count)
    plan=preview(client,saved)
    assert restore(client,saved,plan).status_code==413
    with database() as conn: assert archive.capture(conn,uid)==before


def test_simultaneous_retries_commit_only_one_restore(client):
    import server
    seed(client);saved=exported(client);plan=preview(client,saved)
    gate=Barrier(2)
    def attempt(_):
        with server.app.test_client() as worker:
            assert worker.post('/api/login',json={'username':'tester','password':'secret123'}).status_code==200
            gate.wait(timeout=3)
            response=restore(worker,saved,plan)
            return response.status_code,response.get_json()
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(attempt,range(2)))
    assert [r[0] for r in results]==[200,200]
    assert sorted(r[1]['replayed'] for r in results)==[False,True]
    assert len({r[1]['receipt_id'] for r in results})==1
    with database() as conn: assert conn.execute('SELECT COUNT(*) FROM learning_archive_restores').fetchone()[0]==1


def test_import_never_reuses_another_users_history_ids(client):
    import learning_archive as archive
    uid=seed(client);saved=exported(client)
    original=saved['payload']['tables']['attempts'][0]
    register(client,name='history_other')
    with database() as conn:
        other=conn.execute("SELECT id FROM users WHERE username='history_other'").fetchone()[0]
        conn.execute('DELETE FROM attempts WHERE user_id=?',(uid,))
        conn.execute("INSERT INTO attempts(id,user_id,task_id,verdict,code,created_at) VALUES (?,?,'2.9','верно','OTHER_USER_KEEP','2026-10-21')",(original['id'],other))
        before=archive.capture(conn,other)
    client.post('/api/login',json={'username':'tester','password':'secret123'})
    assert restore(client,saved,preview(client,saved)).status_code==200
    with database() as conn:
        assert archive.capture(conn,other)==before
        assert conn.execute('SELECT COUNT(*) FROM attempts WHERE user_id=?',(uid,)).fetchone()[0]==2
        assert conn.execute('SELECT code FROM attempts WHERE id=?',(original['id'],)).fetchone()[0]=='OTHER_USER_KEEP'


def test_schema_coverage_explicitly_accounts_for_every_personal_table(client):
    import learning_archive as archive
    register(client)
    with database() as conn:
        tables=[r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        owned={table for table in tables if {r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')}&{'user_id','owner_id'}}
    assert owned==set(archive.TABLES)|archive.SERVER_ONLY_TABLES


def test_operator_grant_stays_private_and_old_archive_cannot_replay_it(client):
    import learning_archive as archive, server
    from wallet_admin import grant
    uid = seed(client)
    saved = exported(client)  # Existing v2 archive, before the operator grant.
    grant(server.DB_PATH, 'tester', 800, 'operator-request')
    assert 'operator_wallet_grants' not in exported(client)['payload']['tables']
    assert restore(client, saved, preview(client, saved)).status_code == 200
    assert grant(server.DB_PATH, 'tester', 800, 'operator-request')['applied'] is False
    with database() as conn:
        assert conn.execute('SELECT drops,freezes FROM wallet WHERE user_id=?',(uid,)).fetchone()[:] == (923,2)
        assert conn.execute('SELECT COUNT(*) FROM operator_wallet_grants').fetchone()[0] == 1
    assert archive.VERSION == saved['payload']['version']
