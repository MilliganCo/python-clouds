"""The decorative scene is deterministic, bounded and independent of learner state."""
from pathlib import Path
import subprocess


def test_real_sky_scene_lifecycle_and_drawing_contract():
    script = Path(__file__).resolve().parents[1] / 'scripts/verify_sky_scenes_unit.cjs'
    result = subprocess.run(['node', str(script)], capture_output=True, text=True,
                            encoding='utf-8', timeout=10)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.startswith('PASS sky scenes:'), result.stdout + result.stderr
