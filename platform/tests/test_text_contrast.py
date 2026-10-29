"""The manual rendered audit uses standard, unrounded contrast calculations."""
from pathlib import Path
import subprocess


def test_contrast_math_self_check_without_browser():
    script = Path(__file__).resolve().parents[1] / 'scripts/verify_text_contrast.cjs'
    result = subprocess.run(['node', str(script), '--unit'], capture_output=True,
                            text=True, encoding='utf-8', timeout=10)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.startswith('PASS:')
