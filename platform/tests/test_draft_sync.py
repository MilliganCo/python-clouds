"""Owned optimistic draft versions preserve conflicts, empty code and resets."""
from test_platform import client, register
import copy
from pathlib import Path
import subprocess
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest


def payload(code='first',version=0,base_id=None,mutation='a'*32,scope='sandbox'):
    return dict(scope=scope,code=code,starter='# starter',base_version=version,
                base_mutation_id=base_id,mutation_id=mutation)


def test_draft_store_conflict_and_replay(client):
    register(client)
    first=client.put('/api/drafts',json=payload())
    assert first.status_code==200
    saved=first.get_json()['draft']
    assert saved['code']=='first' and saved['version']==1 and saved['mutation_id']=='a'*32
    assert client.put('/api/drafts',json=payload()).get_json()['draft']==saved
    conflict=client.put('/api/drafts',json=payload('other',mutation='b'*32))
    assert conflict.status_code==409 and conflict.get_json()['code']=='draft_conflict'
    assert conflict.headers['Cache-Control']=='no-store'
    assert conflict.get_json()['draft']==saved


def test_empty_reset_and_reused_mutation_are_distinct(client):
    register(client)
    first=client.put('/api/drafts',json=payload('')).get_json()['draft']
    assert first['code']==''
    reset=payload(None,1,'a'*32,'b'*32)
    second=client.put('/api/drafts',json=reset).get_json()['draft']
    assert second['code'] is None and second['version']==2
    assert client.put('/api/drafts',json=reset).get_json()['draft']==second
    reused=copy.deepcopy(reset);reused['code']='different'
    response=client.put('/api/drafts',json=reused)
    assert response.status_code==409 and response.get_json()['code']=='mutation_reused'
    assert client.get('/api/drafts?scope=sandbox').get_json()['draft']==second
    stale=client.put('/api/drafts',json=payload('old',1,'a'*32,'c'*32))
    assert stale.status_code==409


def test_same_version_different_base_token_cannot_overwrite(client):
    register(client)
    client.put('/api/drafts',json=payload())
    response=client.put('/api/drafts',json=payload('wrong branch',1,'d'*32,'b'*32))
    assert response.status_code==409 and response.get_json()['code']=='draft_conflict'
    assert client.get('/api/drafts?scope=sandbox').get_json()['draft']['code']=='first'


def test_drafts_are_private_and_do_not_change_learning_records(client):
    register(client,name='draft_owner_a')
    before=(client.get('/api/progress').get_json(),client.get('/api/wallet').get_json()['drops'])
    for scope in ['sandbox','task:2.9','daily:2026-10-21:expert','atlas:seed-example']:
        assert client.put('/api/drafts',json=payload('PRIVATE_DRAFT',scope=scope)).status_code==200
    assert before==(client.get('/api/progress').get_json(),client.get('/api/wallet').get_json()['drops'])
    client.post('/api/logout');register(client,name='draft_owner_b')
    response=client.get('/api/drafts?scope=sandbox')
    assert response.get_json()['draft']['version']==0 and response.get_json()['draft']['code'] is None
    assert 'PRIVATE_DRAFT' not in response.get_data(as_text=True)
    stale=client.put('/api/drafts',json=payload(),headers={'X-Pycloud-User':'draft_owner_a'})
    assert stale.status_code==409 and stale.get_json()['code']=='session_changed'


@pytest.mark.parametrize('defect',['type','version','base_id','mutation','extra','scope','unicode','large'])
def test_invalid_draft_never_writes(client,defect):
    register(client);data=payload()
    if defect=='type':data['code']=7
    elif defect=='version':data['base_version']=True
    elif defect=='base_id':data['base_mutation_id']='a'*32
    elif defect=='mutation':data['mutation_id']='bad'
    elif defect=='extra':data['uid']=999
    elif defect=='scope':data['scope']='task:9999.9'
    elif defect=='unicode':data['code']='\ud800'
    elif defect=='large':data['code']='ж'*40000
    response=client.put('/api/drafts',json=data)
    assert response.status_code in (400,413)
    assert client.get('/api/drafts?scope=sandbox').get_json()['draft']['version']==0


def test_quotas_are_atomic_and_do_not_erase_existing_code(client,monkeypatch):
    import draft_store
    register(client);client.put('/api/drafts',json=payload())
    monkeypatch.setattr(draft_store,'MAX_SCOPES',1)
    response=client.put('/api/drafts',json=payload(scope='task:2.9'))
    assert response.status_code==413
    monkeypatch.setattr(draft_store,'MAX_TOTAL_BYTES',16)
    response=client.put('/api/drafts',json=payload('x'*100,1,'a'*32,'b'*32))
    assert response.status_code==413
    assert client.get('/api/drafts?scope=sandbox').get_json()['draft']['code']=='first'


def test_two_writers_have_exactly_one_success(client):
    import server
    register(client);client.put('/api/drafts',json=payload())
    barrier=Barrier(2)
    def attempt(index):
        with server.app.test_client() as c:
            assert c.post('/api/login',json={'username':'tester','password':'secret123'}).status_code==200
            barrier.wait(timeout=3)
            return c.put('/api/drafts',json=payload(str(index),1,'a'*32,['b'*32,'c'*32][index])).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:values=list(pool.map(attempt,range(2)))
    assert sorted(values)==[200,409]
    assert client.get('/api/drafts?scope=sandbox').get_json()['draft']['version']==2


def test_draft_client_reconciliation_model():
    subprocess.run(['node',str(Path(__file__).resolve().parents[1]/'scripts/verify_draft_sync_unit.cjs')],check=True)


def test_version_exhaustion_preserves_code(client):
    import server,draft_store
    register(client);client.put('/api/drafts',json=payload())
    with sqlite3.connect(server.DB_PATH) as con:
        con.execute('UPDATE editor_drafts SET version=?',(draft_store.MAX_VERSION,))
    response=client.put('/api/drafts',json=payload('no',draft_store.MAX_VERSION,'a'*32,'b'*32))
    assert response.status_code==503 and response.get_json()['code']=='draft_version_limit'
    assert client.get('/api/drafts?scope=sandbox').get_json()['draft']['code']=='first'


def test_additive_schema_preserves_existing_records(tmp_path):
    import server,draft_store
    path=tmp_path/'old.db'
    with sqlite3.connect(path) as con:
        con.executescript(server.SCHEMA.replace(draft_store.SCHEMA,''))
        con.execute("INSERT INTO users(id,username,password_hash,created_at) VALUES (7,'synthetic_owner','synthetic_hash','2026-10-21')")
        con.execute("INSERT INTO progress(user_id,task_id,solved_at) VALUES (7,'0.1','2026-10-21')")
        con.commit()
        tables=[row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        before={table:con.execute('SELECT * FROM "'+table.replace('"','""')+'"').fetchall() for table in tables}
        con.executescript(server.SCHEMA)
        after={table:con.execute('SELECT * FROM "'+table.replace('"','""')+'"').fetchall() for table in tables}
        assert before==after
        assert con.execute('SELECT COUNT(*) FROM editor_drafts').fetchone()[0]==0
