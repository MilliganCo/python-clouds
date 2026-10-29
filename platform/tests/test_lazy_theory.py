from pathlib import Path
import subprocess

def test_theory_lazy_manifest_and_loader_contract():
    script=Path(__file__).resolve().parents[1]/'scripts/verify_lazy_theory_unit.cjs'
    result=subprocess.run(['node','--test',str(script)],capture_output=True,text=True,encoding='utf8',timeout=30)
    assert result.returncode==0,result.stdout+result.stderr
    assert 'fail 0' in result.stdout
