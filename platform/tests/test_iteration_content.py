"""Trusted course checks must reject eager/incorrect generator solutions promptly."""
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


def test_regular_stage_can_own_its_canonical_behavior_check():
    raw = '''**Тип задания:** написать функцию
**Название:** Первый элемент
**Условие:** Верните первый элемент.
**Ответ:**
```python
def first(values):
    return next(iter(values))
```
**Объяснение:** Читаем один элемент.
**Проверено в CPython:** да
**Проверка:**
```python
assert first([3]) == 3
print("OK")
```
**Ожидаемый вывод:**
```text
OK
```
'''
    task = build_tasks.parse_task(raw, 27, 7)
    assert task['check'] == {'append': 'assert first([3]) == 3\nprint("OK")', 'expect': 'OK'}
    assert task['explanation'] == 'Читаем один элемент.'
    assert task['verified'] == 'да'
    assert 'finale' not in task


@pytest.mark.parametrize('fields', [
    '**Проверка:**\n```python\nprint("OK")\n```',
    '**Ожидаемый вывод:**\n```text\nOK\n```',
])
def test_incomplete_regular_behavior_check_is_not_silently_dropped(fields):
    with pytest.raises(ValueError, match='27.7'):
        build_tasks.parse_task('**Тип задания:** написать функцию\n' + fields, 27, 7)


@pytest.fixture(scope='module')
def iteration_tasks():
    tasks = {task['id']: task for topic in build_tasks.parse() if topic['id'] in (27, 28) for task in topic['tasks']}
    support = build_tasks._load_support_content()['checks']
    for task_id, task in tasks.items():
        if 'check' not in task and task_id in support:
            task['check'] = support[task_id]
    assert len(tasks) == 21
    return tasks


@pytest.mark.parametrize(('task_id', 'code'), [
    ('27.7', 'def first(iterable, default=None):\n    return next(iter(list(iterable)), default)'),
    ('27.7', 'def first(iterable, default=None):\n    try:\n        return next(iter(iterable))\n    except Exception:\n        return default'),
    ('28.4', 'def squares(n):\n    return (i * i for i in range(n))'),
    ('28.7', 'def countdown(n):\n    return list(range(n, 0, -1))'),
    ('28.10', None),
])
def test_iteration_checks_reject_missing_required_form_or_eager_reads(iteration_tasks, task_id, code):
    task = iteration_tasks[task_id]
    if code is None:
        code = build_tasks._reference_program(task).replace('iterator = iter(iterable)', 'iterator = iter(list(iterable))')
    namespace = {}
    exec(code, namespace)
    with pytest.raises(AssertionError):
        exec(task['check']['append'], namespace)


@pytest.mark.parametrize('task_id', ['27.7', '27.9', '27.10', '28.4', '28.7', '28.10', '28.11'])
def test_iteration_reference_passes_current_authored_checks(iteration_tasks, task_id, capsys):
    task = iteration_tasks[task_id]
    namespace = {}
    exec(build_tasks._reference_program(task), namespace)
    exec(task['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


def test_take_first_accepts_islice_without_forcing_the_reference_loop(iteration_tasks, capsys):
    namespace = {}
    exec('from itertools import islice\ndef take_first(iterable, count):\n    return list(islice(iterable, count))', namespace)
    exec(iteration_tasks['27.9']['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


def test_adjacent_pairs_may_collect_a_finite_source_once(iteration_tasks, capsys):
    namespace = {}
    exec('def adjacent_pairs(iterable):\n    data = list(iterable)\n    return list(zip(data, data[1:]))', namespace)
    exec(iteration_tasks['27.10']['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize('task_id', ['27.10', '28.10'])
def test_late_debugging_has_real_broken_starter_and_unchanged_finale(iteration_tasks, task_id, capsys):
    task = iteration_tasks[task_id]
    assert task['type'] == 'исправить ошибку'
    assert task['finale'] == (2 if task_id == '27.10' else 1)
    assert task['code'].startswith('def ')
    assert '# TODO' not in task['code']
    assert task['hint'] and task['explanation']
    namespace = {}
    exec(task['code'], namespace)
    with pytest.raises(AssertionError):
        exec(task['check']['append'], namespace)
    assert not capsys.readouterr().out


@pytest.mark.parametrize(('task_id', 'code'), [
    ('27.10', 'from itertools import pairwise\ndef adjacent_pairs(iterable):\n    return list(pairwise(iterable))'),
    ('28.10', 'from itertools import groupby\ndef runs(iterable):\n    for value, group in groupby(iterable):\n        yield value, sum(1 for _ in group)'),
])
def test_late_debugging_accepts_standard_library_alternatives(iteration_tasks, task_id, code, capsys):
    namespace = {}
    exec(code, namespace)
    exec(iteration_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize('code', [
    'def adjacent_pairs(iterable):\n    data = list(iterable)\n    return list(zip(data[::2], data[1::2]))',
    'def adjacent_pairs(iterable):\n    data = [value for value in iterable if value]\n    return list(zip(data, data[1:]))',
    'def adjacent_pairs(iterable):\n    data = list(iterable)\n    return zip(data, data[1:])',
])
def test_adjacent_debugging_rejects_disjoint_filtered_or_wrong_form(iteration_tasks, code):
    namespace = {}
    exec(code, namespace)
    with pytest.raises(AssertionError):
        exec(iteration_tasks['27.10']['check']['append'], namespace)


@pytest.mark.parametrize('defect', ['identity', 'last_series', 'eager', 'none_marker'])
def test_runs_debugging_rejects_each_independent_defect(iteration_tasks, defect):
    task = iteration_tasks['28.10']
    code = build_tasks._reference_program(task)
    if defect == 'identity':
        code = code.replace('value == previous', 'value is previous')
    elif defect == 'last_series':
        code = code.rsplit('\n    yield previous, count', 1)[0]
    elif defect == 'eager':
        code = code.replace('iterator = iter(iterable)', 'iterator = iter(list(iterable))')
    else:
        code = '''def runs(iterable):
    previous = None
    count = 0
    for value in iterable:
        if previous is None:
            previous, count = value, 1
        elif value == previous:
            count += 1
        else:
            yield previous, count
            previous, count = value, 1
    if count:
        yield previous, count'''
    assert code != build_tasks._reference_program(task)
    namespace = {}
    exec(code, namespace)
    with pytest.raises(AssertionError):
        exec(task['check']['append'], namespace)
