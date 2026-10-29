"""CLI practice must connect real argv/stdin/exit with a testable Python core."""
import contextlib,io,json,sys
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
import build_tasks
from test_project_courses import client,srv,register,solve_topic


def quest():
    section=build_tasks.SRC.read_text(encoding='utf-8').split('\n## Мини-квесты на своём компьютере\n',1)[1]
    matches=[q for q in json.loads(build_tasks.first_fence(section)[1]) if q['id']=='practice_cli']
    assert len(matches)==1,'Missing actual CLI/input practice route'
    return matches[0]


def test_route_has_parser_and_real_input_entrypoint_chapters():
    course=quest()
    assert [s['id'] for s in course['stages']]==['parser','stdin_main']
    assert {12,15,16,18,23,50}<=set(course['unlock_topics'])


def checked(source,check):
    output=io.StringIO()
    with contextlib.redirect_stdout(output),contextlib.redirect_stderr(io.StringIO()):
        exec(source+'\n'+check,{})
    assert output.getvalue().strip()=='OK'


ALT_PARSER='''def make_parser():
    from argparse import ArgumentParser
    parser=ArgumentParser(prog='alternative')
    parser.add_argument('--upper',action='store_const',const=True,default=False)
    parser.add_argument('--repeat',type=int,choices=range(1,4),default=1)
    parser.add_argument('name')
    return parser
'''
ALT_MAIN='''def main(argv,read_text=input,emit=print):
    settings=make_parser().parse_args(argv)
    try:
        message=read_text().strip()
    except EOFError:
        emit('Ввод завершён.')
        return 1
    if message=='':
        emit('Пустое сообщение.')
        return 1
    message=message.upper() if settings.upper else message
    lines=[settings.name+': '+message]*settings.repeat
    for line in lines:emit(line)
    return 0
'''


@pytest.mark.parametrize('index',[0,1])
@pytest.mark.parametrize('variant',['reference','alternative'])
def test_correct_alternatives_are_accepted(index,variant):
    stage=quest()['stages'][index]
    source=stage['reference_code'] if variant=='reference' else ALT_PARSER+('\n'+ALT_MAIN if index else '')
    checked(source,stage['check']['append'])


MUTATIONS=[(0,'default=1','default=2'),(0,'choices=(1, 2, 3)','choices=(0, 1, 2, 3, 4)'),
    (0,"action='store_true'","action='store_false'"),(0,"add_argument('name')","add_argument('name',type=str.lower)"),
    (0,"prog='echo_cli.py'","prog='echo_cli.py',add_help=False"),
    (0,'return parser',"print('debug')\n    return parser"),
    (1,"text = text.strip()","text = text.replace(' ', '')"),
    (1,'return 0','return False'),(1,'except EOFError:','except Exception:'),
    (1,"emit(f'{args.name}: {text}')","emit(f'{args.name}: {text}')\n        read_text()"),
    (1,"emit(f'{args.name}: {text}')","print(f'{args.name}: {text}')"),
    (1,"emit('Пустое сообщение.')","emit('Ввод завершён.')"),
    (1,'args = make_parser().parse_args(argv)','args = make_parser().parse_args(argv)\n    argv.clear()')]


@pytest.mark.parametrize('index,old,new',MUTATIONS)
def test_grader_rejects_independent_cli_defects(index,old,new):
    stage=quest()['stages'][index];source=stage['reference_code'];assert old in source
    with pytest.raises((AssertionError,SystemExit,TypeError,AttributeError,ValueError)):
        checked(source.replace(old,new),stage['check']['append'])


def test_reading_before_parse_is_rejected():
    stage=quest()['stages'][1]
    source=stage['reference_code'].replace('    args = make_parser().parse_args(argv)','    # delayed parsing')
    source=source.replace('    text = text.strip()','    args = make_parser().parse_args(argv)\n    text = text.strip()')
    with pytest.raises(AssertionError,match='stdin'):
        checked(source,stage['check']['append'])


@pytest.mark.parametrize('index',[0,1])
@pytest.mark.parametrize('variant',['starter','print-only'])
def test_stubs_and_print_only_are_not_a_cli(index,variant):
    stage=quest()['stages'][index]
    with pytest.raises((AssertionError,NameError,AttributeError,TypeError)):
        checked(stage['starter_code'] if variant=='starter' else "print('OK')",stage['check']['append'])


GUARD="\nif __name__=='__main__':\n    import sys\n    raise SystemExit(main(sys.argv[1:]))\n"


@pytest.mark.parametrize('args,input_text,exit_code,lines,errors',[
    (['Ada'],'hello\n',0,['Ada: hello'],False),
    (['Ада Л.','--repeat','2'],'привет\n',0,['Ада Л.: привет']*2,False),
    (['Ada','--upper'],' привет \n',0,['Ada: ПРИВЕТ'],False),
    (['Ada','--repeat','2'],'first\nsecond\n',0,['Ada: first']*2,False),
    (['Ada'],'\n',1,['Пустое сообщение.'],False),
    (['Ada'],'',1,['Ввод завершён.'],False),
    (['Ada','--repeat','4'],'',2,[],True),
    ([], '',2,[],True),
    (['--','--help'],'да\n',0,['--help: да'],False),
],ids=['success','quoted-name','upper','one-read','blank','eof','invalid-option','missing-name','literal-help'])
def test_real_cli_process_arguments_stdin_and_status(tmp_path,args,input_text,exit_code,lines,errors):
    import subprocess
    file=tmp_path/'echo_cli.py';file.write_text(quest()['stages'][1]['reference_code']+GUARD,encoding='utf-8')
    result=subprocess.run([sys.executable,'-I','-X','utf8',str(file),*args],input=input_text,cwd=tmp_path,
        capture_output=True,text=True,encoding='utf-8',timeout=5)
    assert result.returncode==exit_code and result.stdout.splitlines()==lines
    assert bool(result.stderr.strip())==errors


def test_help_and_import_never_wait_for_stdin(tmp_path):
    import subprocess
    file=tmp_path/'echo_cli.py';file.write_text(quest()['stages'][1]['reference_code']+GUARD,encoding='utf-8')
    help=subprocess.run([sys.executable,'-I','-X','utf8',str(file),'--help'],input='',cwd=tmp_path,capture_output=True,text=True,encoding='utf-8',timeout=5)
    assert help.returncode==0 and all(s in help.stdout for s in ('--repeat','--upper')) and not help.stderr
    script="import importlib.util; s=importlib.util.spec_from_file_location('echo_sample',"+repr(str(file))+"); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print('quiet import')"
    imported=subprocess.run([sys.executable,'-I','-X','utf8','-c',script],input='',cwd=tmp_path,capture_output=True,text=True,encoding='utf-8',timeout=5)
    assert imported.returncode==0 and imported.stdout.strip()=='quiet import' and not imported.stderr


def test_generated_route_excludes_private_references():
    data=json.loads((ROOT/'platform/practice_quests.json').read_text(encoding='utf-8'))
    q=next(q for q in data if q['id']=='practice_cli')
    assert [s['id'] for s in q['stages']]==['parser','stdin_main']
    assert all('reference_code' not in stage for stage in q['stages'])


def test_route_is_locked_until_argparse_and_completion_has_no_reward(client,srv):
    register(client,name='cli_owner');course=srv.pc.get_course('practice_cli');url='/api/project-courses/practice_cli'
    assert client.post(url+'/start').status_code==409
    for topic in course['unlock_topics']:solve_topic(client,srv,topic)
    assert client.post(url+'/start').status_code==200
    before=(client.get('/api/wallet').get_json()['drops'],client.get('/api/progress').get_json()['xp'])
    for stage in course['stages']:
        endpoint=url+'/stages/'+stage['id']
        assert client.post(endpoint+'/complete',json={'check':{'ok':True}}).status_code==400
        evidence={'checked':[i['id'] for i in stage['local_practice']['checklist']],
            'reflection':'Сверил аргументы, один ввод и коды завершения в отдельной учебной папке.'}
        result=client.post(endpoint+'/complete',json={'code':'# owned draft','check':{'ok':True},'local_evidence':evidence})
        assert result.status_code==200,result.get_json()
    assert client.get(url).get_json()['course']['status']=='completed'
    assert before==(client.get('/api/wallet').get_json()['drops'],client.get('/api/progress').get_json()['xp'])
    client.post('/api/logout');register(client,name='cli_other')
    assert all(not s['local_evidence'] for s in client.get(url).get_json()['course']['stages'])
