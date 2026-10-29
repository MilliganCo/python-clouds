"""Explain a failed report comparison without repeating learner calls."""
import contextlib,io,json,sys
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT));import build_tasks


def stages():
    section=build_tasks.SRC.read_text(encoding='utf-8').split('\n## Мини-квесты на своём компьютере\n',1)[1]
    return next(q for q in json.loads(build_tasks.first_fence(section)[1]) if q['id']=='practice_csv_report')['stages']


CASES=[(0,"int(frame['qty'].sum())","len(clean)",'audit_sales',2),
       (1,"group['qty'], group['amount_cents']","group['qty'], 0",'write_sales_excel',1),
       (2,"[row['amount_cents'] for row in rows]","[row['qty'] for row in rows]",'plot_sales',1)]


@pytest.mark.parametrize('index,old,new,function,calls_expected',CASES)
def test_failure_names_data_expected_actual_and_does_not_repeat_calls(index,old,new,function,calls_expected):
    stage=stages()[index];ns={};exec(stage['reference_code'].replace(old,new),ns)
    original=ns[function];calls=[]
    def tracked(*args):calls.append(args);return original(*args)
    ns[function]=tracked
    with contextlib.redirect_stdout(io.StringIO()),pytest.raises(AssertionError) as failure:
        exec(stage['check']['append'],ns)
    message=str(failure.value)
    assert all(label in message for label in ('Проверка:','Данные:','Ожидалось:','Получено:'))
    assert len(calls)==calls_expected
    assert len(message.encode('utf-8'))<4096


@pytest.mark.parametrize('index',[0,1,2])
def test_success_does_not_format_diagnostics(index):
    stage=stages()[index];helper,body=stage['check']['append'].split('import copy as _copy',1)
    ns={};exec(stage['reference_code'],ns);exec(helper,ns)
    def unwanted(*args):pytest.fail('Successful comparisons must not format learner values')
    ns['_report_feedback']=unwanted
    with contextlib.redirect_stdout(io.StringIO()):exec('import copy as _copy'+body,ns)


@pytest.mark.parametrize('value',['я'*100000,{'data':['x'*10000]*50},list(range(10000)),None,'<img src=x onerror=alert(1)>','\ud800'],
    ids=['long-text','nested','long-list','none','markup','surrogate'])
def test_value_preview_is_bounded_and_utf8_encodable(value):
    helper=stages()[0]['check']['append'].split('import copy as _copy',1)[0]
    ns={};exec(helper,ns)
    shown=ns['_report_value'](value)
    assert isinstance(shown,str) and len(shown.encode('utf-8'))<=700
    message=ns['_report_feedback']('Пример',value,value,value)
    assert len(message.encode('utf-8'))<4096


def test_recursive_and_unprintable_values_do_not_replace_original_comparison():
    helper=stages()[0]['check']['append'].split('import copy as _copy',1)[0]
    ns={};exec(helper,ns);loop=[];loop.append(loop)
    assert len(ns['_report_value'](loop))<700
    def broken(value):raise ValueError('repr failed')
    ns['_report_repr'].repr=broken
    assert ns['_report_value'](object())=='<не удалось представить значение>'


@pytest.mark.parametrize('index,function',[(0,'audit_sales'),(1,'write_sales_excel'),(2,'plot_sales')])
def test_real_learner_exception_keeps_type_and_message(index,function):
    class ExpectedProblem(RuntimeError):pass
    def broken(*args):raise ExpectedProblem('real learner failure')
    with pytest.raises(ExpectedProblem,match='real learner failure'):
        exec(stages()[index]['check']['append'],{function:broken})


def test_invalid_csv_return_is_explained_without_a_second_call():
    stage=stages()[0];ns={};exec(stage['reference_code'],ns);original=ns['audit_sales'];returned=[]
    def weak(text):
        if not text:returned.append(text);return {'rows':0,'qty':0,'amount_cents':0,'groups':[]}
        return original(text)
    ns['audit_sales']=weak
    with contextlib.redirect_stdout(io.StringIO()),pytest.raises(AssertionError) as failure:
        exec(stage['check']['append'],ns)
    assert 'ValueError' in str(failure.value) and 'Получено:' in str(failure.value)
    assert returned==['']


@pytest.mark.parametrize('kind,value,expected',[('int64',5,'5'),('uint64',2**64-1,str(2**64-1)),
    ('float32',2.5,'2.5'),('float64',3.75,'3.75')])
def test_known_numpy_scalar_previews_keep_numbers_without_library_wrappers(kind,value,expected):
    import numpy as np
    helper=stages()[0]['check']['append'].split('import copy as _copy',1)[0]
    ns={};exec(helper,ns)
    scalar=getattr(np,kind)(value)
    assert ns['_report_value'](scalar)==expected
    assert ns['_report_value']([scalar])=='['+expected+']'


def helper():
    ns={};exec(stages()[0]['check']['append'].split('import copy as _copy',1)[0],ns);return ns


def test_hidden_seventh_group_reports_exact_first_differing_field():
    import copy
    ns=helper();expected={'groups':[{'item':'G'+str(i),'qty':1,'amount_cents':10} for i in range(7)]}
    actual=copy.deepcopy(expected);actual['groups'][6]['qty']=2
    assert ns['_report_value'](expected)==ns['_report_value'](actual)
    message=ns['_report_feedback']('Сводка',{'rows':7},expected,actual)
    assert 'groups[6].qty' in message and 'Ожидалось: 1' in message and 'Получено: 2' in message


@pytest.mark.parametrize('a,b,path',[(list(range(20)),list(range(20))+[20],'длина'),
    ({'a':1},{},'a'),({'a':1},{'a':1,'b':2},'b'),({'a':1},{'a':True},'тип'),
    (['A'],('A',),'тип'),({'groups':[{'qty':1}]},{'groups':[{'qty':2}]},'groups[0].qty')])
def test_plain_data_difference_has_a_path(a,b,path):
    difference=helper()['_report_first_difference'](a,b)
    assert difference is not None and path in difference[0]


def test_difference_search_does_not_call_custom_equality_or_iterators():
    class Trap:
        def __eq__(self,other):pytest.fail('Custom comparison must not run')
        def __iter__(self):pytest.fail('Custom iteration must not run')
    class TrapList(list):
        def __iter__(self):pytest.fail('Subclass iteration must not run')
    ns=helper()
    assert ns['_report_first_difference'](Trap(),Trap()) is None
    assert ns['_report_first_difference'](TrapList([1]),TrapList([2])) is None
    assert ns['_report_first_difference']({'a':Trap()},{'a':Trap()}) is None
    class Meta(type):
        def __eq__(self,other):pytest.fail('Metaclass comparison must not run')
    class MetaTrap(metaclass=Meta):pass
    assert ns['_report_first_difference'](MetaTrap(),MetaTrap()) is None


def test_difference_search_bounds_depth_cycles_and_scan():
    ns=helper();left=[];right=[];left.append(left);right.append(right)
    assert ns['_report_first_difference'](left,right) is None
    a=list(range(10000));b=a.copy();b[-1]=-1
    assert ns['_report_first_difference'](a,b) is None
    message=ns['_report_feedback']('Длинный список',None,a,b)
    assert 'не доказывает равенство' in message and len(message.encode('utf-8'))<4096
