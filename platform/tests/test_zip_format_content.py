"""Position, data preservation and textual formatting are separate contracts."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def zip_format_tasks():
    tasks = {t['id']: t for p in build_tasks.parse() if p['id'] in (42, 43) for t in p['tasks']}
    assert len(tasks) == 15
    return tasks


def bad_program(tasks, task_id, code):
    reference = build_tasks._reference_program(tasks[task_id])
    if code == 'space-only':
        return reference.replace('line.strip()', "line.strip(' ')")
    if code == 'inner-spaces':
        return reference.replace('line.strip()', "''.join(line.split())")
    if code == 'mutate-lines':
        return reference.replace('def numbered_lines(lines):', 'def numbered_lines(lines):\n    lines[:] = [line.strip() for line in lines]')
    if code == 'first-three':
        return reference.replace('enumerate(lines, 1)', 'enumerate(lines[:3], 1)')
    if code == 'lower-names':
        return reference.replace('{name: new - old', '{name.lower(): new - old')
    if code == 'reverse-sources':
        return reference.replace('def score_changes(names, before, after):', 'def score_changes(names, before, after):\n    names.reverse()\n    before.reverse()\n    after.reverse()')
    if code == 'integer-deltas':
        return reference.replace('new - old', 'int(new - old)')
    if code == 'shared-result':
        return '_cache = {}\ndef score_changes(names, before, after):\n    _cache.clear()\n    _cache.update({name: new-old for name,old,new in zip(names,before,after)})\n    return _cache'
    if code == 'strip-label':
        return reference.replace('{name:<8}', '{name.strip():<8}')
    if code == 'lower-label':
        return reference.replace('{name:<8}', '{name.lower():<8}')
    if code == 'round-unit-price':
        return reference.replace('count * price', 'count * round(price, 2)')
    if code == 'integer-total':
        return reference.replace('count * price', 'int(count * price)')
    if code == 'half-up-percent':
        return "from decimal import Decimal, ROUND_HALF_UP\ndef progress_label(done, total):\n    value = Decimal(str(done / total * 100)).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)\n    return f'{value}%'"
    return code


@pytest.mark.parametrize(('task_id', 'code'), [
    ('42.7', 'space-only'), ('42.7', 'inner-spaces'), ('42.7', 'mutate-lines'),
    ('42.7', 'first-three'), ('42.8', 'lower-names'), ('42.8', 'reverse-sources'),
    ('42.8', 'integer-deltas'), ('42.8', 'shared-result'), ('43.6', 'strip-label'),
    ('43.6', 'lower-label'), ('43.6', 'round-unit-price'), ('43.6', 'integer-total'),
    ('43.7', 'half-up-percent'),
])
def test_zip_format_checks_reject_old_false_accepts(zip_format_tasks, task_id, code):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(bad_program(zip_format_tasks, task_id, code), namespace)
    with pytest.raises(AssertionError):
        exec(zip_format_tasks[task_id]['check']['append'], namespace)


@pytest.mark.parametrize('task_id', ['42.3', '42.5', '42.6', '42.7', '42.8', '43.5', '43.6', '43.7'])
def test_zip_format_references_pass(zip_format_tasks, task_id, capsys):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(build_tasks._reference_program(zip_format_tasks[task_id]), namespace)
    exec(zip_format_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize(('task_id', 'code'), [
    ('42.3', 'd = {key: value for key, value in zip(keys, values)}'),
    ('42.5', 'pairs = [pair for pair in zip(names, scores)]'),
    ('42.7', 'def numbered_lines(lines):\n    result = []\n    for number, line in enumerate(lines, start=1):\n        text = line.strip()\n        if text:\n            result.append((number, text))\n    return result'),
    ('42.8', 'def score_changes(names, before, after):\n    result = {}\n    for name, old, new in zip(names, before, after):\n        result[name] = new - old\n    return result'),
    ('43.6', 'def report_row(name, count, price):\n    return "{:<8}|{:>3}|{:.2f}".format(name, count, count * price)'),
    ('43.7', 'def progress_label(done, total):\n    return format(done / total, ".1%")'),
])
def test_zip_format_equivalent_solutions_pass(zip_format_tasks, task_id, code, capsys):
    namespace = {}
    if task_id == '42.3':
        namespace.update(keys=['a', 'b'], values=[1, 2])
    elif task_id == '42.5':
        namespace.update(names=['Ann', 'Bob'], scores=[10, 8])
    exec(code, namespace)
    exec(zip_format_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize(('topic', 'ordinary'), [(42, 6), (43, 5)])
def test_zip_format_theory_and_hints_are_self_contained(topic, ordinary):
    support = build_tasks._load_support_content()
    examples = [e for s in support['theory'][str(topic)]['sections'] for e in s['examples']]
    assert len(examples) == 8 and all(e.get('output') is not None and not e.get('context') for e in examples)
    assert all(support['hints'].get(f'{topic}.{i}') for i in range(1, ordinary + 1))
