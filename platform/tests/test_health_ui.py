# -*- coding: utf-8 -*-
"""Тесты /api/health: ui и frontend_build без утечки путей."""
import importlib
import sqlite3
import sys
from pathlib import Path

import pytest

PLATFORM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLATFORM))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    import server as srv

    importlib.reload(srv)
    monkeypatch.setattr(srv, "DB_PATH", tmp_path / "test.db")
    conn = sqlite3.connect(srv.DB_PATH)
    conn.executescript(srv.SCHEMA)
    conn.close()
    srv.app.config["TESTING"] = True
    with srv.app.test_client() as c:
        yield c


def test_health_default_ui_legacy(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.get_json()
    assert body["ok"] is True
    assert body["service"] == "pycloud"
    assert body["ui"] == "legacy"
    assert "frontend_build" in body
    assert isinstance(body["frontend_build"], str)
    blob = str(body).lower()
    assert "db" not in body
    assert "instance" not in blob
    assert "secret" not in blob
    assert "app.db" not in blob


def test_health_ui_and_build_from_module(client, monkeypatch):
    import server as srv

    monkeypatch.setattr(srv, "UI_MODE", "react")
    monkeypatch.setattr(srv, "FRONTEND_BUILD", "test-build-sha")
    body = client.get("/api/health").get_json()
    assert body["ui"] == "react"
    assert body["frontend_build"] == "test-build-sha"


def test_busy_port_refuses_start_without_terminating_listener(client, monkeypatch):
    import server as srv
    monkeypatch.setattr(srv, '_pids_listening_on', lambda port: {987654})
    monkeypatch.setattr(srv, '_terminate_pid', lambda *a, **kw: pytest.fail('Existing listener must stay alive'), raising=False)
    with pytest.raises(SystemExit, match='8017'):
        srv.ensure_single_instance(8017)


def test_windows_listener_probe_matches_the_exact_port(client, monkeypatch):
    import sys
    from types import SimpleNamespace
    import server as srv
    monkeypatch.setattr(sys, 'platform', 'win32')
    monkeypatch.setattr(srv.subprocess, 'run', lambda *a, **kw: SimpleNamespace(stdout=(
        'TCP 0.0.0.0:18017 0.0.0.0:0 LISTENING 111\n'
        'TCP [::]:8017 [::]:0 LISTENING 222\n'
        'TCP 127.0.0.1:80170 0.0.0.0:0 LISTENING 333\n')))
    assert srv._pids_listening_on(8017) == {222}
