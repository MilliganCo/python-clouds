import json,sqlite3,time
from concurrent.futures import ThreadPoolExecutor
from threading import Event
import pytest
from test_platform import client,register

def preferences(client):
    response=client.get('/api/ai/settings');assert response.status_code==200,response.get_json();return response.get_json()['preferences']
def change(client,**fields):
    return client.patch('/api/ai/settings',json={'version':preferences(client)['version'],**fields})

def test_optout_is_server_enforced_without_disabling_learning(client,monkeypatch):
    import server
    register(client)
    assert change(client,enabled=False).status_code==200
    monkeypatch.setattr(server,'call_opencode',lambda *a,**kw:pytest.fail('Disabled account reached a model'))
    response=client.post('/api/ai/ask',json={'task':{'id':'0.1'},'question':'Explain a value'})
    assert response.status_code==403 and response.get_json()['code']=='ai_disabled'
    assert client.get('/api/progress').status_code==200
    assert client.post('/api/notes',json={'task_id':'0.1','text':'Own note'}).status_code==200

def test_automatic_review_optout_and_preference_cas(client,monkeypatch):
    import server
    register(client);old=preferences(client)
    assert change(client,automatic_review=False).status_code==200
    assert client.patch('/api/ai/settings',json={'version':old['version'],'enabled':False}).status_code==409
    monkeypatch.setattr(server,'call_opencode',lambda *a,**kw:pytest.fail('Opted-out automatic review reached a model'))
    response=client.post('/api/ai/review',json={'task':{'id':'0.1'},'attempt':{'ok':True,'code':'print(1)'},'automatic':True})
    assert response.status_code==200 and response.get_json()['reason']=='automatic_review_disabled'

def fake_model(monkeypatch,server,calls):
    monkeypatch.setattr(server,'AI_REMOTE_ENABLED',True);monkeypatch.setattr(server,'OPENCODE_BIN','synthetic-model-only')
    monkeypatch.setattr(server,'_run_opencode',lambda prompt:(calls.append(prompt) or json.dumps({'reply':'A useful explanation','review':'Подумайте о типе значения','memory':{'note':'new fact'}})))

def test_erasing_chat_never_resets_daily_quota_or_spending(client,monkeypatch):
    import server
    register(client);calls=[];fake_model(monkeypatch,server,calls)
    with server.app.app_context():
        uid=server.db().execute("SELECT id FROM users WHERE username='tester'").fetchone()[0]
        for _ in range(server.AI_FREE_QUESTIONS_PER_DAY):server.db().execute('INSERT INTO ai_messages(user_id,task_id,role,text,created_at) VALUES(?,?,?,?,?)',(uid,'0.1','user','old question',server.now()))
        server.wallet_get(uid);server.wallet_add(uid,drops=100);server.db().commit()
    before=client.get('/api/wallet').get_json()['drops']
    cleared=client.post('/api/ai/clear',json={'section':'chat','confirmed':True});assert cleared.status_code==200
    assert cleared.get_json()['counts']['chat']==0 and cleared.get_json()['usage_today']==server.AI_FREE_QUESTIONS_PER_DAY
    response=client.post('/api/ai/ask',json={'task':{'id':'0.1'},'question':'Explain a value'});assert response.status_code==200,response.get_json()
    assert response.get_json()['cost']==server.AI_QUESTION_PRICE and response.get_json()['free_left']==0
    assert client.get('/api/wallet').get_json()['drops']==before-server.AI_QUESTION_PRICE
    assert client.post('/api/ai/clear',json={'section':'chat','confirmed':True}).get_json()['usage_today']==server.AI_FREE_QUESTIONS_PER_DAY+1
    assert len(calls)==1

def test_history_optout_excludes_prior_prose_memory_and_attempts(client,monkeypatch):
    import server
    register(client);calls=[];fake_model(monkeypatch,server,calls)
    with server.app.app_context():
        uid=server.db().execute("SELECT id FROM users WHERE username='tester'").fetchone()[0]
        server.memory_set(uid,'ai:note','PRIVATE_MEMORY')
        server.db().execute('INSERT INTO ai_messages(user_id,task_id,role,text,created_at) VALUES(?,?,?,?,?)',(uid,'0.1','user','PRIVATE_CHAT',server.now()))
        server.record_attempt(uid,'0.1',server.normalize_attempt({'ok':False,'code':'PRIVATE_ATTEMPT'}))
    assert change(client,history_context=False).status_code==200
    assert client.post('/api/ai/ask',json={'task':{'id':'0.1'},'question':'CURRENT_QUESTION'}).status_code==200
    assert client.post('/api/ai/review',json={'task':{'id':'0.1','type':'code'},'attempt':{'ok':False,'code':'print(0)'}}).status_code==200
    assert len(calls)==2 and 'CURRENT_QUESTION' in calls[0]
    assert all(marker not in '\n'.join(calls) for marker in ('PRIVATE_MEMORY','PRIVATE_CHAT','PRIVATE_ATTEMPT'))

def test_retention_requires_confirmation_and_only_prunes_selected_owners_old_prose(client):
    import server
    register(client);other=server.app.test_client();register(other,'second')
    with server.app.app_context():
        for user, in server.db().execute('SELECT id FROM users'):
            server.db().execute('INSERT INTO ai_messages(user_id,task_id,role,text,created_at) VALUES(?,?,?,?,?)',(user,'0.1','user','old','2000-01-01T00:00:00+00:00'))
            server.db().execute('INSERT INTO ai_memory VALUES(?,?,?,?)',(user,'ai:old','old','2000-01-01T00:00:00+00:00'))
        server.db().commit()
    assert client.get('/api/ai/settings').get_json()['counts']['chat']==1
    assert change(client,retention_days=30).status_code==409
    assert client.get('/api/ai/settings').get_json()['counts']['chat']==1
    response=change(client,retention_days=30,confirm_retention=True);assert response.status_code==200
    assert response.get_json()['counts']['chat']==response.get_json()['counts']['memory']==0
    assert other.get('/api/ai/settings').get_json()['counts']['chat']==1
    assert other.get('/api/ai/settings').get_json()['counts']['memory']==1

def test_busy_user_is_rejected_without_waiting_and_clear_cannot_race_a_reply(client,monkeypatch):
    import server,ai_controls
    register(client);entered=Event();release=Event();calls=[];fake_model(monkeypatch,server,calls)
    def slow(prompt):entered.set();assert release.wait(5);return json.dumps({'reply':'Completed','memory':{'note':'one fact'}})
    monkeypatch.setattr(server,'_run_opencode',slow)
    first=server.app.test_client();first.post('/api/login',json={'username':'tester','password':'secret123'})
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending=pool.submit(lambda:first.post('/api/ai/ask',json={'task':{'id':'0.1'},'question':'Slow synthetic question'}).status_code)
        assert entered.wait(5);started=time.monotonic()
        try:
            busy=client.post('/api/ai/ask',json={'task':{'id':'0.1'},'question':'Do not queue'})
            assert busy.status_code==503 and busy.get_json()['code']=='ai_busy' and busy.headers['Retry-After']=='3'
            assert time.monotonic()-started<1
            assert client.post('/api/ai/clear',json={'section':'memory','confirmed':True}).status_code==503
        finally:release.set()
        assert pending.result()==200
    assert ai_controls.admission.snapshot()['active']==0
    assert client.post('/api/ai/clear',json={'section':'memory','confirmed':True}).get_json()['counts']['memory']==0

def test_global_capacity_is_bounded_and_releases_on_failures():
    import ai_controls
    budget=ai_controls.Admission(2)
    with budget.slot(),budget.slot():
        with pytest.raises(ai_controls.AIBusy):
            with budget.slot():pytest.fail('over-admission')
        assert budget.snapshot()['active']==2
    with pytest.raises(RuntimeError):
        with budget.slot():raise RuntimeError('synthetic provider failure')
    assert budget.snapshot()['active']==0 and budget.snapshot()['rejected']==1

def test_explicit_attempt_clear_preserves_progress_notes_wallet_and_other_owner(client):
    import server
    register(client);other=server.app.test_client();register(other,'second')
    for target in (client,other):
        target.post('/api/progress',json={'task_id':'0.1','solved':True})
        target.post('/api/notes',json={'task_id':'0.1','text':'Keep this note'})
        for ok in (False,True):assert target.post('/api/attempts',json={'task_id':'0.1','attempt':{'ok':ok,'text':'a value'}}).status_code==200
    before_progress=client.get('/api/progress').get_json();before_wallet=client.get('/api/wallet').get_json()
    other_count=other.get('/api/ai/settings').get_json()['counts']['attempts']
    assert client.post('/api/ai/clear',json={'section':'attempts','confirmed':False}).status_code==400
    response=client.post('/api/ai/clear',json={'section':'attempts','confirmed':True});assert response.get_json()['counts']['attempts']==0
    assert client.get('/api/progress').get_json()==before_progress
    assert client.get('/api/wallet').get_json()['drops']==before_wallet['drops']
    assert client.get('/api/notes?task_id=0.1').get_json()['text']=='Keep this note'
    assert other.get('/api/ai/settings').get_json()['counts']['attempts']==other_count
    assert client.get('/api/review-history').get_json()=={'tasks':[],'total':0}

def test_report_clear_keeps_paid_receipt_and_never_recharges(client,monkeypatch):
    import server
    from test_workshop import create,money
    register(client);money(100);project=create(client).get_json()['project'];url='/api/workshop/'+project['id']+'/review'
    monkeypatch.setattr(server,'ai_available',lambda:True)
    monkeypatch.setattr(server,'call_opencode',lambda *a,**k:('Проверьте обработку входных данных в main.py. Это замечание к сохранённому коду, без выполнения программы.',{}))
    body={'revision':1,'confirmed_price':40};assert client.post(url,json=body).status_code==200
    balance=client.get('/api/wallet').get_json()['drops']
    assert client.post('/api/ai/clear',json={'section':'project_reviews','confirmed':True}).get_json()['counts']['project_reviews']==0
    monkeypatch.setattr(server,'call_opencode',lambda *a,**k:pytest.fail('Cleared paid receipt must not rerun'))
    response=client.post(url,json=body);assert response.status_code==200 and response.get_json()['cached'] and response.get_json()['report']==''
    assert client.get('/api/wallet').get_json()['drops']==balance

def test_riddle_clear_finishes_current_round_without_resetting_daily_allowance(client):
    register(client);assert client.post('/api/riddle/turn',json={'message':''}).status_code==200
    assert client.post('/api/ai/clear',json={'section':'riddles','confirmed':True}).status_code==200
    state=client.get('/api/riddle/status').get_json();assert state['history']==[] and state['left']==0 and state['finished']
    assert client.post('/api/riddle/turn',json={'message':'A'}).get_json()['engine']=='limit'

def test_mobile_optout_and_global_off_never_reach_provider(client,monkeypatch):
    import server
    register(client);token=client.post('/api/v1/mobile/login',json={'username':'tester','password':'secret123','device_id':'synthetic-mobile','device_name':'Synthetic'}).get_json()['access_token']
    assert change(client,enabled=False).status_code==200
    monkeypatch.setattr(server,'_run_opencode',lambda *a,**k:pytest.fail('Disabled remote provider called'))
    response=client.post('/api/v1/mobile/ai/ask',headers={'Authorization':'Bearer '+token},json={'task':{'id':'0.1'},'question':'Explain'})
    assert response.status_code==403 and response.get_json()['code']=='ai_disabled'
    assert change(client,enabled=True).status_code==200
    monkeypatch.setattr(server,'AI_REMOTE_ENABLED',False)
    assert client.post('/api/ai/ask',json={'task':{'id':'0.1'},'question':'Explain'}).status_code==503
    assert client.get('/api/hints?task_id=0.1').status_code==200
    exported=client.get('/api/learning-archive').get_json()['payload']['tables']
    assert 'ai_preferences' not in exported and 'ai_usage_days' not in exported

def test_reused_app_context_does_not_apply_another_mobile_accounts_preferences(client,monkeypatch):
    import server
    register(client);other=server.app.test_client();register(other,'second');change(other,enabled=False)
    tokens=other.post('/api/v1/mobile/login',json={'username':'second','password':'secret123','device_id':'synthetic-other','device_name':'Synthetic'}).get_json()
    calls=[];fake_model(monkeypatch,server,calls)
    web=server.app.test_client();assert web.post('/api/login',json={'username':'tester','password':'secret123'}).status_code==200
    with server.app.app_context():
        assert other.get('/api/v1/mobile/me',headers={'Authorization':'Bearer '+tokens['access_token']}).status_code==200
        response=web.post('/api/ai/ask',json={'task':{'id':'0.1'},'question':'Current web owner'})
        assert response.status_code==200,response.get_json()
    assert len(calls)==1
