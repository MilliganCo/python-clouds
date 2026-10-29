"""Preview uses bounded header/chunk inspection, not guest-provided dimensions."""
import base64
import struct
import zlib

import pytest

from execution_artifacts import normalize_artifacts,png_preview


def chunk(kind,data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)


def png(width=1,height=1,extra=b''):
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+extra+chunk(b'IDAT',zlib.compress(b'\x00\x00\x00\x00\xff'))+chunk(b'IEND',b'')


def test_real_one_pixel_header_is_available_and_guest_metadata_is_ignored():
    data=png();file={'name':'plot.png','data':base64.b64encode(data).decode(),'preview':{'width':99999,'height':99999},'description':'Одна точка'}
    result=normalize_artifacts([file])[0]
    assert result['preview']=={'width':1,'height':1}
    assert result['description']=='Одна точка'


@pytest.mark.parametrize('value',[png(0,1),png(5000,1),png(2048,2048),png()[:-1],png()+b'trailing',b'\x89PNG\r\n\x1a\nsmall',png(extra=chunk(b'acTL',struct.pack('>II',2,0)))],ids=['zero','too-wide','too-many-pixels','truncated','trailing','signature-only','animated'])
def test_unsupported_png_stays_download_only(value):
    assert png_preview(value) is None
    file=normalize_artifacts([{'name':'plot.png','data':base64.b64encode(value).decode()}])[0]
    assert 'preview' not in file


def test_bad_crc_is_not_previewed():
    value=bytearray(png());value[29]^=1
    assert png_preview(bytes(value)) is None


@pytest.mark.parametrize('description',[True,'x'*501,'bad\x00','\ud800'],ids=['type','length','control','surrogate'])
def test_invalid_descriptions_do_not_enter_json_or_alt(description):
    with pytest.raises(ValueError):normalize_artifacts([{'name':'plot.png','data':base64.b64encode(png()).decode(),'description':description}])


def test_missing_description_does_not_change_old_xlsx_metadata():
    file=normalize_artifacts([{'name':'a.xlsx','data':base64.b64encode(b'PK\x03\x04data').decode()}])[0]
    assert set(file)=={'name','data','size','mime'}
