import json,sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from threading import current_thread,main_thread
from types import SimpleNamespace
import pytest
from test_platform import client,register

OLD='secret123'
def prepare(client):
    response=client.post('/api/account/deletion-prepare',json={'password':OLD})
    assert response.status_code==200,response.get_json()
    return response.get_json()
def remove(client,plan,**changes):
    return client.post('/api/account/delete',json={
        'password':OLD,'confirmation':'tester','acknowledge_copies':True,
        'request_id':plan['request_id'],'token':plan['token'],'policy_version':plan['policy_version'],**changes})

def test_deletion_requires_password_typed_name_and_explicit_acknowledgement(client):
    register(client)
    assert client.post('/api/account/deletion-prepare',json={'password':'wrong'}).status_code==403
    plan=prepare(client)
    assert remove(client,plan,confirmation='TESTER').status_code==400
    assert remove(client,plan,acknowledge_copies=False).status_code==400
    assert remove(client,plan,password='wrong').status_code==403
    assert client.get('/api/me').status_code==200

def test_delete_preserves_other_owner_removes_private_rows_and_reserves_old_name(client):
    import server
    register(client);uid=client.get('/api/learning-archive').get_json()['payload']['owner']['id']
    other=server.app.test_client();register(other,'second')
    other_before=other.get('/api/progress').get_json()
    with server.app.app_context():
        db=server.db()
        db.execute('INSERT INTO notes VALUES(?,?,?,?)',(uid,'0.1','private note',server.now()))
        db.execute('INSERT INTO progress VALUES(?,?,?)',(uid,'0.1',server.now()));db.commit()
    plan=prepare(client);result=remove(client,plan)
    assert result.status_code==200,result.get_json()
    assert result.get_json()['deleted'] is True and 'Set-Cookie' not in result.headers
    assert client.get('/api/me').get_json()['code']=='account_deleted'
    assert other.get('/api/progress').get_json()==other_before
    with sqlite3.connect(server.DB_PATH) as connection:
        assert connection.execute('SELECT * FROM users WHERE id=?',(uid,)).fetchone() is None
        assert connection.execute('SELECT * FROM notes WHERE user_id=?',(uid,)).fetchall()==[]
        assert connection.execute('SELECT * FROM progress WHERE user_id=?',(uid,)).fetchall()==[]
        assert connection.execute('PRAGMA foreign_key_check').fetchall()==[]
        stored=connection.execute('SELECT username_hash FROM account_deletions WHERE user_id=?',(uid,)).fetchone()[0]
        assert stored!='tester' and len(stored)==64
    assert register(server.app.test_client()).status_code==409
    assert other.post('/api/login',json={'username':'second','password':OLD}).status_code==200

def test_lost_delete_response_has_secret_receipt_without_login_or_enumeration(client):
    import server
    register(client);plan=prepare(client);assert remove(client,plan).status_code==200
    anon=server.app.test_client();body={k:plan[k] for k in ('request_id','token')}
    response=anon.post('/api/account/deletion-status',json=body)
    assert response.status_code==200 and response.get_json()['deleted'] is True
    assert 'Set-Cookie' not in response.headers and response.headers['Cache-Control']=='no-store'
    bad=anon.post('/api/account/deletion-status',json={**body,'token':'0'*64})
    missing=anon.post('/api/account/deletion-status',json={**body,'request_id':'0'*32})
    assert bad.status_code==missing.status_code==404 and bad.get_json()==missing.get_json()
    with server.app.app_context():
        stored=server.db().execute('SELECT token_hash FROM account_deletions').fetchone()[0]
        assert stored!=plan['token']
        server.db().execute("UPDATE account_deletions SET receipt_expires_at='2000-01-01T00:00:00+00:00'");server.db().commit()
    expired=anon.post('/api/account/deletion-status',json=body)
    assert expired.status_code==404 and expired.get_json()==missing.get_json()

def test_delete_removes_publications_and_related_votes_without_touching_other_work(client):
    import server,account_lifecycle
    register(client);uid=client.get('/api/learning-archive').get_json()['payload']['owner']['id']
    other=server.app.test_client();register(other,'second')
    with server.app.app_context():
        db=server.db();other_uid=db.execute("SELECT id FROM users WHERE username='second'").fetchone()[0]
        def card(owner,name):
            return db.execute('INSERT INTO showcase_cards(user_id,owner_name,title,description,cover,files_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
                (owner,name,'My project','private description','cloud','[]',server.now(),server.now())).lastrowid
        mine=card(uid,'tester');theirs=card(other_uid,'second')
        db.execute('INSERT INTO showcase_votes VALUES(?,?,?,?)',(mine,other_uid,1,server.now()))
        db.execute('INSERT INTO showcase_votes VALUES(?,?,?,?)',(theirs,uid,1,server.now()));db.commit()
    plan=prepare(client);assert remove(client,plan).status_code==200
    with server.app.app_context():
        for table,column in account_lifecycle.owned_tables(server.db()).items():
            assert server.db().execute('SELECT COUNT(*) FROM '+account_lifecycle.quote(table)+' WHERE '+account_lifecycle.quote(column)+'=?',(uid,)).fetchone()[0]==0,table
        assert server.db().execute('SELECT owner_name FROM showcase_cards WHERE id=?',(theirs,)).fetchone()[0]=='second'
        assert server.db().execute('SELECT COUNT(*) FROM showcase_votes').fetchone()[0]==0

def test_same_account_work_and_python_run_block_delete_until_finished(client,monkeypatch):
    import server
    register(client);plan=prepare(client);entered=Event();release=Event();original=server.now
    def delay():
        if current_thread() is not main_thread():entered.set();assert release.wait(5)
        return original()
    monkeypatch.setattr(server,'now',delay)
    worker=server.app.test_client();worker.post('/api/login',json={'username':'tester','password':OLD})
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending=pool.submit(lambda:worker.post('/api/notes',json={'task_id':'0.1','text':'saved during another action'}).status_code)
        assert entered.wait(5)
        try:assert remove(client,plan).get_json()['code']=='account_busy'
        finally:release.set()
        assert pending.result()==200
    with server.app.app_context():uid=server.db().execute("SELECT id FROM users WHERE username='tester'").fetchone()[0]
    monkeypatch.setattr(server.sandbox.pool,'jobs',{'synthetic':SimpleNamespace(uid=uid)})
    assert remove(client,plan).get_json()['code']=='account_busy'
    monkeypatch.setattr(server.sandbox.pool,'jobs',{})
    assert remove(client,plan).status_code==200

def test_unknown_owned_table_stops_delete_without_partial_loss(client):
    import server
    register(client);plan=prepare(client)
    with server.app.app_context():server.db().execute('CREATE TABLE future_owner_records(user_id INTEGER, text TEXT)');server.db().commit()
    response=remove(client,plan);assert response.status_code==503
    assert client.get('/api/me').status_code==200

def test_expired_intent_or_other_owner_cannot_delete(client):
    import server
    register(client);plan=prepare(client);other=server.app.test_client();register(other,'second')
    assert remove(other,plan,confirmation='second').status_code==409
    with server.app.app_context():server.db().execute("UPDATE account_deletion_intents SET expires_at='2000-01-01T00:00:00+00:00'");server.db().commit()
    assert remove(client,plan).status_code==409 and client.get('/api/me').status_code==200

def test_old_backup_requires_current_ledger_and_never_resurrects_deleted_account(client,tmp_path,monkeypatch):
    import server,backup
    register(client);other=server.app.test_client();register(other,'second')
    secret=tmp_path/'secret';secret.write_text(server.app.secret_key,encoding='ascii')
    old=tmp_path/'old';backup.snapshot(server.DB_PATH,secret,old)
    plan=prepare(client);assert remove(client,plan).status_code==200
    current=tmp_path/'current';backup.snapshot(server.DB_PATH,secret,current)
    restored=tmp_path/'restored'
    with pytest.raises(ValueError,match='Latest deletion ledger'):backup.restore(old,restored)
    assert not restored.exists()
    other_secret=tmp_path/'other-secret';other_secret.write_text('different-installation-key',encoding='ascii')
    foreign=tmp_path/'foreign';backup.snapshot(server.DB_PATH,other_secret,foreign)
    with pytest.raises(ValueError,match='different installation'):backup.restore(old,restored,deletions_from=foreign)
    assert not restored.exists()
    backup.restore(old,restored,deletions_from=current);backup.check_backup(restored)
    monkeypatch.setattr(server,'DB_PATH',restored/'app.db')
    # Test client's preserved app context may hold an earlier connection.
    with server.app.app_context():
        assert server.db().execute('SELECT username FROM users ORDER BY id').fetchall()[0][0]=='second'
        assert server.db().execute('SELECT COUNT(*) FROM account_deletions').fetchone()[0]==1
    fresh=server.app.test_client();assert register(fresh).status_code==409
    assert fresh.post('/api/login',json={'username':'second','password':OLD}).status_code==200
    assert fresh.get('/api/learning-archive').status_code==200
