"""Explicit, detached operator start. Never stop, restart or mutate an unknown runtime."""
from contextlib import contextmanager
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

# This imports operator parsers only, never server.py or a sandbox inventory.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
from runtime_status import read_descriptor, clean_snapshot
from runtime_ops import OPS_PATH, _protect_credential


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def _read_record(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 16384:
            raise ValueError('Invalid launch receipt')
        value = json.loads(source.read(16385))
    if not isinstance(value, dict) or value.get('schema') != 1:
        raise ValueError('Invalid launch receipt')
    return value


def _write_record(path, record):
    fd, temporary = tempfile.mkstemp(prefix='.launch-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as target:
            _protect_credential(temporary)
            json.dump(record, target, ensure_ascii=False)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def _launch_lock(directory):
    with open(directory / '.launch.lock', 'a+b') as handle:
        handle.seek(0, os.SEEK_END)
        if not handle.tell():
            handle.write(b'0')
            handle.flush()
        handle.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == 'nt':
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


def _process_state(pid):
    """A reused/unqueryable live PID is conservative evidence, never a kill target."""
    if type(pid) is not int or pid <= 0:
        return 'unknown'
    if os.name != 'nt':
        try:
            os.kill(pid, 0)
            return 'alive'
        except ProcessLookupError:
            return 'dead'
        except OSError:
            return 'unknown'
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return 'dead' if ctypes.get_last_error() == 87 else 'unknown'
    try:
        code = wintypes.DWORD()
        if not kernel.GetExitCodeProcess(handle, ctypes.byref(code)):
            return 'unknown'
        return 'alive' if code.value == 259 else 'dead'
    finally:
        kernel.CloseHandle(handle)


def _port_busy(port):
    if os.name == 'nt':
        return _windows_port_busy(port)
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=.15):
            return True
    except ConnectionRefusedError:
        return False
    except OSError:
        return True  # No permission/timeout is not proof that the port is free.


def _windows_port_busy(port):
    """Read LISTEN rows, not connect timeouts or TIME_WAIT (IPv4 and IPv6)."""
    from ctypes import wintypes
    class Row4(ctypes.Structure):
        _fields_ = [(name, wintypes.DWORD) for name in
                    ('state', 'local_address', 'local_port', 'remote_address', 'remote_port', 'pid')]
    class Row6(ctypes.Structure):
        _fields_ = [('local_address', ctypes.c_ubyte * 16), ('local_scope', wintypes.DWORD),
                    ('local_port', wintypes.DWORD), ('remote_address', ctypes.c_ubyte * 16),
                    ('remote_scope', wintypes.DWORD), ('remote_port', wintypes.DWORD),
                    ('state', wintypes.DWORD), ('pid', wintypes.DWORD)]
    api = ctypes.WinDLL('iphlpapi', use_last_error=True).GetExtendedTcpTable
    api.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD), wintypes.BOOL,
                    wintypes.ULONG, ctypes.c_int, wintypes.ULONG]
    api.restype = wintypes.DWORD
    for family, row in ((socket.AF_INET, Row4), (socket.AF_INET6, Row6)):
        class Table(ctypes.Structure):
            _fields_ = [('count', wintypes.DWORD), ('rows', row * 1)]
        size = wintypes.DWORD()
        status = api(None, ctypes.byref(size), False, family, 3, 0)  # OWNER_PID_LISTENER
        if status not in (0, 122):
            raise OSError('Cannot inspect TCP listeners')
        for attempt in range(2):
            if not 4 <= size.value <= 8 * 1024 * 1024:
                raise OSError('Invalid TCP listener table')
            buffer = ctypes.create_string_buffer(size.value)
            status = api(buffer, ctypes.byref(size), False, family, 3, 0)
            if status == 122 and attempt == 0:
                continue  # The table grew between the two reads, never restart a child.
            if status != 0:
                raise OSError('Cannot inspect TCP listeners')
            count = wintypes.DWORD.from_buffer_copy(buffer.raw[:4]).value
            offset, stride = Table.rows.offset, ctypes.sizeof(row)
            if offset + count * stride > len(buffer):
                raise OSError('Invalid TCP listener table bounds')
            for index in range(count):
                entry = row.from_buffer_copy(buffer.raw, offset + index * stride)
                if entry.state == 2 and socket.ntohs(entry.local_port & 65535) == port:
                    return True
            break
    return False


def _probe(instance, port, pid, boot_id=None, excluded_boot=None):
    """Only query the descriptor of the intended PID; never expose its credential."""
    try:
        descriptor = read_descriptor(instance / f'runtime-ops-{port}.json', port)
        if (descriptor['pid'] != pid or descriptor['boot_id'] == excluded_boot
                or (boot_id and descriptor['boot_id'] != boot_id)):
            return None
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        def get(path, token=None):
            headers = {'Accept': 'application/json'}
            if token:
                headers['Authorization'] = 'Bearer ' + token
            request = urllib.request.Request(f'http://127.0.0.1:{port}{path}', headers=headers)
            with opener.open(request, timeout=.5) as response:
                raw = response.read(16385)
                if response.status != 200 or len(raw) > 16384:
                    raise ValueError('Invalid local response')
                return json.loads(raw)
        health = get('/api/health')
        if health.get('ok') is not True or health.get('service') != 'pycloud' or health.get('port') != port:
            return None
        verified = clean_snapshot(get(OPS_PATH, descriptor['token']), descriptor)
        return dict(pid=pid, boot_id=verified['boot_id'], readiness='operator_http_verified',
                    content_generation=verified['runtime'].get('content_generation'))
    except Exception:
        return None


def _observe(instance, port, pid, deadline, boot_id=None, excluded_boot=None):
    # A daemon prevents a stalled/drip-fed HTTP response from retaining the helper.
    result = queue.Queue(maxsize=1)
    threading.Thread(target=lambda: result.put(_probe(instance, port, pid, boot_id, excluded_boot)),
                     daemon=True).start()
    try:
        return result.get(timeout=max(.001, deadline - time.monotonic()))
    except queue.Empty:
        return None


def _start_runtime(*, project_dir, instance_dir, port, operation_id, timeout=10,
                  python=sys.executable, db_path=None, secret_file=None):
    project, instance = Path(project_dir).resolve(), Path(instance_dir).resolve()
    if (type(port) is not int or not 1 <= port <= 65535 or not isinstance(operation_id, str)
            or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', operation_id)
            or not isinstance(timeout, (float, int)) or not 0 < timeout <= 120):
        raise ValueError('Invalid launch request')
    if not (project / 'server.py').is_file() or not Path(python).is_file():
        raise ValueError('Missing interpreter or server.py')
    database = Path(db_path).resolve() if db_path else instance / 'app.db'
    secret = Path(secret_file).resolve() if secret_file else instance / 'secret_key'
    served = [project / 'static', project / 'frontend/dist']
    if any(path.is_relative_to(root.resolve()) for path in (instance, database, secret) for root in served):
        raise ValueError('Runtime data cannot be placed under served assets')
    config = dict(project=str(project), instance=str(instance), port=port, python=str(Path(python).resolve()),
                  db=str(database), secret=str(secret))
    digest = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    directory = instance / 'operator-launches'
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    receipt = directory / (operation_id + '.json')
    active = directory / f'_active-{port}.json'
    base = dict(schema=1, operation_id=operation_id, port=port, request_digest=digest,
                receipt=str(receipt), pid=None)

    def save(record, *, update_active=True):
        _write_record(receipt, record)
        if update_active:
            _write_record(active, record)
        return record

    created_record = None
    try:
        with _launch_lock(directory):
            deadline = time.monotonic() + timeout
            if receipt.exists():
                previous = _read_record(receipt)
                if previous.get('request_digest') != digest:
                    return {**base, 'status': 'refused', 'reason': 'operation_id_conflict'}
                if previous.get('status') == 'failed':
                    return {**previous, 'reused': True}
                while time.monotonic() < deadline:
                    if _process_state(previous.get('pid')) == 'dead':
                        return save({**previous, 'status': 'failed',
                                     'reason': 'previous_process_exited', 'reused': True},
                                    update_active=False)
                    ready = _observe(instance, port, previous.get('pid'), deadline,
                                     previous.get('boot_id'), previous.get('excluded_boot'))
                    if ready:
                        return save({**previous, **ready, 'status': 'ready', 'reused': True},
                                    update_active=False)
                    time.sleep(min(.05, max(0, deadline - time.monotonic())))
                return {**previous, 'status': 'starting' if previous.get('status') == 'starting' else 'refused',
                        'reason': 'previous_start_unverified', 'reused': True}

            previous = _read_record(active) if active.exists() else None
            if previous and _process_state(previous.get('pid')) != 'dead':
                if previous.get('request_digest') != digest:
                    return {**base, 'status': 'refused', 'reason': 'previous_configuration_mismatch'}
                ready = _observe(instance, port, previous.get('pid'), deadline,
                                 previous.get('boot_id'), previous.get('excluded_boot'))
                if ready:
                    record = {**base, **ready, 'status': 'already_running'}
                    _write_record(receipt, record)
                    return record
                return {**base, 'status': 'refused', 'reason': 'previous_start_unverified'}

            old_descriptor = None
            try:
                old_descriptor = read_descriptor(instance / f'runtime-ops-{port}.json', port)
            except (OSError, ValueError):
                pass
            if _port_busy(port):
                # A descriptor proves process identity, not its DB/key/project paths.
                # Without a matching launch receipt never accept it as this request.
                return {**base, 'status': 'refused', 'reason': 'port_in_use'}
            if old_descriptor and _process_state(old_descriptor['pid']) != 'dead':
                return {**base, 'status': 'refused', 'reason': 'previous_runtime_unverified'}

            record = {**base, 'status': 'starting',
                      'excluded_boot': old_descriptor['boot_id'] if old_descriptor else None,
                      'stdout_log': str(directory / (operation_id + '.stdout.log')),
                      'stderr_log': str(directory / (operation_id + '.stderr.log'))}
            save(record)  # Persist intent before creation: an interrupted helper must never retry it.
            env = os.environ.copy()
            env.update(PYCLOUD_INSTANCE_DIR=str(instance), PYCLOUD_DB_PATH=str(database),
                       PYCLOUD_SECRET_FILE=str(secret), PYCLOUD_PORT=str(port), PYCLOUD_UI='legacy')
            options = dict(cwd=project, env=env, stdin=subprocess.DEVNULL, close_fds=True)
            if os.name == 'nt':
                options['creationflags'] = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
            else:
                options['start_new_session'] = True
            try:
                with open(record['stdout_log'], 'ab') as stdout, open(record['stderr_log'], 'ab') as stderr:
                    _protect_credential(record['stdout_log'])
                    _protect_credential(record['stderr_log'])
                    child = subprocess.Popen([config['python'], '-u', str(project / 'server.py')],
                                             stdout=stdout, stderr=stderr, **options)
            except OSError:
                return save({**record, 'status': 'failed', 'reason': 'process_creation_failed'})
            record['pid'] = child.pid
            created_record = record
            save(record)
            while time.monotonic() < deadline:
                if child.poll() is not None:
                    return save({**record, 'status': 'failed', 'reason': 'process_exited', 'exit_code': child.returncode})
                ready = _observe(instance, port, child.pid, deadline, excluded_boot=record['excluded_boot'])
                if ready:
                    return save({**record, **ready, 'status': 'ready'})
                time.sleep(min(.05, max(0, deadline - time.monotonic())))
            return save({**record, 'status': 'starting', 'reason': 'readiness_unverified'})
    except (OSError, ValueError, subprocess.SubprocessError):
        if created_record is not None:
            return {**created_record, 'status': 'starting', 'reason': 'launch_state_unavailable'}
        return {**base, 'status': 'refused', 'reason': 'launch_state_unavailable'}


def start_runtime(*, project_dir, instance_dir, port, operation_id, timeout=10,
                  python=sys.executable, db_path=None, secret_file=None):
    try:
        return _start_runtime(project_dir=project_dir, instance_dir=instance_dir, port=port,
                              operation_id=operation_id, timeout=timeout, python=python,
                              db_path=db_path, secret_file=secret_file)
    except (OSError, ValueError, TypeError):
        return {'status': 'error', 'reason': 'invalid_launch_request'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-dir', type=Path, default=SCRIPT_DIR.parent)
    parser.add_argument('--instance-dir', type=Path, required=True)
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--operation-id', required=True)
    parser.add_argument('--timeout', type=float, default=10)
    parser.add_argument('--python', default=sys.executable)
    parser.add_argument('--db-path', type=Path)
    parser.add_argument('--secret-file', type=Path)
    try:
        result = start_runtime(**vars(parser.parse_args(argv)))
    except (OSError, ValueError):
        result = {'status': 'error', 'reason': 'invalid_launch_request'}
    print(json.dumps(result, ensure_ascii=True))
    return 0 if result['status'] in ('ready', 'already_running') else 2 if result['status'] == 'starting' else 1


if __name__ == '__main__':
    raise SystemExit(main())
