"""Native mobile editor/stdin behavior, independent of the execution backend."""
from pathlib import Path
import subprocess


def test_mobile_editor_and_terminal_contract():
    script = Path(__file__).resolve().parents[1] / 'scripts/verify_mobile_terminal_unit.cjs'
    result = subprocess.run(['node', '--test', str(script)], capture_output=True,
                            text=True, encoding='utf-8', timeout=15)
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'tests 23' in result.stdout, result.stdout


def test_floating_mobile_keyboard_contract():
    script = Path(__file__).resolve().parents[1] / 'scripts/verify_editor_fab_unit.cjs'
    result = subprocess.run(['node', '--test', str(script)], capture_output=True,
                            text=True, encoding='utf-8', timeout=15)
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'tests 21' in result.stdout, result.stdout
