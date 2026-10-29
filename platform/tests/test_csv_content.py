"""CSV records are not physical lines; integer scores are not floats."""
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def tasks():
    return {t['id']: t for topic in build_tasks.parse() if topic['id'] == 49 for t in topic['tasks']}


def checked(task, code):
    namespace = {}
    with redirect_stdout(StringIO()):
        exec(code, namespace)
    out = StringIO()
    with redirect_stdout(out):
        exec(task['check']['append'], namespace)
    assert out.getvalue() == 'OK\n'
    return namespace


@pytest.mark.parametrize('task_id', ['49.8', '49.9'])
def test_unchanged_csv_references_pass(tasks, task_id):
    checked(tasks[task_id], build_tasks._reference_program(tasks[task_id]))


@pytest.mark.parametrize('code', [
    "import csv\ndef csv_names(text):\n    return [r['name'] for r in csv.DictReader(text.splitlines())]",
    "import csv,io\ndef csv_names(text):\n    return [r['name'].replace(chr(34),'') for r in csv.DictReader(io.StringIO(text))]",
    "import csv,io\ndef csv_names(text):\n    return [r['name'].strip() for r in csv.DictReader(io.StringIO(text))]",
    "import csv,io\ndef csv_names(text):\n    return sorted(set(r['name'] for r in csv.DictReader(io.StringIO(text))))",
    "import csv,io\ndef csv_names(text):\n    r=csv.reader(io.StringIO(text))\n    next(r,None)\n    return [row[0] for row in r]",
])
def test_csv_names_rejects_destroyed_fields_or_record_structure(tasks, code):
    with pytest.raises(AssertionError):
        checked(tasks['49.8'], code)


@pytest.mark.parametrize('defect', ['float_result', 'float_sum', 'unsigned_only', 'stop_at_invalid', 'physical_lines'])
def test_csv_scores_rejects_numeric_or_record_skipping_errors(tasks, defect):
    task = tasks['49.9']
    code = build_tasks._reference_program(task)
    if defect == 'float_result':
        code = code.replace('return total', 'return float(total)')
    elif defect == 'float_sum':
        code = code.replace('total = 0', 'total = 0.0')
    elif defect == 'unsigned_only':
        code = code.replace('total += int(row["score"])', 'total += int(row["score"]) if row["score"].isdigit() else 0')
    elif defect == 'physical_lines':
        code = code.replace('csv.DictReader(StringIO(text))', 'csv.DictReader(text.splitlines())')
    else:
        code = code.replace('            pass', '            return total')
    assert code != build_tasks._reference_program(task)
    with pytest.raises(AssertionError):
        checked(task, code)


@pytest.mark.parametrize(('task_id', 'code'), [
    ('49.8', "def csv_names(text):\n    import csv,io\n    records=csv.DictReader(io.StringIO(text))\n    return list(map(lambda r:r['name'], records))"),
    ('49.9', '''def csv_score_total(text):
    import csv,io
    values=[]
    for record in csv.DictReader(io.StringIO(text)):
        try:
            value=int(record['score'])
        except ValueError:
            continue
        values.append(value)
    return sum(values)'''),
])
def test_csv_checks_allow_equivalent_solutions(tasks, task_id, code):
    checked(tasks[task_id], code)


@pytest.mark.parametrize(('text', 'expected'), [
    ('name,score\n"два\nэтажа",3\n', ['два\nэтажа']),
    ('score,name\r\n3,"Лена ""Лис"", II"\r\n', ['Лена "Лис", II']),
    ('name,score\n a ,1\na,2\na,3\n', [' a ', 'a', 'a']),
])
def test_csv_names_expected_values_independent_of_authored_cases(tasks, text, expected):
    namespace = checked(tasks['49.8'], build_tasks._reference_program(tasks['49.8']))
    assert namespace['csv_names'](text) == expected


@pytest.mark.parametrize('fragment', ["print(repr(row['name'])", "Ира,7,лишнее"])
def test_csv_new_theory_examples_are_independent_and_show_output(fragment):
    article = build_tasks._load_support_content()['theory']['49']
    examples = [e for s in article['sections'] for e in s['examples'] if fragment in e['code']]
    assert len(examples) == 1
    example = examples[0]
    assert not example.get('context')
    output = StringIO()
    with redirect_stdout(output):
        exec(example['code'], {})
    assert output.getvalue().rstrip('\n') == example['output']


def test_csv_theory_describes_server_files_and_record_boundaries():
    article = build_tasks._load_support_content()['theory']['49']
    text = ' '.join(s['text'] for s in article['sections'])
    assert 'файловой системой в браузере' not in text
    assert 'одноразов' in text
    assert 'две кавычки' in text
    assert len([e for s in article['sections'] for e in s['examples']]) == 9
