"""Launcher diagnostics are not learner stdout; raw output after start is preserved."""
import io
import json
from types import SimpleNamespace

import pytest
import sandbox_runner as sandbox


def read_stream(monkeypatch, preamble, raw_solution=b'', raw_check=b'', exit_code=0, started=True):
    docker = SimpleNamespace(call=lambda args: json.dumps([{'State':{'ExitCode':exit_code}}]).encode())
    job = sandbox.Job(SimpleNamespace(docker=docker), 900001,
                      {'code':'', 'check':'', 'interactive':False, 'reportTests':False})
    def frame(kind, **data):
        return b'\x1e' + json.dumps({'id':job.id,'type':kind,**data}).encode() + b'\n'
    data = preamble + frame('status',text='')
    if started:
        data += frame('execution_start') + frame('phase',phase='solution')
        data += raw_solution + frame('output',phase='solution',chunk='OK\n')
        data += frame('phase',phase='check') + raw_check
        data += frame('result',stdout='OK\n',user_stdout='OK\n',check_stdout='',error=None,failure=None)
    job.process = SimpleNamespace(stdout=io.BytesIO(data),wait=lambda timeout:0)
    monkeypatch.setattr(job,'close',lambda:None)
    job._read()
    events=[]
    while not job.events.empty():
        events.append(job.events.get_nowait())
    return next(e for e in events if e['type']=='result')


@pytest.mark.parametrize('preamble', [b'WSL startup warning\n', 'wsl: служебное предупреждение\r\n'.encode('utf-16-le'), b'x'*5000, 'Ошибка WSL\r\n'.encode('utf-16-le'), 'Ошибка без переноса'.encode('utf-16-le')], ids=['utf8','utf16','chunked','utf16-marker','utf16-inline-marker'])
def test_preamble_does_not_change_exact_output(monkeypatch,preamble):
    result=read_stream(monkeypatch,preamble)
    assert result['stdout']=='OK\n' and result['user_stdout']=='OK\n'
    assert result['check_stdout']=='' and result['error'] is None


def test_native_output_after_start_is_preserved_in_its_phase(monkeypatch):
    result=read_stream(monkeypatch,b'host warning\n',b'wsl: student message\n',b'raw check output\n')
    assert result['user_stdout']=='wsl: student message\nOK\n'
    assert result['check_stdout']=='raw check output\n'
    assert result['stdout']=='wsl: student message\nOK\nraw check output\n'


def test_bootstrap_failure_is_reported_without_fake_student_output(monkeypatch):
    result=read_stream(monkeypatch,b'launcher failed\n',exit_code=127,started=False)
    assert result['error'] and result['stdout']==''


def test_bad_frame_after_start_is_still_an_error(monkeypatch):
    result=read_stream(monkeypatch,b'launcher warning\n',raw_solution=b'\x1enot json\n')
    assert result['error'] and result['stdout']==''
