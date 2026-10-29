"""Optional static guidance: no grade/model changes and no inferred user data."""
import json
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]


def entries():
    program = "const fs=require('fs'),vm=require('vm'),ctx={window:{}};vm.runInNewContext(fs.readFileSync('platform/static/error-help.js','utf8'),ctx);process.stdout.write(JSON.stringify(ctx.window.LearningErrorHelp.examples));"
    result = subprocess.run(['node', '-e', program], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(result.stdout)


EXAMPLES = entries()


@pytest.mark.parametrize('key', EXAMPLES)
def test_hint_example_is_independent_and_has_exact_output(key, tmp_path):
    item = EXAMPLES[key]
    result = subprocess.run([sys.executable, '-I', '-X', 'utf8', '-c', item['code']], cwd=tmp_path,
                            capture_output=True, text=True, encoding='utf-8', timeout=6)
    assert result.returncode == 0 and result.stdout.rstrip('\n') == item['output'], result.stderr


def test_real_js_feedback_integration_without_browser():
    result = subprocess.run(['node', 'platform/scripts/verify_error_help.cjs'], cwd=ROOT,
                            capture_output=True, text=True, encoding='utf-8', timeout=12)
    assert result.returncode == 0 and result.stdout.startswith('PASS:'), result.stderr


def test_hint_asset_loads_before_consumers_and_does_not_call_external_services():
    index = (ROOT / 'platform/static/index.html').read_text(encoding='utf-8')
    assert index.count('src="error-help.js"') == 1
    assert index.index('src="error-help.js"') < index.index('src="project-courses.js"') < index.index('src="app.js"')
    source = (ROOT / 'platform/static/error-help.js').read_text(encoding='utf-8')
    assert 'fetch(' not in source and 'localStorage' not in source and 'XMLHttpRequest' not in source
