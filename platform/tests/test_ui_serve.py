# -*- coding: utf-8 -*-
"""Cutover-prep: React dist /legacy /pyodide serving."""
from __future__ import annotations

import importlib
import sqlite3
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

PLATFORM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLATFORM))


def _make_fake_dist(root: Path) -> Path:
    dist = root / "frontend" / "dist"
    assets = dist / "assets"
    assets.mkdir(parents=True)
    (dist / "index.html").write_text(
        "<!doctype html><html><body>react-ui</body></html>", encoding="utf-8"
    )
    (dist / "manifest.json").write_text("{}", encoding="utf-8")
    (dist / "build-version.txt").write_text("cutover-test\n", encoding="utf-8")
    (assets / "index-abc123.js").write_text("console.log(1)", encoding="utf-8")
    (dist / "runner-worker.js").write_text("// worker", encoding="utf-8")
    return dist


@pytest.fixture()
def react_client(tmp_path, monkeypatch):
    """Flask test client with PYCLOUD_UI=react and a fake frontend/dist."""
    _make_fake_dist(tmp_path)
    legacy = tmp_path / "static"
    legacy.mkdir()
    (legacy / "index.html").write_text(
        "<!doctype html><html><body>legacy-ui</body></html>", encoding="utf-8"
    )
    (legacy / "app.js").write_text("// legacy", encoding="utf-8")
    (legacy / "runner-worker.js").write_text("// legacy worker", encoding="utf-8")

    monkeypatch.setenv("PYCLOUD_UI", "react")
    monkeypatch.setenv("PYCLOUD_INSTANCE_DIR", str(tmp_path / "instance"))
    monkeypatch.delenv("PYCLOUD_FRONTEND_BUILD", raising=False)

    import server as srv

    importlib.reload(srv)
    # Point UI roots at tmp_path (reload already registered with real BASE).
    srv.app.config["PYCLOUD_UI"] = "react"
    srv.app.config["PYCLOUD_BASE"] = str(tmp_path)
    srv.app.config["PYCLOUD_LEGACY_STATIC"] = str(legacy)
    srv.UI_MODE = "react"
    srv.FRONTEND_BUILD = "cutover-test"

    monkeypatch.setattr(srv, "DB_PATH", tmp_path / "test.db")
    conn = sqlite3.connect(srv.DB_PATH)
    conn.executescript(srv.SCHEMA)
    conn.close()
    srv.app.config["TESTING"] = True
    with srv.app.test_client() as c:
        yield c, legacy


def test_react_mode_serves_dist_index(react_client):
    client, _legacy = react_client
    r = client.get("/")
    assert r.status_code == 200
    assert b"react-ui" in r.data
    assert r.headers.get("Cache-Control") == "no-cache"


def test_react_mode_serves_hashed_assets(react_client):
    client, _legacy = react_client
    r = client.get("/assets/index-abc123.js")
    assert r.status_code == 200
    assert b"console.log(1)" in r.data
    assert "immutable" in (r.headers.get("Cache-Control") or "")


def test_legacy_prefix_serves_vanilla(react_client):
    client, _legacy = react_client
    r = client.get("/legacy/")
    assert r.status_code == 200
    assert b"legacy-ui" in r.data
    r2 = client.get("/legacy/app.js")
    assert r2.status_code == 200
    assert b"legacy" in r2.data


def test_legacy_path_traversal_blocked(react_client):
    client, _legacy = react_client
    r = client.get("/legacy/../frontend/dist/index.html")
    assert r.status_code in (404, 400)


def test_runner_worker_from_dist_in_react_mode(react_client):
    client, _legacy = react_client
    r = client.get("/runner-worker.js")
    assert r.status_code == 503
    assert r.get_json()["code"] == "execution_disabled"
    assert r.headers["Cache-Control"] == "no-store"


def test_health_reports_react_ui(react_client):
    client, _legacy = react_client
    body = client.get("/api/health").get_json()
    assert body["ui"] == "react"
    assert body["frontend_build"] == "cutover-test"


def test_pyodide_proxy_fetches_cdn(react_client):
    client, _legacy = react_client

    class FakeHeaders:
        def get_content_type(self):
            return "text/javascript"

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return b"fake-pyodide"

        headers = FakeHeaders()

    with patch("ui_serve.urllib.request.urlopen", return_value=FakeResp()) as fetch:
        r = client.get("/pyodide/pyodide.mjs")
    assert r.status_code == 503
    assert r.get_json()["code"] == "execution_disabled"
    fetch.assert_not_called()


def test_pyodide_rejects_traversal(react_client):
    client, _legacy = react_client
    r = client.get("/pyodide/../secret")
    assert r.status_code == 503


def test_default_mode_still_legacy(tmp_path, monkeypatch):
    monkeypatch.delenv("PYCLOUD_UI", raising=False)
    monkeypatch.setenv("PYCLOUD_INSTANCE_DIR", str(tmp_path / "instance"))
    import server as srv

    importlib.reload(srv)
    monkeypatch.setattr(srv, "DB_PATH", tmp_path / "test.db")
    conn = sqlite3.connect(srv.DB_PATH)
    conn.executescript(srv.SCHEMA)
    conn.close()
    srv.app.config["TESTING"] = True
    # Keep real static folder so index exists
    with srv.app.test_client() as c:
        r = c.get("/")
        assert r.status_code == 200
        assert b"Python" in r.data or b"react-root" not in r.data
        body = c.get("/api/health").get_json()
        assert body["ui"] == "legacy"
        # /legacy/ still available as emergency
        assert c.get("/legacy/").status_code == 200
