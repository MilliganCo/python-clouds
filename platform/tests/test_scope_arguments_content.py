"""Scope, shared object identity, argument binding and numerical return values."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def tasks():
    result = {t['id']: t for p in build_tasks.parse() if p['id'] in (14, 15) for t in p['tasks']}
    assert len(result) == 19
    return result


def checked(task, code):
    ns = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(code, ns)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(task['check']['append'], ns)
    assert output.getvalue().strip() == 'OK'


@pytest.mark.parametrize('task_id', ['14.3', '14.7', '14.8', '14.9', '14.10', '15.3', '15.6', '15.7', '15.8', '15.9'])
def test_references(tasks, task_id):
    checked(tasks[task_id], build_tasks._reference_program(tasks[task_id]))


@pytest.mark.parametrize(('task_id', 'code'), [
    ('14.3', 'total=5\ndef add(x):\n    global total\n    if x==2: total=7\n    elif x==-3: total=4\nprint(total)'),
    ('14.7', 'count=2\ndef bump():\n    global count\n    count=min(count+1,4)\nprint(count)'),
    ('14.8', 'x=100\ndef double(value):\n    return int(value*2)\nprint(double(5))'),
    ('14.9', 'fee=100\ndef with_fee(price,fee):\n    return int(price+fee)'),
    ('14.10', 'events=[]\ndef record_event(name):\n    global events\n    events=events+[name]\n    return len(events)'),
    ('14.10', 'events=[]\ndef record_event(name):\n    events.append(name)\n    return True if len(events)==1 else len(events)'),
    ('15.3', 'def average(*numbers):\n    return sum(numbers)//len(numbers) if numbers else 0'),
    ('15.3', 'def average(*numbers):\n    return sum(numbers)/len(numbers) if numbers else False'),
    ('15.6', "def greet(name,hello='Привет'):\n    hello=hello or 'Привет'\n    return hello+', '+name+'!'"),
    ('15.7', 'def add(a,b): return a+b\nresult="7"\nprint(7)'),
    ('15.8', "def booking(name,nights,*args,breakfast=False):\n    if args: raise TypeError('нет')\n    return f'{name}: {nights*(1200 if breakfast else 1000)}'"),
    ('15.8', "def booking(name,nights,*,breakfast=False):\n    return f'{name}: {nights*1000+(200 if breakfast else 0)}'"),
    ('15.9', 'def scaled_total(*numbers,factor=1):\n    return sum(numbers)*(factor or 1)'),
    ('15.9', 'def scaled_total(*numbers,factor=1):\n    return sum(numbers)*int(factor)'),
])
def test_rejects_wrong_scope_and_arguments(tasks, task_id, code):
    with pytest.raises(AssertionError):
        checked(tasks[task_id], code)


@pytest.mark.parametrize(('task_id', 'code'), [
    ('14.10', 'events=[]\ndef record_event(name):\n    events.extend([name])\n    return len(events)'),
    ('15.3', 'def average(*numbers):\n    if len(numbers)==0: return 0\n    total=0\n    for value in numbers: total+=value\n    return total/len(numbers)'),
    ('15.6', "def greet(name,hello='Привет'):\n    return hello+', '+name+'!'"),
    ('15.8', "def booking(name,nights,*,breakfast=False):\n    total=nights*1000\n    if breakfast: total+=nights*200\n    return '{}: {}'.format(name,total)"),
    ('15.9', 'def scaled_total(*numbers,factor=1):\n    total=0\n    for value in numbers: total+=value\n    return factor*total'),
])
def test_equivalent_solutions(tasks, task_id, code):
    checked(tasks[task_id], code)


@pytest.mark.parametrize(('task_id', 'code', 'ok'), [
    ('14.3', None, True),
    ('14.7', 'count=2\ndef bump():\n    global count\n    count+=1', False),
    ('15.7', None, True),
    ('15.8', "def booking(name,nights,*args,breakfast=False):\n    if args: raise TypeError('нет')\n    return f'{name}: {nights*(1200 if breakfast else 1000)}'", False),
])
def test_actual_runner_mixed_output_and_binding(tasks, task_id, code, ok):
    import importlib.util
    spec = importlib.util.spec_from_file_location('scope_arguments_runner_test', Path(__file__).resolve().parents[1] / 'sandbox_http_plots/runner.py')
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    task = tasks[task_id]
    events = []
    result = runner.execute({'code': build_tasks._reference_program(task) if code is None else code,
                             'check': task['check']['append'], 'interactive': False, 'reportTests': True},
                            io.StringIO(), lambda kind, **data: events.append((kind, data)))
    assert any(kind == 'test_event' and data['event']['type'] == 'plan' for kind, data in events)
    output = result['check_stdout'] if task['check']['expect'] == 'OK' else result['stdout']
    assert (result['error'] is None and build_tasks._normalized_output(output) == build_tasks._normalized_output(task['check']['expect'])) is ok


def test_theory_and_hints():
    support = build_tasks._load_support_content()
    for topic, ordinary in ((14, 8), (15, 7)):
        examples = [e for s in support['theory'][str(topic)]['sections'] for e in s['examples']]
        assert len(examples) == 10 and all('output' in e and not e.get('context') for e in examples)
        assert all(support['hints'].get(f'{topic}.{i}') for i in range(1, ordinary + 1))
    assert not {'14.3', '14.7', '14.8', '15.3', '15.6', '15.7'} & set(support['checks'])
