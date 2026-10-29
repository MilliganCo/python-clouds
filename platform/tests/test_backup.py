"""Backup/restore proof on disposable data, including an uncheckpointed WAL."""
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

import pytest

PLATFORM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLATFORM))
import backup


def test_backup_restores_committed_wal_and_rejects_damage(tmp_path):
    original = tmp_path / "original"
    original.mkdir()
    secret = original / "secret_key"
    secret.write_text("private-test-key", encoding="ascii")
    database = original / "app.db"
    saved, restored = tmp_path / "saved", tmp_path / "restored"
    with closing(sqlite3.connect(database)) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA wal_autocheckpoint=0")
        db.executescript("CREATE TABLE users(id INTEGER, username TEXT); CREATE TABLE progress(task_id TEXT);")
        db.execute("INSERT INTO users VALUES (1, 'learner')")
        db.execute("INSERT INTO progress VALUES ('3.1')")
        db.commit()
        assert Path(str(database) + "-wal").stat().st_size > 0
        # A change in a still-open transaction must not enter the snapshot.
        db.execute("INSERT INTO progress VALUES ('3.2')")
        backup.snapshot(database, secret, saved)
        db.rollback()
    backup.restore(saved, restored)
    with closing(sqlite3.connect(restored / "app.db")) as db:
        assert db.execute("SELECT * FROM users").fetchall() == [(1, "learner")]
        assert db.execute("SELECT * FROM progress").fetchall() == [("3.1",)]
    assert (restored / "secret_key").read_bytes() == secret.read_bytes()
    assert sorted(p.name for p in saved.iterdir()) == ["app.db", "manifest.json", "secret_key"]
    before = {p.name: p.read_bytes() for p in original.iterdir()}
    with pytest.raises(FileExistsError):
        backup.restore(saved, original)
    with pytest.raises(FileExistsError):
        backup.snapshot(database, secret, saved)
    assert before == {p.name: p.read_bytes() for p in original.iterdir()}
    empty = tmp_path / "existing-empty"
    empty.mkdir()
    with pytest.raises(FileExistsError):
        backup.restore(saved, empty)
    with pytest.raises(ValueError, match="public web"):
        backup.restore(saved, PLATFORM / "static" / "private-backup-must-not-exist")
    assert not (PLATFORM / "static" / "private-backup-must-not-exist").exists()
    (restored / "app.db-wal").write_bytes(b"unexpected journal")
    with pytest.raises(ValueError, match="journal"):
        backup.restore(restored, tmp_path / "journal")
    assert not (tmp_path / "journal").exists()
    (saved / "secret_key").write_text("damaged", encoding="ascii")
    with pytest.raises(ValueError, match="Checksum"):
        backup.restore(saved, tmp_path / "damaged")
    assert not (tmp_path / "damaged").exists()
    # The manifest cannot make the tool copy arbitrary paths.
    manifest = json.loads((saved / "manifest.json").read_text())
    manifest["sha256"]["../outside"] = "0" * 64
    (saved / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="file list"):
        backup.restore(saved, tmp_path / "unexpected")


def test_backup_missing_or_wrong_source_leaves_no_fake_snapshot(tmp_path):
    db, secret, output = tmp_path / "app.db", tmp_path / "secret_key", tmp_path / "saved"
    with pytest.raises(ValueError):
        backup.snapshot(db, secret, output)
    assert not db.exists() and not output.exists()
    secret.write_text("key")
    with closing(sqlite3.connect(db)) as conn:
        conn.execute("CREATE TABLE unrelated(value TEXT)")
    with pytest.raises(ValueError, match="Not a Python Cloud"):
        backup.snapshot(db, secret, output)
    assert not output.exists()
    assert not list(tmp_path.glob(".pycloud-*"))


def test_backup_cli_restores_a_real_learner_and_project(tmp_path):
    env = dict(os.environ, PYCLOUD_INSTANCE_DIR=str(tmp_path / "instance"),
               PYCLOUD_DB_PATH=str(tmp_path / "separate-db" / "learning.sqlite"),
               PYCLOUD_SECRET_FILE=str(tmp_path / "separate-key" / "session-key"),
               PYCLOUD_AI_ENABLED="0", PYCLOUD_UI="legacy", PYTHONIOENCODING="utf-8")
    seed = '''
import json
import server
with server.app.test_client() as client:
    assert client.post('/api/register', json={'username':'restore_user','password':'restore123'}).status_code == 200
    for task_id in server.TASKS_META:
        if task_id.startswith(('1.', '3.')):
            assert client.post('/api/progress', json={'task_id':task_id,'solved':True}).status_code == 200
    assert client.post('/api/notes', json={'task_id':'3.1','text':'my saved note'}).status_code == 200
    assert client.post('/api/project-courses/chatbot_to_telegram/start').status_code == 200
    saved = client.post('/api/project-courses/chatbot_to_telegram/stages/hello_name/save',
        json={'code':"print('saved code')",'snapshot':True})
    assert saved.status_code == 200
    print(json.dumps({'cookie':client.get_cookie('session').value,
        'progress':client.get('/api/progress').get_json(),
        'wallet':client.get('/api/wallet').get_json(),
        'project':saved.get_json()['stage']}))
'''
    state = subprocess.run([sys.executable, "-c", seed], cwd=PLATFORM, env=env,
                           capture_output=True, text=True, check=True).stdout
    saved, restored = tmp_path / "saved.pycloud-backup", tmp_path / "restored"
    created = subprocess.run([sys.executable, str(PLATFORM / "backup.py"), "create", str(saved)],
                             env=env, capture_output=True, text=True)
    assert created.returncode == 0, created.stderr
    recovered = subprocess.run([sys.executable, str(PLATFORM / "backup.py"), "restore", str(saved), str(restored),'--deletions-from',str(saved)],
                               env=env, capture_output=True, text=True)
    assert recovered.returncode == 0, recovered.stderr
    restored_env = dict(env, PYCLOUD_INSTANCE_DIR=str(restored), PYCLOUD_DB_PATH=str(restored / "app.db"),
                        PYCLOUD_SECRET_FILE=str(restored / "secret_key"))
    verify = '''
import json, sys
import server
expected = json.load(sys.stdin)
with server.app.test_client() as client:
    client.set_cookie('session', expected['cookie'])
    assert client.get('/api/me').status_code == 200  # Original signed cookie still works.
    progress = client.get('/api/progress').get_json()
    for key in ('solved', 'xp'):
        assert progress[key] == expected['progress'][key], key
    assert client.get('/api/wallet').get_json() == expected['wallet']
    assert client.get('/api/notes?task_id=3.1').get_json()['text'] == 'my saved note'
    course = client.get('/api/project-courses/chatbot_to_telegram').get_json()['course']
    stage = next(s for s in course['stages'] if s['id'] == 'hello_name')
    assert stage['current_code'] == "print('saved code')"
    assert stage['snapshots'] == expected['project']['snapshots']
with server.app.test_client() as client:
    assert client.post('/api/login', json={'username':'restore_user','password':'restore123'}).status_code == 200
'''
    checked = subprocess.run([sys.executable, "-c", verify], cwd=PLATFORM, env=restored_env,
                             input=state, capture_output=True, text=True)
    assert checked.returncode == 0, checked.stderr


def test_json_column_migration_preserves_old_chest_wallet_and_is_idempotent(tmp_path):
    import server
    instance = tmp_path / 'old-instance'
    instance.mkdir()
    schema = server.SCHEMA.replace("    result_json TEXT NOT NULL DEFAULT '{}',\n", '').replace("    local_evidence_json TEXT NOT NULL DEFAULT '{}',\n", '')
    database = instance / 'app.db'
    with closing(sqlite3.connect(database)) as conn:
        conn.executescript(schema)
        conn.execute("INSERT INTO users(id, username, password_hash, created_at) VALUES(1, 'migration_learner', 'test', 'old')")
        conn.execute("INSERT INTO wallet(user_id, drops) VALUES(1, 19)")
        conn.execute("INSERT INTO daily_claims(user_id, day) VALUES(1, '2026-09-29')")
        conn.commit()
    env = dict(os.environ, PYCLOUD_INSTANCE_DIR=str(instance), PYCLOUD_DB_PATH=str(database),
               PYCLOUD_SECRET_FILE=str(instance / 'secret_key'), PYCLOUD_AI_ENABLED='0')
    for _ in range(2):
        run = subprocess.run([sys.executable, '-c', 'import server'], cwd=PLATFORM, env=env, capture_output=True, text=True)
        assert run.returncode == 0, run.stderr
    with closing(sqlite3.connect(database)) as conn:
        assert conn.execute('SELECT user_id, day, result_json FROM daily_claims').fetchall() == [(1, '2026-09-29', '{}')]
        assert conn.execute('SELECT drops FROM wallet WHERE user_id=1').fetchone() == (19,)
        assert 'local_evidence_json' in {row[1] for row in conn.execute('PRAGMA table_info(project_stage_progress)')}
