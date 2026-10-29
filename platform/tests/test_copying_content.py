"""Copying checks validate ownership rather than matching one printed example."""
from pathlib import Path
import sys

import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def copying_tasks():
    tasks={t['id']:t for p in build_tasks.parse() if p['id']==38 for t in p['tasks']}
    assert len(tasks)==12
    return tasks


@pytest.mark.parametrize(('task_id','code'),[
    ('38.9',"a = [[1, 2], [3, 4]]\nb = [a[0][:], a[1]]\nb[0][0] = 9\nprint(a, b)"),
    ('38.11',"from copy import deepcopy\ndef with_tag(settings, tag):\n    result = {key: deepcopy(value) if key in ('tags', 'view') else value for key, value in settings.items()}\n    result['tags'].append(tag)\n    return result"),
    ('38.11',"import json\ndef with_tag(settings, tag):\n    result = json.loads(json.dumps(settings))\n    result['tags'].append(tag)\n    return result"),
    ('38.11',"from copy import deepcopy\ndef with_tag(settings, tag):\n    result = deepcopy(settings)\n    if tag not in result['tags']:\n        result['tags'].append(tag)\n    return result"),
    ('38.12','def make_board(rows, cols):\n    if rows == 0:\n        return []\n    first, rest = [0] * cols, [0] * cols\n    return [first] + [rest] * (rows - 1)'),
    ('38.12','def make_board(rows, cols):\n    return [[False] * cols for _ in range(rows)]'),
    ('38.12','cache = {}\ndef make_board(rows, cols):\n    key = rows, cols\n    if key not in cache:\n        cache[key] = [[0] * cols for _ in range(rows)]\n    return cache[key]'),
])
def test_copying_checks_reject_partial_copy_shared_rows_and_reused_state(copying_tasks,task_id,code):
    namespace={}
    exec(code,namespace)
    with pytest.raises(AssertionError):
        exec(copying_tasks[task_id]['check']['append'],namespace)


@pytest.mark.parametrize('task_id',['38.8','38.9','38.10','38.11','38.12'])
def test_copying_reference_passes(copying_tasks,task_id,capsys):
    namespace={}
    exec(build_tasks._reference_program(copying_tasks[task_id]),namespace)
    capsys.readouterr()
    exec(copying_tasks[task_id]['check']['append'],namespace)
    assert capsys.readouterr().out=='OK\n'


@pytest.mark.parametrize(('task_id','code'),[
    ('38.8','a = [1, 2, 3]\nb = a.copy()\nb[0] = 99'),
    ('38.11',"def clone(value):\n    if isinstance(value, dict):\n        return {key: clone(item) for key, item in value.items()}\n    if isinstance(value, list):\n        return [clone(item) for item in value]\n    if isinstance(value, tuple):\n        return tuple(clone(item) for item in value)\n    return value\ndef with_tag(settings, tag):\n    result = clone(settings)\n    result['tags'].append(tag)\n    return result"),
    ('38.12','def make_board(rows, cols):\n    result = []\n    for _ in range(rows):\n        result.append([0] * cols)\n    return result'),
])
def test_valid_copying_alternatives_need_not_match_reference(copying_tasks,task_id,code,capsys):
    namespace={}
    exec(code,namespace)
    exec(copying_tasks[task_id]['check']['append'],namespace)
    assert capsys.readouterr().out=='OK\n'


def test_copying_hints_do_not_promise_universal_resource_safety():
    hints=build_tasks._load_support_content()['hints']
    assert all(hints.get(f'38.{i}') for i in range(1,11))
    assert 'в полной безопасности' not in hints['38.3']
