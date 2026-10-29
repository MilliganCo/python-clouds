"""Keep server import/startup away from learner databases and credentials."""
import os
import tempfile
from pathlib import Path
import pytest


_instance = tempfile.TemporaryDirectory(prefix="pycloud-pytest-")
_paths = {
    "PYCLOUD_INSTANCE_DIR": _instance.name,
    "PYCLOUD_DB_PATH": str(Path(_instance.name) / "import.db"),
    "PYCLOUD_SECRET_FILE": str(Path(_instance.name) / "test-secret"),
    "PYCLOUD_AI_ENABLED": "0",
}
_previous = {key: os.environ.get(key) for key in _paths}
os.environ.update(_paths)


@pytest.fixture(autouse=True)
def no_external_runtime(monkeypatch):
    import sandbox_runner as sandbox
    def unavailable(*args, **kwargs):
        raise sandbox.SandboxError("Synthetic runtime unavailable")
    monkeypatch.setattr(sandbox.pool, "create", unavailable)
    monkeypatch.setattr(sandbox.pool, "ready", False)


def pytest_unconfigure(config):
    for key, value in _previous.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    _instance.cleanup()
