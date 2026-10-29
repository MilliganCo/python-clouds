import json,sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier,Event,current_thread,main_thread
import pytest
from test_platform import client,register

OLD='secret123';NEW='A new cloud passphrase 2026'

def setup_codes(client):
    result=client.post('/api/account/recovery-codes',json={'password':OLD})
    assert result.status_code==200
    return result.get_json()
def activate(client,batch):
    return client.post('/api/account/recovery-codes/activate',json={'activation_token':batch['activation_token']})

def test_old_session_stays_valid_and_security_setup_requires_password(client):
    register(client)
    result=client.get('/api/account/security');assert result.status_code==200
    assert result.get_json()['recovery_codes_remaining']==0
    assert client.post('/api/account/recovery-codes',json={'password':'wrong'}).status_code==403
    assert client.get('/api/me').status_code==200

def test_code_activation_is_explicit_idempotent_and_keeps_old_codes_until_confirmed(client):
    register(client);first=setup_codes(client)
    assert len(first['codes'])==8 and len(set(first['codes']))==8
    assert client.get('/api/account/security').get_json()['recovery_codes_remaining']==0
    assert activate(client,first).status_code==200
    assert activate(client,first).get_json()['replayed']
    assert client.get('/api/account/security').get_json()['recovery_codes_remaining']==8
    second=setup_codes(client)
    assert client.get('/api/account/security').get_json()['active_batch']==first['batch']
    assert activate(client,second).status_code==200
    assert client.get('/api/account/security').get_json()['active_batch']==second['batch']
    assert client.post('/api/account/recover',json={'username':'tester','code':first['codes'][0],'new_password':NEW}).status_code==400

def test_recovery_preserves_work_revokes_sessions_and_never_auto_logs_in(client):
    import server
    register(client);batch=setup_codes(client);assert activate(client,batch).status_code==200
    with server.app.app_context():
        uid=server.db().execute('SELECT id FROM users WHERE username=?',('tester',)).fetchone()[0]
        server.db().execute('INSERT INTO progress VALUES(?,?,?)',(uid,'0.1',server.now()))
        server.wallet_get(uid);server.wallet_add(uid,drops=123,freezes=2);server.db().commit()
    before_wallet=client.get('/api/wallet').get_json()
    other=server.app.test_client()
    assert other.post('/api/login',json={'username':'tester','password':OLD}).status_code==200
    anon=server.app.test_client()
    response=anon.post('/api/account/recover',json={'username':'tester','code':batch['codes'][0].lower().replace('-',' '),'new_password':NEW})
    assert response.status_code==200,response.get_json()
    assert 'Set-Cookie' not in response.headers
    assert anon.get('/api/me').status_code==401
    assert other.get('/api/progress').status_code==401 and client.get('/api/me').status_code==401
    assert anon.post('/api/login',json={'username':'tester','password':OLD}).status_code==401
    assert anon.post('/api/login',json={'username':'tester','password':NEW}).status_code==200
    assert anon.get('/api/wallet').get_json()['drops']==before_wallet['drops']
    assert anon.get('/api/wallet').get_json()['freezes']==before_wallet['freezes']
    assert '0.1' in anon.get('/api/progress').get_json()['solved']
    assert anon.get('/api/account/security').get_json()['recovery_codes_remaining']==0
    assert anon.post('/api/account/recover',json={'username':'tester','code':batch['codes'][1],'new_password':NEW}).status_code==400

def test_password_change_and_revoke_all_require_reauth_and_reject_old_cookies(client):
    import server
    register(client);other=server.app.test_client();other.post('/api/login',json={'username':'tester','password':OLD})
    assert client.post('/api/account/password',json={'password':'wrong','new_password':NEW}).status_code==403
    response=client.post('/api/account/password',json={'password':OLD,'new_password':NEW})
    assert response.status_code==200 and 'Set-Cookie' not in response.headers
    assert other.get('/api/me').status_code==401 and client.get('/api/me').status_code==401
    assert client.post('/api/login',json={'username':'tester','password':NEW}).status_code==200
    assert client.post('/api/account/revoke-sessions',json={'password':NEW}).status_code==200
    assert client.get('/api/me').status_code==401

def test_expired_unknown_and_used_codes_have_the_same_failure(client,monkeypatch):
    import server
    register(client);batch=setup_codes(client);activate(client,batch)
    base={'username':'tester','code':'0'*32,'new_password':NEW}
    wrong=client.post('/api/account/recover',json=base)
    unknown=client.post('/api/account/recover',json={**base,'username':'not_registered'})
    with server.app.app_context():
        server.db().execute("UPDATE account_recovery_codes SET expires_at='2000-01-01T00:00:00+00:00'");server.db().commit()
    expired=client.post('/api/account/recover',json={**base,'code':batch['codes'][0]})
    assert wrong.status_code==unknown.status_code==expired.status_code==400
    assert wrong.get_json()==unknown.get_json()==expired.get_json()

def test_only_hashes_are_stored_and_learning_archive_excludes_security_tables(client):
    import server
    register(client);batch=setup_codes(client)
    with sqlite3.connect(server.DB_PATH) as connection:
        dump='\n'.join(connection.iterdump())
    assert batch['activation_token'] not in dump
    assert all(code.replace('-','').lower() not in dump for code in batch['codes'])
    activate(client,batch)
    archive=client.get('/api/learning-archive').get_json()['payload']['tables']
    assert not any(name.startswith('account_') for name in archive)

def test_pending_setup_expires_without_replacing_active_codes(client):
    import server
    register(client);first=setup_codes(client);activate(client,first);second=setup_codes(client)
    with server.app.app_context():
        server.db().execute("UPDATE account_recovery_setup SET expires_at='2000-01-01T00:00:00+00:00'");server.db().commit()
    assert activate(client,second).status_code==409
    assert client.get('/api/account/security').get_json()['active_batch']==first['batch']

def test_concurrent_use_of_one_code_succeeds_once(client):
    import server
    register(client);batch=setup_codes(client);activate(client,batch);barrier=Barrier(2)
    def recover(_):
        with server.app.test_client() as anon:
            barrier.wait(timeout=5)
            return anon.post('/api/account/recover',json={'username':'tester','code':batch['codes'][0],'new_password':NEW}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(recover,range(2)))
    assert sorted(results)==[200,400]

def test_revoke_all_invalidates_mobile_access_and_refresh(client):
    import server
    register(client)
    mobile=server.app.test_client();login=mobile.post('/api/v1/mobile/login',json={'username':'tester','password':OLD,'device_id':'account-device','device_name':'Synthetic phone'})
    assert login.status_code==200;tokens=login.get_json()
    assert client.post('/api/account/revoke-sessions',json={'password':OLD}).status_code==200
    assert mobile.get('/api/v1/mobile/me',headers={'Authorization':'Bearer '+tokens['access_token']}).status_code==401
    assert mobile.post('/api/v1/mobile/refresh',json={'refresh_token':tokens['refresh_token'],'device_id':'account-device'}).status_code==401
    assert mobile.post('/api/v1/mobile/login',json={'username':'tester','password':OLD,'device_id':'account-device','device_name':'Synthetic phone'}).status_code==200

@pytest.mark.parametrize('kind',['web','mobile'])
def test_login_checked_before_password_change_cannot_create_a_fresh_session(client,monkeypatch,kind):
    import server,account_security
    register(client);checked=Event();release=Event();verify=account_security.verify_password
    def delayed(hashed,password):
        result=verify(hashed,password)
        if current_thread() is not main_thread():checked.set();assert release.wait(5)
        return result
    monkeypatch.setattr(account_security,'verify_password',delayed)
    def stale_login():
        with server.app.test_client() as stale:
            path='/api/login' if kind=='web' else '/api/v1/mobile/login'
            data={'username':'tester','password':OLD}
            if kind=='mobile':data.update(device_id='racing-device',device_name='Synthetic phone')
            response=stale.post(path,json=data)
            return response.status_code,'Set-Cookie' in response.headers
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending=pool.submit(stale_login);assert checked.wait(5)
        try:assert client.post('/api/account/password',json={'password':OLD,'new_password':NEW}).status_code==200
        finally:release.set()
        assert pending.result()==(401,False)
    assert client.post('/api/login',json={'username':'tester','password':NEW}).status_code==200

def test_recovery_rate_limit_cannot_be_reset_by_switching_cookie_identity(client):
    import server
    register(client);data={'username':'missing','code':'0'*32,'new_password':NEW}
    for _ in range(5):assert client.post('/api/account/recover',json=data).status_code==400
    anon=server.app.test_client();assert anon.post('/api/account/recover',json=data).status_code==400
    assert anon.post('/api/account/recover',json=data).status_code==429

def test_short_password_and_cross_account_code_never_change_credentials(client):
    import server
    register(client);batch=setup_codes(client);activate(client,batch)
    assert client.post('/api/account/password',json={'password':OLD,'new_password':'short'}).status_code==400
    register(client,'second')
    assert client.post('/api/account/recover',json={'username':'second','code':batch['codes'][0],'new_password':NEW}).status_code==400
    assert client.post('/api/login',json={'username':'tester','password':OLD}).status_code==200

def test_unicode_passphrase_preserves_exact_spaces(client):
    register(client);password='  пароль для облака 🐍 2026  '
    assert client.post('/api/account/password',json={'password':OLD,'new_password':password}).status_code==200
    assert client.post('/api/login',json={'username':'tester','password':password.strip()}).status_code==401
    assert client.post('/api/login',json={'username':'tester','password':password}).status_code==200

@pytest.mark.parametrize('path,body',[
    ('/api/login',{'username':'\ud800','password':OLD}),
    ('/api/register',{'username':'bad_unicode','password':'\ud800'*8}),
    ('/api/v1/mobile/login',{'username':'tester','password':OLD,'device_id':'abcdefgh','device_name':'\ud800'}),
    ('/api/v1/mobile/refresh',{'refresh_token':'\ud800','device_id':'abcdefgh'}),
])
def test_malformed_auth_unicode_returns_client_error_not_server_error(client,path,body):
    register(client);assert client.post(path,json=body).status_code in (400,401)
