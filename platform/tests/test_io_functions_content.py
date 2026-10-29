"""I/O contracts, return paths, numeric tolerance and unchanged caller data."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def tasks():
    result = {t['id']: t for topic in build_tasks.parse() if topic['id'] in (12, 13) for t in topic['tasks']}
    assert len(result) == 17
    return result


def checked(task, code):
    ns = {}
    out = io.StringIO()
    with contextlib.redirect_stdout(io.StringIO()):
        exec(code, ns)
    with contextlib.redirect_stdout(out):
        exec(task['check']['append'], ns)
    assert out.getvalue().strip() == 'OK'


@pytest.mark.parametrize('task_id', ['12.7', '12.8', '12.9', '13.2', '13.3', '13.4', '13.7', '13.8'])
def test_references(tasks, task_id):
    checked(tasks[task_id], build_tasks._reference_program(tasks[task_id]))


@pytest.mark.parametrize(('task_id', 'code'), [
    ('12.7', "n=42\nline=42\nprint('id=42')"),
    ('12.8', "def receipt_line(name,count,price):\n    return f'{name} x{count} = {count*price}'"),
    ('12.9', "def time_label(hours,minutes):\n    return f'{hours:02d}:{minutes}'"),
    ('13.2', 'def absolute_difference(a,b):\n    if a==b: return False\n    return max(a,b)-min(a,b)'),
    ('13.2', 'def absolute_difference(a,b):\n    return int(max(a,b)-min(a,b))'),
    ('13.3', 'def min_max(lst):\n    lst.sort()\n    return lst[0],lst[-1]'),
    ('13.3', 'def min_max(lst):\n    return [min(lst),max(lst)]'),
    ('13.4', 'def clamp(x,lo,hi):\n    return max(0,min(10,x))'),
    ('13.4', 'def clamp(x,lo,hi):\n    if lo<x<hi: return x\n    if x<lo: return lo\n    if x>hi: return hi'),
    ('13.7', 'def checkout(prices,discount,delivery):\n    return (sum(prices)+delivery)*(1-discount/100)'),
    ('13.7', 'def checkout(prices,discount,delivery):\n    total=sum(prices)\n    prices.clear()\n    return total*(1-discount/100)+delivery'),
    ('13.7', 'def checkout(prices,discount,delivery):\n    return round(sum(prices)*(1-discount/100)+delivery,2)'),
    ('13.8', 'def longest_run(values):\n    if not values: return False\n    best=current=1\n    for i in range(1,len(values)):\n        current=current+1 if values[i]==values[i-1] else 1\n        best=max(best,current)\n    return best'),
    ('13.8', 'def longest_run(values):\n    best=current=0\n    previous=None\n    for value in values:\n        current=current+1 if current and value==previous else 1\n        previous=value\n        best=max(best,current)\n    values.clear()\n    return best'),
])
def test_rejects_wrong_contracts(tasks, task_id, code):
    with pytest.raises(AssertionError):
        checked(tasks[task_id], code)


@pytest.mark.parametrize(('task_id', 'code'), [
    ('12.8', "def receipt_line(name,count,price):\n    return '{} x{} = {:.2f}'.format(name,count,count*price)"),
    ('12.9', "def time_label(hours,minutes):\n    return str(hours).zfill(2)+':'+str(minutes).zfill(2)"),
    ('13.2', 'def absolute_difference(a,b):\n    return a-b if a>=b else b-a'),
    ('13.3', 'def min_max(lst):\n    ordered=sorted(lst)\n    return ordered[0],ordered[-1]'),
    ('13.4', 'def clamp(x,lo,hi):\n    if x<lo: return lo\n    if x>hi: return hi\n    return x'),
    ('13.7', 'def checkout(prices,discount,delivery):\n    total=sum(prices)\n    return total-total*discount/100+delivery'),
    ('13.8', 'from itertools import groupby\ndef longest_run(values):\n    return max((len(list(group)) for _,group in groupby(values)),default=0)'),
])
def test_equivalent_solutions(tasks, task_id, code):
    checked(tasks[task_id], code)


@pytest.mark.parametrize(('task_id', 'code', 'ok'), [
    ('12.7', None, True),
    ('12.7', "n=42\nline='id=42'", False),
    ('13.7', 'def checkout(prices,discount,delivery):\n    return sum(prices)*(100-discount)/100+delivery\nprint("пример")', True),
    ('13.8', 'def longest_run(values):\n    values.clear()\n    return 0', False),
])
def test_actual_runner_stdout_and_failure(tasks, task_id, code, ok):
    import importlib.util
    path = Path(__file__).resolve().parents[1] / 'sandbox_http_plots/runner.py'
    spec = importlib.util.spec_from_file_location('io_functions_runner_test', path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    task = tasks[task_id]
    events = []
    result = runner.execute({'code': build_tasks._reference_program(task) if code is None else code,
                             'check': task['check']['append'], 'interactive': False, 'reportTests': True},
                            io.StringIO(), lambda kind, **data: events.append((kind, data)))
    assert any(kind == 'test_event' and data['event']['type'] == 'plan' for kind, data in events)
    output = result['check_stdout'] if task['check']['expect'] == 'OK' else result['stdout']
    passed = result['error'] is None and build_tasks._normalized_output(output) == build_tasks._normalized_output(task['check']['expect'])
    assert passed is ok
    if task_id == '12.7':
        assert result['check_stdout'] == 'OK\n' and bool(result['user_stdout']) is ok
    elif not ok:
        assert result['failure']['source'] == 'check'


def test_theory_and_hints():
    support = build_tasks._load_support_content()
    for topic, count, ordinary in ((12, 12, 7), (13, 10, 6)):
        examples = [e for section in support['theory'][str(topic)]['sections'] for e in section['examples']]
        assert len(examples) == count and all('output' in e and not e.get('context') for e in examples)
        assert all(support['hints'].get(f'{topic}.{i}') for i in range(1, ordinary + 1))
