"""Style and dependency text contracts; no package installation from pytest."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def style_tasks():
    tasks = {t['id']: t for p in build_tasks.parse() if p['id'] == 45 for t in p['tasks']}
    checks = build_tasks._load_support_content()['checks']
    for task_id, task in tasks.items():
        if 'check' not in task and task_id in checks:
            task['check'] = checks[task_id]
    assert len(tasks) == 18
    return tasks


def bad_program(tasks, task_id, code):
    reference = build_tasks._reference_program(tasks[task_id])
    if code == 'lower-name':
        return reference.replace("return req.split('==', 1)[0]", "return req.split('==', 1)[0].lower()")
    if code == 'split-dot':
        return reference.replace("return req.split('==', 1)[0]", "return req.split('==', 1)[0].split('.')[0]")
    if code == 'lower-command':
        return reference.replace("return 'pip install ' + package", "return 'pip install ' + package.lower()")
    if code == 'lower-version':
        return reference.replace("return name + '==' + ver", "return name + '==' + ver.lower()")
    if code == 'drop-local-version':
        return reference.replace("return name + '==' + ver", "return name + '==' + ver.split('+')[0]")
    if code == 'constant-five':
        return reference.replace('return a + b', 'return 5')
    if code == 'alias-old-name':
        return 'def CalcSum(a, b):\n    return a + b\ncalc_sum = CalcSum\ndel CalcSum\nprint(calc_sum(2, 3))'
    if code == 'two-passes':
        return reference.replace("    while '--' in result:\n        result = result.replace('--', '-')", "    result = result.replace('--', '-').replace('--', '-')")
    if code == 'strip-edges':
        return reference.replace('return result', "return result.strip('-')")
    if code == 'sort-lines':
        return 'def requirements_lines(packages):\n    return sorted(f"{name}=={version}" for name, version in packages.items())'
    if code == 'consume-packages':
        return reference.replace('packages[name]', 'packages.pop(name)')
    if code == 'normalize-name':
        return reference.replace('{name}==', '{name.lower()}==')
    return code


@pytest.mark.parametrize(('task_id', 'code'), [
    ('45.5', 'lower-name'),
    ('45.5', 'split-dot'),
    ('45.10', 'lower-command'),
    ('45.12', 'lower-version'),
    ('45.12', 'drop-local-version'),
    ('45.16', 'constant-five'),
    ('45.16', 'alias-old-name'),
    ('45.17', 'two-passes'),
    ('45.17', 'strip-edges'),
    ('45.18', 'sort-lines'),
    ('45.18', 'consume-packages'),
    ('45.18', 'normalize-name'),
])
def test_style_checks_reject_old_false_accepts(style_tasks, task_id, code):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(bad_program(style_tasks, task_id, code), namespace)
    with pytest.raises(AssertionError):
        exec(style_tasks[task_id]['check']['append'], namespace)


@pytest.mark.parametrize('task_id', ['45.5', '45.10', '45.12', '45.16', '45.17', '45.18'])
def test_style_references_pass(style_tasks, task_id, capsys):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(build_tasks._reference_program(style_tasks[task_id]), namespace)
    exec(style_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize(('task_id', 'code'), [
    ('45.5', "def package_name(req):\n    return req.partition('==')[0]"),
    ('45.12', 'def req_line(name, ver):\n    return f"{name}=={ver}"'),
    ('45.16', 'import operator\ndef calc_sum(a, b):\n    return operator.add(a, b)'),
    ('45.17', "import re\ndef package_key(name):\n    return re.sub(r'[-_.]+', '-', name).lower()"),
])
def test_style_equivalent_text_and_addition_pass(style_tasks, task_id, code, capsys):
    namespace = {}
    exec(code, namespace)
    exec(style_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


def test_style_python_examples_are_visible_and_shell_cards_are_honest():
    support = build_tasks._load_support_content()
    examples = [e for s in support['theory']['45']['sections'] for e in s['examples']]
    python = [e for e in examples if e.get('codeLanguage') != 'shell']
    shell = [e for e in examples if e.get('codeLanguage') == 'shell']
    assert len(python) == len(shell) == 4
    assert all(e.get('output') and not e.get('context') for e in python)
    assert all(e.get('resultNote') and 'output' not in e for e in shell)
    assert all(support['hints'].get(f'45.{i}') for i in range(1, 17))
