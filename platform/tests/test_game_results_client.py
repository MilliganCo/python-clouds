from pathlib import Path
import subprocess

def test_owner_bound_game_result_outbox():
    script=Path(__file__).resolve().parents[1]/'scripts/verify_game_results_unit.cjs'
    result=subprocess.run(['node','--test',str(script)],capture_output=True,text=True,encoding='utf8',timeout=20)
    assert result.returncode==0,result.stdout+result.stderr
    assert 'fail 0' in result.stdout

def test_bounded_authored_game_review_and_round_isolation():
    script=Path(__file__).resolve().parents[1]/'scripts/verify_game_review_unit.cjs'
    result=subprocess.run(['node','--test',str(script)],capture_output=True,text=True,encoding='utf8',timeout=20)
    assert result.returncode==0,result.stdout+result.stderr
    assert 'fail 0' in result.stdout
