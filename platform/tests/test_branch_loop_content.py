"""Branches cover boundaries; loops preserve counters and return integer counts."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def tasks():
    result = {task['id']: task for topic in build_tasks.parse() if topic['id'] in (6, 7) for task in topic['tasks']}
    assert len(result) == 17
    return result


def checked(task, code):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(code, namespace)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(task['check']['append'], namespace)
    assert output.getvalue().strip() == 'OK'


@pytest.mark.parametrize('task_id', ['6.3', '6.6', '6.7', '6.8', '7.3', '7.6', '7.7', '7.8', '7.9'])
def test_reference_has_canonical_behavior_check(tasks, task_id):
    checked(tasks[task_id], build_tasks._reference_program(tasks[task_id]))


@pytest.mark.parametrize(('task_id', 'code'), [
    ('6.3', "score=90\ngrade='B'\nprint(grade)"),
    ('6.6', "score=40\nmark='зачёт'\nprint(mark)"),
    ('6.7', 'def delivery(total,pickup):\n    if pickup or total>=2000:\n        return 0\n    return 100 if total>1000 else 250'),
    ('6.7', 'def delivery(total,pickup):\n    if pickup or total==2000:\n        return 0\n    return 100 if total>=1000 else 250'),
    ('6.7', 'def delivery(total,pickup):\n    if pickup or total>=2000:\n        return False\n    return 100 if total>=1000 else 250'),
    ('6.8', "def sensor_status(value):\n    if value>50:\n        return 'ошибка'\n    if value<0:\n        return 'мороз'\n    return 'норма' if value<=25 else 'жара'"),
    ('7.3', "total='10'\nprint(total)"),
    ('7.6', "n=5\nprint('5 4 3 2 1',end=' ')"),
    ('7.7', "n=5\ns='15'\nprint(s)"),
    ('7.8', 'def sum_multiples(n):\n    total=0\n    for value in range(1,n+1):\n        if value%3==0 and value%5!=0:\n            total+=value\n    return False if n==0 else total'),
    ('7.9', 'def growth_steps(start,target):\n    steps=0.0\n    while start<target:\n        start*=2\n        steps+=1\n    return steps'),
    ('7.9', 'import math\ndef growth_steps(start,target):\n    return max(0,math.ceil(math.log2(target/start))) if target else 0'),
])
def test_wrong_boundaries_state_and_result_types_are_rejected(tasks, task_id, code):
    with pytest.raises(AssertionError):
        checked(tasks[task_id], code)


@pytest.mark.parametrize(('task_id', 'code'), [
    ('6.3', "score=75\nif score>=90:\n    grade='A'\nelif score>=70:\n    grade='B'\nelse:\n    grade='C'\nprint(grade)"),
    ('6.6', "score=72\nif score>=50:\n    mark='зачёт'\nelse:\n    mark='незачёт'\nprint(mark)"),
    ('6.7', 'def delivery(total,pickup):\n    if pickup:\n        return 0\n    if total<1000:\n        return 250\n    if total<2000:\n        return 100\n    return 0'),
    ('6.8', "def sensor_status(value):\n    if not -50<=value<=50:\n        return 'ошибка'\n    elif value<0:\n        return 'мороз'\n    elif value<=25:\n        return 'норма'\n    return 'жара'"),
    ('7.3', 'total=0\nfor number in range(4,0,-1):\n    total=number+total\nprint(total)'),
    ('7.6', "n=5\nwhile n:\n    print(n,end=' ')\n    n=n-1"),
    ('7.7', 'n=5\ns=0\nfor value in range(n,0,-1):\n    s+=value\nprint(s)'),
    ('7.8', 'def sum_multiples(n):\n    total=0\n    value=1\n    while value<=n:\n        if value%3==0 and value%5!=0:\n            total+=value\n        value+=1\n    return total'),
    ('7.9', 'def growth_steps(start,target):\n    current=start\n    count=0\n    while current<target:\n        current+=current\n        count+=1\n    return count'),
])
def test_equivalent_branch_orders_and_loop_forms_are_accepted(tasks, task_id, code):
    checked(tasks[task_id], code)


def test_theory_separates_branch_choice_loop_control_and_result():
    support = build_tasks._load_support_content()
    for topic, count, ordinary in ((6, 8, 6), (7, 10, 7)):
        article = support['theory'][str(topic)]
        examples = [example for section in article['sections'] for example in section['examples']]
        assert len(examples) == count
        assert all('output' in example and not example.get('context') for example in examples)
        assert all(support['hints'].get(f'{topic}.{stage}') for stage in range(1, ordinary+1))
    conditions = [example['code'] for section in support['theory']['6']['sections'] for example in section['examples']]
    assert any("pass\n    print('После pass')" in code for code in conditions)
    loops = [example['code'] for section in support['theory']['7']['sections'] for example in section['examples']]
    assert any('range(0, 8, -1)' in code for code in loops)
    assert any('return total' in code and 'print(sum_to(0))' in code for code in loops)


@pytest.mark.parametrize(('task_id', 'code', 'ok'), [
    ('7.6', None, True),
    ('7.6', 'n=0', False),
    ('6.8', "def sensor_status(value):\n    if value>50:\n        return 'ошибка'\n    if value<0:\n        return 'мороз'\n    return 'норма' if value<=25 else 'жара'", False),
    ('7.9', 'import math\ndef growth_steps(start,target):\n    return max(0,math.ceil(math.log2(target/start))) if target else 0', False),
])
def test_actual_runner_preserves_countdown_stdout_and_boundary_failures(tasks, task_id, code, ok):
    import importlib.util
    path = Path(__file__).resolve().parents[1] / 'sandbox_http_plots/runner.py'
    spec = importlib.util.spec_from_file_location('branch_loop_runner_test', path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    task = tasks[task_id]
    events = []
    result = runner.execute({'code': build_tasks._reference_program(task) if code is None else code,
                             'check': task['check']['append'], 'interactive': False, 'reportTests': True},
                            io.StringIO(), lambda kind, **data: events.append((kind, data)))
    assert any(kind == 'test_event' and data['event']['type'] == 'plan' for kind, data in events)
    passed = result['error'] is None and build_tasks._normalized_output(result['stdout']) == build_tasks._normalized_output(task['check']['expect'])
    assert passed is ok
    if task_id == '7.6':
        assert result['error'] is None and result['check_stdout'] == '\nOK\n'
        assert result['user_stdout'] == ('5 4 3 2 1 ' if ok else '')
    else:
        assert result['failure']['source'] == 'check' and result['failure']['type'] == 'AssertionError'
        assert 'Ожидалось:' in result['error'] and 'Получено:' in result['error']


def test_repair_starter_really_contains_the_announced_syntax_error(tasks):
    with pytest.raises(SyntaxError):
        compile(tasks['6.5']['code'], '<исходник задания>', 'exec')
    compile(build_tasks._reference_program(tasks['6.5']), '<исправление>', 'exec')
