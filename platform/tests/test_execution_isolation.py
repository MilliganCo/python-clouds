"""Browser transports code; OS-isolated server jobs enforce the boundary."""
import subprocess
from pathlib import Path

import pytest

from test_platform import client, register


PLATFORM = Path(__file__).resolve().parents[1]


def test_python_entrypoints_never_start_a_runtime():
    result = subprocess.run(
        ["node", str(PLATFORM / "scripts/verify_execution_isolation.cjs")],
        capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "19 probes x 2 modes" in result.stdout


@pytest.mark.parametrize("path", [
    "/runner-worker.js", "/legacy/runner-worker.js", "/RuNnEr-WoRkEr.Js",
    "/runner-worker.js.", "/runner-worker.js?cached=1", "/pyodide/pyodide.mjs",
    "/pyodide/pyodide.asm.wasm", "/PYODIDE/python_stdlib.zip",
])
def test_runtime_assets_are_denied_with_no_network(client, monkeypatch, path):
    import ui_serve
    monkeypatch.setattr(ui_serve.urllib.request, "urlopen", lambda *a, **k: pytest.fail("Network access"))
    response = client.get(path)
    assert response.status_code == 503
    assert response.get_json()["code"] == "execution_disabled"
    assert response.headers["Cache-Control"] == "no-store"


def test_csp_blocks_workers_eval_and_remote_scripts(client):
    policy = client.get("/").headers["Content-Security-Policy"]
    assert "worker-src 'none'" in policy
    assert "script-src 'self';" in policy
    assert "unsafe-eval" not in policy and "cdn.jsdelivr.net" not in policy
    assert "connect-src 'self';" in policy
    assert client.get("/runner.js").status_code == 200


def test_frozen_native_runner_keeps_its_existing_offline_isolation():
    source = (PLATFORM.parent / 'android/app/src/main/java/ru/pythonclouds/app/runner/PythonWebRunner.kt').read_text(encoding='utf-8')
    assert 'EXECUTION_BLOCKED' not in source
    assert 'addJavascriptInterface' not in source
    assert 'allowFileAccess = false' in source and 'allowContentAccess = false' in source
    assert 'WebViewAssetLoader' in source


def test_learning_content_and_account_access_remain_available(client):
    register(client)
    assert client.get('/api/me').status_code == 200
    assert client.get('/tasks.js').status_code == 200
    assert client.get('/theory.js').status_code == 200
    assert client.get('/api/progress').status_code == 200
