"""Pipelines preserve exact totals, keys, versions and the declared date format."""
import contextlib
from copy import deepcopy
import io
from pathlib import Path
import random
import sys

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import build_tasks


def task_by_id(task_id):
    return next(task for topic in build_tasks.parse() for task in topic['tasks'] if task['id'] == task_id)


MATRIX_CASES = [
    ([{'day': 'D', 'sku': 'A', 'qty': 2**62}, {'day': 'D', 'sku': 'A', 'qty': 2**62}], {'D': {'A': 2**63}}),
    ([{'day': 'B', 'sku': 'Y', 'qty': 10**40}, {'day': 'A', 'sku': 'X', 'qty': 1}], {'A': {'X': 1, 'Y': 0}, 'B': {'X': 0, 'Y': 10**40}}),
    ([{'day': 'B', 'sku': 'X', 'qty': 0}, {'day': 'A', 'sku': 'Y', 'qty': 3}], {'A': {'X': 0, 'Y': 3}, 'B': {'X': 0, 'Y': 0}}),
    ([], {}),
]
REVENUE_CASES = [
    ([{'sku': 'A', 'qty': 2**62}], [{'sku': 'A', 'price': 4}], {'A': 2**64}),
    ([{'sku': 'A', 'qty': 1}, {'sku': 'A', 'qty': 1}], [{'sku': 'A', 'price': 2**62}], {'A': 2**63}),
    ([{'sku': ' A ', 'qty': 10**40}], [{'sku': ' A ', 'price': 10**30}], {' A ': 10**70}),
    ([], [{'sku': 'A', 'price': 0}], {}),
]
REPORT_CASES = [
    ([{'event_id': 'A', 'date': '2026-10-01', 'amount': 2**62, 'revision': 0}, {'event_id': 'B', 'date': '2026-10-01', 'amount': 2**62, 'revision': 0}], '2026-10-01', '2026-10-02', [{'day': '2026-10-01', 'amount': 2**63}, {'day': '2026-10-02', 'amount': 0}]),
    ([{'event_id': 'A', 'date': '0007-01-01', 'amount': 10**40, 'revision': 0}], '0007-01-01', '0007-01-02', [{'day': '0007-01-01', 'amount': 10**40}, {'day': '0007-01-02', 'amount': 0}]),
    ([{'event_id': 'A', 'date': '9999-12-31', 'amount': 1, 'revision': 0}], '9999-12-30', '9999-12-31', [{'day': '9999-12-30', 'amount': 0}, {'day': '9999-12-31', 'amount': 1}]),
    ([{'event_id': 'A', 'date': '0001-01-01', 'amount': 2, 'revision': 0}, {'event_id': 'B', 'date': '9999-12-31', 'amount': 3, 'revision': 0}], '2026-10-01', '2026-10-01', [{'day': '2026-10-01', 'amount': 0}]),
    ([{'event_id': 'A', 'date': '2026-10-01', 'amount': 2, 'revision': 2**63}, {'event_id': 'A', 'date': '2026-10-02', 'amount': 3, 'revision': 2**63+1}], '2026-10-01', '2026-10-02', [{'day': '2026-10-01', 'amount': 0}, {'day': '2026-10-02', 'amount': 3}]),
    ([], '0001-01-01', '0001-01-01', [{'day': '0001-01-01', 'amount': 0}]),
]
BAD_DATES = ['2026-1-1', '20261001', '2026-W01-1', '2026-10-01T00:00:00', ' 2026-10-01', '2026-02-30', '0000-01-01', None, 20261001]


def load_function(task_id, name):
    namespace = {}
    exec(build_tasks._reference_program(task_by_id(task_id)), namespace)
    return namespace[name]


def test_missing_skus_ignores_reserved_and_unrelated_columns():
    function = load_function('53.3', 'missing_skus')
    orders = pd.DataFrame({'sku': ['X', ' A ', 'A', 'X'], '_merge': ['old']*4, 'price': [1]*4}, index=[4, 4, 9, 1])
    catalog = pd.DataFrame({'sku': ['A'], '_merge': ['catalog'], 'price': [8]})
    before_left, before_right = orders.copy(), catalog.copy()
    assert function(orders, catalog) == [' A ', 'X']
    pd.testing.assert_frame_equal(orders, before_left)
    pd.testing.assert_frame_equal(catalog, before_right)


@pytest.mark.parametrize('ordered,empty', [(True, None), (False, None), (True, 'orders'), (True, 'catalog')])
def test_missing_skus_sorts_labels_not_categories(ordered, empty):
    dtype = pd.CategoricalDtype(['Z', 'X', 'A', ' A ', 'unused'], ordered=ordered)
    orders = pd.DataFrame({'sku': pd.Series(['Z', 'X', ' A ', 'Z'], dtype=dtype)})
    catalog = pd.DataFrame({'sku': pd.Series(['A'], dtype=dtype)})
    if empty == 'orders':
        orders = orders.iloc[:0]
    elif empty == 'catalog':
        catalog = catalog.iloc[:0]
    before_left, before_right = orders.copy(), catalog.copy()
    assert load_function('53.3', 'missing_skus')(orders, catalog) == ([] if empty == 'orders' else [' A ', 'X', 'Z'])
    pd.testing.assert_frame_equal(orders, before_left)
    pd.testing.assert_frame_equal(catalog, before_right)


@pytest.mark.parametrize('ordered,empty', [(True, False), (False, False), (True, True)])
def test_matrix_sorts_observed_labels_not_categories(ordered, empty):
    frame = pd.DataFrame({
        'day': pd.Categorical(['B', 'A', 'A'], categories=['unused', 'B', 'A'], ordered=ordered),
        'sku': pd.Categorical(['Y', ' X ', ' X '], categories=['Y', ' X ', 'unused'], ordered=ordered),
        'qty': [1, 2**62, 2**62],
    })
    if empty:
        frame = frame.iloc[:0]
    before = frame.copy()
    actual = load_function('53.6', 'daily_matrix')(frame)
    expected = {} if empty else {'A': {' X ': 2**63, 'Y': 0}, 'B': {' X ': 0, 'Y': 1}}
    assert actual == expected
    assert list(actual) == list(expected)
    assert all(list(row) == [' X ', 'Y'] for row in actual.values())
    assert all(type(value) is int for row in actual.values() for value in row.values())
    pd.testing.assert_frame_equal(frame, before)


@pytest.mark.parametrize('rows,expected', MATRIX_CASES)
def test_matrix_sums_exactly_and_does_not_change_dtype(rows, expected):
    frame = pd.DataFrame(rows, columns=['day', 'sku', 'qty'])
    before = frame.copy()
    actual = load_function('53.6', 'daily_matrix')(frame)
    assert actual == expected
    assert all(type(value) is int for row in actual.values() for value in row.values())
    pd.testing.assert_frame_equal(frame, before)


@pytest.mark.parametrize('orders,catalog,expected', REVENUE_CASES)
def test_checked_revenue_keeps_large_products_and_totals(orders, catalog, expected):
    before = deepcopy((orders, catalog))
    actual = load_function('53.13', 'checked_revenue')(orders, catalog)
    assert actual == expected and all(type(value) is int for value in actual.values())
    assert (orders, catalog) == before


@pytest.mark.parametrize('events,start,end,expected', REPORT_CASES)
def test_report_keeps_calendar_exactness_and_original_events(events, start, end, expected):
    before = deepcopy(events)
    actual = load_function('53.14', 'daily_report')(events, start, end)
    assert actual == expected and all(type(row['amount']) is int for row in actual)
    assert events == before


@pytest.mark.parametrize('bad_date', BAD_DATES)
def test_report_rejects_invalid_date_even_in_old_version(bad_date):
    events = [{'event_id': 'A', 'date': bad_date, 'amount': 1, 'revision': 0}, {'event_id': 'A', 'date': '2026-10-01', 'amount': 2, 'revision': 1}]
    before = deepcopy(events)
    with pytest.raises(ValueError):
        load_function('53.14', 'daily_report')(events, '2026-10-01', '2026-10-01')
    assert events == before


def test_latest_rows_uses_input_order_for_many_equal_versions():
    rows = [{'id': chr(65+i%5), 'version': i%4, 'value': i} for i in range(120)]
    random.Random(1).shuffle(rows)
    expected = {}
    for row in rows:
        if row['id'] not in expected or row['version'] >= expected[row['id']]['version']:
            expected[row['id']] = dict(row)
    before = deepcopy(rows)
    assert load_function('53.9', 'latest_rows')(rows) == [expected[key] for key in sorted(expected)]
    assert rows == before


@pytest.mark.parametrize('task_id', ['53.3', '53.6', '53.9', '53.13', '53.14'])
def test_canonical_pipeline_checks_accept_reference(task_id):
    task = task_by_id(task_id)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(build_tasks._reference_program(task) + '\n' + task['check']['append'], {})
    assert output.getvalue().strip() == 'OK'


@pytest.mark.parametrize('task_id', ['53.3', '53.6', '53.9', '53.13', '53.14'])
def test_canonical_pipeline_checks_reject_print_only(task_id):
    task = task_by_id(task_id)
    with contextlib.redirect_stdout(io.StringIO()), pytest.raises((AssertionError, NameError)):
        exec("print('OK')\n" + task['check']['append'], {})


@pytest.mark.parametrize('task_id', ['53.3', '53.6', '53.9', '53.13', '53.14', 'iso_guard'])
def test_pipeline_checks_reject_wrong_implementation(task_id):
    task = task_by_id('53.14' if task_id == 'iso_guard' else task_id)
    code = build_tasks._reference_program(task)
    if task_id == '53.3':
        wrong = code.replace("orders[['sku']].merge(catalog[['sku']],", 'orders.merge(catalog,')
    elif task_id == '53.6':
        wrong = code.replace("    work['qty'] = work['qty'].astype(object)\n", '')
    elif task_id == '53.9':
        wrong = code.replace("drop_duplicates('id', keep='last')", "drop_duplicates('id', keep='first')")
    elif task_id == 'iso_guard':
        wrong = code.replace("    if not df['date'].map(is_iso_day).all():\n        raise ValueError('Дата должна быть корректной строкой YYYY-MM-DD')\n", '')
    else:
        wrong = code.replace(', dtype=object)', ')')
    assert wrong != code
    with contextlib.redirect_stdout(io.StringIO()), pytest.raises((AssertionError, ValueError, OverflowError, TypeError)):
        exec(wrong + '\n' + task['check']['append'], {})


@pytest.mark.parametrize('task_id', ['53.3', '53.6', '53.9', '53.13', '53.14'])
def test_pipeline_checks_allow_equivalent_implementation(task_id):
    task = task_by_id(task_id)
    code = build_tasks._reference_program(task)
    variants = {
        '53.3': lambda s: s.replace("missing.astype('string').drop_duplicates().sort_values().to_list()", 'sorted(set(missing))'),
        '53.6': lambda s: s.replace("aggfunc='sum'", 'aggfunc=lambda values: sum(values)'),
        '53.9': lambda s: s.replace("kind='stable'", "kind='mergesort'"),
        '53.13': lambda s: s.replace("['revenue'].sum()", "['revenue'].agg(lambda values: sum(values))"),
        '53.14': lambda s: s.replace('day.date().isoformat()', "f'{day.year:04d}-{day.month:02d}-{day.day:02d}'"),
    }
    alternative = variants[task_id](code)
    assert alternative != code
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(alternative + '\n' + task['check']['append'], {})
    assert output.getvalue().strip() == 'OK'


@pytest.mark.parametrize('task_id,missing_line', [
    ('53.3', "missing.astype('string')"),
    ('53.6', "    work['day'] = work['day'].astype('string')\n"),
    ('53.6', "    work['sku'] = work['sku'].astype('string')\n"),
])
def test_canonical_checks_reject_category_order(task_id, missing_line):
    task = task_by_id(task_id)
    code = build_tasks._reference_program(task)
    wrong = code.replace(missing_line, 'missing' if task_id == '53.3' else '')
    assert wrong != code
    with contextlib.redirect_stdout(io.StringIO()), pytest.raises(AssertionError):
        exec(wrong + '\n' + task['check']['append'], {})


@pytest.mark.parametrize('task_id,name,args', [
    ('53.13', 'checked_revenue', ([], [{'sku': 'A', 'price': -1}])),
    ('53.14', 'daily_report', ([{'event_id': 'A', 'date': '2026-1-1', 'amount': 1, 'revision': 0}], '2026-01-01', '2026-01-01')),
])
def test_mandatory_validation_survives_optimized_python(task_id, name, args):
    namespace = {}
    exec(compile(build_tasks._reference_program(task_by_id(task_id)), '<trusted reference>', 'exec', optimize=2), namespace)
    with pytest.raises(ValueError):
        namespace[name](*args)


def test_pipeline_theory_examples_and_catalog_validation():
    support = build_tasks._load_support_content()
    assert all(key not in support['checks'] for key in ('53.3', '53.6', '53.9'))
    article = support['theory']['53']
    for index in (3, 4, 5):
        example = article['sections'][index]['examples'][-1]
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exec(example['code'], {})
        assert output.getvalue().strip() == example['output']
    example = article['sections'][10]['examples'][0]
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(example['code'], namespace)
    with pytest.raises(ValueError):
        namespace['check_catalog'](pd.DataFrame({'sku': [''], 'price': [0]}))


def report_defect(code, defect):
    """One semantic defect at a time, retaining the rest of the reference contract."""
    if defect == 'period_before_version':
        old = (
            "    latest = df.sort_values('revision', kind='stable').drop_duplicates('event_id', keep='last')\n"
            "    calendar = pd.date_range(start, end, freq='D')\n"
            "    current = latest.loc[latest['date'].between(calendar[0], calendar[-1])]"
        )
        new = (
            "    calendar = pd.date_range(start, end, freq='D')\n"
            "    current = df.loc[df['date'].between(calendar[0], calendar[-1])]\n"
            "    latest = current.sort_values('revision', kind='stable').drop_duplicates('event_id', keep='last')\n"
            "    current = latest"
        )
    elif defect == 'first_version':
        old, new = "drop_duplicates('event_id', keep='last')", "drop_duplicates('event_id', keep='first')"
    elif defect == 'observed_calendar':
        old, new = 'daily.reindex(calendar, fill_value=0)', 'daily.reindex(daily.index, fill_value=0)'
    else:
        raise ValueError(defect)
    assert code.count(old) == 1
    return code.replace(old, new, 1)


def test_report_finale_has_a_real_broken_program_instead_of_an_empty_function():
    task = task_by_id('53.14')
    assert task['type'] == 'исправить ошибку'
    assert task['finale'] == 2 and '# TODO' not in task['code']
    namespace = {}
    exec(task['code'], namespace)
    # A plausible happy path works; the task is repairing behavior, not syntax or a pass stub.
    event = {'event_id': 'A', 'date': '2026-10-01', 'amount': 12, 'revision': 1}
    assert namespace['daily_report']([event], '2026-10-01', '2026-10-01') == [{'day': '2026-10-01', 'amount': 12}]
    with contextlib.redirect_stdout(io.StringIO()), pytest.raises(AssertionError):
        exec(task['check']['append'], namespace)


@pytest.mark.parametrize('defect', ['period_before_version', 'first_version', 'observed_calendar'])
def test_existing_report_checks_reject_each_independent_debugging_defect(defect):
    task = task_by_id('53.14')
    code = report_defect(build_tasks._reference_program(task), defect)
    with contextlib.redirect_stdout(io.StringIO()), pytest.raises(AssertionError):
        exec(code + '\n' + task['check']['append'], {})


def test_report_debugging_accepts_reversed_stable_selection():
    task = task_by_id('53.14')
    code = build_tasks._reference_program(task)
    old = "df.sort_values('revision', kind='stable').drop_duplicates('event_id', keep='last')"
    new = "df.iloc[::-1].sort_values('revision', ascending=False, kind='stable').drop_duplicates('event_id', keep='first')"
    assert code.count(old) == 1
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(code.replace(old, new, 1) + '\n' + task['check']['append'], {})
    assert output.getvalue().strip() == 'OK'
