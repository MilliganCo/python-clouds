"""Fixed teaching template: preserve text/data; don't confuse a report with a sanitizer."""
import contextlib
import io
import json
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import build_tasks


def quest():
    section = build_tasks.SRC.read_text(encoding='utf-8').split('\n## Мини-квесты на своём компьютере\n', 1)[1]
    return next(q for q in json.loads(build_tasks.first_fence(section)[1]) if q['id'] == 'practice_html_report')


def check_program(code, check):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(code + '\n' + check, {})
    return output.getvalue().strip()


@pytest.mark.parametrize('variant', ['reference', 'linebreaks', 'single_quotes', 'uppercase_charset'])
def test_equivalent_document_formats_are_accepted(variant):
    stage = quest()['stages'][0]
    code = stage['reference_code']
    if variant == 'linebreaks':
        code = code.replace("return ''.join(pieces)", "return '\\n'.join(pieces)")
    elif variant == 'single_quotes':
        code = code.replace("return ''.join(pieces)", "return ''.join(pieces).replace(chr(34), chr(39))")
    elif variant == 'uppercase_charset':
        code = code.replace('utf-8', 'UTF-8')
    assert check_program(code, stage['check']['append']) == 'OK'


@pytest.mark.parametrize('variant', ['starter', 'print_only', 'title_markup', 'name_markup', 'wrong_total', 'mutate', 'whole_escape', 'attribute', 'meta_text'])
def test_incorrect_or_active_markup_is_rejected(variant):
    stage = quest()['stages'][0]
    code = stage['reference_code']
    if variant == 'starter':
        code = stage['starter_code']
    elif variant == 'print_only':
        code = "print('OK')"
    elif variant == 'title_markup':
        code = code.replace('escape(title)', 'title')
    elif variant == 'name_markup':
        code = code.replace("escape(row['name'])", "row['name']")
    elif variant == 'wrong_total':
        code = code.replace("total += row['qty']", 'total += 1')
    elif variant == 'mutate':
        code = code.replace("return ''.join(pieces)", "rows.clear()\n    return ''.join(pieces)")
    elif variant == 'whole_escape':
        code = code.replace("return ''.join(pieces)", "return escape(''.join(pieces))")
    elif variant == 'attribute':
        code = code.replace('<h1>', '<h1 onclick="alert(1)">')
    elif variant == 'meta_text':
        code = code.replace('<meta charset="utf-8" />', '<meta charset="utf-8">hidden</meta>')
    output = io.StringIO()
    with contextlib.redirect_stdout(output), pytest.raises((AssertionError, NameError)):
        exec(code + '\n' + stage['check']['append'], {})


def test_report_function_returns_without_printing():
    namespace = {}
    exec(quest()['stages'][0]['reference_code'], namespace)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        document = namespace['render_report']('Тест', [{'name': 'A', 'qty': 2}])
    assert output.getvalue() == '' and isinstance(document, str)


def test_writer_creates_new_utf8_file_and_refuses_repeat(tmp_path):
    stage = quest()['stages'][0]
    code = stage['local_practice']['guide'][3]['code'].split('\nfrom tempfile import TemporaryDirectory', 1)[0]
    namespace = {}
    exec(code, namespace)
    target = tmp_path / 'report.html'
    document = '<p>Отчёт &amp; данные</p>'
    namespace['save_report'](target, document)
    assert target.read_text(encoding='utf-8') == document
    with pytest.raises(FileExistsError):
        namespace['save_report'](target, 'replacement')
    assert target.read_text(encoding='utf-8') == document


def test_prerequisites_include_actual_document_file_and_json_operations():
    course = quest()
    assert {2, 3, 4, 7, 8, 10, 17, 18, 23, 26, 43, 46} == set(course['unlock_topics'])
    assert course['stages'][0]['requirements']['topics'] == course['unlock_topics']
