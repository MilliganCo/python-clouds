"""Only learner-declared files, not files created by grading checks, are returned."""
import importlib.util
import io
from types import ModuleType

import sandbox_runner


def guest_runner():
    path=sandbox_runner.RUNTIME_CONTEXT/'runner.py'
    spec=importlib.util.spec_from_file_location('export_snapshot_guest',path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_solution_exports_are_snapshotted_before_checks(monkeypatch):
    module=ModuleType('pycloud')
    files=[]
    module.export_file=lambda name:files.append({'name':name,'data':'UEsDBA=='})
    module._snapshot=lambda:[dict(item) for item in files]
    monkeypatch.setitem(__import__('sys').modules,'pycloud',module)
    result=guest_runner().execute(dict(code="import pycloud\npycloud.export_file('own.xlsx')",check="pycloud.export_file('private-check.xlsx')",interactive=False,reportTests=False),io.StringIO(),lambda *a,**kw:None)
    assert [f['name'] for f in result['artifacts']]==['own.xlsx']


def test_check_only_exports_do_not_appear(monkeypatch):
    module=ModuleType('pycloud');files=[]
    module.export_file=lambda name:files.append({'name':name,'data':'UEsDBA=='})
    module._snapshot=lambda:[dict(item) for item in files]
    monkeypatch.setitem(__import__('sys').modules,'pycloud',module)
    result=guest_runner().execute(dict(code='pass',check="import pycloud\npycloud.export_file('check.xlsx')",interactive=False,reportTests=False),io.StringIO(),lambda *a,**kw:None)
    assert 'artifacts' not in result


def test_runtime_digest_includes_the_learner_helper(tmp_path,monkeypatch):
    for name in ('Dockerfile','runner.py','supervisor.py','pycloud.py'):
        (tmp_path/name).write_bytes((sandbox_runner.RUNTIME_CONTEXT/name).read_bytes())
    monkeypatch.setattr(sandbox_runner,'RUNTIME_CONTEXT',tmp_path)
    before=sandbox_runner.source_digest()
    with (tmp_path/'pycloud.py').open('a') as file:file.write('\n# changed\n')
    assert sandbox_runner.source_digest()!=before


def test_an_unrelated_same_named_module_does_not_break_ordinary_code(monkeypatch):
    monkeypatch.setitem(__import__('sys').modules,'pycloud',ModuleType('pycloud'))
    result=guest_runner().execute(dict(code="print('OK')",check='',interactive=False,reportTests=False),io.StringIO(),lambda *a,**kw:None)
    assert result['error'] is None and result['stdout']=='OK\n' and 'artifacts' not in result
