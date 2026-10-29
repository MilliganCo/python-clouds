"""Text must become an exact integer before pandas can infer a lossy dtype."""
import contextlib
from copy import deepcopy
from decimal import localcontext
import io
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import build_tasks

NUMERIC_CASES = [
    (['9007199254740993', None, 'нет'], [9007199254740993, 0, 0]),
    ([str(10**70 + 3), str(-(10**70 + 1))], [10**70 + 3, -(10**70 + 1)]),
    (['2.0', '2e2', '20e-1', '-0'], [2, 200, 2, 0]),
    (['2.5', '-3.9', '9007199254740993.1'], [0, 0, 0]),
    (['NaN', 'sNaN', 'Infinity', '-inf', '', '   ', None], [0, 0, 0, 0, 0, 0, 0]),
    (['  +008 ', '-7', '1_000', '١٢', '2/1', '1__0'], [8, -7, 1000, 12, 0, 10]),
    ([], []),
]

CSV_CASES = [
    ('sku,stock,price\nA,9007199254740993,1\nB,bad,2\n', 0,
     [{'sku': 'A', 'stock': 9007199254740993, 'value': 9007199254740993}]),
    ('sku,stock,price\nA,1,9007199254740993\nB,2,bad\n', 0,
     [{'sku': 'A', 'stock': 1, 'value': 9007199254740993}]),
    (f'sku,stock,price\nA,{10**40+1},{10**40+3}\n', 0,
     [{'sku': 'A', 'stock': 10**40+1, 'value': (10**40+1)*(10**40+3)}]),
    ('sku,stock,price\nA,9007199254740992,1\nB,9007199254740993,1\n', 9007199254740993,
     [{'sku': 'B', 'stock': 9007199254740993, 'value': 9007199254740993}]),
    ('sku,stock,price\nA,9007199254740993.1,1\nB,2,1.0000000000000000000000000001\n', 0, []),
    ('sku,stock,price\nA,2.0,20e-1\nB,2e1,1.0\n', 0,
     [{'sku': 'B', 'stock': 20, 'value': 20}, {'sku': 'A', 'stock': 2, 'value': 4}]),
    ('sku,stock,price\nA,NaN,2\nB,1,inf\nC,sNaN,1\nD,1,-Infinity\n', 0, []),
    ('sku,stock,price\nNA,0,5\n001,1,0\n001,2,4\nslash,2/1,3\nunder,1__0,2\n', 0,
     [{'sku': 'under', 'stock': 10, 'value': 20}, {'sku': '001', 'stock': 2, 'value': 8}, {'sku': '001', 'stock': 1, 'value': 0}, {'sku': 'NA', 'stock': 0, 'value': 0}]),
    ('sku,stock,price\n', 0, []),
]


def task_by_id(task_id):
    return next(task for topic in build_tasks.parse() for task in topic['tasks'] if task['id'] == task_id)


@pytest.mark.parametrize('values,expected', NUMERIC_CASES)
def test_numeric_values_are_exact_whole_numbers(values, expected):
    namespace = {}
    exec(task_by_id('52.6')['answer'], namespace)
    before = deepcopy(values)
    with localcontext() as context:
        context.prec = 3
        actual = namespace['numeric_values'](values)
    assert isinstance(actual, list) and actual == expected
    assert all(type(value) is int for value in actual)
    assert values == before


@pytest.mark.parametrize('text,threshold,expected', CSV_CASES)
def test_csv_catalog_preserves_exact_values_and_threshold(text, threshold, expected):
    namespace = {}
    exec(task_by_id('52.14')['answer'], namespace)
    with localcontext() as context:
        context.prec = 3
        actual = namespace['csv_catalog'](text, threshold)
    assert isinstance(actual, list) and actual == expected
    assert all(type(row['stock']) is int and type(row['value']) is int for row in actual)


@pytest.mark.parametrize('task_id', ['52.6', '52.14'])
def test_canonical_checks_reject_print_only(task_id):
    task = task_by_id(task_id)
    check = task['check']
    with contextlib.redirect_stdout(io.StringIO()), pytest.raises((AssertionError, NameError)):
        exec("print('OK')\n" + check['append'], {})


@pytest.mark.parametrize('task_id', ['52.6', '52.14'])
def test_canonical_checks_accept_exact_reference(task_id):
    task = task_by_id(task_id)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(task['answer'] + '\n' + task['check']['append'], {})
    assert output.getvalue().strip() == 'OK'


@pytest.mark.parametrize('task_id,shortcut', [
    ('52.6', 'to_numeric'), ('52.6', 'float_first'),
    ('52.14', 'float_first'), ('52.14', 'late_object'), ('52.14', 'inferred_csv'),
    ('52.6', 'fraction_without_grammar'), ('52.14', 'fraction_without_grammar'),
])
def test_canonical_checks_reject_lossy_shortcuts(task_id, shortcut):
    task = task_by_id(task_id)
    code = task['answer']
    if shortcut == 'to_numeric':
        code = "import pandas as pd\ndef numeric_values(values):\n    raw = pd.Series(values, dtype='string')\n    return pd.to_numeric(raw, errors='coerce').fillna(0).astype('int64').to_list()"
    elif shortcut == 'float_first':
        code = code.replace('number = Decimal(text)', 'number = Decimal(str(float(text)))')
    elif shortcut == 'late_object':
        code = code.replace('index=df.index, dtype=object)', 'index=df.index).astype(object)')
    elif shortcut == 'fraction_without_grammar':
        code = code.replace('from decimal import Decimal, InvalidOperation', 'from fractions import Fraction')
        code = code.replace('number = Decimal(text)', 'number = Fraction(text)')
        code = code.replace('except (InvalidOperation, TypeError):', 'except (ValueError, ZeroDivisionError, TypeError):')
        code = code.replace('not number.is_finite() or number != number.to_integral_value()', 'number.denominator != 1')
        code = code.replace('return int(number)', 'return number.numerator')
    else:
        code = code.replace("dtype='string', keep_default_na=False", "dtype={'sku': 'string'}, keep_default_na=False")
    assert code != task['answer']
    with contextlib.redirect_stdout(io.StringIO()), pytest.raises((AssertionError, ValueError, TypeError, OverflowError)):
        exec(code + '\n' + task['check']['append'], {})


@pytest.mark.parametrize('task_id', ['52.6', '52.14'])
def test_exact_fraction_parser_is_an_allowed_alternative(task_id):
    task = task_by_id(task_id)
    code = task['answer'].replace('from decimal import Decimal, InvalidOperation', 'from fractions import Fraction')
    fallback = '0' if task_id == '52.6' else 'None'
    code = code.replace('            number = Decimal(text)', "            if '/' in text:\n                return " + fallback + "\n            number = Fraction(text.replace('_', ''))")
    code = code.replace('except (InvalidOperation, TypeError):', 'except (ValueError, ZeroDivisionError, TypeError):')
    code = code.replace('not number.is_finite() or number != number.to_integral_value()', 'number.denominator != 1')
    code = code.replace('return int(number)', 'return number.numerator')
    assert code != task['answer']
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(code + '\n' + task['check']['append'], {})
    assert output.getvalue().strip() == 'OK'


def test_already_parsed_integer_list_does_not_need_a_specific_series_dtype():
    task = task_by_id('52.6')
    code = task['answer'].replace(', dtype=object)', ')')
    assert code != task['answer']
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(code + '\n' + task['check']['append'], {})
    assert output.getvalue().strip() == 'OK'


def test_theory_explains_parse_policy_and_keeps_all_examples_standalone():
    support = build_tasks._load_support_content()
    assert '52.6' not in support['checks']
    examples = support['theory']['52']['sections'][3]['examples']
    assert len(examples) == 7
    for example in examples[4:]:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exec(example['code'], {})
        assert output.getvalue().strip() == example['output']
    for task_id in ('52.6', '52.14'):
        task = task_by_id(task_id)
        assert 'Decimal(text)' in task['prompt'] and 'NaN' in task['prompt']
        assert 'int64' in task['prompt']
