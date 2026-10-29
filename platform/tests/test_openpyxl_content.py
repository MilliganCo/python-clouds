"""Saved XLSX semantics, literal IDs, rejection reasons and exclusive creation."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def stages():
    return {t['id']:t for p in build_tasks.parse() if p['id']==56 for t in p['tasks']}


def checked(task,code):
    stream=io.StringIO()
    with contextlib.redirect_stdout(stream):
        exec(code+'\n'+task['check']['append'],{})
    assert stream.getvalue().strip()=='OK'


@pytest.mark.parametrize('id',['56.2','56.4','56.5','56.7','56.8','56.9','56.10'])
def test_excel_references_and_incomplete_programs(stages,id):
    task=stages[id]
    checked(task,task['answer'])
    for wrong in (task['code'],"print('OK')"):
        with pytest.raises((AssertionError,NameError,TypeError,AttributeError,KeyError,NotImplementedError)):
            checked(task,wrong)


@pytest.mark.parametrize(('before','after'),[
    ('type(qty) is not int','not isinstance(qty,int)'),
    ('0 <= qty <= 10000','0 < qty <= 10000'),
    ('0 <= qty <= 10000','0 <= qty < 10000'),
    ("cells[0].data_type != 's' or ",' '),
    ('sku.strip(), qty','sku.strip().lstrip("0"), qty'),
    ("clean.cell(clean.max_row, 1).data_type = 's'",'pass'),
    ('max_col=3), 2)','max_col=3), 1)'),
])
def test_cleaning_check_rejects_independent_data_errors(stages,before,after):
    task=stages['56.9'];wrong=task['answer'].replace(before,after)
    assert wrong!=task['answer']
    with pytest.raises(AssertionError):checked(task,wrong)


@pytest.mark.parametrize(('before','after'),[
    ('data_only=False','data_only=True'),
    ("f'=SUM(D2:D{last})'","f'=SUM(D2:D{last+1})'"),
    ("page.auto_filter.ref = f'A1:D{last}'","page.auto_filter.ref = f'A1:D{last+1}'"),
    ("page.cell(number, 1).data_type = 's'",'pass'),
])
def test_report_checks_formula_cache_circular_total_filter_and_literal_text(stages,before,after):
    task=stages['56.10'];wrong=task['answer'].replace(before,after)
    assert wrong!=task['answer']
    with pytest.raises(AssertionError):checked(task,wrong)


def test_exclusive_create_catches_an_exists_then_write_race(stages):
    task=stages['56.8']
    unsafe=task['answer'].replace("with Path(path).open('xb') as stream:\n        book.save(stream)","if Path(path).exists():\n        raise FileExistsError(path)\n    book.save(path)")
    assert unsafe!=task['answer']
    with pytest.raises(AssertionError,match='исключительный режим'):
        checked(task,unsafe)


def test_correct_exclusive_os_open_alternative_is_accepted(stages):
    task=stages['56.8']
    alternative=task['answer'].replace("with Path(path).open('xb') as stream:","import os\n    descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)\n    with os.fdopen(descriptor,'wb') as stream:")
    checked(task,alternative)


def test_report_accepts_reversed_product(stages):
    task=stages['56.10']
    alternative=task['answer'].replace("f'=B{number}*C{number}'","f'=C{number}*B{number}'")
    checked(task,alternative)


def test_material_has_executable_results_and_specific_help():
    support=build_tasks._load_support_content()
    sections=support['theory']['56']['sections']
    assert len(sections)==12
    for section in sections:
        for ex in section['examples']:
            assert 'output' in ex and not ex.get('context')
    assert all(support['hints'].get(f'56.{i}') for i in range(1,9))
    assert all(support['intros'][f'56.{i}']['source']=='authored' for i in range(1,11))


@pytest.mark.parametrize('writer', ['os_exists', 'builtin_stream'])
def test_exclusive_creation_rejects_other_ordinary_write_apis(stages, writer):
    task = stages['56.8']
    original = "with Path(path).open('xb') as stream:\n        book.save(stream)"
    if writer == 'os_exists':
        replacement = "import os\n    if os.path.exists(path):\n        raise FileExistsError(path)\n    book.save(path)"
    else:
        replacement = "if Path(path).exists():\n        raise FileExistsError(path)\n    with open(path, 'wb') as stream:\n        book.save(stream)"
    unsafe = task['answer'].replace(original, replacement)
    assert unsafe != task['answer']
    with pytest.raises(AssertionError, match='исключительный режим'):
        checked(task, unsafe)
