# -*- coding: utf-8 -*-
import importlib
import os
import sqlite3
import sys
from pathlib import Path

import pytest

PLATFORM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLATFORM))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("PYCLOUD_CLIENT_DIAGNOSTICS", raising=False)
    import server as srv

    importlib.reload(srv)
    monkeypatch.setattr(srv, "DB_PATH", tmp_path / "test.db")
    conn = sqlite3.connect(srv.DB_PATH)
    conn.executescript(srv.SCHEMA)
    conn.close()
    srv.app.config["TESTING"] = True
    with srv.app.test_client() as c:
        yield c


def test_client_diagnostics_accepts_allowlisted_event(client):
    r = client.post(
        "/api/client-diagnostics",
        json={
            "event": "worker_init_failure",
            "ui": "react",
            "frontendBuild": "dev",
            "routeCategory": "task",
            "errorCategory": "worker-init",
            "capabilities": {"crossOriginIsolated": True},
        },
    )
    assert r.status_code == 200
    assert r.get_json()["ok"] is True


def test_client_diagnostics_rejects_code_field(client):
    r = client.post(
        "/api/client-diagnostics",
        json={"event": "runner_timeout", "code": "print(1)"},
    )
    assert r.status_code == 400
    body = r.get_json()
    assert body.get("error") == "Forbidden fields"


def test_client_diagnostics_rejects_unknown_event(client):
    r = client.post("/api/client-diagnostics", json={"event": "not_a_real_event"})
    assert r.status_code == 400


def test_client_diagnostics_can_be_disabled(tmp_path, monkeypatch):
    monkeypatch.setenv("PYCLOUD_CLIENT_DIAGNOSTICS", "0")
    import server as srv

    importlib.reload(srv)
    monkeypatch.setattr(srv, "DB_PATH", tmp_path / "test.db")
    conn = sqlite3.connect(srv.DB_PATH)
    conn.executescript(srv.SCHEMA)
    conn.close()
    srv.app.config["TESTING"] = True
    with srv.app.test_client() as c:
        r = c.post("/api/client-diagnostics", json={"event": "runner_timeout"})
        assert r.status_code == 200
        assert r.get_json().get("disabled") is True
    monkeypatch.delenv("PYCLOUD_CLIENT_DIAGNOSTICS", raising=False)
    # Avoid leaking disabled flag into later imported server modules in same process
    os.environ.pop("PYCLOUD_CLIENT_DIAGNOSTICS", None)
    importlib.reload(srv)
