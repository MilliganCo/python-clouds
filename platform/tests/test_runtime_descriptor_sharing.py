"""Descriptor replacement and parsing use only local temporary files."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import queue
import threading

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "runtime_status.py"


@pytest.fixture()
def status(monkeypatch):
    monkeypatch.syspath_prepend(str(SCRIPT.parent))
    spec = importlib.util.spec_from_file_location("runtime_descriptor_sharing_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def descriptor(*, pid=10101, boot="a"):
    return dict(schema=1, port=8123, pid=pid, boot_id=boot * 32, token="e" * 64)


@pytest.mark.skipif(os.name != "nt", reason="Windows publication must tolerate a briefly open destination")
def test_publish_retries_same_descriptor_after_old_reader_closes(status, tmp_path, monkeypatch):
    import runtime_ops
    path = tmp_path / "runtime-ops-8123.json"
    path.write_text(json.dumps(descriptor()), encoding="utf-8")
    opened, release = threading.Event(), threading.Event()
    blocked = threading.Event()
    result, published = queue.Queue(), queue.Queue()
    original_fdopen = os.fdopen
    original_replace = os.replace
    attempts = []
    ops = runtime_ops.RuntimeOps()
    ops.token, ops.boot_id = "e" * 64, "b" * 32

    class HeldReader:
        def __init__(self, stream):
            self.stream = stream

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return self.stream.__exit__(*args)

        def fileno(self):
            return self.stream.fileno()

        def read(self, size):
            opened.set()
            if not release.wait(timeout=5):
                raise AssertionError("The controlling test did not release the reader")
            return self.stream.read(size)

    def held_fdopen(*args, **kwargs):
        stream = original_fdopen(*args, **kwargs)
        return HeldReader(stream) if len(args) > 1 and args[1] == "rb" else stream

    def observed_replace(source, destination):
        if Path(destination) == path:
            attempts.append((str(source), hashlib.sha256(Path(source).read_bytes()).hexdigest()))
        try:
            return original_replace(source, destination)
        except PermissionError:
            blocked.set()
            raise

    monkeypatch.setattr(status.os, "fdopen", held_fdopen)
    monkeypatch.setattr(runtime_ops.os, "replace", observed_replace)

    def read_old_descriptor():
        try:
            result.put(status.read_descriptor(path, 8123))
        except BaseException as error:
            result.put(error)

    def publish_new_descriptor():
        try:
            published.put(ops.publish(tmp_path, 8123))
        except BaseException as error:
            published.put(error)

    reader = threading.Thread(target=read_old_descriptor, name="held-descriptor-reader", daemon=True)
    reader.start()
    writer = threading.Thread(target=publish_new_descriptor, name="descriptor-publisher", daemon=True)
    try:
        assert opened.wait(timeout=5), "The actual descriptor read handle was not opened"
        writer.start()
        # Release only after the actual Windows replace has failed against the held handle.
        assert blocked.wait(timeout=5), "The first publication did not meet the held descriptor handle"
    finally:
        release.set()
        reader.join(timeout=5)
        if writer.ident is not None:
            writer.join(timeout=5)
    assert not reader.is_alive(), "The descriptor read thread did not finish"
    assert not writer.is_alive(), "The bounded descriptor publication did not finish"
    old = result.get_nowait()
    if isinstance(old, BaseException):
        raise old
    assert old["pid"] == 10101 and old["boot_id"] == "a" * 32
    outcome = published.get_nowait()
    if isinstance(outcome, BaseException):
        raise outcome
    assert outcome == path and ops.enabled is True
    assert len(attempts) >= 2 and len(set(attempts)) == 1, "Retries must reuse the same prepared descriptor"
    new = status.read_descriptor(path, 8123)
    assert new["pid"] == os.getpid() and new["boot_id"] == "b" * 32


def test_permanent_descriptor_denial_is_bounded_and_preserves_old_file(tmp_path, monkeypatch):
    import runtime_ops
    path = tmp_path / "runtime-ops-8123.json"
    path.write_text(json.dumps(descriptor()), encoding="utf-8")
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    attempts, protected = [], []

    class Clock:
        now = 0.0
        calls = 0

        def monotonic(self):
            self.calls += 1
            assert self.calls < 1000, "Publication did not make bounded progress"
            return self.now

        def sleep(self, seconds):
            self.now += seconds
            assert self.now <= 1.1, "Publication retry exceeded its one-second bound"

    clock = Clock()
    monkeypatch.setattr(runtime_ops, "time", clock, raising=False)
    monkeypatch.setattr(runtime_ops, "_protect_credential", lambda temporary: protected.append(str(temporary)))

    def denied(source, destination):
        attempts.append(str(source))
        error = PermissionError(13, "Synthetic descriptor replacement denial")
        error.winerror = 5
        raise error

    monkeypatch.setattr(runtime_ops.os, "replace", denied)
    ops = runtime_ops.RuntimeOps()
    ops.token = "e" * 64
    with pytest.raises(PermissionError):
        ops.publish(tmp_path, 8123)
    assert ops.enabled is False
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before
    assert list(tmp_path.iterdir()) == [path], "Failed publication must clean up its prepared temporary file"
    assert len(set(attempts)) == 1 and attempts[0] == protected[0]
    assert len(protected) == 1, "The same credential must be prepared and protected only once"
    if os.name == "nt":
        assert len(attempts) >= 2 and 0 < clock.now <= 1.1
    else:
        assert len(attempts) == 1 and clock.now == 0


@pytest.mark.parametrize("invalid", ["size", "schema", "port", "boolean-pid"])
def test_shared_descriptor_opener_retains_bounded_schema_validation(status, tmp_path, invalid):
    value = descriptor()
    if invalid == "schema":
        value["schema"] = 2
    elif invalid == "port":
        value["port"] = 8124
    elif invalid == "boolean-pid":
        value["pid"] = True
    payload = json.dumps(value)
    if invalid == "size":
        payload += " " * 4097
    path = tmp_path / "invalid-descriptor.json"
    path.write_text(payload, encoding="utf-8")
    with pytest.raises(ValueError):
        status.read_descriptor(path, 8123)
