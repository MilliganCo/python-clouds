# -*- coding: utf-8 -*-
"""Тесты приоритета PYCLOUD_* путей instance/DB/secret."""
import sys
from pathlib import Path

import pytest

PLATFORM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLATFORM))

import server_paths  # noqa: E402


def test_db_path_prefers_pycloud_db_path(tmp_path, monkeypatch):
    inst = tmp_path / "inst"
    db = tmp_path / "custom.db"
    monkeypatch.setenv("PYCLOUD_INSTANCE_DIR", str(inst))
    monkeypatch.setenv("PYCLOUD_DB_PATH", str(db))
    monkeypatch.delenv("PYCLOUD_SECRET_FILE", raising=False)
    p = server_paths.resolve_paths(base=tmp_path)
    assert p.db_path == db
    assert p.instance_dir == inst
    assert p.secret_file == inst / "secret_key"
    assert inst.is_dir()


def test_secret_file_env_override(tmp_path, monkeypatch):
    inst = tmp_path / "inst"
    secret = tmp_path / "secrets" / "key"
    monkeypatch.setenv("PYCLOUD_INSTANCE_DIR", str(inst))
    monkeypatch.setenv("PYCLOUD_SECRET_FILE", str(secret))
    monkeypatch.delenv("PYCLOUD_DB_PATH", raising=False)
    p = server_paths.resolve_paths(base=tmp_path)
    assert p.secret_file == secret
    assert p.db_path == inst / "app.db"
    assert secret.parent.is_dir()


def test_defaults_under_base_instance(tmp_path, monkeypatch):
    monkeypatch.delenv("PYCLOUD_INSTANCE_DIR", raising=False)
    monkeypatch.delenv("PYCLOUD_DB_PATH", raising=False)
    monkeypatch.delenv("PYCLOUD_SECRET_FILE", raising=False)
    p = server_paths.resolve_paths(base=tmp_path)
    assert p.instance_dir == tmp_path / "instance"
    assert p.db_path == tmp_path / "instance" / "app.db"
    assert p.secret_file == tmp_path / "instance" / "secret_key"


def test_invalid_explicit_instance_fails_fast(tmp_path, monkeypatch):
    blocker = tmp_path / "not_a_dir"
    blocker.write_text("x", encoding="utf-8")
    monkeypatch.setenv("PYCLOUD_INSTANCE_DIR", str(blocker))
    with pytest.raises(SystemExit, match="PYCLOUD_INSTANCE_DIR"):
        server_paths.resolve_paths(base=tmp_path)


def test_resolve_ui_default_legacy(monkeypatch):
    monkeypatch.delenv("PYCLOUD_UI", raising=False)
    assert server_paths.resolve_ui() == "legacy"


def test_resolve_ui_empty_is_legacy(monkeypatch):
    monkeypatch.setenv("PYCLOUD_UI", "")
    assert server_paths.resolve_ui() == "legacy"


def test_resolve_ui_react(monkeypatch):
    monkeypatch.setenv("PYCLOUD_UI", "react")
    assert server_paths.resolve_ui() == "react"


def test_resolve_ui_invalid_fails_fast(monkeypatch):
    monkeypatch.setenv("PYCLOUD_UI", "angular")
    with pytest.raises(SystemExit, match="PYCLOUD_UI"):
        server_paths.resolve_ui()


def test_assert_ui_assets_react_requires_dist(tmp_path):
    with pytest.raises(SystemExit, match="frontend/dist"):
        server_paths.assert_ui_assets("react", base=tmp_path)


def test_assert_ui_assets_legacy_ok_without_dist(tmp_path):
    server_paths.assert_ui_assets("legacy", base=tmp_path)
