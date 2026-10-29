"""Learner-facing execution facts must match the active one-run HTTP runner."""
from pathlib import Path
import re
import subprocess


STATIC = Path(__file__).resolve().parents[1] / 'static'


def test_runtime_guidance_and_active_facade_do_not_advertise_browser_python():
    html = (STATIC / 'index.html').read_text(encoding='utf-8')
    footer = html.split('<footer', 1)[1].split('</footer>', 1)[0]
    assert 'Pyodide' not in footer
    # Runtime guidance belongs next to the editor and sandbox, not in the
    # catalogue footer; keep this claim checked at its actual source and mount.
    help_source = (STATIC / 'runtime-help.js').read_text(encoding='utf-8')
    assert 'на сервере создаётся отдельная среда на один запуск' in help_source
    assert 'браузер не скачивает интерпретатор' in help_source
    assert 'data-python-runtime-help' in html
    runner = (STATIC / 'runner.js').read_text(encoding='utf-8')
    assert 'new Worker' not in runner
    assert 'SharedArrayBuffer' not in runner
    assert 'PythonExecutionClient' in runner


def test_runtime_help_loads_before_all_its_consumers():
    html = (STATIC / 'index.html').read_text(encoding='utf-8')
    assert html.count('src="runtime-help.js"') == 1
    assert html.index('src="runtime-help.js"') < html.index('src="project-courses.js"') < html.index('src="app.js"')
    assert 'data-python-runtime-help' in html


def test_runtime_guidance_and_facade_pure_node():
    script = STATIC.parent / 'scripts/verify_runtime_guidance_unit.cjs'
    run = subprocess.run(['node', str(script)], capture_output=True, text=True, encoding='utf-8', timeout=10)
    assert run.returncode == 0, run.stdout + run.stderr


def test_resource_feedback_uses_real_shared_helper_and_transport():
    script = STATIC.parent / 'scripts/verify_runtime_limits.cjs'
    run = subprocess.run(['node', str(script)], capture_output=True, text=True, encoding='utf-8', timeout=10)
    assert run.returncode == 0, run.stdout + run.stderr


def test_legacy_host_reason_matches_are_still_real_server_messages():
    help_source = (STATIC / 'runtime-help.js').read_text(encoding='utf-8')
    host_source = (STATIC.parent / 'sandbox_runner.py').read_text(encoding='utf-8')
    reasons = re.findall(r'"([^"\n]+)": "(?:time|memory|output|resources)"', help_source)
    assert len(reasons) == 8
    assert all(reason in host_source for reason in reasons), 'Update guidance with host protocol wording, not guessed exceptions'
