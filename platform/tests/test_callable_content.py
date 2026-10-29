"""Teaching contracts for decorators and independent function factories."""
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.mark.parametrize(('expected', 'passes'), [('OK', True), ('demo\nOK', True), ('wrong\nOK', False)])
def test_build_verifier_separates_only_function_check_output(monkeypatch, expected, passes):
    # The subprocess plumbing is portable; authored content is also checked in CPython3.14.
    monkeypatch.setattr(build_tasks, '_python314_command', lambda: [sys.executable])
    monkeypatch.setattr(build_tasks, '_load_support_content', lambda: {'checks': {}})
    task = {'id': '29.test', 'type': 'написать функцию', 'answer': "print('demo')\ndef value():\n    return 7",
            'check': {'append': "assert value() == 7\nprint('OK')", 'expect': expected}}
    if passes:
        assert build_tasks.verify_mobile_tasks([{'tasks': [task]}])['checked'] == 1
    else:
        with pytest.raises(AssertionError, match='29.test'):
            build_tasks.verify_mobile_tasks([{'tasks': [task]}])


@pytest.mark.parametrize('source_error', [True, False])
def test_captured_demo_does_not_hide_reference_or_check_errors(monkeypatch, source_error):
    monkeypatch.setattr(build_tasks, '_python314_command', lambda: [sys.executable])
    monkeypatch.setattr(build_tasks, '_load_support_content', lambda: {'checks': {}})
    task = {'id': '29.test', 'type': 'написать функцию',
            'answer': "print('demo')\nraise ValueError('broken reference')" if source_error else "print('demo')",
            'check': {'append': "assert False, 'broken check'\nprint('OK')", 'expect': 'OK'}}
    with pytest.raises(AssertionError, match='29.test'):
        build_tasks.verify_mobile_tasks([{'tasks': [task]}])


@pytest.fixture(scope='module')
def callable_tasks():
    tasks = {task['id']: task for topic in build_tasks.parse() if topic['id'] in (29, 30) for task in topic['tasks']}
    support = build_tasks._load_support_content()['checks']
    for task_id, task in tasks.items():
        if 'check' not in task and task_id in support:
            task['check'] = support[task_id]
    assert len(tasks) == 17
    return tasks


@pytest.mark.parametrize(('task_id', 'code'), [
    ('29.3', "def logged(fn):\n    def wrapper(*args, **kwargs):\n        try:\n            return fn(*args, **kwargs)\n        finally:\n            print('вызов')\n    return wrapper"),
    ('29.7', 'def twice(fn):\n    def wrapper(*args, **kwargs):\n        first = fn(*args, **kwargs)\n        fn(*args, **kwargs)\n        return first\n    return wrapper'),
    ('29.8', 'from functools import wraps\ndef count_calls(fn):\n    @wraps(fn)\n    def wrapper(*args, **kwargs):\n        wrapper.calls += 1\n        fn(*args, **kwargs)\n        return fn(*args, **kwargs)\n    wrapper.calls = 0\n    return wrapper'),
    ('30.2', 'def multiplier(k):\n    global factor\n    factor = k\n    return lambda x: x * factor'),
    ('30.3', 'def make_counter():\n    global count\n    count = 0\n    def step():\n        global count\n        count += 1\n        return count\n    return step'),
    ('30.6', 'def make_adder(n):\n    global offset\n    offset = n\n    return lambda x: x + offset'),
    ('30.8', 'def make_multipliers(factors):\n    global current_factors\n    current_factors = list(factors)\n    return [lambda value, i=i: value * current_factors[i] for i in range(len(current_factors))]'),
])
def test_checks_reject_lost_result_duplicate_calls_and_shared_state(callable_tasks, task_id, code):
    namespace = {}
    exec(code, namespace)
    with pytest.raises((AssertionError, IndexError)):
        exec(callable_tasks[task_id]['check']['append'], namespace)


def test_logged_checks_only_own_output_not_the_learners_demonstration(callable_tasks):
    assert callable_tasks['29.3']['check']['expect'] == 'OK'


@pytest.mark.parametrize('task_id', ['29.3', '29.6', '29.7', '29.8', '29.9', '30.2', '30.3', '30.6', '30.7', '30.8'])
def test_reference_passes_callable_checks(callable_tasks, task_id, capsys):
    task = callable_tasks[task_id]
    namespace = {}
    exec(build_tasks._reference_program(task), namespace)
    capsys.readouterr()
    exec(task['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


def test_fallback_finale_is_a_real_debugging_task(callable_tasks, capsys):
    task = callable_tasks['29.9']
    assert task['type'] == 'исправить ошибку' and task['finale'] == 2
    assert 'def fallback(default):' in task['code'] and '# TODO' not in task['code']
    namespace = {}
    exec(task['code'], namespace)
    with pytest.raises(AssertionError):
        exec(task['check']['append'], namespace)
    assert capsys.readouterr().out == ''


@pytest.mark.parametrize('defect', ['truthiness', 'wide_except', 'double_call'])
def test_fallback_finale_rejects_each_independent_defect(callable_tasks, defect):
    task = callable_tasks['29.9']
    code = build_tasks._reference_program(task)
    if defect == 'truthiness':
        code = code.replace('return func(*args, **kwargs)', 'return func(*args, **kwargs) or default')
    elif defect == 'wide_except':
        code = code.replace('except ValueError:', 'except Exception:')
    else:
        code = code.replace('return func(*args, **kwargs)', 'func(*args, **kwargs)\n                return func(*args, **kwargs)')
    namespace = {}
    exec(code, namespace)
    with pytest.raises(AssertionError):
        exec(task['check']['append'], namespace)


@pytest.mark.parametrize(('task_id', 'code'), [
    ('30.2', 'def multiplier(k):\n    return lambda x: x * k'),
    ('30.6', 'def make_adder(n):\n    return lambda x: x + n'),
    ('30.8', 'def make_multipliers(factors):\n    def make(factor):\n        return lambda value: value * factor\n    return [make(factor) for factor in factors]'),
])
def test_valid_alternatives_need_not_copy_reference(callable_tasks, task_id, code, capsys):
    namespace = {}
    exec(code, namespace)
    exec(callable_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'
