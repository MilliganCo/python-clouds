"""Author source requirements are separate from stdout and never execute code."""
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks

RULES = {
    '0.10': {'kind': 'printed_sum', 'terms': [7, 5]},
    '0.11': {'kind': 'commented_notice', 'note': 'заметка для себя', 'lines': ['Начинаем!', 'Код работает']},
    '1.7': {'kind': 'counter_events', 'name': 'tickets', 'start': 24, 'deltas': [-7, 2]},
}


@pytest.mark.parametrize(('task_id', 'code'), [
    ('0.10', "print('7 + 5')\nprint(12)"),
    ('0.10', "unused=7+5\nprint('7 + 5')\nprint(12)"),
    ('0.10', "print('7 + 5')\nprint('12') # 7 + 5"),
    ('0.11', "print('Начинаем!')\nprint('Код работает')"),
    ('0.11', "'заметка для себя'\nprint('Начинаем!')\nprint('Код работает')"),
    ('0.11', "# заметка для себя\nprint('Начинаем!\\nКод работает')"),
    ('1.7', 'tickets=19\nprint(tickets)'),
    ('1.7', 'tickets=24-7+2\nprint(tickets)'),
    ('1.7', 'start=24\nsold=7\nreturned=2\ntickets=19\nprint(tickets)'),
    ('1.7', 'tickets=24\ntickets-=7\ntickets+=2\nprint(19)'),
])
def test_known_shortcuts_are_rejected(task_id, code):
    from platform_source_rules import inspect_source
    result = inspect_source(code, RULES[task_id])
    assert result['status'] == 'wrong' and result['message']


@pytest.mark.parametrize(('task_id', 'code'), [
    ('0.10', "print('7 + 5')\nprint(7+5)"),
    ('0.10', "left=7\nright=5\nanswer=left+right\nprint('7 + 5')\nprint(answer)"),
    ('0.10', "print('7 + 5')\nprint(str(5+7))"),
    ('0.10', "print('7 + 5')\nprint(f'{7+5}')"),
    ('0.10', "print('7 + 5\\n',7+5,sep='')"),
    ('0.10', "print('7 + 5')\nprint(sum([7,5]))"),
    ('0.10', "left,right=(7,5)\np=print\np('7 + 5')\np(left+right)"),
    ('0.10', "exec=7\nright=5\nprint('7 + 5')\nprint(exec+right)"),
    ('0.11', "print(\"Начинаем!\")\n# заметка для себя\nprint('Код работает')"),
    ('0.11', "first='Начинаем!'\nsecond='Код работает'\nprint(first) # заметка для себя\nprint(second)"),
    ('0.11', "# ЗАМЕТКА  ДЛЯ СЕБЯ\nprint('Начинаем!', sep=None); print('Код работает')"),
    ('1.7', 'tickets=24\ntickets=tickets-7\ntickets=tickets+2\nprint(tickets)'),
    ('1.7', 'tickets=24\ntickets-=7\ntickets+=2\nprint(tickets)'),
    ('1.7', "start=24\nsale=7\nrefund=2\ntickets=start\ntickets=tickets-sale\ntickets=refund+tickets\nprint(str(tickets))"),
    ('1.7', "tickets=24\ntickets+=-7\ntickets-=-2\nprint(f'{tickets}')"),
])
def test_meaningful_alternatives_are_accepted(task_id, code):
    from platform_source_rules import inspect_source
    assert inspect_source(code, RULES[task_id]) == {'status': 'ok', 'message': ''}


def test_unsupported_construct_is_not_an_incorrect_attempt(tmp_path):
    from platform_source_rules import inspect_source
    target = tmp_path / 'must-not-exist.txt'
    result = inspect_source(f"open({str(target)!r}, 'w').write('executed')", RULES['0.10'])
    assert result['status'] == 'unsupported' and result['message']
    assert not target.exists()


def test_rules_are_canonical_and_references_use_the_same_composition():
    tasks = {t['id']: t for p in build_tasks.parse() for t in p['tasks']}
    for task_id, rule in RULES.items():
        check = tasks[task_id]['check']
        assert check['source'] == rule
        program = build_tasks._reference_program(tasks[task_id])
        namespace = {}
        exec(program, namespace)
        exec(build_tasks.compose_check(check, program), namespace)


@pytest.mark.parametrize('rule', [None, {}, {'kind': 'unknown'}, {'kind': 'printed_sum', 'terms': [True, 5]},
                                 {'kind': 'printed_sum', 'terms': [7, 5], 'extra': 1},
                                 {'kind': 'commented_notice', 'note': '', 'lines': ['a', 'b']}])
def test_invalid_authored_rules_fail_before_build(rule):
    from platform_source_rules import validate_rule
    with pytest.raises(ValueError):
        validate_rule(rule)


def test_actual_runner_keeps_source_validation_in_check_phase():
    import importlib.util
    import io
    runner_path = Path(__file__).resolve().parents[1] / 'sandbox_http_plots/runner.py'
    spec = importlib.util.spec_from_file_location('source_rule_runner_test', runner_path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    task = next(t for p in build_tasks.parse() for t in p['tasks'] if t['id'] == '0.10')
    for code, status in [("print('once')\nprint('7 + 5')\nprint(7+5)", 'ok'),
                         ("print('7 + 5')\nprint(12)", 'wrong'),
                         ("if True:\n    print('7 + 5')\n    print(7+5)", 'unsupported')]:
        events = []
        result = runner.execute({'code': code, 'check': build_tasks.compose_check(task['check'], code),
                                 'interactive': False, 'reportTests': True}, io.StringIO(),
                                lambda kind, **data: events.append((kind, data)))
        if status == 'ok':
            assert result['error'] is None
            assert result['user_stdout'] == 'once\n7 + 5\n12\n'
            assert result['check_stdout'] == 'OK\n'
        else:
            assert result['user_stdout'] == '7 + 5\n12\n' and result['check_stdout'] == ''
            assert result['failure']['source'] == 'check'
            assert ('PYCLOUD_SOURCE_UNSUPPORTED:' in result['error']) == (status == 'unsupported')
        plan = next(data['event'] for kind, data in events if kind == 'test_event' and data['event']['type'] == 'plan')
        assert len(plan['tests']) == 1 and plan['tests'][0]['line'] == 7


@pytest.mark.parametrize('task_id', ['0.10', '0.11', '1.7'])
def test_legacy_grader_composes_same_check_and_blocks_unsupported(task_id):
    import json
    import subprocess
    root = Path(__file__).resolve().parents[2]
    app = (root / 'platform/static/app.js').read_text(encoding='utf-8')
    start = app.index('  function taskCheckScript(')
    end = app.index('  /* ── Страница задания', start)
    code = app[start:end]
    task = next(t for p in build_tasks.parse() for t in p['tasks'] if t['id'] == task_id)
    source = build_tasks._reference_program(task)
    request = {'code': code, 'task': task, 'source': source,
               'library': build_tasks.SOURCE_RULES.read_text(encoding='utf-8')}
    script = r'''
const vm=require('node:vm'),fs=require('node:fs');
const data=JSON.parse(fs.readFileSync(0,'utf8')), calls=[];
const context={window:{CHECKS:{[data.task.id]:data.task.check},SOURCE_RULES_PYTHON:data.library},
  normText:s=>String(s??'').trim(),outputsEqual:(a,b)=>a.trim()===b.trim(),
  PyRunner:{run:async(code,status,check)=>{calls.push({code,check});return context.response;}}};
vm.createContext(context);vm.runInContext(data.code+'\nthis.callGrade=grade; this.compose=taskCheckScript;',context);
(async()=>{
  context.response={stdout:data.task.check.expect+'\n',check_stdout:'OK\n'};
  const good=await context.callGrade(data.task,{code:data.source});
  const composed=calls[0].check;
  context.response={error:'RuntimeError: PYCLOUD_SOURCE_UNSUPPORTED: unknown technique',failure:{source:'check'}};
  const unknown=await context.callGrade(data.task,{code:data.source});
  context.response={error:'AssertionError: use the sum',check_stdout:'',failure:{source:'check'}};
  const wrong=await context.callGrade(data.task,{code:data.source});
  context.response={error:'RuntimeError: PYCLOUD_SOURCE_UNSUPPORTED: from solution',failure:{source:'solution'}};
  const imitated=await context.callGrade(data.task,{code:data.source});
  process.stdout.write(JSON.stringify({good,unknown,wrong,imitated,composed,calls}));
})().catch(e=>{process.stderr.write(e.stack);process.exitCode=1;});
'''
    result = subprocess.run(['node', '-e', script], input=json.dumps(request, ensure_ascii=True),
                            capture_output=True, encoding='utf-8', timeout=15)
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert data['good']['kind'] == 'auto' and data['good']['ok'] is True
    assert data['unknown'] == {'kind': 'blocked', 'error': 'unknown technique'}
    assert data['wrong']['kind'] == 'auto' and data['wrong']['ok'] is False
    assert data['imitated']['kind'] == 'auto' and data['imitated']['ok'] is False
    assert len(data['calls']) == 4 and all(call['code'] == source for call in data['calls'])
    namespace = {}
    exec(source, namespace)
    exec(data['composed'], namespace)
    assert 'SubmissionChecks.start($("taskTests"), taskCheckScript(task, payload.code))' in app


def test_source_inspection_is_bounded_for_shared_expression_graphs():
    import json
    import subprocess
    source = 'a=0\n' + 'a=a+a\n' * 50 + 'print(a)'
    program = 'from platform_source_rules import inspect_source\nimport json\nprint(json.dumps(inspect_source(' + repr(source) + ',' + repr(RULES['0.10']) + ')))'
    result = subprocess.run([sys.executable, '-c', program], cwd=Path(__file__).resolve().parents[2],
                            capture_output=True, encoding='utf-8', timeout=6)
    assert result.returncode == 0 and json.loads(result.stdout)['status'] == 'wrong'
    from platform_source_rules import inspect_source
    assert inspect_source('a=[0]\na=a+a\nprint(a)', RULES['0.10'])['status'] == 'unsupported'


def test_frozen_mobile_bundle_keeps_its_existing_check_schema():
    topics = build_tasks.parse()
    bundle = build_tasks.build_mobile_bundle(topics)
    mobile = {t['id']: t for p in bundle['topics'] for t in p['tasks']}
    canonical = {t['id']: t for p in topics for t in p['tasks']}
    for task_id in RULES:
        assert set(mobile[task_id]['check']) == {'append', 'expect'}
        assert mobile[task_id]['check'] == {key: canonical[task_id]['check'][key] for key in ('append', 'expect')}


def test_source_rule_without_executable_check_is_not_silently_ignored():
    raw = '**Тип задания:** дописать код\n**Название:** Test\n**Условие:** Test\n**Ответ:**\n```python\npass\n```\n**Объяснение:** Test\n**Проверено в CPython:** да\n**Проверка исходника:**\n```json\n{"kind":"printed_sum","terms":[7,5]}\n```'
    with pytest.raises(ValueError, match='нужны проверка'):
        build_tasks.parse_task(raw, 0, 1)
