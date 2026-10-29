"""The first calculations and functions must meet their stated contracts."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def tasks():
    result = {task['id']: task for topic in build_tasks.parse() if topic['id'] in (2, 3) for task in topic['tasks']}
    assert len(result) == 20
    return result


def checked(task, code):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(code, namespace)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(task['check']['append'], namespace)
    assert output.getvalue().strip() == 'OK'


@pytest.mark.parametrize('task_id', ['2.6', '2.7', '2.8', '2.9', '2.10', '3.5', '3.6', '3.9', '3.10'])
def test_reference_has_canonical_behavior_check(tasks, task_id):
    checked(tasks[task_id], build_tasks._reference_program(tasks[task_id]))


@pytest.mark.parametrize(('task_id', 'code'), [
    ('2.6', 'celsius=0\nfahrenheit=77.0\nprint(fahrenheit)'),
    ('2.7', "pi=3.14\nr=5\narea='78.5'\nprint(area)"),
    ('2.8', 'total=17\nn=5\nq=3.0\nr=2\nprint(int(q),r)'),
    ('2.9', 'items=29\ncapacity=6\nfull=4.0\nleft=5\nboxes=5\nprint(int(full),left,boxes)'),
    ('2.10', 'seconds=75\nhours=1\nminutes=1\nrest=15\nprint(hours,minutes,rest)'),
    ('3.5', 'def is_even(n):\n    return n > 0 and n % 2 == 0'),
    ('3.5', 'def is_even(n):\n    return int(n % 2 == 0)'),
    ('3.6', 'def rectangle_area(width,height):\n    return int(width*height)'),
    ('3.9', 'def trip_cost(km):\n    print(km)\n    return 90+km*25'),
    ('3.10', 'def water_cost(bottles):\n    return bottles*40\ndef order_cost(bottles):\n    return bottles*40+70'),
    ('3.10', 'def water_cost(bottles):\n    print(bottles)\n    return bottles*40\ndef order_cost(bottles):\n    return water_cost(bottles)+70'),
])
def test_rejects_misleading_output_and_broken_function_contract(tasks, task_id, code):
    with pytest.raises(AssertionError):
        checked(tasks[task_id], code)


@pytest.mark.parametrize(('task_id', 'code'), [
    ('2.6', 'celsius=25\nfahrenheit=32+celsius/5*9\nprint(fahrenheit)'),
    ('2.7', 'pi=3.14\nr=5\narea=pi*r*r\nprint(area)'),
    ('2.8', 'total=17\nn=5\nq,r=divmod(total,n)\nprint(q,r)'),
    ('2.9', 'items=29\ncapacity=6\nfull,left=divmod(items,capacity)\nboxes=-(-items//capacity)\nprint(full,left,boxes)'),
    ('2.10', 'seconds=3675\nhours,remaining=divmod(seconds,3600)\nminutes,rest=divmod(remaining,60)\nprint(hours,minutes,rest)'),
    ('3.5', 'def is_even(n):\n    return not n % 2'),
    ('3.6', 'def rectangle_area(width,height):\n    area=height*width\n    return area'),
    ('3.9', 'def trip_cost(km):\n    cost=25*km\n    return cost+90'),
    ('3.10', 'def water_cost(bottles):\n    return 40*bottles\ndef order_cost(bottles):\n    cost=water_cost(bottles)\n    return 70+cost'),
    ('3.10', 'def water_cost(n):\n    return 40*n\nwater=water_cost\ndef order_cost(n):\n    return water(n)+70'),
    ('3.10', 'def water_cost(n):\n    return 40*n\ndef order_cost(n,calculate=water_cost):\n    return calculate(n)+70'),
])
def test_equivalent_solutions_are_not_tied_to_reference_spelling(tasks, task_id, code):
    checked(tasks[task_id], code)


def test_all_ordinary_stages_have_authored_hints_and_small_theory_examples():
    support = build_tasks._load_support_content()
    for topic, count in ((2, 10), (3, 9)):
        article = support['theory'][str(topic)]
        examples = [example for section in article['sections'] for example in section['examples']]
        assert len(examples) == count
        assert all(example.get('output') is not None and not example.get('context') for example in examples)
        assert all(support['hints'].get(f'{topic}.{stage}') for stage in range(1, 9))
    code = '\n'.join(example['code'] for section in support['theory']['3']['sections'] for example in section['examples'])
    assert "print('Эта строка не выполнится')" in code
    assert 'return base_cost(value) + 8' in code


@pytest.mark.parametrize('delegates', [True, False])
def test_delegation_observer_coexists_with_real_runner_events(tasks, delegates):
    import importlib.util
    runner_path = Path(__file__).resolve().parents[1] / 'sandbox_http_plots/runner.py'
    spec = importlib.util.spec_from_file_location('arithmetic_function_runner_test', runner_path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    expression = 'water(n)+70' if delegates else '40*n+70'
    code = 'def water_cost(n):\n    return 40*n\nwater=water_cost\ndef order_cost(n):\n    return ' + expression
    events = []
    profile = sys.getprofile()
    result = runner.execute({'code': code, 'check': tasks['3.10']['check']['append'],
                             'interactive': False, 'reportTests': True}, io.StringIO(),
                            lambda kind, **data: events.append((kind, data)))
    assert sys.getprofile() is profile
    assert result['user_stdout'] == ''
    assert any(kind == 'test_event' and data['event']['type'] == 'plan' for kind, data in events)
    if delegates:
        assert result['error'] is None and result['check_stdout'] == 'OK\n'
    else:
        assert result['failure']['source'] == 'check' and result['failure']['type'] == 'AssertionError'
        assert result['check_stdout'] == ''
