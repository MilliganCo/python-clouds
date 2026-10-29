"""Native argparse behavior, without reading the server's process arguments."""
import contextlib
import io
from pathlib import Path
import subprocess
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def argparse_tasks():
    tasks = {t['id']: t for p in build_tasks.parse() if p['id'] == 50 for t in p['tasks']}
    checks = build_tasks._load_support_content()['checks']
    for task_id, task in tasks.items():
        if 'check' not in task and task_id in checks:
            task['check'] = checks[task_id]
    assert len(tasks) == 9
    return tasks


def bad_program(tasks, task_id, code):
    reference = build_tasks._reference_program(tasks[task_id])
    if code == 'bool-count':
        return reference.replace('return args.file, args.count, args.verbose', 'return args.file, (True if args.count == 1 else args.count), args.verbose')
    if code == 'clamp-count':
        return reference.replace('return args.file, args.count, args.verbose', 'return args.file, max(0, args.count), args.verbose')
    if code in ('reverse-only', 'reject-repeat'):
        program = reference.replace('def parse_mode(', 'def _real_mode(')
        if code == 'reverse-only':
            return program + "\ndef parse_mode(argv):\n    if argv == ['--safe', '--fast']:\n        return 'fast'\n    return _real_mode(argv)"
        return program + "\ndef parse_mode(argv):\n    if len(argv) > 1 and len(set(argv)) == 1:\n        argparse.ArgumentParser().error('repeated flag')\n    return _real_mode(argv)"
    return code


@pytest.mark.parametrize(('task_id', 'code'), [
    ('50.2', "def build_cmd(name, verbose):\n    return 'run ' + name.lower() + (' --verbose' if verbose else '')"),
    ('50.4', 'def has_flag(argv, flag):\n    return flag.lower() in [value.lower() for value in argv]'),
    ('50.4', 'def has_flag(argv, flag):\n    result = flag in argv\n    argv.clear()\n    return result'),
    ('50.7', "import argparse\nparser = argparse.ArgumentParser()\nargs = argparse.Namespace(count=3)\nprint(args.count)"),
    ('50.7', "import argparse\nparser = argparse.ArgumentParser()\nparser.add_argument('--count', default=1)\nargs = parser.parse_args(['--count', '3'])\nprint(args.count)"),
    ('50.7', "import argparse\nparser = argparse.ArgumentParser()\nparser.add_argument('--count', type=int, default=99)\nargs = parser.parse_args(['--count', '3'])\nprint(args.count)"),
    ('50.8', 'bool-count'),
    ('50.8', 'clamp-count'),
    ('50.8', "def parse_options(argv):\n    values = argv.copy()\n    verbose = '--verbose' in values\n    if verbose:\n        values.remove('--verbose')\n    count = 1\n    if '--count' in values:\n        index = values.index('--count')\n        count = int(values[index + 1])\n        del values[index:index + 2]\n    return values[0], count, verbose"),
    ('50.9', "def parse_mode(argv):\n    if '--fast' in argv and '--safe' in argv:\n        raise SystemExit(2)\n    return 'fast' if '--fast' in argv else 'safe' if '--safe' in argv else 'normal'"),
    ('50.9', 'reverse-only'),
    ('50.9', 'reject-repeat'),
])
def test_argparse_checks_reject_old_false_accepts(argparse_tasks, task_id, code):
    namespace = {}
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        exec(bad_program(argparse_tasks, task_id, code), namespace)
    if 'check' not in argparse_tasks[task_id]:
        # Before this regression, the ordinary --count stage compared stdout only.
        assert out.getvalue().strip() != '3', 'Неверная настройка парсера прошла старую проверку вывода'
    else:
        with pytest.raises(AssertionError):
            exec(argparse_tasks[task_id]['check']['append'], namespace)


@pytest.mark.parametrize('task_id', ['50.2', '50.4', '50.7', '50.8', '50.9'])
def test_argparse_references_pass(argparse_tasks, task_id, capsys):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(build_tasks._reference_program(argparse_tasks[task_id]), namespace)
    exec(argparse_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize(('task_id', 'code'), [
    ('50.4', 'def has_flag(argv, flag):\n    return any(value == flag for value in argv)'),
    ('50.7', "import argparse\nparser = argparse.ArgumentParser(prog='my-tool')\nparser.add_argument('--count', default=1, type=int)\nargs = parser.parse_args('--count 3'.split())"),
    ('50.8', '''import argparse
from collections import namedtuple
Options = namedtuple('Options', 'file count verbose')
def parse_options(argv):
    parser = argparse.ArgumentParser(prog='my-tool')
    parser.add_argument('path')
    parser.add_argument('--count', dest='number', type=int, default=1)
    parser.add_argument('--verbose', dest='loud', action='store_true')
    args = parser.parse_args(argv)
    return Options(args.path, args.number, args.loud)'''),
    ('50.9', '''import argparse
def parse_mode(argv):
    parser = argparse.ArgumentParser(prog='my-mode')
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--fast', dest='mode', action='store_const', const='fast')
    group.add_argument('--safe', dest='mode', action='store_const', const='safe')
    parser.set_defaults(mode='normal')
    return parser.parse_args(argv).mode'''),
])
def test_argparse_equivalent_actions_and_namespace_fields_pass(argparse_tasks, task_id, code, capsys):
    namespace = {}
    exec(code, namespace)
    exec(argparse_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize(('task_id', 'argv', 'status', 'output'), [
    ('50.8', ['my file.csv', '--count', '0', '--verbose'], 0, "('my file.csv', 0, True)"),
    ('50.8', ['x', '--count', 'bad'], 2, None),
    ('50.9', ['--safe', '--fast'], 2, None),
    ('50.9', ['--help'], 0, None),
])
def test_argparse_real_script_process_receives_cli_tokens(argparse_tasks, tmp_path, task_id, argv, status, output):
    function = 'parse_options' if task_id == '50.8' else 'parse_mode'
    script = tmp_path / 'tool.py'
    script.write_text(build_tasks._reference_program(argparse_tasks[task_id]) + '\nif __name__ == "__main__":\n    import sys\n    print(' + function + '(sys.argv[1:]))\n', encoding='utf-8')
    result = subprocess.run([sys.executable, '-I', '-X', 'utf8', str(script), *argv], cwd=tmp_path,
                            capture_output=True, text=True, encoding='utf-8', timeout=6)
    assert result.returncode == status
    if output is not None:
        assert result.stdout.strip() == output and not result.stderr
    elif status:
        assert result.stderr.strip()
    else:
        assert '--fast' in result.stdout and '--safe' in result.stdout


def test_argparse_examples_and_hints_are_visible_and_independent():
    support = build_tasks._load_support_content()
    examples = [e for s in support['theory']['50']['sections'] for e in s['examples']]
    assert len(examples) == 8
    assert all(e.get('output') and not e.get('context') for e in examples)
    assert all(support['hints'].get(f'50.{i}') for i in range(1, 8))
