"""Keep optional wallet delivery out of the core learning-route critical path."""
from pathlib import Path
import subprocess
import pytest


@pytest.mark.parametrize('script',['verify_wallet_boot_unit.cjs','verify_app_boot_unit.cjs'])
def test_core_boot_and_wallet_ownership_state(script):
    result = subprocess.run(
        ['node', str(Path(__file__).resolve().parents[1] / 'scripts' / script)],
        check=True, capture_output=True, text=True, encoding='utf-8', timeout=15,
    )
    # An unresolved Promise alone does not keep Node alive: require the final assertion marker.
    assert result.stdout.startswith('PASS '), result.stdout + result.stderr
