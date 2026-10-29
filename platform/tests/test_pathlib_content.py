"""Real private files and lexical paths, never learner or platform folders."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def pathlib_tasks():
    tasks = {t['id']: t for p in build_tasks.parse() if p['id'] == 46 for t in p['tasks']}
    checks = build_tasks._load_support_content()['checks']
    for task_id, task in tasks.items():
        if 'check' not in task and task_id in checks:
            task['check'] = checks[task_id]
    assert len(tasks) == 9
    return tasks


def bad_program(tasks, task_id, code):
    reference = build_tasks._reference_program(tasks[task_id])
    if code == 'known-suffixes':
        return reference.replace('return Path(source).with_suffix(".json").as_posix()', "p = Path(source)\n    return p.with_suffix('.json').as_posix() if p.suffix in ('.csv', '.gz', '.txt') else p.as_posix() + '.json'")
    if code == 'write-output':
        return reference.replace('return Path(source).with_suffix(".json").as_posix()', "p = Path(source).with_suffix('.json')\n    p.parent.mkdir(parents=True, exist_ok=True)\n    p.write_text('changed', encoding='utf-8')\n    return p.as_posix()")
    if code == 'ignore-path':
        return reference.replace('target = Path(path)', "target = Path('finale-notes/deep/note.txt')")
    if code == 'skip-empty':
        return reference.replace('target = Path(path)', 'if not text:\n        return 0\n    target = Path(path)')
    if code == 'replace-newlines':
        return reference.replace('return target.write_text(text, encoding="utf-8")', "target.write_text(text.replace('\\n', ' '), encoding='utf-8')\n    return len(text)")
    if code == 'clean-siblings':
        return reference.replace('return target.write_text(text, encoding="utf-8")', "for item in target.parent.iterdir():\n        if item.is_file() and item != target:\n            item.unlink()\n    return target.write_text(text, encoding='utf-8')")
    if code == 'hide-error':
        return reference.replace('def write_note(', 'def _write_note(') + '\ndef write_note(path, text):\n    try:\n        return _write_note(path, text)\n    except OSError:\n        return 0'
    return code


@pytest.mark.parametrize(('task_id', 'code'), [
    ('46.2', "from types import SimpleNamespace\npath = SimpleNamespace(as_posix=lambda: 'out/report.csv')\nprint(path.as_posix())"),
    ('46.4', "def is_python(path):\n    return str(path).endswith('.py')"),
    ('46.4', "from pathlib import Path\ndef is_python(path):\n    return Path(path).suffix in '.py'"),
    ('46.7', "from pathlib import Path\np = Path('wrong.txt')\nname = 'data.txt'\nprint(name)"),
    ('46.8', "def output_path(source):\n    text = str(source)\n    return (text.rsplit('.', 1)[0] if '.' in text else text) + '.json'"),
    ('46.8', 'known-suffixes'),
    ('46.8', 'write-output'),
    ('46.9', 'ignore-path'),
    ('46.9', 'skip-empty'),
    ('46.9', 'replace-newlines'),
    ('46.9', 'clean-siblings'),
    ('46.9', 'hide-error'),
])
def test_pathlib_checks_reject_old_false_accepts(pathlib_tasks, tmp_path, task_id, code):
    namespace = {'Path': Path}
    out = io.StringIO()
    with contextlib.chdir(tmp_path):
        with contextlib.redirect_stdout(out):
            exec(bad_program(pathlib_tasks, task_id, code), namespace)
        if 'check' not in pathlib_tasks[task_id]:
            expected = 'out/report.csv' if task_id == '46.2' else 'data.txt'
            assert out.getvalue().strip() != expected, 'Неверный объект пути прошёл прежнюю проверку одного вывода'
        else:
            with pytest.raises(AssertionError):
                exec(pathlib_tasks[task_id]['check']['append'], namespace)


@pytest.mark.parametrize('task_id', ['46.2', '46.4', '46.7', '46.8', '46.9'])
def test_pathlib_reference_passes(pathlib_tasks, tmp_path, task_id, capsys):
    namespace = {}
    with contextlib.chdir(tmp_path):
        with contextlib.redirect_stdout(io.StringIO()):
            exec(build_tasks._reference_program(pathlib_tasks[task_id]), namespace)
        exec(pathlib_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize(('task_id', 'code'), [
    ('46.4', "from pathlib import Path\ndef is_python(path):\n    return Path(path).suffix in {'.py'}"),
    ('46.7', "from pathlib import Path\np = Path('.') / 'data.txt'\nname = p.name"),
    ('46.8', "from pathlib import Path\ndef output_path(source):\n    p = Path(source)\n    return p.with_name(p.stem + '.json').as_posix()"),
    ('46.9', "from pathlib import Path\ndef write_note(path, text):\n    target = Path(path)\n    target.parent.mkdir(parents=True, exist_ok=True)\n    with target.open('w', encoding='utf-8') as stream:\n        return stream.write(text)"),
])
def test_pathlib_equivalent_construction_and_explicit_open_pass(pathlib_tasks, tmp_path, task_id, code, capsys):
    namespace = {}
    with contextlib.chdir(tmp_path):
        exec(code, namespace)
        exec(pathlib_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


def test_pathlib_examples_are_visible_deterministic_and_have_hints():
    support = build_tasks._load_support_content()
    examples = [e for s in support['theory']['46']['sections'] for e in s['examples']]
    assert len(examples) == 8
    assert all(e.get('output') and not e.get('context') and not e.get('outputKind') for e in examples)
    assert all(support['hints'].get(f'46.{i}') for i in range(1, 8))
