"""Local-only SQLite + session-key snapshots. Never restore over a live instance."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import time

import server_paths


FILES = ("app.db", "secret_key")
FORMAT = "pycloud-instance-v1"


def check_destination(destination):
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(f"Destination already exists: {destination}")
    for public in (server_paths.BASE / "static", server_paths.BASE / "frontend" / "dist",
                   server_paths.BASE.parent / "web"):
        if destination.resolve().is_relative_to(public.resolve()):
            raise ValueError("Private backups/instances must not be placed in a public web directory")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def check_database(path):
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("SQLite integrity_check failed")
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"users", "progress"} <= tables:
            raise ValueError("Not a Python Cloud database: users/progress tables are missing")


def check_backup(folder):
    for name in (*FILES, "manifest.json"):
        path = folder / name
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"Backup must contain a regular {name} file")
    if (folder / "manifest.json").stat().st_size > 65536:
        raise ValueError("Backup manifest is too large")
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT:
        raise ValueError("Unknown backup format")
    hashes = manifest.get("sha256")
    if not isinstance(hashes, dict) or set(hashes) != set(FILES):
        raise ValueError("Backup file list does not match the format")
    for name in FILES:
        if digest(folder / name) != hashes[name]:
            raise ValueError(f"Checksum mismatch: {name}")
    secret = folder / "secret_key"
    if not 1 <= secret.stat().st_size <= 4096 or not secret.read_text(encoding="ascii").strip():
        raise ValueError("Missing or invalid session key")
    # Completed snapshots are self-contained: never accept an extra SQLite journal.
    if any((folder / ("app.db" + suffix)).exists() for suffix in ("-wal", "-shm", "-journal")):
        raise ValueError("Backup contains an unexpected SQLite journal")
    check_database(folder / "app.db")


def snapshot(db_path, secret_path, destination):
    """Online backup includes committed WAL data; no raw copy of a running DB."""
    db_path, secret_path, destination = map(Path, (db_path, secret_path, destination))
    if not db_path.is_file() or not secret_path.is_file():
        raise ValueError("Existing database and session key are both required")
    if not 1 <= secret_path.stat().st_size <= 4096:
        raise ValueError("Invalid session key size")
    secret = secret_path.read_bytes()
    if not secret.decode("ascii").strip():
        raise ValueError("Session key is empty")
    destination = destination.absolute()
    check_destination(destination)
    # Staging is private and adjacent, so publishing stays on the same filesystem.
    with tempfile.TemporaryDirectory(prefix=".pycloud-backup-", dir=destination.parent) as temporary:
        stage = Path(temporary)
        deadline = time.monotonic() + 30

        def progress(_status, _remaining, _total):
            if time.monotonic() > deadline:
                raise TimeoutError("Database backup took longer than 30 seconds; try again when less busy")

        with closing(sqlite3.connect(db_path.resolve().as_uri() + "?mode=ro", uri=True)) as source:
            with closing(sqlite3.connect(stage / "app.db")) as target:
                source.backup(target, pages=256, progress=progress)
                target.execute("PRAGMA journal_mode=DELETE")
        if secret_path.read_bytes() != secret:
            raise ValueError("Session key changed during backup; retry")
        (stage / "secret_key").write_bytes(secret)
        (stage / "manifest.json").write_text(json.dumps({
            "format": FORMAT,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "sha256": {name: digest(stage / name) for name in FILES},
        }, indent=2), encoding="utf-8")
        check_backup(stage)
        check_destination(destination)
        stage.rename(destination)
    return destination


def restore(source, destination, *, deletions_from=None):
    """Validate a trusted local snapshot, then publish into a NEW instance folder."""
    source, destination = Path(source), Path(destination).absolute()
    check_backup(source)
    check_destination(destination)
    with closing(sqlite3.connect((source/'app.db').resolve().as_uri()+'?mode=ro',uri=True)) as check:
        account_database='password_hash' in {r[1] for r in check.execute('PRAGMA table_info(users)')}
    records=[]
    if account_database:
        if deletions_from is None:
            raise ValueError('Latest deletion ledger required: pass --deletions-from with a fresh backup of the current instance')
        latest=Path(deletions_from);check_backup(latest)
        if (latest/'secret_key').read_bytes()!=(source/'secret_key').read_bytes():
            raise ValueError('Deletion ledger belongs to a different installation')
        with closing(sqlite3.connect((latest/'app.db').resolve().as_uri()+'?mode=ro',uri=True)) as current:
            current.row_factory=sqlite3.Row
            if not current.execute("SELECT 1 FROM sqlite_master WHERE name='account_deletions' AND type='table'").fetchone():
                raise ValueError('Latest deletion ledger is unavailable; use a fresh backup after the account lifecycle update')
            records=[dict(row) for row in current.execute('SELECT * FROM account_deletions ORDER BY user_id')]
    with tempfile.TemporaryDirectory(prefix=".pycloud-restore-", dir=destination.parent) as temporary:
        stage = Path(temporary)
        for name in (*FILES, "manifest.json"):
            shutil.copyfile(source / name, stage / name)
        check_backup(stage)  # Detect a damaged/changed source during copying as well.
        if account_database:
            import account_lifecycle
            with closing(sqlite3.connect(stage/'app.db')) as restored:
                restored.execute('PRAGMA foreign_keys=ON');restored.executescript(account_lifecycle.SCHEMA)
                with restored:
                    restored.execute('BEGIN IMMEDIATE')
                    account_lifecycle.reconcile(restored,(stage/'secret_key').read_text(encoding='ascii').strip(),records)
                    if restored.execute('PRAGMA foreign_key_check').fetchone():raise ValueError('Restored account relationships are invalid')
            manifest=json.loads((stage/'manifest.json').read_text(encoding='utf8'))
            manifest.update(sha256={name:digest(stage/name) for name in FILES},deletions_reconciled=len(records),restored_at=datetime.now(timezone.utc).isoformat())
            (stage/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8');check_backup(stage)
        check_destination(destination)
        stage.rename(destination)
    return destination


def main():
    parser = argparse.ArgumentParser(description="Private local backups; no upload and no in-place restore.")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", help="Copy the configured database and session key")
    create.add_argument("destination", type=Path, help="New directory; its parent must already exist")
    recover = commands.add_parser("restore", help="Restore into a new instance directory")
    recover.add_argument("source", type=Path)
    recover.add_argument("destination", type=Path)
    recover.add_argument('--deletions-from',type=Path,help='Fresh backup of the current instance; its deletion ledger is applied to the restored copy')
    args = parser.parse_args()
    try:
        if args.command == "create":
            # Read the same PYCLOUD_* overrides as the server without importing/starting Flask.
            instance = Path(os.environ.get("PYCLOUD_INSTANCE_DIR") or server_paths.BASE / "instance")
            db = Path(os.environ.get("PYCLOUD_DB_PATH") or instance / "app.db")
            secret = Path(os.environ.get("PYCLOUD_SECRET_FILE") or instance / "secret_key")
            result = snapshot(db, secret, args.destination)
        else:
            result = restore(args.source, args.destination,deletions_from=args.deletions_from)
    except (OSError, ValueError, sqlite3.Error) as exc:
        parser.exit(1, f"Backup failed: {exc}\n")
    print(f"Ready: {result}\nContains private learner data and a session key. Store securely; do not publish.")


if __name__ == "__main__":
    main()
