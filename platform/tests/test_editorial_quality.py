"""Editorial corrections preserve assignment identity, archives, progress and credit."""
import copy,json,runpy
from pathlib import Path
import sys
import pytest
from test_platform import client,register
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import build_tasks


def test_prerequisites_refer_to_the_actual_subject_instead_of_nearby_ids():
    topics={p['id']:p for p in build_tasks.parse()}
    assert 'pathlib' in topics[46]['title'].casefold()
    assert 46 in topics[63]['prerequisites'] and 30 not in topics[63]['prerequisites']
    manifest=next(t for t in build_tasks.parse_weekly(verify=False)['tasks'] if t['id']=='weekly-file-manifest-v1')
    assert 'json' in topics[26]['title'].casefold()
    assert 26 in manifest['prerequisites'] and 29 not in manifest['prerequisites']


def test_sqlite_intros_are_specific_and_generator_owned():
    generator=runpy.run_path(str(Path(__file__).resolve().parents[1]/'scripts/enrich_task_intros.py'))
    support=build_tasks._load_support_content()
    tasks=next(p['tasks'] for p in build_tasks.parse() if p['id']==51)
    for task in tasks:
        intro=generator['build_intro'](task)
        assert intro['source']=='authored' and intro['explanation'] and intro['example'] is None
        assert intro['goal'] not in generator['TYPE_GOALS'].values()
        assert support['intros'][task['id']]==intro


def published(client,monkeypatch):
    import server
    monkeypatch.setattr(server,'now',lambda:'2026-11-11T12:00:00+00:00')
    bank=copy.deepcopy(server.WEEKLY_BANK);bank['tasks'][3]['prerequisites']=[29]
    monkeypatch.setattr(server,'WEEKLY_BANK',bank)
    register(client)
    task=client.get('/api/weekly').get_json()['task']
    assert task['id']=='weekly-file-manifest-v1'
    return server,bank,task


def solve(client,task):
    return client.post('/api/atlas/'+task['id']+'/solve',json={'task_key':task['task_key'],'week_start':task['week_start']})


def test_published_editorial_fix_changes_links_but_not_code_identity_or_credit(client,monkeypatch):
    server,bank,old=published(client,monkeypatch)
    assert solve(client,old).get_json()['awarded']==30
    with server.app.app_context():before=server.db().execute('SELECT payload_json FROM weekly_assignments').fetchone()[0]
    corrected=copy.deepcopy(bank)
    corrected['tasks'][3].update(prerequisites=[26],skills=['JSON','Проверка bytes'],reflection='Почему одного размера недостаточно?',explanation='Исправленное пояснение без замены задания.')
    monkeypatch.setattr(server,'WEEKLY_BANK',corrected)
    fresh=client.get('/api/atlas/'+old['id']).get_json()['task']
    assert fresh['prerequisites']==[26] and fresh['reflection']==corrected['tasks'][3]['reflection']
    assert fresh['task_key']==old['task_key'] and fresh['solved'] and fresh['available_reward']==0
    result=solve(client,fresh).get_json()
    assert result['awarded']==0 and result['explanation']==corrected['tasks'][3]['explanation']
    assert client.get('/api/wallet').get_json()['drops']==30
    with server.app.app_context():assert server.db().execute('SELECT payload_json FROM weekly_assignments').fetchone()[0]==before


def test_archive_accepts_only_editorial_context_difference_without_overwriting_live_definition(client,monkeypatch):
    server,bank,task=published(client,monkeypatch);solve(client,task)
    saved=client.get('/api/learning-archive').get_json();original=copy.deepcopy(saved)
    with server.app.app_context():
        row=server.db().execute('SELECT payload_json FROM weekly_assignments').fetchone()[0]
        payload=json.loads(row);payload['prerequisites']=[26];payload['reflection']='Исправленный вопрос'
        corrected=json.dumps(payload,ensure_ascii=False)
        server.db().execute('UPDATE weekly_assignments SET payload_json=?',(corrected,));server.db().commit()
    response=client.post('/api/learning-archive/preview',json={'archive':saved,'choice':'use_archive'})
    assert response.status_code==200,response.get_json()
    restored=client.post('/api/learning-archive/restore',json={'archive':saved,'choice':'use_archive','token':response.get_json()['token']})
    assert restored.status_code==200 and saved==original
    with server.app.app_context():assert server.db().execute('SELECT payload_json FROM weekly_assignments').fetchone()[0]==corrected
    assert solve(client,task).get_json()['awarded']==0


@pytest.mark.parametrize('field',['title','prompt','func_name','starter','solution','tests','difficulty','id','unknown_field'])
def test_editorial_overlay_never_replaces_immutable_or_unknown_fields(field):
    import weekly_practice as weekly
    bank=build_tasks.parse_weekly(verify=False);frozen=copy.deepcopy(bank['tasks'][0]);changed=copy.deepcopy(bank)
    changed['tasks'][0][field]='changed'
    changed['tasks'][0]['reflection']='A new question'
    assert weekly.display_payload(frozen,changed)==frozen


@pytest.mark.parametrize('field,value',[('skills',[]),('skills',[7]),('prerequisites',[True]),('prerequisites',[-1]),('reflection',None),('explanation','')])
def test_malformed_editorial_patch_keeps_published_view_usable(field,value):
    import weekly_practice as weekly
    bank=build_tasks.parse_weekly(verify=False);frozen=copy.deepcopy(bank['tasks'][0]);changed=copy.deepcopy(bank)
    changed['tasks'][0][field]=value
    assert weekly.display_payload(frozen,changed)==frozen


def test_displayed_metadata_does_not_share_lists_with_the_bank():
    import weekly_practice as weekly
    bank=build_tasks.parse_weekly(verify=False);frozen=copy.deepcopy(bank['tasks'][0])
    before=copy.deepcopy(bank);shown=weekly.display_payload(frozen,bank)
    shown['prerequisites'].append(9999);shown['skills'].append('other')
    assert bank==before and frozen==before['tasks'][0]


@pytest.mark.parametrize('field',['prompt','solution','tests','difficulty','id','unknown_field'])
def test_archive_still_rejects_core_change_even_with_matching_signature(client,monkeypatch,field):
    import learning_archive as archive,weekly_practice
    server,bank,task=published(client,monkeypatch);solve(client,task)
    saved=client.get('/api/learning-archive').get_json()
    changed=copy.deepcopy(saved);row=changed['payload']['contexts']['weekly_assignments'][0]
    definition=json.loads(row['payload_json']);definition[field]='changed'
    row['payload_json']=json.dumps(definition,ensure_ascii=False)
    row['content_key']=weekly_practice.content_key(definition)
    changed['signature']=archive.mac(server.app.secret_key,archive.FORMAT,changed['payload'])
    response=client.post('/api/learning-archive/preview',json={'archive':changed,'choice':'use_archive'})
    assert response.status_code==409,response.get_json()
    assert client.get('/api/wallet').get_json()['drops']==30


def test_only_sqlite_intros_change_under_scoped_generation(monkeypatch,tmp_path):
    generator=runpy.run_path(str(Path(__file__).resolve().parents[1]/'scripts/enrich_task_intros.py'))
    assert set(generator['SQLITE_FOUNDATIONS_INTROS'])=={f'51.{i}' for i in range(1,10)}
    keep={'source':'authored','goal':'Чужая авторская вводная','explanation':'Сохранить дословно','example':None}
    fn=generator['main'];scope=fn.__globals__;out=tmp_path/'intros.js'
    monkeypatch.setitem(scope,'load_tasks',lambda:[{'id':'51.1','type':'определить вывод'},{'id':'52.1','type':'написать функцию'}])
    monkeypatch.setitem(scope,'load_existing_intros',lambda:{'52.1':copy.deepcopy(keep)})
    monkeypatch.setitem(scope,'OUT',out)
    fn({51})
    result=json.loads(out.read_text(encoding='utf-8').split('window.TASK_INTRO = ',1)[1].strip().removesuffix(';'))
    assert result['52.1']==keep and result['51.1']['source']=='authored'


def test_editorial_compatibility_never_accepts_an_unsigned_file_edit(client,monkeypatch):
    server,bank,task=published(client,monkeypatch);solve(client,task)
    saved=client.get('/api/learning-archive').get_json()
    row=saved['payload']['contexts']['weekly_assignments'][0]
    definition=json.loads(row['payload_json']);definition['prerequisites']=[26]
    row['payload_json']=json.dumps(definition,ensure_ascii=False)
    response=client.post('/api/learning-archive/preview',json={'archive':saved,'choice':'use_archive'})
    assert response.status_code==400 and response.get_json()['code']=='archive_signature'
