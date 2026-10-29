# -*- coding: utf-8 -*-
"""Разрешение путей instance/DB/secret и режима UI (PYCLOUD_*)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

BASE = Path(__file__).resolve().parent


@dataclass(frozen=True)
class Paths:
    instance_dir: Path
    db_path: Path
    secret_file: Path


def resolve_paths(environ=None, base: Path = BASE) -> Paths:
    env = os.environ if environ is None else environ
    instance = (
        Path(env["PYCLOUD_INSTANCE_DIR"])
        if env.get("PYCLOUD_INSTANCE_DIR")
        else base / "instance"
    )
    db = Path(env["PYCLOUD_DB_PATH"]) if env.get("PYCLOUD_DB_PATH") else instance / "app.db"
    secret = (
        Path(env["PYCLOUD_SECRET_FILE"])
        if env.get("PYCLOUD_SECRET_FILE")
        else instance / "secret_key"
    )
    try:
        instance.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise SystemExit(
            f"Invalid PYCLOUD_INSTANCE_DIR={instance}: cannot create directory ({exc})"
        ) from exc
    if not instance.is_dir():
        raise SystemExit(
            f"Invalid PYCLOUD_INSTANCE_DIR={instance}: path exists but is not a directory"
        )
    try:
        db.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise SystemExit(
            f"Invalid PYCLOUD_DB_PATH={db}: cannot create parent directory ({exc})"
        ) from exc
    try:
        secret.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise SystemExit(
            f"Invalid PYCLOUD_SECRET_FILE={secret}: cannot create parent directory ({exc})"
        ) from exc
    return Paths(instance_dir=instance, db_path=db, secret_file=secret)


def resolve_ui(environ=None) -> str:
    env = os.environ if environ is None else environ
    raw = env.get("PYCLOUD_UI")
    if raw is None or raw == "":
        return "legacy"
    if raw in ("legacy", "react"):
        return raw
    raise SystemExit(f"Invalid PYCLOUD_UI={raw!r}; expected legacy|react")


def resolve_frontend_build(environ=None, base: Path = BASE) -> str:
    env = os.environ if environ is None else environ
    explicit = env.get("PYCLOUD_FRONTEND_BUILD")
    if explicit:
        return explicit.strip()
    version_file = base / "frontend" / "dist" / "build-version.txt"
    if version_file.is_file():
        text = version_file.read_text(encoding="utf-8").strip()
        if text:
            return text
    return "dev"


def assert_ui_assets(ui: str, base: Path = BASE) -> None:
    """Fail-fast before bind when serving React without a build."""
    if ui != "react":
        return
    dist = base / "frontend" / "dist"
    index = dist / "index.html"
    manifest_candidates = (
        dist / "manifest.json",
        dist / ".vite" / "manifest.json",
    )
    if not index.is_file():
        raise SystemExit(
            "PYCLOUD_UI=react requires platform/frontend/dist/index.html "
            "(run npm run build in platform/frontend). Falling back is not allowed."
        )
    if not any(p.is_file() for p in manifest_candidates):
        raise SystemExit(
            "PYCLOUD_UI=react requires a Vite manifest under frontend/dist "
            "(manifest.json or .vite/manifest.json)."
        )
    # Entry bundle: any hashed JS asset referenced by index or present in dist/assets
    assets = dist / "assets"
    if not assets.is_dir() or not any(assets.glob("*.js")):
        raise SystemExit(
            "PYCLOUD_UI=react: no JS entry bundle found in frontend/dist/assets/."
        )
