"""Real image bytes and parsed HTML, including independent wrong/correct solutions."""
import contextlib
import io
import json
from pathlib import Path
import runpy
import subprocess
import sys

import pytest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
import build_tasks
CASES=json.loads((Path(__file__).parent/'fixtures/image_templates_cases.json').read_text(encoding='utf-8'))


@pytest.fixture(scope='module')
def stages():
    return {t['id']:t for p in build_tasks.parse() if p['id'] in (64,65) for t in p['tasks']}


def checked(task,code):
    stdout=io.StringIO()
    with contextlib.redirect_stdout(stdout):exec(code+'\n'+task['check']['append'],{})
    assert stdout.getvalue().strip()=='OK'


@pytest.mark.parametrize('task_id',['64.2','64.4','64.5','64.7','64.8','64.9','64.10','65.2','65.4','65.6','65.7','65.8','65.9','65.10'])
def test_reference_passes_and_empty_starters_fail(stages,task_id):
    task=stages[task_id];checked(task,task['answer'])
    for code in (task['code'],"print('OK')"):
        with pytest.raises((AssertionError,TypeError,NameError,AttributeError,IndexError)):
            checked(task,code)


@pytest.mark.parametrize('case',CASES['wrong'],ids=lambda c:c['task_id']+'-'+c['label'])
def test_finales_find_semantic_image_and_template_errors(stages,case):
    with pytest.raises(AssertionError):checked(stages[case['task_id']],case['code'])


@pytest.mark.parametrize('case',CASES['correct'],ids=lambda c:c['task_id'])
def test_finales_accept_correct_alternatives(stages,case):
    checked(stages[case['task_id']],case['code'])


def test_complete_theory_and_generator_owned_intros(stages):
    support=build_tasks._load_support_content()
    generator=runpy.run_path(str(ROOT/'platform/scripts/enrich_task_intros.py'))
    for topic_id in (64,65):
        article=support['theory'][str(topic_id)]
        examples=[e for section in article['sections'] for e in section['examples']]
        assert len(examples)==12
        for example in examples:
            stdout=io.StringIO()
            with contextlib.redirect_stdout(stdout):exec(example['code'],{})
            assert stdout.getvalue().rstrip('\n')==example['output']
        tasks=[t for t in stages.values() if t['id'].startswith(str(topic_id)+'.')]
        assert len(tasks)==10 and [t.get('finale') for t in tasks[-2:]]==[1,2]
        assert len({t['type'] for t in tasks})>=3
        for task in tasks:
            assert task['learning']['skills'] and task['learning']['reason']
            assert task.get('finale') or support['hints'].get(task['id'])
            assert support['intros'][task['id']]==generator['build_intro'](task)


def test_cloud_rotation_geometry_without_browser():
    result=subprocess.run(['node',str(ROOT/'platform/scripts/verify_cloud_models_unit.cjs')],capture_output=True,text=True,timeout=25)
    assert result.returncode==0,result.stdout+result.stderr
    assert result.stdout.startswith('PASS cloud models:')
