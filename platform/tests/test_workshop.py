import json
import secrets
import pytest
from test_platform import client, register
import workshop

def create(client,**values):
    return client.post('/api/workshop',json=dict(id=secrets.token_hex(16),name='Мой проект',**values))
def owned(key):
    import server
    with server.app.app_context():
        uid=server.db().execute('SELECT id FROM users ORDER BY id LIMIT 1').fetchone()[0]
        server.grant_item(uid,key);server.db().commit()
def money(amount):
    import server
    with server.app.app_context():
        uid=server.db().execute('SELECT id FROM users ORDER BY id LIMIT 1').fetchone()[0]
        server.wallet_get(uid);server.db().execute('UPDATE wallet SET drops=? WHERE user_id=?',(amount,uid));server.db().commit()
def save_body(project,**values):return dict(name=project['name'],files=project['files'],entry=project['entry'],revision=project['revision'],mutation_id=secrets.token_hex(16),**values)

def test_free_capacity_archive_and_expansion(client):
    register(client)
    projects=[create(client).get_json()['project'] for _ in range(3)]
    assert create(client).status_code==409
    first=projects[0];url='/api/workshop/'+first['id']
    assert client.post(url+'/archive',json=dict(revision=1,archived=True)).status_code==200
    assert create(client).status_code==200
    assert client.post(url+'/archive',json=dict(revision=2,archived=False)).status_code==409
    owned('workshop_expansion')
    assert client.get('/api/workshop').get_json()['capacity']==12
    assert client.post(url+'/archive',json=dict(revision=2,archived=False)).status_code==200
    assert client.get(url).get_json()['project']['files']==first['files']

def test_create_and_save_are_idempotent_and_conflicts_preserve_both_versions(client):
    register(client);body=dict(id=secrets.token_hex(16),name='А');first=client.post('/api/workshop',json=body).get_json()['project']
    assert client.post('/api/workshop',json=body).get_json()['project']==first
    url='/api/workshop/'+first['id'];body=save_body(first);body['files']=[dict(name='main.py',code='print(42)')]
    saved=client.post(url+'/save',json=body).get_json()['project']
    assert saved['revision']==2
    assert client.post(url+'/save',json=body).get_json()['project']==saved
    stale=save_body(first);response=client.post(url+'/save',json=stale)
    assert response.status_code==409 and response.get_json()['current']['files']==saved['files']
    assert client.get(url+'/versions/1').get_json()['files']==first['files']
    assert client.get(url+'/versions/2').get_json()['files']==saved['files']

@pytest.mark.parametrize('files,entry',[
    ([dict(name='../main.py',code='')],'../main.py'),([dict(name='C:/main.py',code='')],'C:/main.py'),
    ([dict(name='main.py',code='x'*50000)],'main.py'),([dict(name='main.py',code=None)],'main.py'),
    ([dict(name='a.py',code=''),dict(name='A.py',code='')],'a.py'),([dict(name='a.txt',code='')],'a.txt'),
])
def test_file_bounds(client,files,entry):
    register(client);assert create(client,files=files,entry=entry).status_code in (400,413)

def test_owner_isolation_and_catalog_entitlements(client):
    register(client);first=create(client,catalog_id='repair').get_json()['project'];url='/api/workshop/'+first['id']
    assert create(client,catalog_id='booking').status_code==403
    owned('workshop_pack_booking');assert create(client,catalog_id='booking').status_code==200
    register(client,'second');assert client.get(url).status_code==404
    assert client.post(url+'/run',json={'revision':1}).status_code==404
    assert client.post(url+'/save',json=save_body(first)).status_code==404
    assert client.get(url+'/versions/1').status_code==404
    assert not client.get('/api/workshop').get_json()['projects']

def test_tools_ownership_csv_json_diff_and_no_writes(client):
    register(client);project=create(client,files=[dict(name='main.py',code=''),dict(name='data.csv',code='name,price\n"Анна, А",12\n'),dict(name='config.json',code='{"safe":"<script>"}')]).get_json()['project'];url='/api/workshop/'+project['id']+'/tool'
    body=dict(revision=1,tool='csv',file='data.csv')
    assert client.post(url,json=body).status_code==403
    owned('tool_csv');response=client.post(url,json=body).get_json();assert response['rows']==[['Анна, А','12']]
    owned('tool_json');assert client.post(url,json=dict(revision=1,tool='json',file='config.json')).get_json()['value']=={'safe':'<script>'}
    owned('tool_diff');assert '+{"safe"' in client.post(url,json=dict(revision=1,tool='diff',file='main.py',other='config.json')).get_json()['diff']
    assert client.get('/api/workshop/'+project['id']).get_json()['project']['revision']==1

def test_runtime_failure_preserves_project_and_wallet(client):
    register(client);money(100);project=create(client).get_json()['project']
    response=client.post('/api/workshop/'+project['id']+'/run',json={'revision':1})
    assert response.status_code==503
    assert client.get('/api/workshop/'+project['id']).get_json()['project']==project
    assert client.get('/api/wallet').get_json()['drops']==100

def test_server_checks_and_run_history_use_saved_revision(client,monkeypatch):
    register(client);project=create(client,catalog_id='repair').get_json()['project'];seen=[]
    def execution(srv,uid,code,check=''):
        seen.append((code,check));return dict(stdout='WORKSHOP_OK\n',user_stdout='',check_stdout='WORKSHOP_OK\n',error=None)
    monkeypatch.setattr(workshop,'collect',execution)
    url='/api/workshop/'+project['id'];result=client.post(url+'/run',json=dict(revision=1,stage='boundary',code='FORGED',passed=True)).get_json()
    assert result['passed'];assert 'FORGED' not in seen[0][0];assert 'assert total([500,500]) == 900' in seen[0][1]
    detail=client.get(url).get_json();assert detail['project']['checks']['boundary']==1 and detail['runs'][0]['revision']==1
    assert client.post(url+'/run',json=dict(revision=0)).status_code==409

def test_review_charges_only_saved_success_and_reuses_report(client,monkeypatch):
    import server
    register(client);money(100);project=create(client).get_json()['project'];url='/api/workshop/'+project['id']+'/review'
    monkeypatch.setattr(server,'ai_available',lambda:True)
    monkeypatch.setattr(server,'call_opencode',lambda *args,**kwargs:None)
    body=dict(revision=1,confirmed_price=40)
    assert client.post(url,json=body).status_code==503
    assert client.get('/api/wallet').get_json()['drops']==100
    report='В main.py пока только один вывод. Добавьте проверку входных данных; это наблюдение по коду, без запуска.'
    monkeypatch.setattr(server,'call_opencode',lambda *args,**kwargs:(report,{}))
    first=client.post(url,json=body).get_json();assert first['report']==report and not first['cached']
    assert client.get('/api/wallet').get_json()['drops']==60
    monkeypatch.setattr(server,'call_opencode',lambda *a,**k:pytest.fail('Cached review must not call model'))
    assert client.post(url,json=body).get_json()['cached']
    assert client.get('/api/wallet').get_json()['drops']==60

def test_archive_v1_v2_compatibility_with_workshop_tables(client):
    import server,learning_archive as archive
    register(client);project=create(client).get_json()['project']
    with server.app.app_context():
        uid=server.db().execute('SELECT id FROM users').fetchone()[0]
        exported=archive.export_archive(server.db(),uid,server.app.secret_key,server.now())
        assert exported['payload']['tables']['workshop_projects'][0]['id']==project['id']
        for version in [1,2]:
            payload=json.loads(json.dumps(exported['payload']));payload['version']=version
            for table in workshop.ARCHIVE_TABLES:payload['tables'].pop(table)
            if version==1:payload['tables'].pop('weekly_reward_keys');payload['contexts'].pop('weekly_assignments')
            old=archive.seal(server.app.secret_key,payload)
            validated=archive.validate(server.db(),uid,server.app.secret_key,old)
            assert all(validated['tables'][table]==[] for table in workshop.ARCHIVE_TABLES)
