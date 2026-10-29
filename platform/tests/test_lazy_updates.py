from pathlib import Path
import subprocess

def test_pinned_optional_history_loader():
    script=Path(__file__).resolve().parents[1]/'scripts/verify_lazy_updates_unit.cjs'
    run=subprocess.run(['node','--test',str(script)],capture_output=True,text=True,encoding='utf-8',timeout=15)
    assert run.returncode==0,run.stdout+run.stderr
    assert 'tests 7' in run.stdout,run.stdout
