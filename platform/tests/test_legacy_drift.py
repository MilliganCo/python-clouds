# -*- coding: utf-8 -*-
"""Optional bridge for the frozen React hand-port drift check."""
import os
import subprocess
import sys
from pathlib import Path

import pytest

PLATFORM = Path(__file__).resolve().parents[1]
SCRIPT = PLATFORM / "frontend" / "scripts" / "check-legacy-drift.mjs"

pytestmark = pytest.mark.skipif(
    os.environ.get("PYCLOUD_CHECK_REACT_DRIFT") != "1",
    reason="React migration is paused; opt in with PYCLOUD_CHECK_REACT_DRIFT=1",
)


def test_legacy_drift_ok():
    assert SCRIPT.is_file(), f"missing {SCRIPT}"
    result = subprocess.run(
        ["node", str(SCRIPT), "--json"],
        cwd=PLATFORM / "frontend",
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode != 0:
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
    assert result.returncode == 0, "legacy drift detected — see npm run check:legacy-drift"
