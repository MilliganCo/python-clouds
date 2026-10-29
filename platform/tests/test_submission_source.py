"""Submitted text stays data in the Python/JavaScript check composers."""
import json
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import build_tasks


@pytest.mark.parametrize('source', ['def test_x():\n    assert True', '"\'\\\n# test\nprint("not executed")', '\u2028\u2029\x00'])
def test_source_is_quoted_identically_by_client_and_builder(source):
    code = r'''
const fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('platform/static/app.js','utf8');
const start=app.indexOf('  function taskCheckScript('),end=app.indexOf('\n  async function grade(',start);
const context=vm.createContext({window:{CHECKS:{'55.9':{append:'result = _pycloud_submission_source',submissionSource:true}}}});
vm.runInContext(app.slice(start,end),context);
console.log(JSON.stringify(context.taskCheckScript({id:'55.9'},JSON.parse(process.argv[1]))));
'''
    result = subprocess.run(['node','-e',code,json.dumps(source)],cwd=ROOT,capture_output=True,text=True,encoding='utf8',check=True)
    check = {'append':'result = _pycloud_submission_source','submissionSource':True}
    for script in (json.loads(result.stdout), build_tasks.compose_check(check,source)):
        ns={}
        exec(script,ns)
        assert ns['result'] == source


def test_ordinary_checks_do_not_receive_or_execute_source():
    assert build_tasks.compose_check({'append':'assert 2+2==4'}, 'raise SystemExit()') == 'assert 2+2==4'


def test_source_marker_cannot_be_silently_ignored():
    raw='**Тип задания:** написать функцию\n**Название:** Tests\n**Условие:** x\n**Ответ:**\n```python\npass\n```\n**Объяснение:** x\n**Проверено в CPython:** да\n**Проверять тесты:** да\n'
    with pytest.raises(ValueError,match='Проверять тесты'):
        build_tasks.parse_task(raw,55,1)
