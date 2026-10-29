"""String transformations preserve content; logical policies cover their boundaries."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def tasks():
    result = {task['id']: task for topic in build_tasks.parse() if topic['id'] in (4, 5) for task in topic['tasks']}
    assert len(result) == 21
    return result


def checked(task, code):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(code, namespace)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(task['check']['append'], namespace)
    assert output.getvalue().strip() == 'OK'


@pytest.mark.parametrize('task_id', ['4.3', '4.5', '4.7', '4.8', '4.10', '4.11', '5.6', '5.7', '5.9', '5.10'])
def test_reference_has_canonical_behavior_check(tasks, task_id):
    checked(tasks[task_id], build_tasks._reference_program(tasks[task_id]))


@pytest.mark.parametrize(('task_id', 'code'), [
    ('4.3', "s='HELLO WORLD'\nresult=s\nprint(result)"),
    ('4.5', 'def reverse(s):\n    return s.strip()[::-1]'),
    ('4.5', 'def reverse(s):\n    return s.lower()[::-1]'),
    ('4.7', "def shout(s):\n    return s.strip().upper()+'!'"),
    ('4.7', "def shout(s):\n    return s.upper().rstrip('!')+'!'"),
    ('4.8', "word='Облако'\nout='о 6 блако'\nprint(out)"),
    ('4.10', "def mask_phone(phone):\n    return phone[:2]+'******'+str(int(phone[-2:]))"),
    ('4.11', "def make_tag(text):\n    return '#'+text.strip().lower().replace(' ','-').replace(',','')"),
    ('5.6', "n=8\nok='True'\nprint(ok)"),
    ('5.7', "flags='(False, False, True)'\nprint(flags)"),
    ('5.9', 'def can_enter(age,has_ticket,banned):\n    return age in (16,18) and has_ticket and not banned'),
    ('5.10', 'def has_discount(total,member,clearance):\n    return member and not clearance or total == 1000'),
    ('5.10', 'def has_discount(total,member,clearance):\n    return (member or total >= 1000) and not (member and clearance)'),
])
def test_incorrect_transformations_and_incomplete_policies_are_rejected(tasks, task_id, code):
    with pytest.raises(AssertionError):
        checked(tasks[task_id], code)


@pytest.mark.parametrize(('task_id', 'code'), [
    ('4.3', "s='hello world'\nresult=str.upper(s)\nprint(result)"),
    ('4.5', "def reverse(text):\n    return ''.join(reversed(text))"),
    ('4.7', "def shout(text):\n    upper=text.upper()\n    return f'{upper}!'"),
    ('4.8', "word='облако'\nfirst=word[:1]\nout=f'{first} {len(word)} {word[1:]}'\nprint(out)"),
    ('4.10', "def mask_phone(value):\n    return f'{value[0:2]}******{value[8:]}'"),
    ('4.11', "def make_tag(value):\n    clean=value.strip().lower()\n    return '#'+clean.replace(' ','-')"),
    ('5.6', 'n=8\nok=0 < n and not n%2\nprint(ok)'),
    ('5.7', "flags=bool(0), bool(''), bool('0')\nprint(flags)"),
    ('5.9', 'def can_enter(age,has_ticket,banned):\n    return not (age < 16 or not has_ticket or banned)'),
    ('5.10', 'def has_discount(total,member,clearance):\n    return not clearance and (total >= 1000 or member)'),
])
def test_equivalent_solutions_are_accepted(tasks, task_id, code):
    checked(tasks[task_id], code)


def test_articles_prepare_all_methods_and_have_visible_independent_results():
    support = build_tasks._load_support_content()
    for topic, examples_count, ordinary in ((4, 10, 9), (5, 9, 8)):
        article = support['theory'][str(topic)]
        examples = [example for section in article['sections'] for example in section['examples']]
        assert len(examples) == examples_count
        assert all('output' in example and not example.get('context') for example in examples)
        assert all(support['hints'].get(f'{topic}.{stage}') for stage in range(1, ordinary + 1))
    string_examples = [example['code'] for section in support['theory']['4']['sections'] for example in section['examples']]
    assert any("'*' * 4" in code for code in string_examples)
    assert any(".find('Ни')" in code for code in string_examples)
    assert any(".capitalize()" in code for code in string_examples)
    logic_examples = [example['code'] for section in support['theory']['5']['sections'] for example in section['examples']]
    assert any("'' or 'гость'" in code for code in logic_examples)
    assert any('n == 0 or 10 / n > 2' in code for code in logic_examples)


@pytest.mark.parametrize(('task_id', 'code', 'ok'), [
    ('4.5', 'def reverse(text):\n    return text[::-1]', True),
    ('4.5', 'def reverse(text):\n    return text.strip()[::-1]', False),
    ('5.10', 'def has_discount(total,member,clearance):\n    return not clearance and (member or total>=1000)', True),
    ('5.10', 'def has_discount(total,member,clearance):\n    return (member or total>=1000) and not (member and clearance)', False),
])
def test_real_runner_reports_canonical_loop_assertions_in_check_phase(tasks, task_id, code, ok):
    import importlib.util
    path = Path(__file__).resolve().parents[1] / 'sandbox_http_plots/runner.py'
    spec = importlib.util.spec_from_file_location('strings_logic_runner_test', path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    events = []
    result = runner.execute({'code': code, 'check': tasks[task_id]['check']['append'],
                             'interactive': False, 'reportTests': True}, io.StringIO(),
                            lambda kind, **data: events.append((kind, data)))
    assert result['user_stdout'] == ''
    assert any(kind == 'test_event' and data['event']['type'] == 'plan' for kind, data in events)
    if ok:
        assert result['error'] is None and result['check_stdout'] == 'OK\n'
    else:
        assert result['failure']['source'] == 'check' and result['failure']['type'] == 'AssertionError'
        assert 'Ожидалось:' in result['error'] and 'Получено:' in result['error']
