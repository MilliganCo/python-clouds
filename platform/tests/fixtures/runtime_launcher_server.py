"""Owned, disposable HTTP child for the operator-launcher regression tests only."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
import uuid


TOKEN = "e" * 64
ROOT = Path(os.environ["PYCLOUD_TEST_ROOT"]).resolve()


def bounded(name):
    value = Path(os.environ[name]).resolve()
    if not value.is_relative_to(ROOT):
        raise SystemExit("Fake launcher child refused a path outside its temporary root")
    return value


def creation_identity():
    if os.name != "nt":
        return Path(f"/proc/{os.getpid()}/stat").read_text().split(") ", 1)[1].split()[19]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    fields = [wintypes.FILETIME() for _ in range(4)]
    if not kernel.GetProcessTimes(kernel.GetCurrentProcess(), *map(ctypes.byref, fields)):
        raise ctypes.WinError(ctypes.get_last_error())
    return str((fields[0].dwHighDateTime << 32) | fields[0].dwLowDateTime)


instance = bounded("PYCLOUD_INSTANCE_DIR")
db_path = bounded("PYCLOUD_DB_PATH")
secret = bounded("PYCLOUD_SECRET_FILE")
owned = bounded("PYCLOUD_TEST_OWNED_DIR")
port = int(os.environ["PYCLOUD_PORT"])
if port == 8017:
    raise SystemExit("The fake child must never use the learner port")
owned.mkdir(parents=True, exist_ok=True)
(owned / f"{os.getpid()}.json").write_text(
    json.dumps({"pid": os.getpid(), "creation": creation_identity()}), encoding="utf-8"
)
if os.environ.get("PYCLOUD_TEST_FAIL") == "1":
    print("TEST_ONLY_CHILD_STDOUT", flush=True)
    print("TEST_ONLY_CHILD_FAILURE", file=sys.stderr, flush=True)
    raise SystemExit(13)
time.sleep(float(os.environ.get("PYCLOUD_TEST_START_DELAY", "0")))
instance.mkdir(parents=True, exist_ok=True)
db_path.parent.mkdir(parents=True, exist_ok=True)
secret.parent.mkdir(parents=True, exist_ok=True)
if not secret.exists():
    secret.write_text("TEST_ONLY_SESSION_SECRET", encoding="utf-8")
with sqlite3.connect(db_path) as db:
    db.execute("CREATE TABLE IF NOT EXISTS fake_environment (name TEXT, value TEXT)")
    db.executemany(
        "INSERT INTO fake_environment VALUES (?, ?)",
        [(name, os.environ.get(name, "")) for name in (
            "PYCLOUD_INSTANCE_DIR", "PYCLOUD_DB_PATH", "PYCLOUD_SECRET_FILE",
            "PYCLOUD_UI", "PYCLOUD_AI_ENABLED", "PYCLOUD_TEST_INHERITED_MARKER",
        )],
    )
boot_id = uuid.uuid4().hex
snapshot = {
    "schema": 1, "pid": os.getpid(), "boot_id": boot_id, "draining": False,
    "active_http": 0, "active_background": 0, "pool_jobs": 0, "waiting_input": 0,
    "runtime": {
        **dict.fromkeys(("source_digest", "context_digest", "catalog_digest", "content_digest", "content_generation"), "a" * 64),
        "task_count": 1, "topic_count": 1, "context": "launcher_test",
        "image_ref": "pycloud-python-sandbox:test", "verified_image_id": None,
    },
}
descriptor_pid = os.getpid()
if os.environ.get("PYCLOUD_TEST_BAD_OPS_IDENTITY") == "pid":
    descriptor_pid += 1
    snapshot["pid"] = descriptor_pid
elif os.environ.get("PYCLOUD_TEST_BAD_OPS_IDENTITY") == "boot":
    snapshot["boot_id"] = "0" * 32


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/api/health":
            status, payload = 200, {"ok": True, "service": "pycloud", "port": port}
        elif self.path == "/api/_ops/runtime" and self.headers.get("Authorization") == "Bearer " + TOKEN:
            status, payload = 200, snapshot
        else:
            status, payload = 404, {"error": "unavailable"}
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


http = HTTPServer(("127.0.0.1", port), Handler)
descriptor = instance / f"runtime-ops-{port}.json"
temporary = descriptor.with_suffix(".temporary")
temporary.write_text(json.dumps({"schema": 1, "pid": descriptor_pid, "port": port,
                                 "boot_id": boot_id, "token": TOKEN}), encoding="utf-8")
if os.name != "nt":
    temporary.chmod(0o600)
# Match the separately verified RuntimeOps.publish contract: retry only this rename.
deadline = time.monotonic() + 1.0
try:
    while True:
        try:
            os.replace(temporary, descriptor)
            break
        except OSError as error:
            if (os.name != "nt" or getattr(error, "winerror", None) not in (5, 32, 33)
                    or time.monotonic() >= deadline):
                raise
            time.sleep(.01)
finally:
    temporary.unlink(missing_ok=True)
http.serve_forever()
