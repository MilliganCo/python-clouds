"""Launch only stdlib fake children in temporary projects; never import app server."""
import ctypes
from ctypes import wintypes
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import time

import pytest


PLATFORM = Path(__file__).resolve().parents[1]
SCRIPT = PLATFORM / "scripts" / "start_runtime.py"
FAKE = PLATFORM / "tests" / "fixtures" / "runtime_launcher_server.py"
TOKEN = "e" * 64


def available_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    assert port != 8017
    return port


def owned_identity(pid, handle=None):
    if os.name != "nt":
        try:
            return Path(f"/proc/{pid}/stat").read_text().split(") ", 1)[1].split()[19]
        except FileNotFoundError:
            return None
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    fields = [wintypes.FILETIME() for _ in range(4)]
    if not kernel.GetProcessTimes(handle, *map(ctypes.byref, fields)):
        raise ctypes.WinError(ctypes.get_last_error())
    return str((fields[0].dwHighDateTime << 32) | fields[0].dwLowDateTime)


def owned_running(marker, *, stop=False):
    """Use the child's recorded creation identity, never Windows os.kill(pid, 0)."""
    pid = marker["pid"]
    if os.name != "nt":
        identity = owned_identity(pid)
        if identity is None:
            return False
        assert identity == marker["creation"], "Owned child PID was reused"
        if stop:
            import signal
            os.kill(pid, signal.SIGTERM)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                try:
                    done, _ = os.waitpid(pid, os.WNOHANG)
                except ChildProcessError:
                    break
                if done == pid:
                    break
                time.sleep(.025)
        return True
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    handle = kernel.OpenProcess(0x00101001, False, pid)
    if not handle:
        assert ctypes.get_last_error() == 87, "Cannot verify owned child process"
        return False
    try:
        if kernel.WaitForSingleObject(handle, 0) == 0:
            return False
        assert owned_identity(pid, handle) == marker["creation"], "Owned child PID was reused"
        if stop:
            assert kernel.TerminateProcess(handle, 0)
            assert kernel.WaitForSingleObject(handle, 5000) == 0
        return True
    finally:
        kernel.CloseHandle(handle)


@pytest.fixture()
def launcher(monkeypatch):
    monkeypatch.syspath_prepend(str(SCRIPT.parent))
    spec = importlib.util.spec_from_file_location("runtime_launcher_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    # Dataclasses and other normal module introspection need registration.
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def fake_project(tmp_path, monkeypatch):
    project = tmp_path / "fake project"
    project.mkdir()
    (project / "static").mkdir()
    shutil.copyfile(FAKE, project / "server.py")
    owned = tmp_path / "owned children"
    owned.mkdir()
    inherited = tmp_path / "inherited instance"
    inherited.mkdir()
    monkeypatch.setenv("PYCLOUD_TEST_ROOT", str(tmp_path))
    monkeypatch.setenv("PYCLOUD_TEST_OWNED_DIR", str(owned))
    monkeypatch.setenv("PYCLOUD_INSTANCE_DIR", str(inherited))
    monkeypatch.setenv("PYCLOUD_DB_PATH", str(inherited / "must-not-open.db"))
    monkeypatch.setenv("PYCLOUD_SECRET_FILE", str(inherited / "must-not-create.secret"))
    monkeypatch.setenv("PYCLOUD_UI", "react")
    monkeypatch.setenv("PYCLOUD_AI_ENABLED", "0")
    monkeypatch.setenv("PYCLOUD_TEST_INHERITED_MARKER", "TEST_ONLY_INHERITED_VALUE")
    monkeypatch.delenv("PYCLOUD_TEST_START_DELAY", raising=False)
    monkeypatch.delenv("PYCLOUD_TEST_FAIL", raising=False)
    monkeypatch.delenv("PYCLOUD_TEST_BAD_OPS_IDENTITY", raising=False)
    config = dict(project_dir=project, instance_dir=tmp_path / "instance", port=available_port(),
                  operation_id="test-operation", timeout=5, python=sys.executable)
    state = {"project": project, "owned": owned, "inherited": inherited, "config": config}
    yield state
    # Even a failed assertion must clean up only our identity-checked fake children.
    deadline = time.monotonic() + 1
    while not list(owned.glob("*.json")) and time.monotonic() < deadline:
        time.sleep(.025)
    for path in owned.glob("*.json"):
        owned_running(json.loads(path.read_text(encoding="utf-8")), stop=True)


def child_markers(state):
    return [json.loads(path.read_text(encoding="utf-8")) for path in state["owned"].glob("*.json")]


def only_child(state):
    markers = child_markers(state)
    assert len(markers) == 1, "The launcher started more than one fake server"
    return markers[0]


def wait_child_marker(state, pid):
    path = state["owned"] / f"{pid}.json"
    deadline = time.monotonic() + 2
    while not path.is_file() and time.monotonic() < deadline:
        time.sleep(.025)
    assert path.is_file(), "The owned child did not publish its creation identity"
    marker = json.loads(path.read_text(encoding="utf-8"))
    assert marker["pid"] == pid
    return marker


def assert_private_report(report):
    body = json.dumps(report)
    for private in (TOKEN, "TEST_ONLY_SESSION_SECRET", "TEST_ONLY_INHERITED_VALUE", "TEST_ONLY_CHILD_FAILURE"):
        assert private not in body


def cli_arguments(config):
    return [sys.executable, str(SCRIPT), "--project-dir", str(config["project_dir"]),
            "--instance-dir", str(config["instance_dir"]), "--port", str(config["port"]),
            "--operation-id", config["operation_id"], "--timeout", str(config["timeout"])]


def test_direct_launch_overrides_inherited_db_secret_and_uses_detached_stdio(launcher, fake_project, monkeypatch):
    observed = []
    actual_popen = subprocess.Popen
    def record(*args, **kwargs):
        if any(Path(str(part)).name == "server.py" for part in args[0]):
            observed.append((args, kwargs))
        return actual_popen(*args, **kwargs)
    monkeypatch.setattr(launcher.subprocess, "Popen", record)
    config = fake_project["config"]
    report = launcher.start_runtime(**config)
    assert report["status"] == "ready", report
    marker = only_child(fake_project)
    assert report["pid"] == marker["pid"] and owned_running(marker)
    assert not list(fake_project["inherited"].iterdir()), "Inherited paths were used"
    dbs = list(config["instance_dir"].glob("*.db"))
    assert len(dbs) == 1
    with sqlite3.connect(dbs[0]) as db:
        values = dict(db.execute("SELECT name,value FROM fake_environment"))
    assert Path(values["PYCLOUD_INSTANCE_DIR"]).resolve() == config["instance_dir"].resolve()
    assert Path(values["PYCLOUD_DB_PATH"]).resolve() == dbs[0].resolve()
    assert Path(values["PYCLOUD_SECRET_FILE"]).resolve().parent == config["instance_dir"].resolve()
    assert values["PYCLOUD_UI"] == "legacy" and values["PYCLOUD_AI_ENABLED"] == "0"
    assert values["PYCLOUD_TEST_INHERITED_MARKER"] == "TEST_ONLY_INHERITED_VALUE"
    assert len(observed) == 1
    args, kwargs = observed[0]
    assert Path(args[0][0]).resolve() == Path(sys.executable).resolve()
    assert not kwargs.get("shell") and kwargs["close_fds"] is True
    assert kwargs["stdin"] == subprocess.DEVNULL
    assert kwargs["stdout"] != subprocess.PIPE and kwargs["stderr"] != subprocess.PIPE
    assert kwargs["stdout"] is not kwargs["stderr"]
    if os.name == "nt":
        required = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        assert kwargs["creationflags"] & required == required
    receipt = config["instance_dir"] / "operator-launches" / (config["operation_id"] + ".json")
    assert receipt.is_file()
    assert_private_report(report)
    assert_private_report(json.loads(receipt.read_text(encoding="utf-8")))
    if os.name != "nt":
        assert receipt.stat().st_mode & 0o077 == 0


def test_repeated_operation_and_new_operation_never_spawn_twice(launcher, fake_project):
    config = fake_project["config"]
    first = launcher.start_runtime(**config)
    assert first["status"] == "ready", first
    marker = only_child(fake_project)
    again = launcher.start_runtime(**config)
    assert again["status"] in ("ready", "already_running"), again
    assert again["pid"] == marker["pid"]
    other = launcher.start_runtime(**{**config, "operation_id": "different-operation"})
    assert other["status"] in ("refused", "already_running"), other
    assert only_child(fake_project) == marker and owned_running(marker)


@pytest.mark.parametrize("changed", ["project", "db", "secret"],
                         ids=["changed-project", "changed-db-path", "changed-secret-path"])
def test_new_operation_cannot_reuse_a_runtime_with_different_config(launcher, fake_project, changed):
    config = fake_project["config"]
    first = launcher.start_runtime(**config)
    assert first["status"] == "ready", first
    marker = only_child(fake_project)
    other = {**config, "operation_id": "changed-" + changed}
    if changed == "project":
        other_project = fake_project["project"].parent / "different project"
        shutil.copytree(fake_project["project"], other_project)
        other["project_dir"] = other_project
    elif changed == "db":
        other["db_path"] = config["instance_dir"] / "different.db"
    else:
        other["secret_file"] = config["instance_dir"] / "different.secret"
    report = launcher.start_runtime(**other)
    assert only_child(fake_project) == marker and owned_running(marker)
    assert report["status"] == "refused", report


def test_descriptor_alone_cannot_accept_changed_database_request(launcher, fake_project):
    config = fake_project["config"]
    first = launcher.start_runtime(**config)
    assert first["status"] == "ready", first
    marker = only_child(fake_project)
    active = config["instance_dir"] / "operator-launches" / f"_active-{config['port']}.json"
    assert active.resolve().is_relative_to(config["instance_dir"].resolve())
    assert active.is_file()
    active.unlink()  # Remove only this temporary instance's active launch receipt.
    report = launcher.start_runtime(**{**config, "operation_id": "descriptor-only-new-db",
                                      "db_path": config["instance_dir"] / "descriptor-other.db"})
    assert report["status"] == "refused", report
    assert only_child(fake_project) == marker and owned_running(marker)
    assert not (config["instance_dir"] / "descriptor-other.db").exists()


def test_observing_stale_operation_cannot_replace_new_active_operation(launcher, tmp_path, monkeypatch):
    project = tmp_path / "project"
    project.mkdir()
    (project / "server.py").write_text("# This unit fixture must never execute.\n", encoding="utf-8")
    instance = tmp_path / "instance"
    directory = instance / "operator-launches"
    directory.mkdir(parents=True)
    port = available_port()
    config = dict(project=str(project.resolve()), instance=str(instance.resolve()), port=port,
                  python=str(Path(sys.executable).resolve()), db=str(instance / "app.db"),
                  secret=str(instance / "secret_key"))
    digest = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    receipt = directory / "operation-a.json"
    active = directory / f"_active-{port}.json"
    old = dict(schema=1, operation_id="operation-a", request_digest=digest, port=port,
               status="ready", pid=12345, boot_id="a" * 32, receipt=str(receipt))
    current = dict(schema=1, operation_id="operation-b", request_digest=digest, port=port,
                   status="starting", pid=23456, receipt=str(directory / "operation-b.json"))
    records = {receipt: old.copy(), active: current.copy()}
    for path, record in records.items():
        path.write_text(json.dumps(record), encoding="utf-8")
    writes = []
    monkeypatch.setattr(launcher, "_read_record", lambda path: records[path].copy())
    def remember_write(path, record):
        writes.append(path)
        records[path] = record.copy()
    monkeypatch.setattr(launcher, "_write_record", remember_write)
    monkeypatch.setattr(launcher, "_process_state", lambda pid: "dead" if pid == 12345 else "alive")
    monkeypatch.setattr(launcher, "_observe", lambda *args, **kwargs: None)
    def forbidden_spawn(*args, **kwargs):
        pytest.fail("An observation of an existing operation must not spawn a process")
    monkeypatch.setattr(launcher.subprocess, "Popen", forbidden_spawn)
    report = launcher.start_runtime(project_dir=project, instance_dir=instance, port=port,
                                    operation_id="operation-a", timeout=.1, python=sys.executable)
    assert report["status"] in ("failed", "refused"), report
    assert records[active] == current, "A stale operation overwrote the newer active owner"
    assert active not in writes, "Observing operation A must not republish it over active B"


@pytest.mark.parametrize("phase", ["before", "after"], ids=["before-spawn", "after-spawn"])
def test_credential_subprocess_timeout_returns_safe_result_without_respawn(launcher, tmp_path, monkeypatch, phase):
    project = tmp_path / "project"
    project.mkdir()
    (project / "server.py").write_text("# This unit fixture must never execute.\n", encoding="utf-8")
    config = dict(project_dir=project, instance_dir=tmp_path / "instance", port=available_port(),
                  operation_id="credential-timeout", timeout=.05, python=sys.executable)
    spawned = []
    class FakeChild:
        pid = 987654321
        returncode = None
        def poll(self):
            return None
    def fake_spawn(*args, **kwargs):
        spawned.append((args, kwargs))
        return FakeChild()
    def write_record(path, record):
        if phase == "before" or record.get("pid") == FakeChild.pid:
            raise subprocess.TimeoutExpired(["icacls.exe", "TEST_ONLY"], timeout=.01)
        path.write_text(json.dumps(record), encoding="utf-8")
    monkeypatch.setattr(launcher, "_write_record", write_record)
    monkeypatch.setattr(launcher, "_protect_credential", lambda path: None)
    monkeypatch.setattr(launcher, "_port_busy", lambda port: False)
    monkeypatch.setattr(launcher, "_process_state", lambda pid: "unknown")
    monkeypatch.setattr(launcher, "_observe", lambda *args, **kwargs: None)
    monkeypatch.setattr(launcher.subprocess, "Popen", fake_spawn)
    report = launcher.start_runtime(**config)
    assert isinstance(report, dict)
    expected = "refused" if phase == "before" else "starting"
    assert report["status"] == expected, report
    if phase == "after":
        assert report["pid"] == FakeChild.pid
    again = launcher.start_runtime(**config)
    assert isinstance(again, dict) and again["status"] == expected, again
    assert len(spawned) == (0 if phase == "before" else 1)


def test_busy_unknown_port_refused_before_fake_import_or_db_touch(launcher, fake_project):
    config = fake_project["config"]
    with socket.socket() as existing:
        existing.bind(("127.0.0.1", config["port"]))
        existing.listen()
        report = launcher.start_runtime(**config)
        assert report["status"] == "refused", report
        assert not child_markers(fake_project)
        assert not list(fake_project["inherited"].iterdir())
        assert not list(config["instance_dir"].rglob("*.db"))
        # The same listening socket remains usable after the refused launch.
        with socket.create_connection(("127.0.0.1", config["port"]), timeout=1):
            accepted, _ = existing.accept()
            accepted.close()


def test_timeout_can_observe_same_child_ready_without_respawn(launcher, fake_project, monkeypatch):
    config = fake_project["config"]
    monkeypatch.setenv("PYCLOUD_TEST_START_DELAY", "1.5")
    pending = launcher.start_runtime(**{**config, "timeout": .2})
    assert pending["status"] == "starting", pending
    ready = launcher.start_runtime(**config)
    assert ready["status"] == "ready", ready
    marker = only_child(fake_project)
    assert pending["pid"] == ready["pid"] == marker["pid"] and owned_running(marker)


def test_failed_child_is_terminal_and_logs_remain_private(launcher, fake_project, monkeypatch):
    config = fake_project["config"]
    monkeypatch.setenv("PYCLOUD_TEST_FAIL", "1")
    report = launcher.start_runtime(**config)
    assert report["status"] == "failed", report
    marker = only_child(fake_project)
    again = launcher.start_runtime(**config)
    assert again["status"] == "failed", again
    assert only_child(fake_project) == marker
    logs = [path for path in (config["instance_dir"] / "operator-launches").rglob("*")
            if path.is_file() and path.suffix != ".json" and "lock" not in path.name]
    assert any("TEST_ONLY_CHILD_FAILURE" in path.read_text(encoding="utf-8") for path in logs)
    assert_private_report(report)
    assert_private_report(again)
    if os.name != "nt":
        assert all(path.stat().st_mode & 0o077 == 0 for path in logs)


@pytest.mark.parametrize("identity", ["pid", "boot"])
def test_health_alone_cannot_accept_wrong_operator_identity(launcher, fake_project, monkeypatch, identity):
    monkeypatch.setenv("PYCLOUD_TEST_BAD_OPS_IDENTITY", identity)
    report = launcher.start_runtime(**{**fake_project["config"], "timeout": .4})
    assert report["status"] in ("starting", "failed", "error", "refused"), report
    marker = wait_child_marker(fake_project, report["pid"])
    assert only_child(fake_project) == marker
    assert owned_running(marker), "An unverified readiness result must not kill the running child"
    assert_private_report(report)


def test_reused_operation_with_changed_config_is_rejected(launcher, fake_project):
    config = fake_project["config"]
    first = launcher.start_runtime(**config)
    assert first["status"] == "ready", first
    marker = only_child(fake_project)
    changed = launcher.start_runtime(**{**config, "port": available_port()})
    assert changed["status"] in ("refused", "error"), changed
    assert only_child(fake_project) == marker and owned_running(marker)


def test_known_exited_previous_child_allows_a_new_operation(launcher, fake_project):
    config = fake_project["config"]
    assert launcher.start_runtime(**config)["status"] == "ready"
    previous = only_child(fake_project)
    owned_running(previous, stop=True)
    if os.name != "nt":
        deadline = time.monotonic() + 3
        while owned_running(previous) and time.monotonic() < deadline:
            time.sleep(.025)
    next_report = launcher.start_runtime(**{**config, "operation_id": "after-known-exit"})
    assert next_report["status"] == "ready", next_report
    assert len(child_markers(fake_project)) == 2
    assert next_report["pid"] != previous["pid"]


def test_instance_under_served_static_root_is_rejected(launcher, fake_project):
    config = {**fake_project["config"], "instance_dir": fake_project["project"] / "static" / "private"}
    report = launcher.start_runtime(**config)
    assert report["status"] in ("refused", "error"), report
    assert not child_markers(fake_project)
    assert not config["instance_dir"].exists()


def test_cli_nested_capture_returns_while_fake_server_stays_alive(fake_project):
    config = fake_project["config"]
    started = time.monotonic()
    completed = subprocess.run(cli_arguments(config), stdin=subprocess.DEVNULL, capture_output=True,
                               text=True, encoding="utf-8", timeout=12)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    lines = completed.stdout.strip().splitlines()
    assert len(lines) == 1, "CLI must print exactly one JSON report"
    report = json.loads(lines[0])
    assert report["status"] in ("ready", "already_running")
    marker = only_child(fake_project)
    assert report["pid"] == marker["pid"] and owned_running(marker)
    assert time.monotonic() - started < 12
    assert_private_report(report)
    assert TOKEN not in completed.stderr and "TEST_ONLY_SESSION_SECRET" not in completed.stderr


def test_cli_starting_and_failure_exit_codes(fake_project, monkeypatch):
    config = {**fake_project["config"], "timeout": .2}
    monkeypatch.setenv("PYCLOUD_TEST_START_DELAY", "1.5")
    completed = subprocess.run(cli_arguments(config), stdin=subprocess.DEVNULL, capture_output=True,
                               text=True, encoding="utf-8", timeout=10)
    assert completed.returncode == 2, completed.stdout + completed.stderr
    assert json.loads(completed.stdout)["status"] == "starting"
    mismatch = {**config, "port": available_port()}
    refused = subprocess.run(cli_arguments(mismatch), stdin=subprocess.DEVNULL, capture_output=True,
                             text=True, encoding="utf-8", timeout=10)
    assert refused.returncode == 1, refused.stdout + refused.stderr
    assert json.loads(refused.stdout)["status"] in ("refused", "error")
    assert len(child_markers(fake_project)) == 1


def test_concurrent_cli_helpers_start_at_most_one_server(fake_project):
    helpers = [subprocess.Popen(cli_arguments(fake_project["config"]), stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                               encoding="utf-8") for _ in range(2)]
    try:
        reports = []
        for helper in helpers:
            stdout, stderr = helper.communicate(timeout=12)
            assert helper.returncode in (0, 1, 2), stdout + stderr
            report = json.loads(stdout)
            assert report["status"] in ("ready", "already_running", "starting", "refused"), report
            assert_private_report(report)
            reports.append(report)
        assert any(report["status"] in ("ready", "already_running") for report in reports)
        assert owned_running(only_child(fake_project))
    finally:
        for helper in helpers:
            if helper.poll() is None:
                helper.kill()
            helper.communicate(timeout=5)
