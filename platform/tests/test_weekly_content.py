"""Authored transfer tasks, with genuine good/bad implementations, not model judging."""
from pathlib import Path
import sys,contextlib,io,json,re
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def bank():return build_tasks.parse_weekly(verify=False)


def checked(task,code):
    out=io.StringIO()
    with contextlib.redirect_stdout(out):exec(code+'\n'+task['tests'],{})
    return out.getvalue().strip()=='OK'


@pytest.mark.parametrize('index',range(4))
def test_weekly_reference_and_all_authored_negatives(bank,index):
    section=build_tasks.SRC.read_text(encoding='utf-8').split('\n## Недельный практикум\n',1)[1]
    authored=json.loads(build_tasks.first_fence(section)[1])['tasks'][index]
    task=bank['tasks'][index]
    assert checked(task,task['solution'])
    for wrong in [task['starter'],"print('OK')",*authored['negative_codes']]:
        with pytest.raises(Exception):checked(task,wrong)


def test_weekly_source_and_generated_bank_agree_without_negative_or_references_in_catalog(bank):
    generated=json.loads((Path(__file__).resolve().parents[1]/'weekly_tasks.json').read_text(encoding='utf-8'))
    assert generated==bank
    assert len(bank['tasks'])==4
    assert all(len(t['skills'])>=2 and t['reflection'] and t['explanation'] for t in bank['tasks'])
    assert all('negative_codes' not in t for t in bank['tasks'])


@pytest.mark.parametrize('defect',['duplicate','anchor','missing_skill','unknown_topic','no_negatives','money'])
def test_invalid_weekly_source_cannot_be_built(monkeypatch,tmp_path,defect):
    text=build_tasks.SRC.read_text(encoding='utf-8')
    start=text.index('\n## Недельный практикум\n');bank=json.loads(build_tasks.first_fence(text[start:])[1])
    if defect=='duplicate':bank['tasks'].append(dict(bank['tasks'][0]))
    elif defect=='anchor':bank['anchor']='2026-10-20'
    elif defect=='missing_skill':bank['tasks'][0]['skills']=[]
    elif defect=='unknown_topic':bank['tasks'][0]['prerequisites']=[9999]
    elif defect=='no_negatives':bank['tasks'][0]['negative_codes']=[]
    else:bank['tasks'][0]['reward']=9999
    path=tmp_path/'canonical.md';path.write_text(text[:start]+'\n## Недельный практикум\n\n```json\n'+json.dumps(bank)+'\n```\n',encoding='utf-8')
    monkeypatch.setattr(build_tasks,'SRC',path)
    with pytest.raises(ValueError):build_tasks.parse_weekly(verify=False)
