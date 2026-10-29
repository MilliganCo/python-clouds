"""Beginner values must be checked separately from their printed appearance."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def foundation_tasks():
    tasks = {t['id']: t for p in build_tasks.parse() if p['id'] in (0, 1) for t in p['tasks']}
    assert len(tasks) == 19
    return tasks


@pytest.mark.parametrize(('task_id', 'code'), [
    ('1.1', "name='Аня'\nage='25'\nprint(name,age)"),
    ('1.5', "x='5'\ny='7'\nprint(y)"),
    ('1.6', "city='Тверь'\nyear='2026'\nprint(city,year)"),
    ('1.7', 'tickets=24.0\ntickets=tickets-7\ntickets=tickets+2\nprint(int(tickets))'),
])
def test_foundation_checks_reject_wrong_value_types(foundation_tasks, task_id, code):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(code, namespace)
    with pytest.raises(AssertionError):
        exec(foundation_tasks[task_id]['check']['append'], namespace)


@pytest.mark.parametrize('task_id', ['1.1', '1.5', '1.6', '1.7', '1.8'])
def test_foundation_references_pass(foundation_tasks, task_id, capsys):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(build_tasks._reference_program(foundation_tasks[task_id]), namespace)
    exec(foundation_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize(('task_id', 'code'), [
    ('1.1', "name,age='Аня',25"),
    ('1.5', "x='5'\nx=int(x)\ny=x+2\nprint(y)"),
    ('1.6', "city,year='Тверь',2026"),
    ('1.7', 'tickets=24\ntickets-=7\ntickets+=2\nprint(tickets)'),
    ('1.8', "item='чай'\nprice=80\nlabel=f'{item}: {price} руб.'\nprint(label)"),
    ('1.8', "item='чай'\nprice=80\nlabel='{}: {} руб.'.format(item,price)\nprint(label)"),
])
def test_foundation_equivalent_assignment_and_conversion_pass(foundation_tasks, task_id, code, capsys):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(code, namespace)
    exec(foundation_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize(('topic', 'count', 'ordinary'), [(0, 7, 9), (1, 8, 6)])
def test_foundation_lessons_have_visible_results_and_hints(topic, count, ordinary):
    support = build_tasks._load_support_content()
    article = support['theory'][str(topic)]
    examples = [e for s in article['sections'] for e in s['examples']]
    assert len(examples) == count and all(e.get('output') and not e.get('context') for e in examples)
    assert all(support['hints'].get(f'{topic}.{i}') for i in range(1, ordinary+1))
    text = article['lead'] + '\n'.join(s['text'] for s in article['sections'])
    assert 'код запускается в вашем браузере' not in text
    if topic == 1:
        assert any('type(True)' in e['code'] or 'type(ready)' in e['code'] for e in examples)
