"""The introductory pandas report must not silently round or overflow Python ints."""
import contextlib
from copy import deepcopy
import io
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import build_tasks


def sales_stage():
    return next(task for topic in build_tasks.parse() for task in topic['tasks'] if task['id'] == '52.13')


CASES = [
    ([{'city': 'A', 'qty': 2**53 + 1, 'price': 1}, {'city': 'B', 'qty': None, 'price': 1}], {'A': 2**53 + 1}),
    ([{'city': 'A', 'qty': 1, 'price': 2**53 + 1}, {'city': 'B', 'qty': 2, 'price': None}], {'A': 2**53 + 1}),
    ([{'city': 'A', 'qty': 2**62, 'price': 4}], {'A': 2**64}),
    ([{'city': 'A', 'qty': 1, 'price': 2**62}, {'city': 'A', 'qty': 1, 'price': 2**62}], {'A': 2**63}),
    ([{'city': ' A ', 'qty': 10**40, 'price': 10**30}, {'city': 'A', 'qty': 1, 'price': 2}], {'A': 10**70 + 2}),
    ([{'city': 'B', 'qty': 2, 'price': 3}, {'city': 'A', 'qty': 1, 'price': 0}, {'city': 'B', 'qty': 2, 'price': 3}], {'A': 0, 'B': 12}),
    ([], {}),
    ([{'city': '', 'qty': 1, 'price': 2}, {'city': None, 'qty': 4, 'price': 8}], {}),
]


@pytest.mark.parametrize('rows,expected', CASES)
def test_sales_report_keeps_exact_integers_and_source(rows, expected):
    namespace = {}
    exec(sales_stage()['answer'], namespace)
    before = deepcopy(rows)
    actual = namespace['sales_totals'](rows)
    assert isinstance(actual, dict) and actual == expected
    assert list(actual) == sorted(expected)
    assert all(type(value) is int for value in actual.values())
    assert rows == before


@pytest.mark.parametrize('dtype', ['', ', dtype="int64"'])
def test_check_rejects_automatic_float_or_fixed_width_arithmetic(dtype):
    stage = sales_stage()
    faulty = stage['answer'].replace(', dtype=object)', dtype + ')', 1)
    assert faulty != stage['answer']
    with contextlib.redirect_stdout(io.StringIO()), pytest.raises((AssertionError, ValueError, TypeError, OverflowError)):
        exec(faulty + '\n' + stage['check']['append'], {})


def test_sales_check_accepts_reference_and_rejects_print_only():
    stage = sales_stage()
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(stage['answer'] + '\n' + stage['check']['append'], {})
    assert output.getvalue().strip() == 'OK'
    with contextlib.redirect_stdout(io.StringIO()), pytest.raises((AssertionError, NameError)):
        exec("print('OK')\n" + stage['check']['append'], {})


@pytest.mark.parametrize('alternative', ['columns', 'python_sum'])
def test_check_accepts_other_exact_pandas_implementations(alternative):
    stage = sales_stage()
    if alternative == 'columns':
        code = stage['answer'].replace(
            "pd.DataFrame(rows, columns=['city', 'qty', 'price'], dtype=object)",
            "pd.DataFrame({name: pd.Series([row[name] for row in rows], dtype=object) for name in ['city', 'qty', 'price']})",
        )
    else:
        code = stage['answer'].replace("['revenue'].sum()", "['revenue'].agg(lambda values: sum(values))")
    assert code != stage['answer']
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(code + '\n' + stage['check']['append'], {})
    assert output.getvalue().strip() == 'OK'


def test_theory_explains_numeric_limits_and_current_execution():
    stage = sales_stage()
    assert 'могут выходить за диапазон int64' in stage['prompt']
    assert 'до арифметики' in stage['hint']
    article = build_tasks._load_support_content()['theory']['52']
    section = article['sections'][3]
    assert len(section['examples']) == 7
    assert 'dtype=object' in section['text'] and '64 битами' in section['text']
    assert 'не скачивает' in article['sections'][0]['text']
    for example in section['examples'][2:4]:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exec(example['code'], {})
        assert output.getvalue().strip() == example['output']
