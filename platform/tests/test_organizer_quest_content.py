"""The plan is pure data; the supplied local copier refuses unsafe/repeated work."""
import ast
import contextlib
import io
import json
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import build_tasks


def stage():
    source = build_tasks.SRC.read_text(encoding='utf-8').split('\n## Мини-квесты на своём компьютере\n', 1)[1]
    return next(q for q in json.loads(build_tasks.first_fence(source)[1]) if q['id'] == 'practice_file_organizer')['stages'][0]


def copier_namespace():
    tree = ast.parse(stage()['local_practice']['guide'][3]['code'])
    tree.body = [node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef))]
    namespace = {}
    exec(compile(tree, '<trusted local guide>', 'exec'), namespace)
    return namespace


def test_requirements_include_collections_and_real_file_fundamentals():
    source = build_tasks.SRC.read_text(encoding='utf-8').split('\n## Мини-квесты на своём компьютере\n', 1)[1]
    quest = next(q for q in json.loads(build_tasks.first_fence(source)[1]) if q['id'] == 'practice_file_organizer')
    assert {9, 11, 17, 19, 46} <= set(quest['unlock_topics'])
    assert quest['stages'][0]['requirements']['topics'] == quest['unlock_topics']


def source_folder(tmp_path):
    source = tmp_path / 'inbox'
    source.mkdir()
    (source / 'note.txt').write_bytes(b'original')
    return source


@pytest.mark.parametrize('variant', ['reference', 'alternative', 'empty', 'print_only', 'extension_case', 'collision', 'inplace'])
def test_plan_grading_contract(variant):
    item = stage()
    code = item['reference_code']
    if variant == 'alternative':
        code = code.replace('key=str.casefold', 'key=lambda name: name.casefold()')
    elif variant == 'empty':
        code = item['starter_code']
    elif variant == 'print_only':
        code = "print('OK')"
    elif variant == 'extension_case':
        code = code.replace('.suffix.lower()', '.suffix')
    elif variant == 'collision':
        code = code.replace('if key in seen:', 'if False:')
    elif variant == 'inplace':
        code = code.replace('for name in sorted(names, key=str.casefold):', 'names.sort(key=str.casefold)\n    for name in names:')
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        if variant in ('reference', 'alternative'):
            exec(code + '\n' + item['check']['append'], {})
        else:
            with pytest.raises((AssertionError, NameError)):
                exec(code + '\n' + item['check']['append'], {})
    if variant in ('reference', 'alternative'):
        assert output.getvalue().strip() == 'OK'


def test_copier_preserves_source_and_rejects_repeat(tmp_path):
    source = source_folder(tmp_path)
    target = tmp_path / 'organized'
    copy = copier_namespace()['copy_plan']
    plan = [('note.txt', 'documents/note.txt')]
    assert copy(source, target, plan) == 1
    assert (target / 'documents/note.txt').read_bytes() == (source / 'note.txt').read_bytes() == b'original'
    with pytest.raises(FileExistsError):
        copy(source, target, plan)
    assert (target / 'documents/note.txt').read_bytes() == b'original'


@pytest.mark.parametrize('plan', [
    [('note.txt', '../note.txt')], [('note.txt', '/documents/note.txt')],
    [('../note.txt', 'documents/../note.txt')], [('note.txt', 'other/different.txt')],
    [('note.txt', 'documents/./note.txt')], [('note.txt', 'unknown/note.txt')],
    [('note.txt', 'documents/note.txt'), ('note.txt', 'other/note.txt')],
    [('note.txt', 'documents/note.txt'), ('absent.txt', 'documents/absent.txt')],
])
def test_preflight_refuses_entire_bad_plan_before_creating_output(tmp_path, plan):
    source = source_folder(tmp_path)
    target = tmp_path / 'organized'
    with pytest.raises(ValueError):
        copier_namespace()['copy_plan'](source, target, plan)
    assert not target.exists() and (source / 'note.txt').read_bytes() == b'original'


def test_target_must_be_a_new_sibling_not_inside_source(tmp_path):
    source = source_folder(tmp_path)
    with pytest.raises(ValueError):
        copier_namespace()['copy_plan'](source, source / 'nested', [('note.txt', 'documents/note.txt')])
    assert not (source / 'nested').exists()


@pytest.mark.parametrize('kind', ['source', 'destination', 'file'])
def test_symlink_guard_simulated_without_windows_privileges(tmp_path, monkeypatch, kind):
    source = source_folder(tmp_path)
    target = tmp_path / 'organized'
    flagged = {'source': source, 'destination': target, 'file': source / 'note.txt'}[kind]
    actual = Path.is_symlink
    monkeypatch.setattr(Path, 'is_symlink', lambda path: path == flagged or actual(path))
    with pytest.raises((ValueError, FileExistsError)):
        copier_namespace()['copy_plan'](source, target, [('note.txt', 'documents/note.txt')])
    assert not target.exists() and (source / 'note.txt').read_bytes() == b'original'


def test_copy_failure_is_not_swallowed_and_source_is_untouched(tmp_path):
    source = source_folder(tmp_path)
    namespace = copier_namespace()
    def fail(reader, writer):
        raise OSError('simulated full disk')
    namespace['copyfileobj'] = fail
    target = tmp_path / 'organized'
    with pytest.raises(OSError, match='full disk'):
        namespace['copy_plan'](source, target, [('note.txt', 'documents/note.txt')])
    assert target.is_dir() and (source / 'note.txt').read_bytes() == b'original'
