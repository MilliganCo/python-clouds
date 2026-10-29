"""Subscribed mentor transport: no real model calls, tools or learner records."""
import json
import os
import subprocess
import sys
import time

import pytest

def test_timeout_terminates_owned_cli_tree_and_releases_capacity(tmp_path,monkeypatch):
    import server as srv,ai_controls
    fake=tmp_path/'synthetic_cli.py';child_pid=tmp_path/'child.pid'
    fake.write_text("import subprocess,sys,time,pathlib\np=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'],stdin=subprocess.DEVNULL)\npathlib.Path(sys.argv[1]).write_text(str(p.pid))\ntime.sleep(30)\n",encoding='utf8')
    original=subprocess.Popen
    def popen(command,*args,**kwargs):
        if command[0]=='synthetic-codex-for-timeout':command=[sys.executable,str(fake),str(child_pid)]
        return original(command,*args,**kwargs)
    monkeypatch.setattr(srv.subprocess,'Popen',popen);monkeypatch.setattr(srv,'OPENCODE_BIN','synthetic-codex-for-timeout')
    monkeypatch.setattr(srv,'AI_REMOTE_ENABLED',True);monkeypatch.setattr(srv,'OPENCODE_TIMEOUT',.7)
    started=time.monotonic();assert srv.call_opencode_json('synthetic timeout prompt') is None
    assert time.monotonic()-started<5 and ai_controls.admission.snapshot()['active']==0
    assert child_pid.exists();pid=int(child_pid.read_text())
    if os.name=='nt':
        command=f"if(Get-Process -Id {pid} -ErrorAction SilentlyContinue){{exit 1}}"
        assert subprocess.run(['powershell.exe','-NoProfile','-Command',command],capture_output=True,timeout=5).returncode==0
    else:
        # A reaped or zombie child cannot execute or hold the model pipes open.
        status=__import__('pathlib').Path('/proc')/str(pid)/'status'
        assert not status.exists() or 'State:\tZ' in status.read_text()


def test_windows_codex_uses_official_node_launcher(tmp_path, monkeypatch):
    import server as srv
    from types import SimpleNamespace
    shim = tmp_path / 'codex.CMD'
    entry = tmp_path / 'node_modules' / '@openai' / 'codex' / 'bin' / 'codex.js'
    entry.parent.mkdir(parents=True)
    entry.write_text('// installed launcher', encoding='utf-8')
    monkeypatch.setattr(srv, '_os', SimpleNamespace(name='nt', environ={}))
    monkeypatch.setattr(srv.shutil, 'which', lambda name: {'codex': str(shim), 'node': 'node.exe'}.get(name))
    assert srv._find_codex() == str(entry)
    monkeypatch.setattr(srv, 'OPENCODE_BIN', str(entry))
    monkeypatch.setattr(srv, 'AI_MODEL', 'codex/gpt-6-luna')
    monkeypatch.setattr(srv, 'AI_REMOTE_ENABLED', True)
    class Process:
        returncode = 0
        def communicate(self, input, timeout):
            return '\n'.join(json.dumps(e) for e in [
                {'type': 'item.completed', 'item': {'type': 'agent_message', 'text': '{"reply":"OK"}'}},
                {'type': 'turn.completed'}]), ''
    def popen(command, **kwargs):
        assert command[:3] == ['node.exe', str(entry), 'exec']
        assert 'model_reasoning_effort="xhigh"' in command
        assert '--ephemeral' in command and command[-1] == '-'
        return Process()
    monkeypatch.setattr(srv.subprocess, 'Popen', popen)
    assert srv.call_opencode_json('synthetic prompt') == {'reply': 'OK'}


def test_windows_prefers_native_cli_over_broken_npm_shim(monkeypatch):
    import server as srv
    from types import SimpleNamespace
    monkeypatch.setattr(srv, '_os', SimpleNamespace(name='nt', environ={}))
    monkeypatch.setattr(srv.shutil, 'which', lambda name: {
        'codex.exe': 'C:/Codex/bin/codex.exe', 'codex': 'C:/npm/codex.CMD'}.get(name))
    assert srv._find_codex() == 'C:/Codex/bin/codex.exe'


def test_windows_finds_installed_app_cli_without_codex_app_path(tmp_path, monkeypatch):
    import server as srv
    from types import SimpleNamespace
    executable = tmp_path / 'OpenAI' / 'Codex' / 'bin' / 'installed-version' / 'codex.exe'
    executable.parent.mkdir(parents=True)
    executable.write_text('native fixture', encoding='utf-8')
    monkeypatch.setattr(srv, '_os', SimpleNamespace(name='nt', environ={'LOCALAPPDATA': str(tmp_path)}))
    monkeypatch.setattr(srv.shutil, 'which', lambda name: None)
    assert srv._find_codex() == str(executable)


@pytest.mark.parametrize('events,code,expected', [
    ([{'type': 'item.completed', 'item': {'type': 'error'}}, {'type': 'item.completed', 'item': {'type': 'agent_message', 'text': '{"reply":"OK"}'}}, {'type': 'turn.completed'}], 0, {'reply': 'OK'}),
    ([{'type': 'item.completed', 'item': {'type': 'agent_message', 'text': '{"reply":"OK"}'}}, {'type': 'turn.completed'}], 0, {'reply': 'OK'}),
    ([{'type': 'item.completed', 'item': {'type': 'agent_message', 'text': '{"reply":"OK"}'}}], 0, None),
    ([{'type': 'item.completed', 'item': {'type': 'command_execution'}}, {'type': 'turn.completed'}], 0, None),
    ([{'type': 'turn.completed'}], 1, None),
    ([{'type': 'item.completed', 'item': {'type': 'agent_message', 'text': 'not JSON'}}, {'type': 'turn.completed'}], 0, None),
])
def test_codex_transport_is_ephemeral_and_strict(monkeypatch, events, code, expected):
    import server as srv
    monkeypatch.setattr(srv, 'OPENCODE_BIN', 'codex.exe')
    monkeypatch.setattr(srv, 'AI_MODEL', 'codex/gpt-6-luna')
    monkeypatch.setattr(srv, 'AI_REMOTE_ENABLED', True)

    class Process:
        returncode = code
        def communicate(self, input, timeout):
            assert input == 'synthetic prompt' and timeout == 90
            return '\n'.join(json.dumps(e) for e in events), ''

    def popen(command, **kwargs):
        assert command[:2] == ['codex.exe', 'exec']
        assert '--ephemeral' in command and '--ignore-user-config' in command
        assert command[command.index('--sandbox') + 1] == 'read-only'
        assert command[command.index('-m') + 1] == 'gpt-6-luna'
        assert 'model_reasoning_effort="xhigh"' in command
        assert 'shell_tool' in command and 'plugins' in command and 'code_mode_host' in command
        for feature in ('image_generation', 'artifact', 'workspace_dependencies', 'goals', 'sleep_tool'):
            assert ['--disable', feature] == command[command.index(feature) - 1:command.index(feature) + 1]
        assert command[-1] == '-' and 'synthetic prompt' not in command
        assert os.path.isdir(kwargs['cwd']) and kwargs['cwd'] != str(srv.BASE)
        return Process()
    monkeypatch.setattr(srv.subprocess, 'Popen', popen)
    assert srv.call_opencode_json('synthetic prompt') == expected


def test_mentor_process_does_not_inherit_application_secrets(monkeypatch):
    import server as srv
    monkeypatch.setattr(srv, 'OPENCODE_BIN', 'codex.exe')
    monkeypatch.setattr(srv, 'AI_MODEL', 'codex/gpt-6-luna')
    monkeypatch.setattr(srv, 'AI_REMOTE_ENABLED', True)
    monkeypatch.setenv('PYCLOUD_SANDBOX_CANARY', 'synthetic-secret')
    monkeypatch.setenv('OPENAI_API_KEY', 'synthetic-key')
    monkeypatch.setenv('DATABASE_URL', 'synthetic-db')

    class Process:
        returncode = 0

        def communicate(self, input, timeout):
            return '\n'.join(json.dumps(event) for event in [
                {'type': 'item.completed', 'item': {'type': 'agent_message', 'text': '{"reply":"OK"}'}},
                {'type': 'turn.completed'},
            ]), ''

    def popen(command, **kwargs):
        assert not {'PYCLOUD_SANDBOX_CANARY', 'OPENAI_API_KEY', 'DATABASE_URL'} & kwargs['env'].keys()
        assert kwargs['env'].get('PATH') == os.environ.get('PATH')
        return Process()

    monkeypatch.setattr(srv.subprocess, 'Popen', popen)
    assert srv.call_opencode_json('synthetic prompt') == {'reply': 'OK'}
