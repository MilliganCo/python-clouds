"""Code evidence is separate from self-reported local debugger actions."""
import contextlib
import io
import json
from pathlib import Path
import sys

import pytest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
import build_tasks


def quest():
    section=build_tasks.SRC.read_text(encoding='utf8').split('\n## Мини-квесты на своём компьютере\n',1)[1]
    return next(q for q in json.loads(build_tasks.first_fence(section)[1]) if q['id']=='practice_debugger')


def checked(code,check):
    ns={}
    with contextlib.redirect_stdout(io.StringIO()):exec(code,ns)
    output=io.StringIO()
    with contextlib.redirect_stdout(output):exec(check,ns)
    assert output.getvalue().strip()=='OK'


def test_contract_accepts_reference_and_equivalent_accumulation():
    stage=quest()['stages'][0]
    checked(stage['reference_code'],stage['check']['append'])
    alternate=stage['reference_code'].replace('total += price','total = total + price')
    alternate=alternate.replace('    if final < 0:\n        return 0\n    return final','    return max(0,final)')
    checked(alternate,stage['check']['append'])


@pytest.mark.parametrize('variant',['starter','print_only','last_value','negative_total','hardcode','mutate','bypass_helper'])
def test_checks_find_partial_fixes_and_fake_success(variant):
    stage=quest()['stages'][0];code=stage['reference_code']
    if variant=='starter':code=stage['starter_code']
    elif variant=='print_only':code="print('OK')"
    elif variant=='last_value':code=code.replace('total += price','total = price')
    elif variant=='negative_total':code=code.replace('    if final < 0:\n        return 0\n','')
    elif variant=='hardcode':code=code.replace('    return final','    return 15')
    elif variant=='mutate':code=code.replace('    return total','    prices.clear()\n    return total')
    elif variant=='bypass_helper':code=code.replace('total = subtotal(prices)','total = sum(prices)')
    with pytest.raises((AssertionError,NameError)):checked(code,stage['check']['append'])


def test_scope_prerequisites_and_local_evidence_are_explicit():
    course=quest();stage=course['stages'][0];local=stage['local_practice']
    assert course['unlock_topics']==stage['requirements']['topics']==[3,6,7,8]
    assert course['kind']=='local_practice' and stage['id']=='step_report'
    assert len(local['guide'])==5 and len(local['checklist'])==5
    assert {i['id'] for i in local['checklist']}=={'reproduced','stepped','observed','conditional','rechecked'}
    text=' '.join(item['text'] for item in local['guide'])
    for phrase in ['Step Into','Step Over','Step Out','WATCH','CALL STACK','price == 0','ещё не выполнена']:
        assert phrase in text
    assert 'не подключалась к вашей IDE' in stage['completion_message']
    assert 'самопроверка' in text


def test_trace_matches_the_teaching_values_before_assignment():
    code=quest()['stages'][0]['starter_code'];events=[]
    line=code.splitlines().index('        total = price')+1
    def observe(frame,event,arg):
        if event=='line' and frame.f_code.co_filename=='<debugger_quest>' and frame.f_lineno==line:
            events.append((frame.f_locals['price'],frame.f_locals['total']))
        return observe
    previous=sys.gettrace();sys.settrace(observe)
    try:
        output=io.StringIO()
        with contextlib.redirect_stdout(output):exec(compile(code,'<debugger_quest>','exec'),{})
    finally:sys.settrace(previous)
    assert output.getvalue().strip()=='3'
    assert events==[(12,0),(0,12),(8,0)]
