"""Weekly focus reuses Atlas; server-owned credit and retained historical work."""
from test_platform import client,register
import copy,json,sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest


def focus(client):
    response=client.get('/api/weekly');assert response.status_code==200
    return response.get_json()['task']


def claim(client,task,**extra):
    return client.post('/api/atlas/'+task['id']+'/solve',json={'task_key':task['task_key'],'week_start':task['week_start'],**extra})


def fixed(monkeypatch):
    import server
    monkeypatch.setattr(server,'now',lambda:'2026-10-21T12:00:00+00:00')
    monkeypatch.setattr(server,'ai_available',lambda:False)
    return server


def daily_payload(server,payload):
    day=server.now()[:10];difficulty=payload.get('difficulty','intermediate')
    with server.app.app_context():
        server.db().execute('INSERT OR REPLACE INTO daily_ai_tasks(day,difficulty,payload) VALUES (?,?,?)',(day,difficulty,json.dumps(payload)))
        server.db().commit()
    return {'day':day,'difficulty':difficulty,'task_key':server._daily_task_key(payload)}


def row_counts(server):
    with server.app.app_context():
        return tuple(server.db().execute('SELECT COUNT(*) FROM '+table).fetchone()[0] for table in ('atlas_solves','weekly_reward_keys'))


def test_weekly_is_a_prepared_focus_without_model_or_reading_reward(client,monkeypatch):
    import server
    monkeypatch.setattr(server,'now',lambda:'2026-10-21T12:00:00+00:00')
    monkeypatch.setattr(server,'call_opencode_json',lambda *_a,**_k: (_ for _ in ()).throw(AssertionError('No model for weekly')))
    register(client)
    before=client.get('/api/wallet').get_json()['drops']
    response=client.get('/api/weekly')
    assert response.status_code==200
    data=response.get_json()
    assert data['ready'] and data['week_start']=='2026-10-19' and data['week_end']=='2026-10-25'
    assert data['task']['origin']=='weekly' and data['task']['available_reward']==30
    assert 'solution' not in str(data) and 'negative_codes' not in str(data)
    assert client.get('/api/wallet').get_json()['drops']==before


def test_first_solve_repeat_and_rotating_same_id_pay_once(client,monkeypatch):
    server=fixed(monkeypatch);register(client);task=focus(client)
    assert claim(client,task,reward=90000).get_json()['awarded']==30
    assert claim(client,task).get_json()['awarded']==0
    assert focus(client)['available_reward']==0
    monkeypatch.setattr(server,'now',lambda:'2026-11-18T12:00:00+00:00')
    again=focus(client);assert again['id']==task['id'] and again['week_start']!=task['week_start']
    assert claim(client,again).get_json()['awarded']==0
    assert client.get('/api/wallet').get_json()['drops']==30
    assert row_counts(server)==(1,1)


def test_published_payload_is_immutable_and_future_tasks_hidden(client,monkeypatch):
    server=fixed(monkeypatch);register(client);task=focus(client)
    before=client.get('/api/atlas/'+task['id']).get_json()['task']
    changed=copy.deepcopy(server.WEEKLY_BANK);changed['tasks'][0]['prompt']='Changed on disk';changed['tasks'][0]['solution']='different'
    monkeypatch.setattr(server,'WEEKLY_BANK',changed)
    assert client.get('/api/atlas/'+task['id']).get_json()['task']==before
    future=server.WEEKLY_BANK['tasks'][1]['id']
    assert client.get('/api/atlas/'+future).status_code==404
    assert client.post('/api/atlas/'+future+'/solve',json={}).status_code==404
    assert row_counts(server)==(0,0)


@pytest.mark.parametrize('defect',['missing','key','week','future_week'])
def test_invalid_claim_or_rollover_never_writes_a_solve(client,monkeypatch,defect):
    server=fixed(monkeypatch);register(client);task=focus(client)
    data={'task_key':task['task_key'],'week_start':task['week_start']}
    if defect=='missing':data={}
    elif defect=='key':data['task_key']='wrong'
    elif defect=='week':data['week_start']='2026-10-12'
    else:data['week_start']='2026-10-26'
    response=client.post('/api/atlas/'+task['id']+'/solve',json=data)
    assert response.status_code==409 and response.get_json()['code']=='weekly_changed'
    assert row_counts(server)==(0,0)
    assert client.get('/api/wallet').get_json()['drops']==0


def test_old_editor_rollover_is_explicit_then_old_task_is_free_practice(client,monkeypatch):
    server=fixed(monkeypatch);register(client);old=focus(client)
    monkeypatch.setattr(server,'now',lambda:'2026-10-26T00:00:00+00:00')
    new=focus(client);assert new['id']!=old['id']
    assert claim(client,old).status_code==409
    reopened=client.get('/api/atlas/'+old['id']).get_json()['task']
    assert not reopened['weekly_current'] and reopened['available_reward']==0
    assert claim(client,reopened).get_json()['awarded']==0
    assert claim(client,new).get_json()['awarded']==30
    assert client.get('/api/wallet').get_json()['drops']==30


@pytest.mark.parametrize('order',['daily_first','weekly_first','legacy_without_journal','atlas_today_first'])
def test_daily_copy_and_weekly_identity_cannot_pay_twice(client,monkeypatch,order):
    server=fixed(monkeypatch);register(client);task=focus(client)
    payload=server.WEEKLY_BANK['tasks'][0];daily=daily_payload(server,payload)
    if order=='weekly_first':
        # A real historical solve by another owner protects an already published
        # daily payload; new generation would otherwise reject this copied task.
        with server.app.test_client() as other:
            register(other,name='paid_daily_other')
            assert other.post('/api/daily-ai/solve',json=daily).get_json()['awarded']==30
    first=0
    if order in ('daily_first','legacy_without_journal'):
        first=client.post('/api/daily-ai/solve',json=daily).get_json()['awarded']
    elif order=='atlas_today_first':
        first=client.post('/api/atlas/day-'+daily['day']+'-'+daily['difficulty']+'/solve',json=daily).get_json()['awarded']
    else:first=claim(client,task).get_json()['awarded']
    assert first==30
    if order=='legacy_without_journal':
        with server.app.app_context():server.db().execute('DELETE FROM weekly_reward_keys');server.db().commit()
    if order=='weekly_first':
        assert client.get('/api/daily-ai').get_json()['drops'][daily['difficulty']]==0
        assert client.post('/api/daily-ai/solve',json=daily).get_json()['awarded']==0
    else:
        assert focus(client)['available_reward']==0
        assert claim(client,task).get_json()['awarded']==0
    assert client.get('/api/wallet').get_json()['drops']==30


@pytest.mark.parametrize('order',['seed_first','weekly_first'])
def test_seed_alias_copy_is_checked_by_content_not_task_id(client,monkeypatch,order):
    server=fixed(monkeypatch)
    bank=copy.deepcopy(server.WEEKLY_BANK);bank['tasks'][0].update(server.ATLAS_SEEDS['seed-parcel']);bank['tasks'][0]['id']='weekly-alias-v1'
    monkeypatch.setattr(server,'WEEKLY_BANK',bank);register(client);task=focus(client)
    if order=='seed_first':
        assert client.post('/api/atlas/seed-parcel/solve').get_json()['awarded']==30
        # Simulates an actual pre-feature payout: no new journal is available.
        with server.app.app_context():server.db().execute('DELETE FROM weekly_reward_keys');server.db().commit()
        assert claim(client,task).get_json()['awarded']==0
    else:
        assert claim(client,task).get_json()['awarded']==30
        assert client.get('/api/atlas/seed-parcel').get_json()['task']['available_reward']==0
        assert client.post('/api/atlas/seed-parcel/solve').get_json()['awarded']==0
    assert client.get('/api/wallet').get_json()['drops']==30


def test_unrelated_legacy_daily_repeat_policy_is_preserved(client,monkeypatch):
    server=fixed(monkeypatch);register(client);payload=server.ATLAS_SEEDS['seed-parcel']
    for day in ('2026-10-20','2026-10-21'):
        monkeypatch.setattr(server,'now',lambda day=day:day+'T12:00:00+00:00')
        daily=daily_payload(server,payload)
        assert client.post('/api/daily-ai/solve',json=daily).get_json()['awarded']==30
    assert client.get('/api/wallet').get_json()['drops']==60


@pytest.mark.parametrize('other',['weekly','daily'])
def test_parallel_claims_have_one_credit_winner(client,monkeypatch,other):
    server=fixed(monkeypatch);register(client);task=focus(client)
    daily=daily_payload(server,server.WEEKLY_BANK['tasks'][0])
    barrier=Barrier(2)
    def run(index):
        with server.app.test_client() as worker:
            assert worker.post('/api/login',json={'username':'tester','password':'secret123'}).status_code==200
            barrier.wait(timeout=3)
            response=claim(worker,task) if index==0 or other=='weekly' else worker.post('/api/daily-ai/solve',json=daily)
            assert response.status_code==200
            return response.get_json()['awarded']
    with ThreadPoolExecutor(max_workers=2) as pool:amounts=list(pool.map(run,range(2)))
    assert sorted(amounts)==[0,30]
    assert client.get('/api/wallet').get_json()['drops']==30


def test_late_wallet_failure_rolls_back_solve_and_credit_marker(client,monkeypatch):
    server=fixed(monkeypatch);register(client);client.get('/api/wallet');task=focus(client)
    with server.app.app_context():
        server.db().execute("CREATE TRIGGER fail_weekly BEFORE UPDATE ON wallet BEGIN SELECT RAISE(ABORT,'synthetic weekly failure'); END")
        server.db().commit()
    with pytest.raises(sqlite3.IntegrityError,match='synthetic weekly failure'):claim(client,task)
    assert row_counts(server)==(0,0)
    assert client.get('/api/wallet').get_json()['drops']==0


def test_weekly_catalog_is_opt_in_and_status_and_owner_are_preserved(client,monkeypatch):
    fixed(monkeypatch);register(client);task=focus(client)
    old=client.get('/api/atlas').get_json();assert all(t['origin']!='weekly' for t in old['items'])
    assert client.get('/api/atlas?source=seed').get_json()['total']==12
    group=client.get('/api/atlas?source=weekly').get_json()
    assert group['total']==1 and group['items'][0]['id']==task['id']
    assert claim(client,task).get_json()['awarded']==30
    assert client.get('/api/atlas?source=weekly&status=unsolved').get_json()['total']==0
    assert client.get('/api/atlas?source=weekly&status=solved').get_json()['total']==1
    register(client,name='weekly_other')
    assert focus(client)['available_reward']==30 and not focus(client)['solved']


def test_archive_v1_remains_signed_and_compatible_without_resetting_new_credit(client,monkeypatch):
    import learning_archive as archive
    server=fixed(monkeypatch);register(client);task=focus(client)
    old=client.get('/api/learning-archive').get_json()
    old['payload']['version']=1;old['payload']['tables'].pop('weekly_reward_keys');old['payload']['contexts'].pop('weekly_assignments')
    for table in archive.WORKSHOP_TABLES:old['payload']['tables'].pop(table)
    old['signature']=archive.mac(server.app.secret_key,archive.FORMAT,old['payload'])
    original=copy.deepcopy(old)
    assert claim(client,task).get_json()['awarded']==30
    preview=client.post('/api/learning-archive/preview',json={'archive':old,'choice':'use_archive'})
    assert preview.status_code==200,preview.get_json()
    restored=client.post('/api/learning-archive/restore',json={'archive':old,'choice':'use_archive','token':preview.get_json()['token']})
    assert restored.status_code==200 and old==original
    assert row_counts(server)==(1,1)
    assert claim(client,task).get_json()['awarded']==0
    assert client.get('/api/wallet').get_json()['drops']==30


def test_archive_v2_keeps_weekly_definition_and_reward_guard(client,monkeypatch):
    import learning_archive as archive
    server=fixed(monkeypatch);register(client);task=focus(client);claim(client,task)
    saved=client.get('/api/learning-archive').get_json()
    assert saved['payload']['version']==archive.VERSION
    # Exercise an actual historical v2 envelope, without the later workshop sections.
    saved['payload']['version']=2
    for table in archive.WORKSHOP_TABLES:saved['payload']['tables'].pop(table)
    saved['signature']=archive.mac(server.app.secret_key,archive.FORMAT,saved['payload'])
    assert len(saved['payload']['tables']['weekly_reward_keys'])==1
    assert saved['payload']['contexts']['weekly_assignments'][0]['task_id']==task['id']
    with server.app.app_context():
        for table in ('weekly_reward_keys','weekly_assignments','atlas_solves'):server.db().execute('DELETE FROM '+table)
        server.db().commit()
    plan=client.post('/api/learning-archive/preview',json={'archive':saved,'choice':'keep_current'}).get_json()
    response=client.post('/api/learning-archive/restore',json={'archive':saved,'choice':'keep_current','token':plan['token']})
    assert response.status_code==200,response.get_json()
    assert row_counts(server)==(1,1)
    assert claim(client,focus(client)).get_json()['awarded']==0
    assert client.get('/api/wallet').get_json()['drops']==30


def test_restore_merges_the_stronger_weekly_credit_proof_without_repaying(client,monkeypatch):
    server=fixed(monkeypatch);register(client);task=focus(client);claim(client,task)
    saved=client.get('/api/learning-archive').get_json()
    with server.app.app_context():
        server.db().execute("UPDATE weekly_reward_keys SET first_source='legacy_daily',source_id='earlier-backup'")
        server.db().commit()
    plan=client.post('/api/learning-archive/preview',json={'archive':saved,'choice':'keep_current'}).get_json()
    response=client.post('/api/learning-archive/restore',json={'archive':saved,'choice':'keep_current','token':plan['token']})
    assert response.status_code==200,response.get_json()
    daily=daily_payload(server,server.WEEKLY_BANK['tasks'][0])
    assert client.post('/api/daily-ai/solve',json=daily).get_json()['awarded']==0
    assert client.get('/api/wallet').get_json()['drops']==30


def test_shared_weekly_context_is_not_overwritten_by_restore(client,monkeypatch):
    server=fixed(monkeypatch);register(client);task=focus(client);claim(client,task)
    saved=client.get('/api/learning-archive').get_json()
    with server.app.app_context():
        server.db().execute("UPDATE weekly_assignments SET content_key='different'");server.db().commit()
    response=client.post('/api/learning-archive/preview',json={'archive':saved,'choice':'use_archive'})
    assert response.status_code==409
    with server.app.app_context():assert server.db().execute('SELECT content_key FROM weekly_assignments').fetchone()[0]=='different'


def test_iso_week_boundary_and_no_publication_before_anchor(client,monkeypatch):
    import weekly_practice
    server=fixed(monkeypatch);register(client)
    monkeypatch.setattr(server,'now',lambda:'2026-10-18T23:59:59+00:00')
    assert client.get('/api/weekly').get_json()=={'ready':False}
    assert weekly_practice.week_start('2027-01-01T12:00:00+00:00')=='2026-12-28'
    assert weekly_practice.week_end('2026-12-28')=='2027-01-03'


def test_weekly_collection_does_not_schedule_unrelated_daily_generation(client,monkeypatch):
    server=fixed(monkeypatch);register(client)
    monkeypatch.setattr(server,'_get_daily_ai',lambda *_: (_ for _ in ()).throw(AssertionError('No daily/model work for weekly filter')))
    response=client.get('/api/atlas?source=weekly')
    assert response.status_code==200 and response.get_json()['total']==1
    assert response.get_json()['daily_state_checked'] is False


def test_daily_and_personal_generation_cannot_recycle_curated_weekly_content(client,monkeypatch):
    server=fixed(monkeypatch);register(client)
    with server.app.app_context():
        history=server._challenge_history()
        assert all(not server._challenge_is_new(task,history) for task in server.WEEKLY_BANK['tasks'])
