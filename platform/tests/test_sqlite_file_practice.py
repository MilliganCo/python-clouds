"""Local SQLite practice must demonstrate a file and a fresh process, not memory state."""
import contextlib,io,json,sys
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT));import build_tasks
from test_project_courses import client,srv,register,solve_topic


def quest():
    section=build_tasks.SRC.read_text(encoding='utf-8').split('\n## Мини-квесты на своём компьютере\n',1)[1]
    found=[q for q in json.loads(build_tasks.first_fence(section)[1]) if q['id']=='practice_sqlite_file']
    assert len(found)==1,'Missing independent on-computer SQLite file route'
    return found[0]


def test_route_has_exclusive_creation_and_noncreating_reader_chapters():
    course=quest()
    assert [stage['id'] for stage in course['stages']]==['create_file','read_file']
    assert {17,18,23,46,51}<=set(course['unlock_topics'])


def checked(source,check):
    output=io.StringIO()
    with contextlib.redirect_stdout(output),contextlib.redirect_stderr(io.StringIO()):exec(source+'\n'+check,{})
    assert output.getvalue().strip()=='OK'


ALT_CREATE='''def create_study_db(path, entries):
    import sqlite3
    from pathlib import Path
    from contextlib import closing
    with Path(path).open('xb'):pass
    with closing(sqlite3.connect(path)) as con:
        with con:
            cursor=con.cursor()
            cursor.execute('CREATE TABLE sessions(id INTEGER PRIMARY KEY,title TEXT NOT NULL,minutes INTEGER NOT NULL)')
            for title,minutes in entries:
                cursor.execute('INSERT INTO sessions(title,minutes) VALUES(:title,:minutes)',{'title':title,'minutes':minutes})
'''
ALT_REPORT='''def study_report(path):
    import sqlite3
    from pathlib import Path
    from contextlib import closing
    with closing(sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True)) as con:
        rows=sorted(con.cursor().execute('SELECT id,title,minutes FROM sessions').fetchall())
        return {'rows':rows,'total_minutes':sum(row[2] for row in rows)}
'''


@pytest.mark.parametrize('index',[0,1])
@pytest.mark.parametrize('variant',['reference','alternative'])
def test_equivalent_creators_and_readers_pass(index,variant):
    stage=quest()['stages'][index]
    source=stage['reference_code'] if variant=='reference' else (ALT_CREATE if index==0 else ALT_REPORT)
    checked(source,stage['check']['append'])


MUTATIONS=[(0,"path.open('xb')","path.open('wb')"),
    (0,'connection.commit()','connection.rollback()'),
    (0,'sqlite3.connect(path)',"sqlite3.connect(':memory:')"),
    (0,"VALUES (?, ?)', entries)","VALUES (?, ?)', list(dict(entries).items()))"),
    (0,'connection.close()','connection.close()\n        entries.clear()'),
    (1,'COALESCE(SUM(minutes), 0)','SUM(minutes)'),
    (1,'ORDER BY id','ORDER BY title'),
    (1,'connection = sqlite3.connect(uri, uri=True)','connection = sqlite3.connect(path)'),
    (1,"'total_minutes': total","'total_minutes': float(total)"),
]


@pytest.mark.parametrize('index,old,new',MUTATIONS)
def test_independent_persistence_or_reading_defects_are_rejected(index,old,new):
    import sqlite3
    stage=quest()['stages'][index];source=stage['reference_code'];assert old in source
    with pytest.raises((AssertionError,sqlite3.Error,FileNotFoundError,TypeError)):
        checked(source.replace(old,new),stage['check']['append'])


@pytest.mark.parametrize('index',[0,1])
@pytest.mark.parametrize('variant',['starter','print-only'])
def test_placeholder_or_print_only_does_not_create_or_read_a_file(index,variant):
    import sqlite3
    stage=quest()['stages'][index]
    with pytest.raises((AssertionError,NameError,TypeError,sqlite3.Error,FileNotFoundError)):
        checked(stage['starter_code'] if variant=='starter' else "print('OK')",stage['check']['append'])


def test_reader_cannot_change_the_file_even_if_returned_report_is_correct():
    import sqlite3
    stage=quest()['stages'][1]
    source=stage['reference_code'].replace('sqlite3.connect(uri, uri=True)','sqlite3.connect(path)')
    source=source.replace("return {'rows': rows, 'total_minutes': total}",
        "result = {'rows': rows, 'total_minutes': total}\n        connection.execute('PRAGMA user_version=33')\n        connection.commit()\n        return result")
    with pytest.raises(AssertionError,match='данные файла'):
        checked(source,stage['check']['append'])


def test_wrong_schema_is_not_silently_treated_as_empty():
    stage=quest()['stages'][1]
    code='''def study_report(path):
    import sqlite3
    from pathlib import Path
    if not Path(path).exists():raise FileNotFoundError(path)
    con=sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True)
    try:
        try:
            rows=con.execute('SELECT id,title,minutes FROM sessions ORDER BY id').fetchall()
        except sqlite3.OperationalError:
            return {'rows':[],'total_minutes':0}
        return {'rows':rows,'total_minutes':sum(r[2] for r in rows)}
    finally:con.close()
'''
    with pytest.raises(AssertionError,match='другой схемой'):
        checked(code,stage['check']['append'])


def test_separate_creator_reader_and_updater_processes(tmp_path):
    import subprocess
    (tmp_path/'db_tools.py').write_text('\n\n'.join(s['reference_code'] for s in quest()['stages']),encoding='utf-8')
    scripts={
        'create.py':"from db_tools import create_study_db\ncreate_study_db('study.sqlite3',[('Чтение',15),('Практика',20),('Отдых',5)])",
        'read.py':"from db_tools import study_report\nprint(study_report('study.sqlite3')['total_minutes'])",
        'update.py':"import sqlite3\nc=sqlite3.connect('study.sqlite3')\nc.execute('UPDATE sessions SET minutes=? WHERE id=?',(25,2))\nc.commit()\nc.close()",
        'missing.py':"from db_tools import study_report\nstudy_report('missing.sqlite3')"}
    for name,code in scripts.items():(tmp_path/name).write_text(code,encoding='utf-8')
    def run(name):return subprocess.run([sys.executable,'-X','utf8',str(tmp_path/name)],cwd=tmp_path,
        input='',capture_output=True,text=True,encoding='utf-8',timeout=5)
    assert run('create.py').returncode==0
    first=run('read.py');assert first.returncode==0 and first.stdout.strip()=='40'
    original=(tmp_path/'study.sqlite3').read_bytes();repeat=run('create.py')
    assert repeat.returncode!=0 and 'FileExistsError' in repeat.stderr and (tmp_path/'study.sqlite3').read_bytes()==original
    assert run('update.py').returncode==0
    second=run('read.py');assert second.returncode==0 and second.stdout.strip()=='45'
    missing=run('missing.py');assert missing.returncode!=0 and not (tmp_path/'missing.sqlite3').exists()


def test_generated_private_course_matches_source_without_author_references():
    import copy
    courses=json.loads((ROOT/'platform/practice_quests.json').read_text(encoding='utf-8'))
    actual=next(q for q in courses if q['id']=='practice_sqlite_file');expected=copy.deepcopy(quest())
    for stage in expected['stages']:stage.pop('reference_code')
    assert actual==expected


def test_course_unlock_evidence_ownership_and_no_completion_rewards(client,srv):
    register(client,name='sqlite_file_owner');url='/api/project-courses/practice_sqlite_file';course=srv.pc.get_course('practice_sqlite_file')
    assert client.post(url+'/start').status_code==409
    for topic in course['unlock_topics']:solve_topic(client,srv,topic)
    assert client.post(url+'/start').status_code==200
    before=(client.get('/api/wallet').get_json()['drops'],client.get('/api/progress').get_json()['xp'])
    for stage in course['stages']:
        endpoint=url+'/stages/'+stage['id']
        assert client.post(endpoint+'/complete',json={'check':{'ok':True}}).status_code==400
        evidence={'checked':[i['id'] for i in stage['local_practice']['checklist']],
            'reflection':'Сверил отдельный учебный файл, новый процесс чтения и отказ повтора без замены.'}
        result=client.post(endpoint+'/complete',json={'code':'# own study code','check':{'ok':True},'local_evidence':evidence})
        assert result.status_code==200,result.get_json()
    assert client.get(url).get_json()['course']['status']=='completed'
    assert before==(client.get('/api/wallet').get_json()['drops'],client.get('/api/progress').get_json()['xp'])
    client.post('/api/logout');register(client,name='sqlite_file_other')
    assert all(not s['local_evidence'] for s in client.get(url).get_json()['course']['stages'])
