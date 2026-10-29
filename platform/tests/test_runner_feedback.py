"""The browser wrapper reports the actual failing line without rerunning code."""
import json
import re
from pathlib import Path


def test_worker_failure_metadata():
    source = (Path(__file__).resolve().parents[1] / 'static/runner-worker.js').read_text(encoding='utf-8')
    wrapper = re.search(r'const WRAPPER = `([\s\S]*?)`;', source).group(1)
    # The last expression is the value returned by Pyodide's runPythonAsync.
    body, result = wrapper.strip().rsplit('\n', 1)
    cases = [
        ("print('ok')", None, None),
        ("print('before')\n1 / 0", 'ZeroDivisionError', 2),
        ("def f():\n    return 1 / 0\n\nf()", 'ZeroDivisionError', 2),
        ("def f(:\n    pass", 'SyntaxError', 1),
        ("def f():\n    exec('bad syntax')\nf()", 'SyntaxError', 2),
        ("assert False, 'Вызов: f(2)\\nОжидалось: 4\\nПолучено: None'", 'AssertionError', 1),
    ]
    for code, kind, line in cases:
        namespace = {'_user_code': code}
        exec(body, namespace)
        stdout, error, failure, user_stdout, check_stdout = eval(result, namespace)
        assert user_stdout is check_stdout is None
        if kind is None:
            assert (stdout, error, failure) == ('ok\n', None, None)
        else:
            meta = json.loads(failure)
            assert (meta['type'], meta['line']) == (kind, line)
            assert kind in error and meta['message']
            if code.startswith('print'):
                assert stdout == 'before\n'
            if kind == 'AssertionError':
                assert 'Получено: None' in meta['message']


def test_worker_checks_keep_prints_separate_and_report_the_actual_source():
    source = (Path(__file__).resolve().parents[1] / 'static/runner-worker.js').read_text(encoding='utf-8')
    wrapper = re.search(r'const WRAPPER = `([\s\S]*?)`;', source).group(1)
    body, result = wrapper.strip().rsplit('\n', 1)
    cases = [
        ("def f(): return 2\nprint('OK')", "assert f() == 2\nprint('OK')", 'OK\n', 'OK\n', None, None),
        ("def f(): return 2\nprint(42)", "assert f() == 2\nprint('OK')", '42\n', 'OK\n', None, None),
        ("print('OK')", "assert f() == 2\nprint('OK')", 'OK\n', '', 'check', 1),
        ("def f(): return 0", "assert f() == 2, 'expected 2'", '', '', 'check', 1),
        ("def f():\n    assert False, 'inside function'", "f()", '', '', 'solution', 2),
        ("def f(): return 2", "def broken(:", '', '', 'check', 1),
    ]
    for code, check, user, tests, failed_source, line in cases:
        namespace = {'_user_code': code, '_tests_code': check}
        exec(body, namespace)
        stdout, error, failure, user_stdout, check_stdout = eval(result, namespace)
        assert (stdout, user_stdout, check_stdout) == (user + tests, user, tests)
        if failed_source is None:
            assert error is failure is None
        else:
            meta = json.loads(failure)
            assert (meta['source'], meta['line']) == (failed_source, line)


def test_worker_runs_solution_as_main_without_renaming_imports():
    source = (Path(__file__).resolve().parents[1] / 'static/runner-worker.js').read_text(encoding='utf-8')
    wrapper = re.search(r'const WRAPPER = `([\s\S]*?)`;', source).group(1)
    body, result = wrapper.strip().rsplit('\n', 1)
    code = "import math\nif __name__ == '__main__':\n    print(math.__name__, math.isqrt(9))"
    for check in ('', "assert __name__ == '__main__'\nassert math.__name__ == 'math'\nprint('OK')"):
        namespace = {'_user_code': code, '_tests_code': check}
        exec(body, namespace)
        stdout, error, failure, user_stdout, check_stdout = eval(result, namespace)
        assert error is failure is None
        assert stdout == 'math 3\n' + ('OK\n' if check else '')
        assert (user_stdout, check_stdout) == (('math 3\n', 'OK\n') if check else (None, None))


def test_worker_reports_real_assertions_and_stops_at_first_failure():
    source = (Path(__file__).resolve().parents[1] / 'static/runner-worker.js').read_text(encoding='utf-8')
    wrapper = re.search(r'const WRAPPER = `([\s\S]*?)`;', source).group(1)
    body, result = wrapper.strip().rsplit('\n', 1)
    check = "assert f(2) == 2\nassert f(3) == 6, 'Expected 6'\nassert f(4) == 4\nprint('OK')"
    events = []
    namespace = {'_user_code': "calls = []\ndef f(n):\n    calls.append(n)\n    return n",
                 '_tests_code': check, '_report_test': lambda event: events.append(json.loads(event))}
    import sys
    old_trace = sys.gettrace()
    exec(body, namespace)
    stdout, error, failure, user_stdout, check_stdout = eval(result, namespace)
    assert sys.gettrace() is old_trace
    assert namespace['_namespace']['calls'] == [2, 3]
    assert events[0]['type'] == 'plan'
    assert [test['line'] for test in events[0]['tests']] == [1, 2, 3]
    assert [(event['id'], event['state']) for event in events[1:]] == [
        (0, 'running'), (0, 'passed'), (1, 'running'), (1, 'failed')]
    assert events[-1]['message'] == 'Expected 6'
    assert json.loads(failure)['source'] == 'check'
    assert check_stdout == '' and 'AssertionError' in error


def test_worker_traces_multiline_assertions_and_repeated_loop_checks_once():
    source = (Path(__file__).resolve().parents[1] / 'static/runner-worker.js').read_text(encoding='utf-8')
    wrapper = re.search(r'const WRAPPER = `([\s\S]*?)`;', source).group(1)
    body, result = wrapper.strip().rsplit('\n', 1)
    events = []
    check = "for n in [1, 2]:\n    assert (\n        f(n) == n * 2\n    )\nassert calls == [1, 2]\nprint('OK')"
    namespace = {'_user_code': "calls = []\ndef f(n):\n    calls.append(n)\n    return n * 2",
                 '_tests_code': check, '_report_test': lambda event: events.append(json.loads(event))}
    exec(body, namespace)
    stdout, error, failure, user_stdout, check_stdout = eval(result, namespace)
    assert error is failure is None and check_stdout == 'OK\n'
    assert [event['state'] for event in events[1:]] == ['running', 'passed'] * 2
    assert events[0]['tests'][0]['line'] == 2


def test_worker_does_not_report_passed_checks_when_solution_fails():
    source = (Path(__file__).resolve().parents[1] / 'static/runner-worker.js').read_text(encoding='utf-8')
    wrapper = re.search(r'const WRAPPER = `([\s\S]*?)`;', source).group(1)
    body, result = wrapper.strip().rsplit('\n', 1)
    events = []
    namespace = {'_user_code': '1 / 0', '_tests_code': "assert True\nprint('OK')",
                 '_report_test': lambda event: events.append(json.loads(event))}
    exec(body, namespace)
    stdout, error, failure, user_stdout, check_stdout = eval(result, namespace)
    assert len(events) == 1 and events[0]['type'] == 'plan'
    assert json.loads(failure)['source'] == 'solution'
    assert user_stdout is check_stdout is None
