"""Course API contracts run real Flask clients, with no listening socket."""
import contextlib
import io
import importlib.util
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def stages():
    topic = next(p for p in build_tasks.parse() if p['id'] == 61)
    return {task['id']: task for task in topic['tasks']}


def checked(task, source):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(source + '\n' + task['check']['append'], {})
    assert output.getvalue().strip() == 'OK'


@pytest.mark.parametrize('id', ['61.2', '61.4', '61.5', '61.7', '61.8', '61.9', '61.10'])
def test_references_and_incomplete_programs(stages, id):
    task = stages[id]
    checked(task, task['answer'])
    for wrong in [task['code'], "print('OK')"]:
        with pytest.raises(Exception):
            checked(task, wrong)


@pytest.mark.parametrize(('id', 'before', 'after'), [
    ('61.4', "if not values:name='Python'", "if not values or not values[0].strip():name='Python'"),
    ('61.5', "type(data['value']) is not int", "not isinstance(data['value'],int)"),
    ('61.7', "render_template_string('<h1>Привет, {{ name }}!</h1>',name=name)", "render_template_string(f'<h1>Привет, {name}!</h1>')"),
    ('61.8', 'if sku not in stock:', 'if not stock.get(sku):'),
    ('61.9', "stock.get(row['sku'],0)+row['qty']", "row['qty']"),
    ('61.9', 'if updated<0:', 'stock[sku]=updated\n        if updated<0:'),
    ('61.10', "note={'id':next_id", "next_id=len(notes)+1\n        note={'id':next_id"),
    ('61.10', "return note,201,", "return note,200,"),
    ('61.10', "type(data['done']) is not bool", "not isinstance(data['done'],int)"),
    ('61.10', 'nonlocal next_id', 'nonlocal next_id\n        next_id+=1'),
])
def test_checks_reject_semantically_wrong_apps(stages, id, before, after):
    task = stages[id]
    wrong = task['answer'].replace(before, after)
    assert wrong != task['answer']
    with pytest.raises(AssertionError):
        checked(task, wrong)


def test_factory_must_not_reuse_global_app(stages):
    task = stages['61.9']
    wrong = task['answer'] + '''
_factory=create_inventory_app
_shared=None
def create_inventory_app(rows):
    global _shared
    if _shared is None:_shared=_factory(rows)
    return _shared
'''
    with pytest.raises(AssertionError):
        checked(task, wrong)


def test_equivalent_route_and_jsonify_are_accepted(stages):
    task = stages['61.2']
    alternative = task['answer'].replace('from flask import Flask', 'from flask import Flask,jsonify')
    alternative = alternative.replace("@app.get('/health')", "@app.route('/health',methods=['GET'])")
    alternative = alternative.replace("return {'status':'ok'}", "return jsonify(status='ok')")
    checked(task, alternative)


def test_flask_teaching_material_is_independent_and_complete():
    support = build_tasks._load_support_content()
    article = support['theory']['61']
    examples = [ex for section in article['sections'] for ex in section['examples']]
    assert len(examples) == 12
    assert all('output' in ex and not ex.get('context') for ex in examples)
    assert all(support['hints'].get(f'61.{i}') for i in range(1, 9))
    assert all(support['intros'][f'61.{i}']['source'] == 'authored' for i in range(1, 11))
    assert any('test_client' in ex['code'] for ex in examples)
    assert not any('app.run(' in ex['code'] for ex in examples)


def test_intro_generation_can_preserve_other_topics(tmp_path, monkeypatch):
    path = Path(__file__).resolve().parents[1] / 'scripts/enrich_task_intros.py'
    spec = importlib.util.spec_from_file_location('flask_intro_generator', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    old = {'source': 'template', 'goal': 'Сохранённая формулировка', 'example': None}
    intros = {'32.2': old.copy(), '99.1': {'goal': 'Другой черновик'}}
    monkeypatch.setattr(module, 'load_tasks', lambda: [{'id': '32.2'}, {'id': '61.1'}])
    monkeypatch.setattr(module, 'load_existing_intros', lambda: intros)
    monkeypatch.setattr(module, 'build_intro', lambda task: {'goal': task['id']})
    monkeypatch.setattr(module, 'OUT', tmp_path / 'intros.js')
    module.main({61})
    assert intros['32.2'] == old and intros['99.1'] == {'goal': 'Другой черновик'}
    assert intros['61.1'] == {'goal': '61.1'}
    with pytest.raises(ValueError, match='99'):
        module.main({99})
