"""Slice boundaries and shallow copies must agree with the visible lesson."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def slicing_tasks():
    tasks = {t['id']: t for p in build_tasks.parse() if p['id'] == 41 for t in p['tasks']}
    assert len(tasks) == 9
    return tasks


def bad_program(tasks, task_id, code):
    reference = build_tasks._reference_program(tasks[task_id])
    if code == 'strip-text':
        return reference.replace('    middle =', '    text = text.strip()\n    middle =')
    if code == 'lower-text':
        return reference.replace('    middle =', '    text = text.lower()\n    middle =')
    if code == 'fixed-two':
        return reference.replace('middle = len(text) // 2', 'middle = 2 if len(text) > 1 else 0')
    if code == 'byte-middle':
        return reference.replace('len(text) // 2', "len(text.encode('utf-8')) // 2")
    if code == 'sort-tail':
        return reference.replace('items[-count:][::-1]', 'sorted(items[-count:], reverse=True)')
    if code == 'drop-falsy':
        return reference.replace('items[-count:][::-1]', '[item for item in items[-count:][::-1] if item]')
    if code == 'deep-copy':
        return 'import copy\n' + reference.replace('items[-count:][::-1]', 'copy.deepcopy(items[-count:][::-1])')
    if code == 'mutate-empty':
        return reference.replace('    if count == 0:', '    if not items:\n        items.append(None)\n        return []\n    if count == 0:')
    if code == 'alias-empty':
        return reference.replace('    if count == 0:', '    if not items:\n        return items\n    if count == 0:')
    return code


@pytest.mark.parametrize(('task_id', 'code'), [
    ('41.8', 'strip-text'), ('41.8', 'lower-text'), ('41.8', 'fixed-two'),
    ('41.8', 'byte-middle'), ('41.9', 'sort-tail'), ('41.9', 'drop-falsy'),
    ('41.9', 'deep-copy'), ('41.9', 'mutate-empty'), ('41.9', 'alias-empty'),
])
def test_slicing_checks_reject_previously_accepted_variants(slicing_tasks, task_id, code):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(bad_program(slicing_tasks, task_id, code), namespace)
    with pytest.raises(AssertionError):
        exec(slicing_tasks[task_id]['check']['append'], namespace)


@pytest.mark.parametrize('task_id', ['41.4', '41.7', '41.8', '41.9'])
def test_slicing_references_pass(slicing_tasks, task_id, capsys):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(build_tasks._reference_program(slicing_tasks[task_id]), namespace)
    exec(slicing_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize(('task_id', 'code'), [
    ('41.4', 'last_three = a[slice(-3, None)]'),
    ('41.7', 'mid = xs[slice(1, 4)]'),
    ('41.8', "def swap_halves(text):\n    middle = len(text) // 2\n    return ''.join((text[middle:], text[:middle]))"),
    ('41.9', 'def tail_backwards(items, count):\n    return list(reversed(items[-count:])) if count else []'),
    ('41.9', 'def tail_backwards(items, count):\n    return items[::-1][:count]'),
])
def test_slicing_equivalent_boundaries_pass(slicing_tasks, task_id, code, capsys):
    namespace = {}
    if task_id == '41.4':
        namespace['a'] = [10, 20, 30, 40, 50]
    elif task_id == '41.7':
        namespace['xs'] = [0, 1, 2, 3, 4, 5]
    exec(code, namespace)
    exec(slicing_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


def test_slicing_examples_expose_empty_results_and_hints():
    support = build_tasks._load_support_content()
    examples = [e for section in support['theory']['41']['sections'] for e in section['examples']]
    assert len(examples) == 8 and all(e.get('output') is not None and not e.get('context') for e in examples)
    assert any("repr(text[100:])" in e['code'] and "''" in e['output'] for e in examples)
    assert all(support['hints'].get(f'41.{i}') for i in range(1, 8))
