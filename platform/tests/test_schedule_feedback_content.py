"""Schedule comparisons explain one observed call without changing grading rules."""
import contextlib
import io
from pathlib import Path
import runpy
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import build_tasks


@pytest.fixture(scope='module')
def task():
    return next(task for topic in build_tasks.parse() for task in topic['tasks'] if task['id'] == '57.10')


def namespace(task):
    result = {}
    exec(task['answer'], result)
    return result


@pytest.mark.parametrize('step,expected', [(1, "('Пн', 0)"), (2, '[]'), (3, "('Ср', 8)")])
def test_each_comparison_shows_input_expected_actual_without_a_repeated_call(task, step, expected):
    scope = namespace(task)
    reference = scope['parse_schedule']
    calls = []
    def wrong(html):
        calls.append(html)
        return [('ошибка', 99)] if len(calls) == step else reference(html)
    scope['parse_schedule'] = wrong
    with pytest.raises(AssertionError) as error:
        exec(task['check']['append'], scope)
    message = str(error.value)
    assert all(label in message for label in ('Проверка:', 'Данные:', 'Ожидалось:', 'Получено:'))
    assert expected in message and "('ошибка', 99)" in message
    assert 'table' in message and '<' in message
    assert len(calls) == step
    assert len(message.encode('utf-8')) < 4096


@pytest.mark.parametrize('value', ['я' * 100000, list(range(10000)), {'x': ['a' * 10000] * 100}, None, '\ud800'],
                         ids=['long-text', 'long-list', 'nested', 'none', 'surrogate'])
def test_large_or_unusual_result_has_a_bounded_utf8_message(task, value):
    with pytest.raises(AssertionError) as error:
        exec(task['check']['append'], {'parse_schedule': lambda html: value})
    message = str(error.value)
    assert 'Получено:' in message
    assert len(message.encode('utf-8')) < 4096


def test_unprintable_and_recursive_values_do_not_hide_failed_comparison(task):
    class Broken:
        def __repr__(self):
            raise RuntimeError('broken representation')
    recursive = []
    recursive.append(recursive)
    for value in (Broken(), recursive):
        with pytest.raises(AssertionError) as error:
            exec(task['check']['append'], {'parse_schedule': lambda html: value})
        assert 'Получено:' in str(error.value)
        assert len(str(error.value).encode('utf-8')) < 4096


def test_success_never_formats_learner_values(task):
    helper, checks = task['check']['append'].split("header=", 1)
    scope = namespace(task)
    exec(helper, scope)
    def unwanted(*args):
        pytest.fail('Successful grading must not format diagnostics')
    scope['_schedule_feedback'] = unwanted
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec('header=' + checks, scope)
    assert output.getvalue() == 'OK\n'


@pytest.mark.parametrize('step', [1, 2, 3])
def test_real_learner_exception_keeps_original_type_message_and_single_call(task, step):
    calls = []
    reference = namespace(task)['parse_schedule']
    def broken(html):
        calls.append(html)
        if len(calls) == step:
            raise LookupError('learner code failed')
        return reference(html)
    with pytest.raises(LookupError, match='learner code failed'):
        exec(task['check']['append'], {'parse_schedule': broken})
    assert len(calls) == step


@pytest.mark.parametrize('code,kind,source', [
    ('def parse_schedule(html): return []', 'AssertionError', 'check'),
    ("def parse_schedule(html): raise ValueError('learner error')", 'ValueError', 'solution'),
    ("def parse_schedule(html): assert False, 'learner assertion'", 'AssertionError', 'solution'),
])
def test_actual_guest_runner_distinguishes_comparison_from_learner_exception(task, code, kind, source):
    runner = runpy.run_path(str(ROOT / 'platform/sandbox/runner.py'))
    events = []
    result = runner['execute']({'code': code, 'check': task['check']['append'],
                                'interactive': False, 'reportTests': True},
                               io.StringIO(), lambda kind, **data: events.append((kind, data)))
    failure = result['failure']
    assert (failure['type'], failure['source']) == (kind, source)
    assert failure['line']
    if source == 'check':
        assert 'Ожидалось:' in failure['message'] and 'Получено:' in failure['message']
    else:
        assert 'learner' in failure['message'] and 'Получено:' not in failure['message']
