"""Operator reports never infer idle from missing evidence or expose learner data."""
import importlib.util
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import threading

from flask import Flask, Response
import pytest

from runtime_ops import OPS_PATH, RuntimeOps

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/runtime_status.py'
spec = importlib.util.spec_from_file_location('runtime_status', SCRIPT)
status = importlib.util.module_from_spec(spec)
spec.loader.exec_module(status)
IMAGE = 'sha256:' + 'd' * 64
RUNTIME = dict(source_digest='a'*64, context_digest='b'*64, catalog_digest='c'*64,
               image_ref='pycloud-python-sandbox:test', context='sandbox_test',
               topic_count=63, task_count=612)


@pytest.fixture()
def service(tmp_path):
    app = Flask('operator-test')
    app.config['TESTING'] = True
    @app.route('/api/action', methods=['GET', 'POST'])
    def action():
        return {'ok': True}
    @app.get('/api/health')
    def health():
        return {'ok': True, 'service': 'pycloud'}
    @app.post('/api/python/<job>/input')
    @app.post('/api/python/<job>/cancel')
    @app.post('/api/v1/mobile/python/<job>/input')
    def control(job):
        return {'ok': True}
    @app.get('/api/stream')
    def stream():
        return Response(iter([b'first', b'last']))
    ops = RuntimeOps()
    pool = SimpleNamespace(lock=threading.Lock(), jobs={}, verified_image_id=IMAGE)
    ops.install(app, runtime=RUNTIME, pool=pool)
    ops.publish(tmp_path, 8123)
    return app, ops, pool


def headers(ops):
    return {'Authorization': 'Bearer ' + ops.token}


def test_private_endpoint_requires_actual_local_peer_and_token(service):
    app, ops, _ = service
    c = app.test_client()
    for kwargs in [{}, {'headers': {'Authorization': 'Bearer wrong'}},
                   {'headers': {'Authorization': 'Bearer '+ops.token[:-1]+'é'}},
                   {'headers': headers(ops), 'environ_overrides': {'REMOTE_ADDR': '192.0.2.1'}}]:
        assert c.get(OPS_PATH, **kwargs).status_code == 404
    r = c.get(OPS_PATH, headers=headers(ops))
    assert r.status_code == 200 and r.headers['Cache-Control'] == 'no-store'
    assert ops.token not in r.get_data(as_text=True)
    assert not any(key in r.get_json() for key in ['username', 'code', 'token', 'secret'])
    assert r.get_json()['runtime']['verified_image_id'] == IMAGE


def test_disabled_endpoint_does_not_advertise_controls(service):
    app, ops, _ = service
    ops.enabled = False
    assert app.test_client().get(OPS_PATH, headers=headers(ops)).status_code == 404


def test_drain_rejects_new_actions_but_keeps_existing_job_controls(service):
    app, ops, _ = service
    c = app.test_client()
    r = c.post(OPS_PATH, json={'draining': True}, headers=headers(ops))
    assert r.get_json()['draining'] is True and ops.snapshot()['active_http'] == 0
    for method in ('get', 'post'):
        r = getattr(c, method)('/api/action')
        assert r.status_code == 503 and r.get_json()['code'] == 'maintenance_mode'
    assert c.get('/api/health').status_code == 200
    for path in ['/api/python/'+'1'*32+'/input', '/api/python/'+'1'*32+'/cancel',
                 '/api/v1/mobile/python/'+'1'*32+'/input']:
        assert c.post(path, buffered=True).status_code == 200
    assert c.post('/api/python/run').status_code == 503
    assert c.post('/api/python/bad/input').status_code == 503
    assert c.post(OPS_PATH, json={'draining': False}, headers=headers(ops)).status_code == 200
    assert c.get('/api/action', buffered=True).status_code == 200 and ops.snapshot()['active_http'] == 0


@pytest.mark.parametrize('body', [[], {}, {'draining': 1}, {'draining': True, 'extra': 1}])
def test_invalid_control_does_not_change_admission(service, body):
    app, ops, _ = service
    assert app.test_client().post(OPS_PATH, json=body, headers=headers(ops)).status_code == 400
    assert ops.draining is False


def test_http_counter_lives_until_body_closes(service):
    app, ops, _ = service
    r = app.test_client().get('/api/stream', buffered=False)
    assert ops.snapshot()['active_http'] == 1
    r.close()
    assert ops.snapshot()['active_http'] == 0
    r.close()
    assert ops.snapshot()['active_http'] == 0


def test_wsgi_errors_and_unstarted_body_release_activity():
    ops = RuntimeOps()
    def bad(environ, start_response):
        raise ValueError('synthetic')
    with pytest.raises(ValueError):
        ops.middleware(bad)({'PATH_INFO':'/api/action'}, lambda *a: None)
    assert ops.active_http == 0
    body = ops.middleware(lambda e,s: iter([b'x']))({'PATH_INFO':'/api/action'}, lambda *a: None)
    assert ops.active_http == 1
    body.close()
    assert ops.active_http == 0


def test_background_reserved_before_start_and_released_on_failure(monkeypatch):
    import runtime_ops
    ops = RuntimeOps()
    saved = []
    class DeferredThread:
        def __init__(self, **kwargs):
            saved.append(kwargs)
        def start(self):
            assert ops.active_background == 1
    monkeypatch.setattr(runtime_ops.threading, 'Thread', DeferredThread)
    ops.launch_background(lambda: None)
    assert ops.active_background == 1
    saved[0]['target'](*saved[0]['args'])
    assert ops.active_background == 0
    class FailedThread(DeferredThread):
        def start(self):
            raise RuntimeError('synthetic')
    monkeypatch.setattr(runtime_ops.threading, 'Thread', FailedThread)
    with pytest.raises(RuntimeError):
        ops.launch_background(lambda: None)
    assert ops.active_background == 0


def test_job_counts_do_not_include_identity_or_code(service):
    _, ops, pool = service
    pool.jobs['private-id'] = SimpleNamespace(input_lock=threading.Lock(), input_pending=True,
                                            uid=123, code='secret student code')
    data = ops.snapshot()
    assert data['pool_jobs'] == data['waiting_input'] == 1
    assert 'student' not in json.dumps(data) and 'private-id' not in json.dumps(data)


def test_descriptor_not_served_and_unknown_fields_filtered(tmp_path, service):
    _, ops, _ = service
    with pytest.raises(ValueError, match='served'):
        ops.publish(tmp_path, 8123, served_roots=(tmp_path,))
    descriptor = status.read_descriptor(tmp_path/'runtime-ops-8123.json', 8123)
    data = ops.snapshot()
    data.update(code='private', token='private')
    data['runtime']['username'] = 'private'
    cleaned = status.clean_snapshot(data, descriptor)
    assert 'private' not in json.dumps(cleaned)
    data['boot_id'] = 'e'*32
    with pytest.raises(ValueError):
        status.clean_snapshot(data, descriptor)


class Docker:
    def __init__(self, states=()):
        self.states, self.calls = states, []
    def call(self, args):
        self.calls.append(args)
        assert args[0] in ('ps', 'inspect'), 'Read-only inventory must not mutate Docker'
        if args[0] == 'ps':
            return ('\n'.join(f'{i+1:064x}' for i in range(len(self.states)))).encode()
        return ('\n'.join(state+' '+IMAGE for state in self.states)).encode()


class Pool:
    def __init__(self):
        self.docker = Docker()
    def image(self):
        return IMAGE


def test_inventory_reports_counts_and_images_without_container_identity():
    docker = Docker(('running', 'exited', 'created'))
    data = status.engine_inventory(docker, 'instance')
    assert data['active_count'] == 2 and data['stopped_count'] == 1
    assert data['image_ids'] == [IMAGE]
    assert not any(key in data for key in ['ids', 'uid', 'names'])


def test_missing_descriptor_is_unknown_and_read_only(tmp_path):
    directory = tmp_path/'missing'
    calls = []
    def transport(port, path, *args):
        calls.append((path,args))
        return {'ok':True,'service':'pycloud','code':'not to report'}
    report = status.collect_report(directory, 8123, transport=transport, pool_factory=Pool, engine_running=lambda:True)
    assert not directory.exists()
    assert report['server'] == {'state':'unknown','http':'healthy_cached_version_unknown'}
    assert not report['drained_snapshot'] and 'cached_process_unknown' in report['blockers']
    assert calls == [('/api/health',())]


def test_unknown_engine_does_not_start_it(tmp_path):
    def forbidden():
        pytest.fail('Do not wake a stopped engine')
    report = status.collect_report(tmp_path, 8123, transport=lambda *a: {}, pool_factory=forbidden, engine_running=lambda:False)
    assert report['engine']['active_count'] is None and not report['drained_snapshot']


def test_drain_snapshot_requires_all_activity_to_end(tmp_path, service):
    app, ops, _ = service
    def transport(port, path, token=None, draining=None):
        c = app.test_client()
        if draining is None:
            return c.get(path, headers={'Authorization':'Bearer '+token}).get_json()
        return c.post(path, json={'draining':draining}, headers={'Authorization':'Bearer '+token}).get_json()
    ops.active_background = 1
    report = status.collect_report(tmp_path,8123,draining=True,transport=transport,pool_factory=Pool,engine_running=lambda:True)
    assert report['action_applied'] and not report['drained_snapshot'] and 'active_background' in report['blockers']
    ops.active_background = 0
    report = status.collect_report(tmp_path,8123,transport=transport,pool_factory=Pool,engine_running=lambda:True)
    assert report['drained_snapshot'] and not report['action_applied']
    assert ops.token not in json.dumps(report) and 'username' not in json.dumps(report)


def test_launcher_has_no_automatic_process_killing():
    script = (SCRIPT.parents[1]/'run-local-server.ps1').read_text(encoding='utf-8')
    check = script.split('function Test-PortAvailable',1)[1].split('Write-Banner',1)[0]
    assert 'Stop-Process' not in check and 'Clear-PortListeners' not in script
    assert 'Stop-Process -Id $procId' not in script  # Its own failed child may be cleaned up.


@pytest.mark.parametrize('key,value', [('active_http',-1),('active_background',None),
                                      ('pool_jobs',True),('waiting_input',1)])
def test_invalid_or_inconsistent_counts_are_not_idle(tmp_path,service,key,value):
    _,ops,_=service
    descriptor=status.read_descriptor(tmp_path/'runtime-ops-8123.json',8123)
    data=ops.snapshot();data[key]=value
    with pytest.raises(ValueError):status.clean_snapshot(data,descriptor)


def test_partial_docker_inventory_is_not_zero():
    docker=Docker(('running',))
    original=docker.call
    docker.call=lambda args: b'' if args[0]=='inspect' else original(args)
    with pytest.raises(ValueError):status.engine_inventory(docker,'instance')


@pytest.mark.parametrize('port,path', [('80@192.0.2.1',OPS_PATH),(True,OPS_PATH),
                                     (0,OPS_PATH),(8123,'//192.0.2.1/private')])
def test_local_transport_cannot_be_redirected_by_address_arguments(port,path):
    with pytest.raises(ValueError):status.local_request(port,path,token='test-only')


def test_forwarded_for_cannot_turn_external_peer_into_local_operator(tmp_path):
    from werkzeug.middleware.proxy_fix import ProxyFix
    app=Flask('operator-proxy')
    app.wsgi_app=ProxyFix(app.wsgi_app,x_for=1)
    ops=RuntimeOps();pool=SimpleNamespace(lock=threading.Lock(),jobs={})
    ops.install(app,runtime=RUNTIME,pool=pool);ops.publish(tmp_path,8123)
    r=app.test_client().get(OPS_PATH,headers={**headers(ops),'X-Forwarded-For':'127.0.0.1'},
                            environ_overrides={'REMOTE_ADDR':'192.0.2.1'})
    assert r.status_code==404
