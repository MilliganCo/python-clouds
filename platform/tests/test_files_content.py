"""File content, line boundaries and preservation, in disposable test folders."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def tasks():
    result = {t['id']: t for p in build_tasks.parse() if p['id'] == 17 for t in p['tasks']}
    assert len(result) == 9
    return result


def checked(task, code, directory):
    ns = {}
    with contextlib.chdir(directory):
        with contextlib.redirect_stdout(io.StringIO()):
            exec(code, ns)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exec(task['check']['append'], ns)
        assert output.getvalue().strip() == 'OK'


@pytest.mark.parametrize('task_id', ['17.2', '17.6', '17.7', '17.8', '17.9'])
def test_references(tasks, tmp_path, task_id):
    checked(tasks[task_id], build_tasks._reference_program(tasks[task_id]), tmp_path)


@pytest.mark.parametrize(('task_id', 'code'), [
    ('17.2', "print('Привет, файл!')"),
    ('17.2', "with open('notes.txt','w',encoding='utf-8') as f:\n    f.write('Привет, файл!\\n')"),
    ('17.6', "with open('memo.txt','w',encoding='utf-8') as f:\n    f.write('утро\\n')\nwith open('memo.txt',encoding='utf-8') as f:\n    print(f.read())"),
    ('17.7', "from pathlib import Path\nPath('lines.txt').write_text('a\\nb\\n',encoding='utf-8')\nrows=\"['a', 'b']\"\nprint(rows)"),
    ('17.7', "from pathlib import Path\nPath('lines.txt').write_text('',encoding='utf-8')\nrows=['a','b']\nprint(rows)"),
    ('17.8', "def load_nonempty(path):\n    with open(path,encoding='utf-8') as f:\n        return [line.strip().replace(' ','') for line in f if line.strip()]"),
    ('17.8', "def load_nonempty(path):\n    with open(path,encoding='utf-8') as f:\n        rows=[line.strip() for line in f if line.strip()]\n    return list(dict.fromkeys(rows))"),
    ('17.8', "def load_nonempty(path):\n    with open(path,encoding='utf-8') as f:\n        rows=[line.strip() for line in f if line.strip()]\n    with open(path,'w',encoding='utf-8') as f:\n        f.write('')\n    return rows"),
    ('17.9', "def append_line(path,text):\n    with open(path,'a',encoding='utf-8') as f:\n        f.write(text.strip()+'\\n')"),
    ('17.9', "def append_line(path,text):\n    with open(path,'a',encoding='utf-8') as f:\n        f.write(text.rstrip('\\n')+'\\n')"),
    ('17.9', "def append_line(path,text):\n    with open(path,'a',encoding='utf-8') as f:\n        f.write(text+'\\n')\n    return 0"),
    ('17.9', "def append_line(path,text):\n    with open(path,'w',encoding='utf-8') as f:\n        f.write(text+'\\n')"),
])
def test_rejects_file_contract_errors(tasks, tmp_path, task_id, code):
    with pytest.raises(AssertionError):
        checked(tasks[task_id], code, tmp_path)


@pytest.mark.parametrize(('task_id', 'code'), [
    ('17.2', "with open('notes.txt','w',encoding='utf-8') as f:\n    f.writelines(['Привет, ', 'файл!'])"),
    ('17.6', "with open('memo.txt','w',encoding='utf-8') as f:\n    f.write('утро')\nwith open('memo.txt',encoding='utf-8') as f:\n    print(f.read())"),
    ('17.7', "from pathlib import Path\nPath('lines.txt').write_text('a\\nb\\n',encoding='utf-8')\nwith open('lines.txt',encoding='utf-8') as f:\n    rows=[line.rstrip('\\n') for line in f]\nprint(rows)"),
    ('17.8', "def load_nonempty(path):\n    with open(path,encoding='utf-8') as f:\n        lines=f.read().splitlines()\n    return [line.strip() for line in lines if line.strip()]"),
    ('17.9', "def append_line(path,text):\n    with open(path,'a',encoding='utf-8') as f:\n        print(text,file=f)"),
])
def test_equivalent_solutions(tasks, tmp_path, task_id, code):
    checked(tasks[task_id], code, tmp_path)


@pytest.mark.parametrize(('task_id', 'code', 'ok'), [
    ('17.2', None, True),
    ('17.6', None, True),
    ('17.7', "from pathlib import Path\nPath('lines.txt').write_text('a\\nb\\n',encoding='utf-8')\nrows=['a','b']", False),
    ('17.9', "def append_line(path,text):\n    with open(path,'a',encoding='utf-8') as f:\n        f.write(text.strip()+'\\n')", False),
])
def test_actual_runner_file_checks(tasks, tmp_path, task_id, code, ok):
    import importlib.util
    spec = importlib.util.spec_from_file_location('files_runner_test', Path(__file__).resolve().parents[1] / 'sandbox_http_plots/runner.py')
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    task = tasks[task_id]
    events = []
    with contextlib.chdir(tmp_path):
        result = runner.execute({'code': build_tasks._reference_program(task) if code is None else code,
                                 'check': task['check']['append'], 'interactive': False, 'reportTests': True},
                                io.StringIO(), lambda kind, **data: events.append((kind, data)))
    assert any(kind == 'test_event' and data['event']['type'] == 'plan' for kind, data in events)
    output = result['check_stdout'] if task['check']['expect'] == 'OK' else result['stdout']
    assert (result['error'] is None and build_tasks._normalized_output(output) == build_tasks._normalized_output(task['check']['expect'])) is ok


def test_with_explanation_given_existing_file(tasks, tmp_path):
    ns = {}
    (tmp_path / 'data.txt').write_text('сохранённый текст', encoding='utf-8')
    with contextlib.chdir(tmp_path):
        exec(tasks['17.3']['code'], ns)
    assert ns['f'].closed and ns['content'] == 'сохранённый текст'


@pytest.mark.parametrize('index', range(11))
def test_each_theory_example_runs_alone_in_actual_runner(tmp_path, index):
    import importlib.util
    spec = importlib.util.spec_from_file_location('file_example_runner_test', Path(__file__).resolve().parents[1] / 'sandbox_http_plots/runner.py')
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    examples = [e for s in build_tasks._load_support_content()['theory']['17']['sections'] for e in s['examples']]
    example = examples[index]
    with contextlib.chdir(tmp_path):
        result = runner.execute({'code': example['code'], 'check': '', 'interactive': False, 'reportTests': False},
                                io.StringIO(), lambda *args, **kwargs: None)
    assert result['stdout'].rstrip('\n') == example['output']
    if example.get('error'):
        assert example['error'] in result['error'] and result['failure']['source'] == 'solution'
    else:
        assert result['error'] is None


def test_theory_examples_are_independent_and_hints_complete():
    support = build_tasks._load_support_content()
    examples = [e for s in support['theory']['17']['sections'] for e in s['examples']]
    assert len(examples) == 11
    assert all(not e.get('context') and (e.get('output') or e.get('error')) for e in examples)
    assert all(support['hints'].get(f'17.{i}') for i in range(1, 8))
    assert '17.2' not in support['checks']


@pytest.mark.parametrize('topic_id', ['32', '33'])
def test_previously_dependent_class_example_runs_alone(tmp_path, topic_id):
    import importlib.util
    spec = importlib.util.spec_from_file_location('class_example_runner_test', Path(__file__).resolve().parents[1] / 'sandbox_http_plots/runner.py')
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    example = build_tasks._load_support_content()['theory'][topic_id]['sections'][0]['examples'][1]
    assert not example.get('context')
    with contextlib.chdir(tmp_path):
        result = runner.execute({'code': example['code'], 'check': '', 'interactive': False, 'reportTests': False},
                                io.StringIO(), lambda *args, **kwargs: None)
    assert result['error'] is None and result['stdout'].rstrip('\n') == example['output']


def test_all_python_theory_examples_have_no_hidden_setup():
    support = build_tasks._load_support_content()
    assert all(not e.get('context') for article in support['theory'].values() for s in article['sections'] for e in s['examples'] if e.get('codeLanguage') != 'shell')
