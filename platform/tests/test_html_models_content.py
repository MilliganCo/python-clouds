"""HTML boundaries and typed input contracts, not text matching to a reference."""
import ast
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def stages():
    return {t['id']:t for p in build_tasks.parse() if p['id'] in (57,58) for t in p['tasks']}


def checked(task,source):
    stream=io.StringIO()
    with contextlib.redirect_stdout(stream):exec(source+'\n'+task['check']['append'],{})
    assert stream.getvalue().strip()=='OK'


@pytest.mark.parametrize('id',[f'{topic}.{i}' for topic in (57,58) for i in (2,3,5,6,8,9,10)])
def test_html_and_model_references_reject_starter_and_print_only(stages,id):
    task=stages[id];checked(task,task['answer'])
    for incomplete in [task['code'],"print('OK')"]:
        with pytest.raises(Exception):checked(task,incomplete)


@pytest.mark.parametrize(('before','after'),[
    ("select('.catalog .product')","select('.product')"),
    ('len(prices)!=1','not prices'),
    ('len(titles)!=1','not titles'),
    ('len(anchors)!=1','not anchors'),
    ('int(rubles)*100+int(kopeks)',"int(float(text.replace(',','.'))*100)"),
    ("parts.port if parts.port is not None else (443 if parts.scheme=='https' else 80)","parts.port or (443 if parts.scheme=='https' else 80)"),
])
def test_html_final_checks_context_ambiguity_precision_and_zero_port(stages,before,after):
    task=stages['57.9'];source=task['answer'].replace(before,after);assert source!=task['answer']
    with pytest.raises(AssertionError):checked(task,source)


def test_bad_duplicate_must_not_hide_good_record(stages):
    task=stages['57.9'];source=task['answer'].replace('sku=sku.strip()','sku=sku.strip()\n        duplicate=sku in seen;seen.add(sku)').replace('if sku in seen:continue','if duplicate:continue')
    with pytest.raises(AssertionError):checked(task,source)


@pytest.mark.parametrize(('before','after'),[
    ('0<=int(hours)<=24','0<int(hours)<=24'),
    ('day in seen','False'),
    ("raise ValueError('invalid row')",'continue'),
])
def test_schedule_requires_whole_valid_table(stages,before,after):
    task=stages['57.10'];source=task['answer'].replace(before,after);assert source!=task['answer']
    with pytest.raises((AssertionError,ValueError)):checked(task,source)


@pytest.mark.parametrize(('before','after'),[
    ('strict=True','strict=False'),
    ("extra='forbid'","extra='ignore'"),
    ("mode='before'","mode='after'"),
])
def test_nested_model_checks_strict_extra_and_normalization_order(stages,before,after):
    task=stages['58.9'];source=task['answer'].replace(before,after);assert source!=task['answer']
    with pytest.raises(Exception):checked(task,source)


def test_json_journal_requires_default_none_and_no_raw_input(stages):
    task=stages['58.10']
    with pytest.raises(AssertionError):checked(task,task['answer'].replace('order.model_dump()','order.model_dump(exclude_none=True)'))
    source=task['answer']+'''
_original_audit=audit_json_lines
def audit_json_lines(lines):
    result=_original_audit(lines)
    for row in result['rejected']:
        row['input']='not allowed'
    return result
'''
    with pytest.raises(AssertionError):checked(task,source)


def test_catalog_correct_global_strip_configuration_is_accepted(stages):
    task=stages['58.9']
    source='''from pydantic import BaseModel,ConfigDict,Field
class CatalogItem(BaseModel):
    model_config=ConfigDict(strict=True,extra='forbid',str_strip_whitespace=True)
    sku:str=Field(min_length=1,max_length=40)
    qty:int=Field(ge=0,le=10000)
    price_kopeks:int=Field(ge=0,le=10000)
class Catalog(BaseModel):
    model_config=ConfigDict(strict=True,extra='forbid',str_strip_whitespace=True)
    batch:str=Field(min_length=1,max_length=32)
    items:list[CatalogItem]=Field(max_length=50)
def parse_catalog(data):
    return Catalog.model_validate(data).model_dump()
'''
    checked(task,source)


def test_css_attribute_selector_alternative_is_accepted(stages):
    task=stages['57.9']
    source=task['answer'].replace("'.catalog .product'","'[class~=catalog] [class~=product]'")
    checked(task,source)


def test_new_material_outputs_and_help_are_complete(stages):
    support=build_tasks._load_support_content()
    for topic in (57,58):
        article=support['theory'][str(topic)]
        examples=[e for section in article['sections'] for e in section['examples']]
        assert len(examples)==12
        for example in examples:
            stream=io.StringIO()
            with contextlib.redirect_stdout(stream):exec(example['code'],{})
            assert stream.getvalue().rstrip('\n')==example['output']
        assert all(support['hints'].get(f'{topic}.{i}') for i in range(1,9))
        assert all(support['intros'][f'{topic}.{i}']['source']=='authored' for i in range(1,11))
        assert [stages[f'{topic}.{i}']['finale'] for i in (9,10)]==[1,2]
    for id in ('58.8','58.10'):
        handlers=[node for node in ast.walk(ast.parse(stages[id]['answer'])) if isinstance(node,ast.ExceptHandler)]
        assert handlers and all(isinstance(node.type,ast.Name) and node.type.id=='ValidationError' for node in handlers)
