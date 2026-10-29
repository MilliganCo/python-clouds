"""Expected web identity prevents stale-tab requests from using a newer cookie."""
from urllib.parse import quote
from pathlib import Path
import subprocess
import pytest

from test_platform import client, register


def login(client,name):
    assert client.post('/api/login',json={'username':name,'password':'secret123'}).status_code==200


def test_stale_actor_cannot_write_progress_or_logout_new_owner(client):
    register(client,name='scope_first')
    client.post('/api/logout')
    register(client,name='scope_second')
    before=client.get('/api/progress').get_json()
    headers={'X-Pycloud-User':quote('scope_first',safe='')}
    response=client.post('/api/progress',json={'task_id':'0.1','solved':True},headers=headers)
    assert response.status_code==409 and response.get_json()['code']=='session_changed'
    assert client.post('/api/logout',headers=headers).status_code==409
    assert client.get('/api/me').get_json()['username']=='scope_second'
    assert client.get('/api/progress').get_json()==before


def test_stale_actor_never_reaches_execution_admission(client,monkeypatch):
    import server
    register(client,name='scope_first');client.post('/api/logout');register(client,name='scope_second')
    monkeypatch.setattr(server.sandbox.pool,'create',lambda *a,**kw:pytest.fail('Foreign request must stop before sandbox'))
    response=client.post('/api/python/run',json={'code':'print(1)'},headers={'X-Pycloud-User':'scope_first'})
    assert response.status_code==409 and response.get_json()['code']=='session_changed'


def test_matching_encoded_identity_and_legacy_requests_keep_working(client):
    register(client,name='ученик')
    headers={'X-Pycloud-User':quote('ученик',safe='')}
    assert client.get('/api/me',headers=headers).status_code==200
    assert client.get('/api/progress',headers=headers).status_code==200
    assert client.get('/api/me').status_code==200  # Compatibility is explicit, not anti-cheat.
    assert client.get('/api/me',headers={'X-Pycloud-User':'other'}).status_code==409


def test_marker_without_cookie_is_not_authentication(client):
    response=client.get('/api/progress',headers={'X-Pycloud-User':'somebody'})
    assert response.status_code==409 and response.get_json()['code']=='session_changed'


def test_client_session_scope_and_late_body_guards():
    subprocess.run(['node',str(Path(__file__).resolve().parents[1]/'scripts/verify_session_scope_unit.cjs')],check=True)


def test_stale_content_stops_writes_and_execution_without_logging_out(client,monkeypatch):
    import server
    register(client,name='content_owner')
    before=client.get('/api/progress').get_json()
    wrong='a'*64 if server.CONTENT_SNAPSHOT.generation!='a'*64 else 'b'*64
    headers={'X-Pycloud-Content':wrong}
    monkeypatch.setattr(server.sandbox.pool,'create',lambda *a,**kw:pytest.fail('Stale content must stop before execution'))
    for url,payload in [('/api/progress',{'task_id':'0.1','solved':True}),('/api/python/run',{'code':'print(1)'})]:
        response=client.post(url,json=payload,headers=headers)
        assert response.status_code==409 and response.get_json()['code']=='content_changed'
    assert client.get('/api/me',headers=headers).get_json()['username']=='content_owner'
    assert client.get('/api/progress').get_json()==before
    if server.CONTENT_SNAPSHOT.generation:
        assert client.get('/api/progress',headers={'X-Pycloud-Content':server.CONTENT_SNAPSHOT.generation}).status_code==200


def test_stale_content_allows_job_control_and_auth_routes(client):
    import server
    headers={'X-Pycloud-Content':'f'*64}
    for path in ('/api/python/'+'1'*32+'/input','/api/python/'+'1'*32+'/cancel',
                 '/api/me','/api/health','/api/login','/api/register','/api/logout'):
        with server.app.test_request_context(path,method='POST',headers=headers):
            assert server.require_loaded_content_generation() is None,path
