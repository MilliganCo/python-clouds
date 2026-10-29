"""Trusted authored date checks: useful failures, including return type, not stdout tricks."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def date_tasks():
    topic = next(topic for topic in build_tasks.parse() if topic['id'] == 24)
    assert [task['id'] for task in topic['tasks']] == [f'24.{n}' for n in range(1, 10)]
    return {task['id']: task for task in topic['tasks']}


@pytest.mark.parametrize(('task_id', 'code'), [
    ('24.8', "def expires_on(start, days): return start"),
    ('24.8', "def expires_on(start, days): return '2024-03-01'"),
    ('24.9', "def shift_minutes(start, end):\n    left = int(start[:2]) * 60 + int(start[3:])\n    right = int(end[:2]) * 60 + int(end[3:])\n    return float((right - left) % 1440)"),
    ('24.9', "def shift_minutes(start, end):\n    left = int(start[:2]) * 60 + int(start[3:])\n    right = int(end[:2]) * 60 + int(end[3:])\n    return abs(right - left)"),
    ('24.9', "def shift_minutes(start, end):\n    left = int(start[:2]) * 60 + int(start[3:])\n    right = int(end[:2]) * 60 + int(end[3:])\n    return (right - left) % 1440 or 1440"),
])
def test_dates_finales_reject_wrong_behavior_with_a_concrete_example(date_tasks, task_id, code):
    namespace = {}
    exec(code, namespace)
    with pytest.raises(AssertionError) as failure:
        exec(date_tasks[task_id]['check']['append'], namespace)
    message = str(failure.value)
    assert all(label in message for label in ('Вызов:', 'Ожидалось:', 'Получено:')), message


@pytest.mark.parametrize('task_id', ['24.8', '24.9'])
def test_date_finale_reference_passes_without_losing_its_printed_examples(date_tasks, task_id, capsys):
    task = date_tasks[task_id]
    namespace = {}
    exec(build_tasks._reference_program(task), namespace)
    print('мой пример')
    exec(task['check']['append'], namespace)
    assert capsys.readouterr().out == 'мой пример\nOK\n'


def test_shift_finale_accepts_integer_arithmetic_without_imposing_datetime(date_tasks, capsys):
    namespace = {}
    exec('def shift_minutes(start, end):\n'
         '    left = int(start[:2]) * 60 + int(start[3:])\n'
         '    right = int(end[:2]) * 60 + int(end[3:])\n'
         '    return (right - left) % 1440', namespace)
    exec(date_tasks['24.9']['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'
