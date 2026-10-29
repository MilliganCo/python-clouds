from pathlib import Path
import subprocess


PLATFORM = Path(__file__).resolve().parents[1]


def test_shop_selection_and_affordability():
    result = subprocess.run(['node', str(PLATFORM / 'scripts/verify_shop_unit.cjs')],
                            capture_output=True, text=True, encoding='utf-8', timeout=10)
    assert result.returncode == 0, result.stdout + result.stderr
