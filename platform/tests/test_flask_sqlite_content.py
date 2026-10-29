"""Real temporary SQLite files: durability, atomicity, conflicts and resource scope."""
import contextlib
import io
import runpy
from pathlib import Path
import sys

import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def tasks():
    return {t['id']:t for p in build_tasks.parse() if p['id']==62 for t in p['tasks']}


def checked(task,code):
    output=io.StringIO()
    with contextlib.redirect_stdout(output):exec(code+'\n'+task['check']['append'],{})
    assert output.getvalue().strip()=='OK'


@pytest.mark.parametrize('id',['62.2','62.4','62.5','62.7','62.9','62.10'])
def test_references_and_incomplete_programs(tasks,id):
    task=tasks[id];checked(task,task['answer'])
    for wrong in [task['code'],"print('OK')"]:
        with pytest.raises(Exception):checked(task,wrong)


@pytest.mark.parametrize(('id','before','after'),[
    ('62.2','CREATE TABLE IF NOT EXISTS','CREATE TABLE'),
    ('62.5',"if cursor.rowcount!=1:raise ValueError('Изменение невозможно')","if cursor.rowcount!=1:raise ValueError('Изменение невозможно')\n                con.commit()"),
    ('62.7','if db is not None:db.close()','if db is not None:pass'),
    ('62.9',"                    con.execute('UPDATE stock SET qty=qty+?","                    con.commit()\n                    con.execute('UPDATE stock SET qty=qty+?"),
    ('62.10',"if row['version']!=data['version']:",'if False:'),
    ('62.10','version=version+1','version=version'),
    ('62.10',"dict(row,done=bool(row['done']))",'dict(row)'),
])
def test_checks_find_transaction_lifetime_and_version_errors(tasks,id,before,after):
    task=tasks[id];wrong=task['answer'].replace(before,after);assert wrong!=task['answer']
    with pytest.raises(Exception):checked(task,wrong)


def test_reads_must_use_the_supplied_file(tasks):
    task=tasks['62.7'];wrong=task['answer'].replace('sqlite3.connect(path)',"sqlite3.connect(':memory:')")
    with pytest.raises(Exception):checked(task,wrong)


def test_column_order_does_not_define_the_contract(tasks):
    task=tasks['62.4']
    alternative=task['answer'].replace('SELECT id,title,done,version FROM notes','SELECT title,version,done,id FROM notes')
    checked(task,alternative)


def test_material_has_complete_independent_examples():
    support=build_tasks._load_support_content()
    article=support['theory']['62']
    examples=[example for section in article['sections'] for example in section['examples']]
    assert len(examples)==12 and all('output' in ex and not ex.get('context') for ex in examples)
    assert all(support['hints'].get(f'62.{i}') for i in range(1,9))
    assert all(support['intros'][f'62.{i}']['source']=='authored' for i in range(1,11))
    text=' '.join(section['text'] for section in article['sections'])
    assert 'между разными запусками' in text and 'рабочей' in text


def test_intro_loader_sees_canonical_new_tasks_and_preserves_display_type(monkeypatch):
    generator=runpy.run_path(str(Path(__file__).resolve().parents[1]/'scripts/enrich_task_intros.py'))
    monkeypatch.setattr(build_tasks,'parse',lambda:[{'title':'Классы','tasks':[{'id':'99.1','type':'написать функцию','displayType':'написать класс','title':'Свой класс'}]}])
    task=generator['load_tasks']()[0]
    assert task['id']=='99.1' and task['displayType']=='написать класс' and task['topicTitle']=='Классы'
    assert 'класс' in generator['build_intro'](task)['goal']
