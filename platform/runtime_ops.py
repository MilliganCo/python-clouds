"""Local operator control, aggregate activity and a cooperative maintenance gate.

No process termination, Docker mutation, learner identity or submitted code.
The private descriptor is published only by an explicit web-server startup.
"""
from contextlib import suppress
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import threading
import time
import content_generation


OPS_PATH = '/api/_ops/runtime'
CORE_FILES = ('server.py', 'wallet_admin.py', 'sandbox_runner.py', 'runtime_ops.py', 'server_paths.py',
              'execution_artifacts.py', 'execution_policy.py', 'project_courses.py',
              'ui_serve.py', 'content_generation.py', 'static/catalogue-loader.js', 'draft_store.py', 'learning_archive.py', 'learning_titles.py', 'workshop.py', 'workshop_catalog.py', 'account_security.py', 'account_lifecycle.py', 'ai_controls.py', 'weekly_practice.py', 'weekly_tasks.json', 'tasks_meta.json')
_JOB_CONTROL = re.compile(r'^/api/(?:v1/mobile/)?python/[0-9a-f]{32}/(?:input|cancel)$')
_MAINTENANCE = json.dumps({'error': 'Платформа готовится к обновлению. Дождитесь завершения работ.',
                           'code': 'maintenance_mode'}, ensure_ascii=False).encode('utf-8')


def _protect_credential(path):
    if os.name != 'nt':
        os.chmod(path, 0o600)
        return
    # chmod cannot establish a Windows DACL. No credential is written before this.
    identity = subprocess.run(['whoami.exe', '/user', '/fo', 'csv', '/nh'], capture_output=True, timeout=5)
    sid = re.search(rb'S-1-(?:\d+-)*\d+', identity.stdout)
    if identity.returncode or sid is None:
        raise ValueError('Cannot secure operator credential')
    result = subprocess.run(['icacls.exe', str(path), '/inheritance:r', '/grant:r',
                             '*' + sid.group().decode('ascii') + ':F',
                             '*S-1-5-18:F', '*S-1-5-32-544:F'], capture_output=True, timeout=5)
    if result.returncode:
        raise ValueError('Cannot secure operator credential')


def source_fingerprint(base):
    digest = hashlib.sha256()
    try:
        for name in CORE_FILES:
            digest.update(name.encode() + b'\0' + (Path(base) / name).read_bytes())
    except OSError:
        return None
    return digest.hexdigest()


def capture_runtime(base, sandbox, meta, *, content_snapshot=None):
    """Capture once for a loaded process; the CLI separately captures disk state."""
    try:
        context_digest = sandbox.source_digest()
    except OSError:
        context_digest = None
    fingerprint=source_fingerprint(base)
    try:
        selected=content_snapshot or content_generation.capture(base)
        content_digest=hashlib.sha256(selected.identity.encode()).hexdigest()
        generation=selected.generation
    except (content_generation.ContentError,OSError,ValueError,UnicodeError):
        content_digest=generation=None;fingerprint=None
    if fingerprint is not None:fingerprint=hashlib.sha256((fingerprint+'\0'+content_digest).encode()).hexdigest()
    return dict(source_digest=fingerprint, content_digest=content_digest, content_generation=generation, image_ref=sandbox.IMAGE,
                context=sandbox.RUNTIME_CONTEXT.name, context_digest=context_digest,
                catalog_digest=hashlib.sha256(json.dumps(meta, sort_keys=True).encode()).hexdigest(),
                task_count=len(meta), topic_count=len({key.split('.')[0] for key in meta}))


class _TrackedBody:
    def __init__(self, body, release):
        self.body, self.iterator, self.release = body, iter(body), release

    def __iter__(self):
        return self

    def __next__(self):
        try:
            return next(self.iterator)
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.release is not None:
            release, self.release = self.release, None
            try:
                if hasattr(self.body, 'close'):
                    self.body.close()
            finally:
                release()


class RuntimeOps:
    def __init__(self):
        self.lock = threading.Lock()
        self.active_http = self.active_background = 0
        self.draining = False
        self.enabled = False
        self.token = secrets.token_hex(32)
        self.boot_id = secrets.token_hex(16)
        self.runtime = {}
        self.pool = None

    def _reservation(self, field):
        with self.lock:
            setattr(self, field, getattr(self, field) + 1)
        released = False
        def release():
            nonlocal released
            with self.lock:
                if not released:
                    released = True
                    setattr(self, field, getattr(self, field) - 1)
        return release

    def launch_background(self, target, *, args=(), name=None, daemon=True):
        # Reserve before Thread.start, not inside its target: there is no idle gap.
        release = self._reservation('active_background')
        def run(*args):
            try:
                target(*args)
            finally:
                release()
        try:
            thread = threading.Thread(target=run, args=args, name=name, daemon=daemon)
            thread.start()
            return thread
        except BaseException:
            release()
            raise

    def middleware(self, application):
        def gate(environ, start_response):
            path = environ.get('PATH_INFO', '')
            if path == OPS_PATH:
                # Preserve the actual socket peer, before any ProxyFix middleware.
                environ['pycloud.ops_peer'] = environ.get('REMOTE_ADDR', '')
                return application(environ, start_response)
            if path == '/api/health':
                return application(environ, start_response)
            with self.lock:
                blocked = self.draining and path.startswith('/api/') and not (
                    environ.get('REQUEST_METHOD') == 'POST' and _JOB_CONTROL.fullmatch(path))
                if not blocked:
                    self.active_http += 1
            if blocked:
                start_response('503 Service Unavailable', [
                    ('Content-Type', 'application/json; charset=utf-8'),
                    ('Content-Length', str(len(_MAINTENANCE))), ('Retry-After', '30'),
                    ('Cache-Control', 'no-store'), ('X-Content-Type-Options', 'nosniff')])
                return [_MAINTENANCE]
            released = False
            def release():
                nonlocal released
                with self.lock:
                    if not released:
                        released = True
                        self.active_http -= 1
            try:
                body = application(environ, start_response)
                return _TrackedBody(body, release)
            except BaseException:
                release()
                raise
        return gate

    def snapshot(self):
        with self.lock:
            activity = dict(draining=self.draining, active_http=self.active_http,
                            active_background=self.active_background)
        with self.pool.lock:
            jobs = list(self.pool.jobs.values())
        waiting = 0
        for job in jobs:
            with job.input_lock:
                waiting += bool(job.input_pending)
        image = getattr(self.pool, 'verified_image_id', None)
        if not isinstance(image, str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', image):
            image = None
        return dict(schema=1, pid=os.getpid(), boot_id=self.boot_id, **activity,
                    pool_jobs=len(jobs), waiting_input=waiting,
                    runtime={**self.runtime, 'verified_image_id': image})

    def publish(self, directory, port, *, served_roots=()):
        """Install a local credential, never under a served directory."""
        directory = Path(directory).resolve()
        if type(port) is not int or not 1 <= port <= 65535:
            raise ValueError('Invalid operator port')
        if any(directory.is_relative_to(Path(root).resolve()) for root in served_roots):
            raise ValueError('Operator descriptor cannot be served by HTTP')
        if not directory.is_dir():
            raise ValueError('Operator instance directory must already exist')
        path = directory / f'runtime-ops-{port}.json'
        data = dict(schema=1, port=port, pid=os.getpid(), boot_id=self.boot_id, token=self.token)
        fd, temporary = tempfile.mkstemp(prefix='.runtime-ops-', dir=directory)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                _protect_credential(temporary)
                json.dump(data, stream)
            deadline = time.monotonic() + 1.0
            while True:
                try:
                    os.replace(temporary, path)
                    break
                except OSError as error:
                    # MoveFileEx cannot replace an open destination, even when its
                    # reader shares DELETE. Retry only this prepared atomic rename.
                    if (os.name != 'nt' or getattr(error, 'winerror', None) not in (5, 32, 33)
                            or time.monotonic() >= deadline):
                        raise
                    time.sleep(.01)
        finally:
            with suppress(FileNotFoundError):
                os.unlink(temporary)
        self.enabled = True
        return path

    def install(self, app, *, runtime, pool):
        from flask import jsonify, request
        self.runtime, self.pool = dict(runtime), pool
        app.wsgi_app = self.middleware(app.wsgi_app)

        def authorized():
            if not self.enabled:
                return False
            try:
                if not ipaddress.ip_address(request.environ.get('pycloud.ops_peer', '')).is_loopback:
                    return False
            except ValueError:
                return False
            header = request.headers.get('Authorization', '')
            expected = 'Bearer ' + self.token
            return len(header) == len(expected) and header.isascii() and hmac.compare_digest(header, expected)

        @app.route(OPS_PATH, methods=['GET', 'POST'])
        def runtime_operator():
            if not authorized():
                return jsonify(error='Operator endpoint unavailable'), 404
            if request.method == 'POST':
                if request.content_length is None or request.content_length > 1024:
                    return jsonify(error='Invalid operator request'), 400
                data = request.get_json(silent=True)
                if type(data) is not dict or set(data) != {'draining'} or type(data['draining']) is not bool:
                    return jsonify(error='Invalid operator request'), 400
                with self.lock:
                    self.draining = data['draining']
            response = jsonify(self.snapshot())
            response.headers['Cache-Control'] = 'no-store'
            return response
