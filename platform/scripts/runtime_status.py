"""Local operator report. Default is read-only; drain/resume are explicit actions."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import urllib.error
import urllib.request

PLATFORM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLATFORM))
import sandbox_runner as sandbox
import content_generation
from runtime_ops import OPS_PATH, capture_runtime

_HEX = re.compile(r'^[0-9a-f]{64}$')
_IMAGE = re.compile(r'^sha256:[0-9a-f]{64}$')
_BOOT = re.compile(r'^[0-9a-f]{32}$')
_ACTIVE = {'running', 'paused', 'restarting', 'removing', 'created'}
_STATES = _ACTIVE | {'exited', 'dead'}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def read_descriptor(path, port):
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NONBLOCK', 0) | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
            raise ValueError('Invalid operator descriptor')
        data = json.loads(stream.read(4097))
    if (type(data) is not dict or type(data.get('schema')) is not int or data.get('schema') != 1 or type(data.get('port')) is not int
            or data['port'] != port or type(data.get('pid')) is not int or data['pid'] <= 0
            or not isinstance(data.get('token'), str) or not _HEX.fullmatch(data['token'])
            or not isinstance(data.get('boot_id'), str) or not _BOOT.fullmatch(data['boot_id'])):
        raise ValueError('Invalid operator descriptor')
    return data


def local_request(port, path, token=None, draining=None):
    """Never proxy or redirect the local credential; don't expose error bodies."""
    if type(port) is not int or not 1 <= port <= 65535 or path not in (OPS_PATH, '/api/health'):
        raise ValueError('Invalid local operator address')
    headers = {'Accept': 'application/json'}
    if token is not None:
        headers['Authorization'] = 'Bearer ' + token
    body = None
    if draining is not None:
        body = json.dumps({'draining': draining}).encode()
        headers['Content-Type'] = 'application/json'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    req = urllib.request.Request(f'http://127.0.0.1:{port}{path}', data=body, headers=headers)
    with opener.open(req, timeout=3) as response:
        if response.status != 200:
            raise ValueError('Operator endpoint unavailable')
        raw = response.read(16 * 1024 + 1)
        if len(raw) > 16 * 1024:
            raise ValueError('Invalid operator response')
        return json.loads(raw)


def clean_snapshot(data, descriptor):
    if (type(data) is not dict or type(data.get('schema')) is not int or data.get('schema') != 1
            or data.get('pid') != descriptor['pid'] or type(data.get('pid')) is not int
            or data.get('boot_id') != descriptor['boot_id'] or type(data.get('draining')) is not bool):
        raise ValueError('Stale or invalid operator response')
    out = {key: data[key] for key in ('schema', 'pid', 'boot_id', 'draining')}
    for key in ('active_http', 'active_background', 'pool_jobs', 'waiting_input'):
        value = data.get(key)
        if type(value) is not int or not 0 <= value <= 1_000_000:
            raise ValueError('Invalid activity count')
        out[key] = value
    if out['waiting_input'] > out['pool_jobs']:
        raise ValueError('Invalid job count')
    runtime = data.get('runtime')
    if type(runtime) is not dict:
        raise ValueError('Invalid runtime metadata')
    safe = {}
    for key in ('source_digest', 'context_digest', 'catalog_digest','content_digest','content_generation'):
        value = runtime.get(key)
        if value is not None and (not isinstance(value, str) or not _HEX.fullmatch(value)):
            raise ValueError('Invalid runtime digest')
        safe[key] = value
    for key in ('task_count', 'topic_count'):
        if type(runtime.get(key)) is not int or not 0 <= runtime[key] <= 1_000_000:
            raise ValueError('Invalid catalogue count')
        safe[key] = runtime[key]
    for key, pattern in [('context', r'[A-Za-z0-9_-]{1,80}'),
                         ('image_ref', r'pycloud-python-sandbox:[a-z0-9_-]{1,80}')]:
        if not isinstance(runtime.get(key), str) or not re.fullmatch(pattern, runtime[key]):
            raise ValueError('Invalid runtime name')
        safe[key] = runtime[key]
    image = runtime.get('verified_image_id')
    if image is not None and (not isinstance(image, str) or not _IMAGE.fullmatch(image)):
        raise ValueError('Invalid image digest')
    safe['verified_image_id'] = image
    out['runtime'] = safe  # Unknown fields, including PII/code, never reach the report.
    return out


def engine_inventory(docker, instance):
    raw = docker.call(['ps', '--all', '--quiet', '--no-trunc', '--filter',
                       'label=org.pythonclouds.instance=' + instance,
                       '--filter', 'label=org.pythonclouds.sandbox=1'])
    ids = raw.decode('ascii').split()
    if len(ids) > 64 or len(set(ids)) != len(ids) or any(not _HEX.fullmatch(cid) for cid in ids):
        raise ValueError('Invalid container inventory')
    states, images = {}, set()
    if ids:
        rows = docker.call(['inspect', '--format', '{{.State.Status}} {{.Image}}', *ids]).decode('ascii').splitlines()
        if len(rows) != len(ids):
            raise ValueError('Incomplete container inventory')
        for row in rows:
            fields = row.split()
            if len(fields) != 2 or fields[0] not in _STATES or not _IMAGE.fullmatch(fields[1]):
                raise ValueError('Invalid container state')
            state, image = fields
            states[state] = states.get(state, 0) + 1
            images.add(image)
    return dict(state='observed', active_count=sum(n for state, n in states.items() if state in _ACTIVE),
                stopped_count=sum(n for state, n in states.items() if state not in _ACTIVE),
                states=states, image_ids=sorted(images))


def wsl_is_running():
    if os.name != 'nt':
        return True
    result = subprocess.run(['wsl.exe', '--list', '--running', '--quiet'], capture_output=True,
                            timeout=5, env=sandbox.cli_env())
    if result.returncode:
        return False
    raw = result.stdout
    # WSL emits UTF-16 on many Windows installations; accept UTF-8 as well.
    text = raw.decode('utf-16-le' if b'\0' in raw else 'utf-8', errors='replace').lstrip('\ufeff')
    return 'Ubuntu' in {line.strip() for line in text.splitlines()}


def collect_report(instance_dir, port, *, draining=None, transport=local_request, pool_factory=sandbox.SandboxPool,
                   engine_running=wsl_is_running):
    # No server import, migrations, mkdir, job creation, orphan cleanup or process stop.
    try:
        selected=content_generation.capture(PLATFORM)
        meta = selected.json('tasks_meta.json')
        if type(meta) is not dict or any(not isinstance(key,str) for key in meta):
            raise ValueError('Invalid catalogue')
    except (OSError, ValueError, UnicodeError,content_generation.ContentError):
        meta = None;selected=None
    candidate = capture_runtime(PLATFORM, sandbox, meta or {},content_snapshot=selected)
    if meta is None:
        candidate.update(task_count=None, topic_count=None, catalog_digest=None)
    candidate.update(image_valid=False, image_id=None)
    engine = dict(state='unavailable', active_count=None)
    try:
        if engine_running():
            pool = pool_factory()
            try:
                candidate['image_id'] = pool.image()
                candidate['image_valid'] = bool(_IMAGE.fullmatch(candidate['image_id']))
            except sandbox.SandboxError:
                pass
            if pool.docker is not None:
                engine = engine_inventory(pool.docker, sandbox.INSTANCE)
    except (OSError, ValueError, UnicodeError, subprocess.SubprocessError, sandbox.SandboxError):
        engine = dict(state='unavailable', active_count=None)
    server = dict(state='unknown')
    action_applied = False
    try:
        descriptor = read_descriptor(Path(instance_dir) / f'runtime-ops-{port}.json', port)
        snapshot = clean_snapshot(transport(port, OPS_PATH, descriptor['token'], draining), descriptor)
        server = dict(state='observed', snapshot=snapshot,
                      matches_candidate=snapshot['runtime']['source_digest'] == candidate['source_digest'])
        action_applied = draining is not None and snapshot['draining'] == draining
    except (OSError, ValueError, TypeError, UnicodeError, urllib.error.URLError):
        try:
            health = transport(port, '/api/health')
            if type(health) is dict and health.get('ok') is True and health.get('service') == 'pycloud':
                server['http'] = 'healthy_cached_version_unknown'
        except (OSError, ValueError, TypeError, UnicodeError, urllib.error.URLError):
            server['http'] = 'unavailable'
    blockers = []
    if not candidate['image_valid'] or candidate['source_digest'] is None or meta is None:
        blockers.append('candidate_unverified')
    if engine['active_count'] is None:
        blockers.append('engine_state_unknown')
    elif engine['active_count']:
        blockers.append('active_containers')
    if server['state'] != 'observed':
        blockers.append('cached_process_unknown')
    else:
        snapshot = server['snapshot']
        if not snapshot['draining']:
            blockers.append('maintenance_not_enabled')
        for key in ('active_http', 'active_background', 'pool_jobs'):
            if snapshot[key]:
                blockers.append(key)
    if draining is not None and not action_applied:
        blockers.append('maintenance_action_not_confirmed')
    return dict(schema=1, observed_at=datetime.now(timezone.utc).isoformat(),
                candidate=candidate, engine=engine, server=server,
                drained_snapshot=not blockers, blockers=blockers, action_applied=action_applied)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8017)
    parser.add_argument('--instance-dir', type=Path,
                        default=Path(os.environ.get('PYCLOUD_INSTANCE_DIR', str(PLATFORM / 'instance'))))
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--drain', action='store_true', help='Explicitly pause new API actions on this web process')
    actions.add_argument('--resume', action='store_true', help='Explicitly reopen API admission')
    parser.add_argument('--require-ready', action='store_true', help='Exit 2 unless the coordinated reload snapshot is drained')
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error('port must be 1..65535')
    action = True if args.drain else False if args.resume else None
    report = collect_report(args.instance_dir, args.port, draining=action)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 2 if (action is not None and not report['action_applied']) or (args.require_ready and not report['drained_snapshot']) else 0


if __name__ == '__main__':
    raise SystemExit(main())
