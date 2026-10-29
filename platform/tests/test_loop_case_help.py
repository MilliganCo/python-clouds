"""Loop case help is optional; canonical checks and independent examples remain exact."""
import ast
import json
import io
from pathlib import Path
import runpy
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import build_tasks

KEYS = ('loop_filter', 'loop_empty', 'loop_boundary',
        'growth_initial', 'growth_threshold', 'growth_integer')
CASES = {
    '7.8': [(16, 30), (0, 0), (1, 0), (2, 0), (3, 3), (5, 3),
            (6, 9), (15, 30), (18, 48), (30, 120), (31, 120), (33, 153)],
    '7.9': [(3, 20, 3), (5, 5, 0), (8, 2, 0), (1, 17, 5), (2, 4, 1),
            (2, 5, 2), (3, 24, 3), (1, 0, 0), (1, 1152921504606846977, 61)],
}


@pytest.fixture(scope='module')
def case_examples():
    result = subprocess.run(['node', 'platform/scripts/verify_loop_case_help.cjs', '--examples-json'],
                            cwd=ROOT, capture_output=True, text=True, encoding='utf-8',
                            check=True, timeout=10)
    return json.loads(result.stdout)


@pytest.mark.parametrize('key', KEYS, ids=KEYS)
def test_authored_case_example_has_exact_output(key, case_examples, tmp_path):
    assert key in case_examples, f'Missing authored case example: {key}'
    item = case_examples[key]
    result = subprocess.run([sys.executable, '-I', '-X', 'utf8', '-c', item['code']],
                            cwd=tmp_path, capture_output=True, text=True,
                            encoding='utf-8', timeout=6)
    assert result.returncode == 0, result.stderr
    assert result.stdout.rstrip('\n') == item['output']


@pytest.mark.parametrize('task_id', ['7.8', '7.9'], ids=['sum-checks', 'growth-checks'])
def test_canonical_check_cases_and_integer_result_contract_are_preserved(task_id):
    tasks = {task['id']: task for topic in build_tasks.parse() if topic['id'] == 7
             for task in topic['tasks']}
    task = tasks[task_id]
    check = task['check']['append']
    parsed = ast.parse(check)
    assert ast.literal_eval(parsed.body[0].iter) == CASES[task_id]
    assert task['check']['expect'] == 'OK'
    assert 'type(_actual) is int and _actual == _expected' in check
    assert check.count('_actual = ') == 1
    assert check.count('sum_multiples(_n)' if task_id == '7.8'
                       else 'growth_steps(_start, _target)') == 1
    assert 'data-case-help' not in check
    assert 'LearningErrorHelp' not in check


def test_actual_case_helper_and_failure_renderer_without_external_calls():
    result = subprocess.run(['node', 'platform/scripts/verify_loop_case_help.cjs'],
                            cwd=ROOT, capture_output=True, text=True,
                            encoding='utf-8', timeout=10)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.startswith('PASS loop case help:'), result.stdout + result.stderr


@pytest.mark.parametrize('task_id,mutation,card', [
    ('7.8', 'filter', 'loop_filter'),
    ('7.8', 'empty', 'loop_empty'),
    ('7.8', 'boundary', 'loop_boundary'),
    ('7.9', 'initial', 'growth_initial'),
    ('7.9', 'threshold', 'growth_threshold'),
    ('7.9', 'integer', 'growth_integer'),
], ids=['filter', 'empty', 'boundary', 'initial', 'threshold', 'integer'])
def test_actual_guest_failure_selects_only_its_known_case(task_id, mutation, card):
    task = next(task for topic in build_tasks.parse() for task in topic['tasks'] if task['id'] == task_id)
    original = task['answer']
    if mutation == 'filter':
        code = original.replace(' and value % 5 != 0', '')
    elif mutation == 'empty':
        code = original.replace('    total = 0', '    if n == 0: return None\n    total = 0')
    elif mutation == 'boundary':
        code = original.replace('range(1, n + 1)', 'range(1, n)')
    elif mutation == 'initial':
        code = original.replace('    steps = 0', '    if start >= target: return 1\n    steps = 0')
    elif mutation == 'threshold':
        code = original.replace('while start < target:', 'while start * 2 <= target:')
    else:
        code = original.replace('    steps = 0', '    target = int(float(target))\n    steps = 0')
    assert code != original
    runner = runpy.run_path(str(ROOT / 'platform/sandbox/runner.py'))
    result = runner['execute']({'code': code, 'check': task['check']['append'],
                                'interactive': False, 'reportTests': True},
                               io.StringIO(), lambda kind, **data: None)
    failure = result['failure']
    assert failure and (failure['type'], failure['source']) == ('AssertionError', 'check')
    program = "const fs=require('fs'),vm=require('vm'),ctx={window:{}};vm.runInNewContext(fs.readFileSync('platform/static/error-help.js','utf8'),ctx);const p=JSON.parse(process.argv[1]);process.stdout.write(ctx.window.LearningErrorHelp.renderCase(p.failure,{taskId:p.taskId}));"
    rendered = subprocess.run(['node', '-e', program, json.dumps({'failure': failure, 'taskId': task_id})],
                              cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=10, check=True)
    assert f'data-case-help="{card}"' in rendered.stdout
    assert 'Этот случай проверяет' in rendered.stdout


@pytest.mark.parametrize('task_id', ['7.8', '7.9'], ids=['sum-reference', 'growth-reference'])
def test_helper_never_changes_a_successful_guest_check(task_id):
    task = next(task for topic in build_tasks.parse() for task in topic['tasks'] if task['id'] == task_id)
    runner = runpy.run_path(str(ROOT / 'platform/sandbox/runner.py'))
    result = runner['execute']({'code': task['answer'], 'check': task['check']['append'],
                                'interactive': False, 'reportTests': True},
                               io.StringIO(), lambda kind, **data: None)
    assert result['failure'] is None and result['error'] is None
    assert result['check_stdout'] == 'OK\n'
