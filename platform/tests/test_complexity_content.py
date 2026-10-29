"""Cost is checked with counted operations, never a machine-speed timeout."""
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def complexity_tasks():
    tasks = {t['id']: t for p in build_tasks.parse() if p['id'] == 40 for t in p['tasks']}
    checks = build_tasks._load_support_content()['checks']
    for task_id, task in tasks.items():
        if 'check' not in task and task_id in checks:
            task['check'] = checks[task_id]
    assert len(tasks) == 9
    return tasks


@pytest.mark.parametrize(('task_id', 'code'), [
    ('40.5', None),
    ('40.5', 'def first_duplicate(lst):\n    seen = set()\n    while lst:\n        x = lst.pop(0)\n        if x in seen:\n            return x\n        seen.add(x)\n    return None'),
    ('40.5', 'def first_duplicate(lst):\n    seen = set()\n    for x in lst:\n        if x in seen:\n            return x or None\n        seen.add(x)\n    return None'),
    ('40.7', None),
    ('40.7', 'def has_duplicate(nums):\n    nums.sort()\n    return any(nums[i] == nums[i-1] for i in range(1, len(nums)))'),
    ('40.8', 'def pair_sum(values, target):\n    for i in range(len(values)):\n        for j in range(i + 1, len(values)):\n            if values[i] + values[j] == target:\n                return i, j\n    return None'),
    ('40.8', 'def pair_sum(values, target):\n    for j in range(len(values)):\n        for i in range(j):\n            if values[i] + values[j] == target:\n                return i, j\n    return None'),
    ('40.9', None),
    ('40.9', 'def merge_intervals(intervals):\n    result = []\n    for start, end in sorted(intervals):\n        if end < 0:\n            continue\n        if result and start <= result[-1][1]:\n            result[-1] = (result[-1][0], max(result[-1][1], end))\n        else:\n            result.append((start, end))\n    return result'),
])
def test_complexity_checks_reject_old_false_accepts(complexity_tasks, task_id, code):
    if code is None:
        code = build_tasks._reference_program(complexity_tasks[task_id])
        if task_id in ('40.5', '40.7'):
            code = code.replace('seen = set()', 'seen = []').replace('seen.add(x)', 'seen.append(x)')
        else:
            code = '''def merge_intervals(intervals):
    result = []
    for start, end in sorted(intervals):
        if result and start <= result[-1][1]:
            result[-1] = (result[-1][0], max(result[-1][1], end))
        else:
            result.append((start, end))
    if intervals and isinstance(intervals[0], list):
        intervals[0][1] += 1
    return result'''
    namespace = {}
    exec(code, namespace)
    with pytest.raises(AssertionError):
        exec(complexity_tasks[task_id]['check']['append'], namespace)


@pytest.mark.parametrize('task_id', ['40.5', '40.7', '40.8', '40.9'])
def test_complexity_reference_passes(complexity_tasks, task_id, capsys):
    namespace = {}
    exec(build_tasks._reference_program(complexity_tasks[task_id]), namespace)
    exec(complexity_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize(('task_id', 'code'), [
    ('40.5', 'def first_duplicate(lst):\n    seen = {}\n    for value in lst:\n        if value in seen:\n            return value\n        seen[value] = True\n    return None'),
    ('40.7', 'def has_duplicate(nums):\n    return len(set(nums)) != len(nums)'),
    ('40.8', 'from collections import namedtuple\nPair = namedtuple("Pair", "i j")\ndef pair_sum(values, target):\n    seen = {}\n    for j, value in enumerate(values):\n        i = seen.get(target - value)\n        if i is not None:\n            return Pair(i, j)\n        seen.setdefault(value, j)\n    return None'),
])
def test_complexity_equivalent_hash_based_solutions_pass(complexity_tasks, task_id, code, capsys):
    namespace = {}
    exec(code, namespace)
    exec(complexity_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


def test_complexity_lessons_have_visible_independent_examples_and_hints():
    support = build_tasks._load_support_content()
    assert all(support['hints'].get(f'40.{i}') for i in range(1, 8))
    examples = [e for s in support['theory']['40']['sections'] for e in s['examples']]
    assert len(examples) == 9
    assert all(e.get('output') and not e.get('context') for e in examples)
