"""Comprehensions preserve input, result types, order, duplicates and grouping."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def tasks():
    result = {t['id']: t for p in build_tasks.parse() if p['id'] in (19, 20) for t in p['tasks']}
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


@pytest.mark.parametrize('task_id', ['19.3', '19.6', '19.7', '19.9', '19.10', '20.2', '20.6', '20.7', '20.8', '20.9'])
def test_references(tasks, task_id):
    checked(tasks[task_id], build_tasks._reference_program(tasks[task_id]))


@pytest.mark.parametrize(('task_id', 'code'), [
    ('19.3', "words=['Hi','hello','Hey']\nresult=\"['hi', 'hey']\"\nprint(result)"),
    ('19.3', "words=['hi','hello','hey']\nresult=['hi','hey']\nprint(result)"),
    ('19.6', 'nums=[2,4]\nresult=[20,40]\nprint(result)'),
    ('19.7', "cubes='[0, 1, 8, 27]'\nprint(cubes)"),
    ('19.9', 'def clean_addresses(values):\n    values[:]=[s.strip().lower() for s in values if s.strip()]\n    return values'),
    ('19.9', "def clean_addresses(values):\n    return [s.strip().lower().replace(' ','') for s in values if s.strip()]"),
    ('19.10', 'def off_diagonal(n):\n    return [(float(r),float(c)) for r in range(n) for c in range(n) if r!=c]'),
    ('20.2', "words=['a','bb','ccc']\nresult=\"{'a': 1, 'bb': 2, 'ccc': 3}\"\nprint(result)"),
    ('20.6', "d='{1: 1, 2: 4, 3: 9}'\nprint(d)"),
    ('20.7', 'def invert(d):\n    result={v:k for k,v in d.items()}\n    d.clear()\n    return result'),
    ('20.7', "def invert(d):\n    return {1:'a',2:'b'}"),
    ('20.8', 'def affordable(prices,limit):\n    result={name.upper():price for name,price in prices.items() if price<=limit}\n    prices.clear()\n    return result'),
    ('20.8', 'def affordable(prices,limit):\n    return {name.strip().upper():price for name,price in prices.items() if price<=limit}'),
    ('20.9', 'def group_initials(words):\n    result={}\n    while words:\n        word=words.pop(0)\n        if word: result.setdefault(word[0].lower(),[]).append(word)\n    return result'),
    ('20.9', 'def group_initials(words):\n    result={}\n    for raw in words:\n        word=raw.strip()\n        if word: result.setdefault(word[0].lower(),[]).append(word)\n    return result'),
])
def test_rejects_wrong_types_and_input_changes(tasks, task_id, code):
    with pytest.raises(AssertionError):
        checked(tasks[task_id], code)


@pytest.mark.parametrize(('task_id', 'code'), [
    ('19.3', "words=['Hi','hello','Hey']\nresult=[word.lower() for word in words if word.startswith('H')]\nprint(result)"),
    ('19.6', 'nums=[-1,2,-3,4]\nresult=[10*x for x in nums if 0<x]\nprint(result)'),
    ('19.7', 'cubes=[pow(i,3) for i in range(4)]\nprint(cubes)'),
    ('19.9', "def clean_addresses(values):\n    return [s.strip().lower() for s in values if s.strip()!='']"),
    ('19.10', 'def off_diagonal(n):\n    return [(r,c) for r in range(n) for c in range(n) if not r==c]'),
    ('20.7', 'def invert(d):\n    result={}\n    for k,v in d.items(): result[v]=k\n    return result'),
    ('20.8', 'def affordable(prices,limit):\n    return {name.upper():cost for name,cost in prices.items() if not cost>limit}'),
    ('20.9', 'def group_initials(words):\n    groups={}\n    for word in words:\n        if word: groups.setdefault(word[0].lower(),[]).append(word)\n    return groups'),
])
def test_equivalent_solutions(tasks, task_id, code):
    checked(tasks[task_id], code)


@pytest.mark.parametrize(('task_id', 'code', 'ok'), [
    ('19.3', None, True),
    ('20.6', 'd={1:1,2:4,3:9}', False),
    ('19.9', 'def clean_addresses(values):\n    values[:]=[s.strip().lower() for s in values if s.strip()]\n    return values', False),
    ('20.9', None, True),
])
def test_actual_runner_preserves_stdout_and_checks(tasks, task_id, code, ok):
    import importlib.util
    spec = importlib.util.spec_from_file_location('comprehensions_runner_test', Path(__file__).resolve().parents[1] / 'sandbox_http_plots/runner.py')
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
    for topic, ordinary in ((19, 8), (20, 7)):
        examples = [e for s in support['theory'][str(topic)]['sections'] for e in s['examples']]
        assert len(examples) == 12 and all('output' in e and not e.get('context') for e in examples)
        assert all(support['hints'].get(f'{topic}.{i}') for i in range(1, ordinary + 1))
    assert '20.7' not in support['checks']
