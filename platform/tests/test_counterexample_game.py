"""Canonical counterexamples: unique distinguishing inputs, real CPython, no new rewards."""
import copy,json,subprocess,sys
from pathlib import Path
import pytest
from test_platform import client,register

ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT));import build_tasks

def raw_bank():
    section=build_tasks.SRC.read_text(encoding='utf-8').split('\n## Игра «Контрпример»\n',1)[1]
    return json.loads(build_tasks.first_fence(section)[1])

def test_authored_outcomes_and_generated_bank():
    bank=build_tasks.parse_counterexamples()
    assert len(bank)==12 and sum(len(q['choices']) for q in bank)==48
    assert all('reference_code' not in q for q in bank)
    generated=(ROOT/'platform/static/counterexample-data.js').read_text(encoding='utf-8')
    assert json.loads(generated.split('window.COUNTEREXAMPLE_QUESTIONS = ',1)[1].strip().removesuffix(';'))==bank

@pytest.mark.parametrize('defect',['duplicate-id','duplicate-call','missing-reference','empty-bank','ambiguous','no-counterexample','wrong-error-type'])
def test_malformed_game_bank_is_rejected(tmp_path,monkeypatch,defect):
    bank=copy.deepcopy(raw_bank())
    if defect=='duplicate-id':bank[1]['id']=bank[0]['id']
    elif defect=='duplicate-call':bank[0]['choices'][0]['call']=bank[0]['choices'][1]['call']
    elif defect=='missing-reference':del bank[0]['reference_code']
    elif defect=='empty-bank':bank=[]
    elif defect=='ambiguous':bank[0]['choices'][0]['actual']='different'
    elif defect=='no-counterexample':
        for choice in bank[0]['choices']:choice['actual']=choice['expected'];choice['error']=False
    else:bank[0]['choices'][0]['error']='false'
    source=tmp_path/'collection.md';source.write_text('\n## Игра «Контрпример»\n```json\n'+json.dumps(bank)+'\n```',encoding='utf-8')
    monkeypatch.setattr(build_tasks,'SRC',source)
    with pytest.raises(ValueError):build_tasks.parse_counterexamples(verify=False)

def test_wrong_cpython_result_is_rejected(tmp_path,monkeypatch):
    bank=raw_bank()[:1];bank[0]['choices'][0]['actual']='wrong';bank[0]['choices'][0]['expected']='wrong'
    source=tmp_path/'collection.md';source.write_text('\n## Игра «Контрпример»\n```json\n'+json.dumps(bank)+'\n```',encoding='utf-8')
    monkeypatch.setattr(build_tasks,'SRC',source)
    with pytest.raises(ValueError,match='CPython3.14'):build_tasks.parse_counterexamples()

def test_local_round_and_view_contract():
    result=subprocess.run(['node','--test',str(ROOT/'platform/scripts/verify_counterexample_unit.cjs')],capture_output=True,text=True,encoding='utf-8',timeout=15)
    assert result.returncode==0,result.stdout+result.stderr
    assert 'tests 10' in result.stdout

def test_route_uses_practice_before_scored_game_engine():
    source=(ROOT/'platform/static/app.js').read_text(encoding='utf-8')
    function=source.split('function renderGamePlay(key)',1)[1]
    branch=function.split('if (key === "riddle")',1)[0]
    assert 'key === "counterexample"' in branch and 'CounterexampleGame.mount' in branch and 'return;' in branch
    assert '/api/game/result' not in branch and '.best(' not in branch
    assert 'riddle|counterexample' in source

def test_practice_does_not_enter_reward_allowlist(client):
    import server
    register(client)
    before=client.get('/api/wallet').get_json()['drops']
    assert server.GAMES=={'blitz','order','match','trace','fill'}
    response=client.post('/api/game/result',json={'game':'counterexample','score':60})
    assert response.status_code==400
    assert client.get('/api/wallet').get_json()['drops']==before
