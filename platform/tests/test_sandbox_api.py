"""Auth and protocol checks with a synthetic runtime; no Docker/model calls."""
import json
import threading
from types import SimpleNamespace

import pytest
from test_platform import client, register


def test_python_run_requires_authentication(client):
    assert client.post('/api/python/run', json={'code':'print(4)'}).status_code == 401


def test_http_body_limit_rejects_before_authentication_without_large_payload(client):
    import server as srv
    response = client.post('/api/python/run', data='{}', content_type='application/json',
                           environ_overrides={'CONTENT_LENGTH': str(srv.app.config['MAX_CONTENT_LENGTH'] + 1)})
    assert response.status_code == 413
    assert response.get_json()['code'] == 'request_too_large'


def test_unavailable_runtime_never_falls_back_to_host(client):
    register(client)
    result = client.post('/api/python/run', json={'code':"__import__('os').system('true')"})
    assert result.status_code == 503
    assert result.get_json()['code'] == 'execution_disabled'


@pytest.mark.parametrize('body', [[], {}, {'code':3}, {'code':'pass','interactive':'true'}, {'code':'x'*140000}])
def test_invalid_or_oversized_code_is_rejected_before_admission(client, body):
    register(client)
    assert client.post('/api/python/run', json=body).status_code == 400


def test_only_code_fields_cross_boundary_and_uid_comes_from_cookie(client, monkeypatch):
    import sandbox_runner as sandbox
    register(client)
    calls=[]
    def create(uid, request):
        calls.append((uid,request))
        return SimpleNamespace(stream=lambda: iter([
            {'type':'job','id':'synthetic'}, {'type':'result','id':'synthetic','stdout':'4\n','error':None},
        ]))
    monkeypatch.setattr(sandbox.pool,'create',create)
    response=client.post('/api/python/run', json={
        'code':'print(4)', 'uid':999, 'image':'attacker', 'env':{'TOKEN':'synthetic'}, 'memory':-1,
    })
    assert response.status_code == 200
    with client.session_transaction() as session:
        assert calls[0][0] == session['uid']
    assert calls[0][1] == dict(code='print(4)',check='',interactive=False,reportTests=False)
    assert json.loads(response.data.decode().splitlines()[-1])['stdout'] == '4\n'
    assert response.headers['Cache-Control'] == 'no-store'


def test_other_account_cannot_input_or_cancel_owned_job(client, monkeypatch):
    import sandbox_runner as sandbox
    register(client)
    calls=[]
    monkeypatch.setattr(sandbox.pool,'owned',lambda uid,job_id: None)
    monkeypatch.setattr(sandbox.pool,'create',lambda *args: calls.append(args))
    assert client.post('/api/python/unknown/input',json={'answer':'secret'}).status_code == 404
    assert client.post('/api/python/unknown/cancel',json={}).status_code == 404
    assert not calls


def test_guest_result_cannot_supply_privileged_control_fields():
    import sandbox_runner as sandbox
    event=sandbox.normalized_event(dict(type='result',stdout='x',error=None,
        uid=0,container='other',deadline=1e99,env={'TOKEN':'synthetic'}),'server-owned-id')
    assert event['id'] == 'server-owned-id'
    assert not {'uid','container','deadline','env'} & event.keys()
    with pytest.raises(sandbox.SandboxError):
        sandbox.normalized_event(dict(type='test_event',event={'type':'plan','tests':[{'id':'<script>','line':1,'code':'pass'}]}),'id')


def test_input_http_admission_does_not_write_to_a_blocked_pipe():
    import sandbox_runner as sandbox
    entered, release = threading.Event(), threading.Event()
    class BlockedPipe:
        def write(self, data):
            entered.set()
            assert release.wait(2)
        def flush(self):
            pass
    job = sandbox.Job(SimpleNamespace(), 1, dict(code='input()', check='', interactive=True, reportTests=False))
    job.process = SimpleNamespace(stdin=BlockedPipe(), poll=lambda: None)
    with pytest.raises(sandbox.SandboxError, match='не ожидает'):
        job.answer('unsolicited')
    job.input_pending = True
    job.answer('first')
    writer = threading.Thread(target=job._write_input, daemon=True)
    writer.start()
    try:
        assert entered.wait(1)
        job.input_pending = True
        job.answer('one queued answer')
        job.input_pending = True
        with pytest.raises(sandbox.SandboxError, match='ещё передаётся'):
            job.answer('queue is bounded')
        assert job.answers.qsize() == 1
    finally:
        job.stop.set()
        release.set()
        writer.join(2)
    assert not writer.is_alive()


def test_stopped_owned_orphans_are_reaped_before_admission(monkeypatch):
    import sandbox_runner as sandbox
    prefix = 'pycloud-exec-' + sandbox.INSTANCE + '-'
    inventory = [
        ['a'*12, prefix+'1'*32, 'exited'], ['b'*12, prefix+'2'*32, 'created'],
        ['c'*12, prefix+'3'*32, 'running'], ['d'*12, 'unrelated-container', 'exited'],
    ]
    removed=[]
    class SyntheticDocker:
        def call(self, args):
            if args[0] == 'rm':
                removed.append(args[1])
                inventory[:] = [row for row in inventory if row[0] != args[1]]
                return b''
            if '--format' in args:
                return ('\n'.join(' '.join(row) for row in inventory)).encode()
            return b'c'*12  # the only retained managed container is running
    pool = sandbox.SandboxPool()
    pool.docker = SyntheticDocker()
    monkeypatch.setattr(pool, 'image', lambda: 'immutable-image')
    monkeypatch.setattr(sandbox.Job, 'start', lambda *args: None)
    job = pool.create(1, dict(code='print(4)',check='',interactive=False,reportTests=False))
    assert job.uid == 1
    assert removed == ['a'*12, 'b'*12]
    assert inventory == [['c'*12,prefix+'3'*32,'running'], ['d'*12,'unrelated-container','exited']]
