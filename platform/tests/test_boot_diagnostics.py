"""Test-only reload evidence must remain bounded and must not expose learner content."""
from pathlib import Path
import subprocess


def test_boot_diagnostics_collector_and_failure_capture():
    script = Path(__file__).resolve().parents[1] / 'scripts/verify_boot_diagnostics_unit.cjs'
    result = subprocess.run(['node', str(script)], capture_output=True, text=True,
                            encoding='utf-8', timeout=10)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.startswith('PASS boot diagnostics:'), result.stdout + result.stderr
