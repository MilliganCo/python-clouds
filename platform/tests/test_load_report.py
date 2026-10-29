"""Voluntary load reports expose bounded boot metadata, never learner content."""
from pathlib import Path
import subprocess

import pytest


@pytest.mark.parametrize('case', [
    pytest.param('session', id='session-pending-body-errors-and-ownership'),
    pytest.param('bounds', id='session-bounds-and-private-paths'),
    pytest.param('report', id='report-redaction-and-explicit-download'),
    pytest.param('loader', id='loader-dom-ready-report-only-and-single-owner'),
    pytest.param('shell', id='native-fallback-and-external-head-loader'),
])
def test_voluntary_load_report(case):
    script = Path(__file__).resolve().parents[1] / 'scripts/verify_load_report_unit.cjs'
    result = subprocess.run(['node', str(script), case], capture_output=True,
                            text=True, encoding='utf-8', timeout=10)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.startswith(f'PASS load report {case}:'), result.stdout + result.stderr
