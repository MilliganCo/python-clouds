"""Collection tasks preserve inputs, result shape and independent outer lists."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def tasks():
    result = {task['id']: task for topic in build_tasks.parse() if topic['id'] in (8, 9) for task in topic['tasks']}
    assert len(result) == 21
    return result


def checked(task, code):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(code, namespace)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(task['check']['append'], namespace)
    assert output.getvalue().strip() == 'OK'


@pytest.mark.parametrize('task_id', ['8.4', '8.7', '8.8', '8.10', '8.11', '9.6', '9.7', '9.8', '9.9', '9.10'])
def test_canonical_checks_accept_references(tasks, task_id):
    checked(tasks[task_id], build_tasks._reference_program(tasks[task_id]))


@pytest.mark.parametrize(('task_id', 'code'), [
    ('8.4', "numbers=[1,2,3,4,5]\nresult='15'\nprint(result)"),
    ('8.7', "nums='[0, 1, 2, 3, 4]'\nprint(nums)"),
    ('8.8', 'def second(items):\n    return items.pop(1)'),
    ('8.8', 'def second(items):\n    return items[1] or False'),
    ('8.10', 'def rotate_queue(names):\n    return names if len(names)<2 else names[1:]+names[:1]'),
    ('8.11', 'def valid_readings(values):\n    if not values:\n        return values\n    out=[]\n    for value in values:\n        if value>=0 and (not out or out[-1]!=value):\n            out.append(value)\n    return out'),
    ('8.11', 'def valid_readings(values):\n    out=[]\n    for value in values:\n        if value>=0 and (not out or out[-1]!=value):\n            out.append(int(value))\n    return out'),
    ('8.11', 'def valid_readings(values):\n    out=[]\n    for value in values:\n        if value>=0 and value not in out:\n            out.append(value)\n    return out'),
    ('9.6', "point=(3,4)\nx='3'\ny='4'\nprint(x,y)"),
    ('9.7', 't=(7.0,)\nprint(type(t).__name__,t)'),
    ('9.8', 't=[1,2,3]\nt[1]=9\nprint(tuple(t))'),
    ('9.9', 'def rectangle_bounds(a,b):\n    x1,y1=a\n    x2,y2=b\n    return tuple(abs(v) for v in (min(x1,x2),min(y1,y2),max(x1,x2),max(y1,y2)))'),
    ('9.9', 'def rectangle_bounds(a,b):\n    x1,y1=a\n    x2,y2=b\n    return tuple(int(v) for v in (min(x1,x2),min(y1,y2),max(x1,x2),max(y1,y2)))'),
    ('9.10', 'def split_order(order):\n    number,name,count=order\n    return number,(name.strip(),count)'),
    ('9.10', 'def split_order(order):\n    number,name,count=order\n    return number,(name.lower(),count)'),
])
def test_rejects_mutation_aliases_wrong_types_and_lost_content(tasks, task_id, code):
    with pytest.raises(AssertionError):
        checked(tasks[task_id], code)


@pytest.mark.parametrize(('task_id', 'code'), [
    ('8.4', 'numbers=[1,2,3,4,5]\nresult=0\nfor value in numbers:\n    result+=value\nprint(result)'),
    ('8.7', 'nums=[1,2,3]\nnums.extend([4])\nnums[0:0]=[0]\nprint(nums)'),
    ('8.8', 'def second(items):\n    first,answer,*rest=items\n    return answer'),
    ('8.10', 'def rotate_queue(names):\n    out=list(names)\n    if out:\n        out.append(out.pop(0))\n    return out'),
    ('8.11', 'def valid_readings(values):\n    out=[]\n    for value in values:\n        if value<0:\n            continue\n        if not out or value!=out[-1]:\n            out.append(value)\n    return out'),
    ('9.6', 'point=(3,4)\nx,y=point[:]\nprint(x,y)'),
    ('9.7', 't=7,\nprint(type(t).__name__,t)'),
    ('9.8', 't=(1,2,3)\nt=t[:1]+(9,)+t[2:]\nprint(t)'),
    ('9.9', 'def rectangle_bounds(a,b):\n    left,right=sorted((a[0],b[0]))\n    bottom,top=sorted((a[1],b[1]))\n    return left,bottom,right,top'),
    ('9.10', 'def split_order(order):\n    return order[0],order[1:]'),
])
def test_equivalent_collection_operations_are_accepted(tasks, task_id, code):
    checked(tasks[task_id], code)


def test_articles_show_copying_membership_unpacking_and_nested_data():
    support = build_tasks._load_support_content()
    for topic, count, ordinary in ((8, 12, 9), (9, 10, 8)):
        examples = [example for section in support['theory'][str(topic)]['sections'] for example in section['examples']]
        assert len(examples) == count
        assert all('output' in example and not example.get('context') for example in examples)
        assert all(support['hints'].get(f'{topic}.{stage}') for stage in range(1, ordinary+1))
    source = '\n'.join(example['code'] for section in support['theory']['8']['sections'] for example in section['examples'])
    assert '.copy()' in source and ' is ' in source
    assert 'value not in unique' in source
    assert any(example.get('practice') for section in support['theory']['8']['sections'] for example in section['examples'])
    assert '**Что важно объяснить:**' in next(task for topic in build_tasks.parse() for task in topic['tasks'] if task['id']=='8.3')['prompt']


@pytest.mark.parametrize(('task_id', 'code', 'ok'), [
    ('9.8', None, True),
    ('9.8', 't=(1,9,3)', False),
    ('8.10', 'def rotate_queue(names):\n    return names if len(names)<2 else names[1:]+names[:1]', False),
    ('8.11', 'def valid_readings(values):\n    out=[]\n    for value in values:\n        if value>=0 and (not out or out[-1]!=value):\n            out.append(int(value))\n    return out', False),
])
def test_actual_runner_preserves_required_stdout_and_reports_collection_failure(tasks, task_id, code, ok):
    import importlib.util
    path = Path(__file__).resolve().parents[1] / 'sandbox_http_plots/runner.py'
    spec = importlib.util.spec_from_file_location('list_tuple_runner_test', path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    task = tasks[task_id]
    events = []
    result = runner.execute({'code': build_tasks._reference_program(task) if code is None else code,
                             'check': task['check']['append'], 'interactive': False, 'reportTests': True},
                            io.StringIO(), lambda kind, **data: events.append((kind, data)))
    assert any(kind == 'test_event' and data['event']['type']=='plan' for kind, data in events)
    passed = result['error'] is None and build_tasks._normalized_output(result['stdout']) == build_tasks._normalized_output(task['check']['expect'])
    assert passed is ok
    if task_id=='9.8':
        assert result['error'] is None and result['check_stdout']=='OK\n'
        assert result['user_stdout']==('(1, 9, 3)\n' if ok else '')
    else:
        assert result['failure']['source']=='check' and result['failure']['type']=='AssertionError'


def test_tuple_repair_starter_keeps_its_real_mutation_error(tasks):
    with pytest.raises(TypeError):
        exec(tasks['9.8']['code'], {})
