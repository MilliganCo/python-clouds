"""Binary output is bounded data, not a guest-controlled URL or host path."""
import base64

import pytest

from execution_artifacts import MAX_FILE_BYTES, MAX_TOTAL_BYTES, normalize_artifacts
from sandbox_runner import normalized_event


def artifact(name='report.xlsx', data=b'PK\x03\x04small workbook'):
    return dict(name=name,data=base64.b64encode(data).decode('ascii'))


def test_result_metadata_and_identity_come_from_host():
    guest=artifact() | {'uid':999,'url':'https://bad.invalid/','mime':'text/html','size':0,'path':'/etc/passwd'}
    result=normalized_event(dict(type='result',stdout='',error=None,artifacts=[guest],id='guest'),'owned-job')
    assert result['id']=='owned-job'
    file=result['artifacts'][0]
    assert set(file)=={'name','data','mime','size'}
    assert file['mime']=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    assert file['size']==len(base64.b64decode(guest['data']))


@pytest.mark.parametrize('name',['../report.xlsx','/tmp/a.xlsx','a\\b.xlsx','<img>.xlsx','foo.xlsx ','a\x00.xlsx','a.html','no-extension','.hidden.xlsx','a:1.xlsx'])
def test_bad_names_are_rejected(name):
    with pytest.raises(ValueError):normalize_artifacts([artifact(name)])


@pytest.mark.parametrize('value',[None,{},'file',[None],[{}],[artifact()]*4])
def test_only_bounded_lists_are_allowed(value):
    with pytest.raises(ValueError):normalize_artifacts(value)


def test_limits_and_duplicate_names():
    with pytest.raises(ValueError):normalize_artifacts([artifact(data=b'PK\x03\x04'+b'x'*MAX_FILE_BYTES)])
    raw=b'PK\x03\x04'+b'x'*(MAX_FILE_BYTES-4)
    assert len(normalize_artifacts([artifact('one.xlsx',raw),artifact('two.xlsx',raw)]))==2
    with pytest.raises(ValueError):normalize_artifacts([artifact('one.xlsx',raw),artifact('two.xlsx',raw),artifact('three.xlsx')])
    with pytest.raises(ValueError):normalize_artifacts([artifact('same.xlsx'),artifact('SAME.xlsx')])
    assert 2*MAX_FILE_BYTES==MAX_TOTAL_BYTES


@pytest.mark.parametrize('data',['????','A'*(4*((MAX_FILE_BYTES+2)//3)+1),'é',''],ids=['invalid','oversized','non-ascii','empty'])
def test_bad_or_large_base64_is_rejected(data):
    with pytest.raises(ValueError):normalize_artifacts([dict(name='a.xlsx',data=data)])


def test_extension_requires_matching_signature():
    with pytest.raises(ValueError):normalize_artifacts([artifact(data=b'<html>fake</html>')])
    assert normalize_artifacts([artifact('plot.png',b'\x89PNG\r\n\x1a\nbytes')])[0]['mime']=='image/png'


def test_ordinary_results_do_not_gain_new_fields():
    result=normalized_event(dict(type='result',stdout='4\n',error=None),'id')
    assert 'artifacts' not in result


def test_unpaired_surrogates_cannot_break_the_http_json_stream():
    with pytest.raises(ValueError,match='Unicode'):
        normalize_artifacts([artifact('\ud800.xlsx')])
