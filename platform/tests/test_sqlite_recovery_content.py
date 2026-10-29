"""Temporary SQLite recovery course: real files, WAL, failure, races and versions."""
import contextlib
import io
from pathlib import Path
import sys
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def tasks():
    return {t['id']:t for p in build_tasks.parse() if p['id']==63 for t in p['tasks']}


def checked(task,source):
    output=io.StringIO()
    with contextlib.redirect_stdout(output):exec(source+'\n'+task['check']['append'],{})
    assert output.getvalue().strip()=='OK'


@pytest.mark.parametrize('id',['63.3','63.4','63.6','63.7','63.8','63.9','63.10'])
def test_references_pass_and_starters_and_print_only_do_not(tasks,id):
    task=tasks[id];checked(task,task['answer'])
    for source in [task['code'],"print('OK')"]:
        with pytest.raises(Exception):checked(task,source)


@pytest.mark.parametrize(('id','before','after'),[
    ('63.4','os.link(stage,destination)','os.replace(stage,destination)'),
    ('63.6','os.link(stage,destination)','os.replace(stage,destination)'),
    ('63.7',"if type(id) is not int or type(title) is not str or type(done) is not int or done not in (0,1) or type(version) is not int or version<=0:",'if False:'),
    ('63.8',"return inspect_snapshot(path)['revision']","return inspect_snapshot(path)['revision'] or None"),
    ('63.8',"if (getattr(error,'sqlite_errorcode',0)&255) in (sqlite3.SQLITE_CORRUPT,sqlite3.SQLITE_NOTADB):return None",'if True:return None'),
    ('63.9','os.link(stage,destination)','os.replace(stage,destination)'),
    ('63.6',"dst.execute('PRAGMA journal_mode=DELETE')",'pass'),
    ('63.9',"dst.execute('PRAGMA journal_mode=DELETE')",'pass'),
    ('63.10',"report['revision']>best[0]","report['total']>best[0]"),
    ('63.10',"report['revision']>best[0]","report['revision']>=best[0]"),
    ('63.10',"if (getattr(error,'sqlite_errorcode',0)&255) in (sqlite3.SQLITE_CORRUPT,sqlite3.SQLITE_NOTADB):continue",'if True:continue'),
    ('63.10','os.link(stage,destination)','os.link(source,destination)'),
])
def test_checks_reject_overwrite_bad_values_falsey_revision_and_stale_fallback(tasks,id,before,after):
    task=tasks[id];wrong=task['answer'].replace(before,after);assert wrong!=task['answer']
    with pytest.raises(Exception):checked(task,wrong)


def test_report_belongs_to_the_actual_snapshot_not_an_earlier_source_read(tasks):
    task=tasks['63.9']
    wrong=task['answer'].replace('    with TemporaryDirectory(dir=destination.parent) as folder:',
        '    old_report=inspect_snapshot(source)\n    with TemporaryDirectory(dir=destination.parent) as folder:').replace('report=inspect_snapshot(stage)','report=old_report')
    assert wrong!=task['answer']
    with pytest.raises(Exception):checked(task,wrong)


def test_equivalent_column_order_is_accepted(tasks):
    task=tasks['63.7']
    alternative=task['answer'].replace('SELECT id,title,done,version FROM notes ORDER BY id','SELECT title,version,id,done FROM notes ORDER BY id').replace('for id,title,done,version in rows:','for title,version,id,done in rows:').replace('sum(r[2] for r in rows)','sum(r[3] for r in rows)')
    checked(task,alternative)


def test_course_has_authored_material_and_explicit_local_filesystem_limits(tasks):
    support=build_tasks._load_support_content();article=support['theory']['63']
    examples=[e for section in article['sections'] for e in section['examples']]
    assert len(examples)==12 and all('output' in e and not e.get('context') for e in examples)
    assert [t['finale'] for t in list(tasks.values())[-2:]]==[1,2]
    assert all(support['intros'][f'63.{i}']['source']=='authored' for i in range(1,11))
    assert all(support['hints'][f'63.{i}'] for i in range(1,9))
    assert all(t['learning']['reason'] and t['learning']['skills'] for t in tasks.values())
    text=' '.join(s['text'] for s in article['sections'])
    assert 'между разными запусками' in text and 'файловой системы' in text and 'crash-durability' in text
