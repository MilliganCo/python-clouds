"""The optional bank cannot grant progress or substitute survey self-report for code."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys

import pytest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
import build_tasks


def source_bank():
    section=build_tasks.SRC.read_text(encoding='utf8').split('\n## Диагностика точки входа\n',1)[1]
    return json.loads(build_tasks.first_fence(section)[1])


def succeeds(task,source):
    try:
        output=io.StringIO()
        with contextlib.redirect_stdout(output):exec(source+'\n'+task['check']['append'],{})
        return output.getvalue().strip()=='OK'
    except Exception:
        return False


@pytest.mark.parametrize('index',range(5))
def test_diagnostic_checks_accept_reference_and_reject_false_success(index):
    task=source_bank()['tasks'][index]
    assert succeeds(task,task['reference_code'])
    assert all(not succeeds(task,code) for code in [task['starter_code'],"print('OK')",*task['negative_codes']])


def test_diagnostic_bank_is_separate_from_regular_economy_ids():
    public=build_tasks.parse_diagnostics(verify=False)
    assert len(public['tasks'])==5
    ordinary={task['id'] for topic in build_tasks.parse() for task in topic['tasks']}
    meta=json.loads((ROOT/'platform/tasks_meta.json').read_text())
    for task in public['tasks']:
        assert task['id'] not in ordinary and task['id'] not in meta
        assert 'reference_code' not in task and 'negative_codes' not in task


def test_generated_diagnostic_matches_canonical_bank():
    text=(ROOT/'platform/static/diagnostic-tasks.js').read_text(encoding='utf8')
    actual=json.loads(text.split('window.DIAGNOSTIC_TASKS = ',1)[1].strip().removesuffix(';'))
    assert actual==build_tasks.parse_diagnostics(verify=False)


@pytest.mark.parametrize('defect',['duplicate','topic','count','expect','format','empty'])
def test_invalid_bank_is_not_silently_published(tmp_path,monkeypatch,defect):
    bank=source_bank()
    if defect=='duplicate':bank['tasks'][1]['id']=bank['tasks'][0]['id']
    elif defect=='topic':bank['tasks'][0]['topic_id']=True
    elif defect=='count':bank['tasks']=bank['tasks'][:2]
    elif defect=='expect':bank['tasks'][0]['check']['expect']='something else'
    elif defect=='format':bank['tasks'][0]['format']='quiz'
    elif defect=='empty':bank['tasks'][0]['prompt']=''
    source=tmp_path/'collection.md';source.write_text('\n## Диагностика точки входа\n```json\n'+json.dumps(bank)+'\n```',encoding='utf8')
    monkeypatch.setattr(build_tasks,'SRC',source)
    with pytest.raises(ValueError):build_tasks.parse_diagnostics(verify=False)


def test_diagnostic_model_and_nonwriting_module():
    subprocess.run(['node',str(ROOT/'platform/scripts/verify_diagnostic_unit.cjs')],check=True)
    code=(ROOT/'platform/static/diagnostic.js').read_text(encoding='utf8')
    for forbidden in ('localStorage','sessionStorage','/api/progress','/api/attempts','/api/ai','showSuccessModal','hashchange'):
        assert forbidden not in code
    assert 'abort.signal' in code and 'getLearningAuthEpoch' in code
