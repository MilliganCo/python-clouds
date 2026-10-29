"""Callable forwarding, exact callback counts, stable sorting and unchanged inputs."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def tasks():
    result = {t['id']: t for p in build_tasks.parse() if p['id'] in (21, 22) for t in p['tasks']}
    assert len(result) == 18
    return result


def checked(task, code):
    ns = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(code, ns)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(task['check']['append'], ns)
    assert output.getvalue().strip() == 'OK'


@pytest.mark.parametrize('task_id', ['21.3', '21.6', '21.7', '21.8', '21.9', '22.3', '22.6', '22.7', '22.8', '22.9'])
def test_references(tasks, task_id):
    checked(tasks[task_id], build_tasks._reference_program(tasks[task_id]))


@pytest.mark.parametrize(('task_id', 'code'), [
    ('21.3', "students=[('Аня',85),('Боб',92),('Вика',78)]\ndef by_score(s): return s[1]\nresult=\"[('Боб', 92), ('Аня', 85), ('Вика', 78)]\"\nprint(result)"),
    ('21.3', "students=[('Аня',85),('Боб',92),('Вика',78)]\ndef by_score(s): return s[1]\nstudents.sort(key=by_score,reverse=True)\nresult=students\nprint(result)"),
    ('21.6', "words=['bbb','a','dd']\nwords.sort(key=len)\nordered=words\nprint(ordered)"),
    ('21.7', "nums=[3,-1,-2,4]\nby_abs='[-1, -2, 3, 4]'\nprint(by_abs)"),
    ('21.8', 'def ranking(rows):\n    return sorted(rows,key=lambda r:(-r[1],r[0])) if rows else rows'),
    ('21.8', 'def ranking(rows):\n    return sorted(rows,key=lambda r:(-r[1],r[0].casefold()))'),
    ('21.9', 'def nearest(values,target):\n    values.sort()\n    return min(values,key=lambda x:(abs(x-target),x))'),
    ('21.9', 'def nearest(values,target):\n    return int(min(values,key=lambda x:(abs(x-target),x)))'),
    ('21.9', 'def nearest(values,target):\n    return min(values,key=lambda x:(abs(x-target),x)) or False'),
    ('22.3', 'def squares(nums):\n    nums[:]=[n*n for n in nums]\n    return nums'),
    ('22.3', 'def squares(nums):\n    return [int(n*n) for n in nums]'),
    ('22.3', 'def squares(nums):\n    return [n*n for n in nums] if nums else nums'),
    ('22.6', "nums=[1,2,3]\nas_text=\"['1', '2', '3']\"\nprint(as_text)"),
    ('22.7', 'def apply(fn,value):\n    fn(value)\n    return fn(value)'),
    ('22.7', 'def apply(fn,value):\n    return fn(value) or None'),
    ('22.7', 'from copy import deepcopy\ndef apply(fn,value):\n    return deepcopy(fn(value))'),
    ('22.7', 'def apply(fn,value):\n    try: return fn(value)\n    except ValueError: return None'),
    ('22.8', 'def transform_twice(value,first,second):\n    first(value)\n    return second(first(value))'),
    ('22.9', 'def select_values(values,predicate):\n    return [v for v in values if predicate(v) is True]'),
    ('22.9', 'def select_values(values,predicate):\n    values[:]=[v for v in values if predicate(v)]\n    return values'),
    ('22.9', 'def select_values(values,predicate):\n    out=[]\n    for v in values:\n        predicate(v)\n        if predicate(v): out.append(v)\n    return out'),
])
def test_rejects_changed_input_and_callback_contracts(tasks, task_id, code):
    with pytest.raises(AssertionError):
        checked(tasks[task_id], code)


@pytest.mark.parametrize(('task_id', 'code'), [
    ('21.3', "students=[('Аня',85),('Боб',92),('Вика',78)]\ndef by_score(s): return s[1]\nkey_fn=by_score\nresult=sorted(students,key=key_fn,reverse=True)\nprint(result)"),
    ('21.6', "words=['bbb','a','dd']\nordered=words.copy()\nordered.sort(key=len)\nprint(ordered)"),
    ('21.7', 'nums=[3,-1,-2,4]\nby_abs=sorted(nums,key=lambda n:abs(n))\nprint(by_abs)'),
    ('21.8', 'def ranking(rows):\n    named=sorted(rows,key=lambda r:r[0])\n    return sorted(named,key=lambda r:r[1],reverse=True)'),
    ('21.9', 'def nearest(values,target):\n    return sorted(values,key=lambda x:(abs(x-target),x))[0]'),
    ('22.3', 'def squares(nums):\n    return list(map(lambda n:pow(n,2),nums))'),
    ('22.6', "nums=[1,2,3]\nas_text=list(map(lambda value:f'{value}',nums))\nprint(as_text)"),
    ('22.7', 'def apply(fn,value):\n    result=fn(value)\n    return result'),
    ('22.8', 'def transform_twice(value,first,second):\n    middle=first(value)\n    result=second(middle)\n    return result'),
    ('22.9', 'def select_values(values,predicate):\n    return list(filter(predicate,values))'),
])
def test_equivalent_solutions(tasks, task_id, code):
    checked(tasks[task_id], code)


@pytest.mark.parametrize(('task_id', 'code', 'ok'), [
    ('21.3', None, True),
    ('22.6', "nums=[1,2,3]\nas_text=['1','2','3']", False),
    ('22.7', 'def apply(fn,value):\n    fn(value)\n    return fn(value)', False),
    ('22.7', None, True),
    ('22.8', None, True),
])
def test_actual_runner_mixed_stdout_and_callbacks(tasks, task_id, code, ok):
    import importlib.util
    spec = importlib.util.spec_from_file_location('lambda_sort_runner_test', Path(__file__).resolve().parents[1] / 'sandbox_http_plots/runner.py')
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
    for topic, count in ((22, 10), (21, 12)):
        examples = [e for s in support['theory'][str(topic)]['sections'] for e in s['examples']]
        assert len(examples) == count and all('output' in e and not e.get('context') for e in examples)
        assert all(support['hints'].get(f'{topic}.{i}') for i in range(1, 8))
    assert not set(support['checks']) & {'21.3', '22.3', '22.7'}
