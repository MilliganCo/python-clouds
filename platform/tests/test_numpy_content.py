"""Numerical contracts cover shape, missing values, mutation and useful alternatives."""
import contextlib
import io
from pathlib import Path
import sys

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def stages():
    return {t['id']: t for p in build_tasks.parse() if p['id'] == 54 for t in p['tasks']}


def checked(stage, code):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        exec(code + '\n' + stage['check']['append'], {})
    assert out.getvalue().strip() == 'OK'


@pytest.mark.parametrize('task_id', ['54.2', '54.4', '54.5', '54.6', '54.8', '54.9', '54.10'])
def test_numpy_references_pass_and_starters_do_not(stages, task_id):
    stage = stages[task_id]
    checked(stage, stage['answer'])
    for code in (stage['code'], "print('OK')"):
        with pytest.raises((AssertionError, NameError, TypeError, AttributeError)):
            checked(stage, code)


@pytest.mark.parametrize(('task_id', 'code'), [
    ('54.5', 'import numpy as np\ndef outside_bounds(values, low, high):\n    return np.flatnonzero((values <= low) | (values >= high)).tolist()'),
    ('54.8', 'import numpy as np\ndef valid_mean(values):\n    return float(np.nan_to_num(values, nan=0., posinf=0., neginf=0.).mean()) if values.size else None'),
    ('54.9', 'import numpy as np\ndef row_shares(table):\n    a=np.array(table,dtype=float)\n    b=a.sum(axis=0,keepdims=True)\n    return np.divide(a,b,out=np.zeros_like(a),where=b!=0)'),
    ('54.10', 'import numpy as np\ndef column_means(readings):\n    clean=np.nan_to_num(readings, nan=0., posinf=0., neginf=0.)\n    return clean.mean(axis=0).tolist()'),
    ('54.10', 'import numpy as np\ndef column_means(readings):\n    result=[]\n    for col in readings.T:\n        valid=col[np.isfinite(col) & (col != 0)]\n        result.append(float(valid.mean()) if len(valid) else None)\n    return result'),
])
def test_checks_reject_boundary_axis_and_fake_zero_errors(stages, task_id, code):
    with pytest.raises(AssertionError):
        checked(stages[task_id], code)


@pytest.mark.parametrize(('task_id', 'code'), [
    ('54.6', 'def shifted_tail(values):\n    return values[1:] + 1'),
    ('54.9', '''import numpy as np
def row_shares(table):
    result = np.zeros(table.shape, dtype=np.float64)
    for i, row in enumerate(table):
        total = float(sum(row))
        if total:
            result[i] = row / total
    return result'''),
    ('54.10', '''import numpy as np
def column_means(readings):
    result = []
    for col in readings.T:
        valid = col[np.isfinite(col)]
        result.append(float(valid.mean()) if valid.size else None)
    return result'''),
])
def test_correct_alternatives_are_accepted(stages, task_id, code):
    checked(stages[task_id], code)


def test_numpy_theory_examples_and_hints_are_complete(stages):
    support = build_tasks._load_support_content()
    article = support['theory']['54']
    examples = [e for section in article['sections'] for e in section['examples']]
    assert len(examples) == 12
    for example in examples:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            exec(example['code'], {})
        assert out.getvalue().rstrip('\n') == example['output']
    assert all(support['hints'].get(f'54.{i}') for i in range(1, 9))
    assert [t.get('finale') for t in list(stages.values())[-2:]] == [1, 2]
    assert all(t.get('learning', {}).get('skills') for t in stages.values())


def test_column_means_handles_missing_columns_without_mutation(stages):
    ns = {}
    exec(stages['54.10']['answer'], ns)
    source = np.array([[np.nan, 0., 2.], [np.inf, 4., 8.], [-np.inf, 2., np.nan]])
    before = source.copy()
    assert ns['column_means'](source) == [None, 2., 5.]
    assert np.array_equal(source, before, equal_nan=True)
