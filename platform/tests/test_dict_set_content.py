"""Mappings aggregate values without losing zero keys; set operations preserve inputs."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def tasks():
    result={task['id']:task for topic in build_tasks.parse() if topic['id'] in (10,11) for task in topic['tasks']}
    assert len(result)==19
    return result


def checked(task,code):
    ns={}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(code,ns)
    out=io.StringIO()
    with contextlib.redirect_stdout(out):
        exec(task['check']['append'],ns)
    assert out.getvalue().strip()=='OK'


@pytest.mark.parametrize('task_id',['10.3','10.5','10.6','10.8','10.9','11.6','11.7','11.8','11.9','11.10'])
def test_canonical_references(tasks,task_id):
    checked(tasks[task_id],build_tasks._reference_program(tasks[task_id]))


@pytest.mark.parametrize(('task_id','code'),[
    ('10.3',"text='a b a c b a'\ncounts=\"{'a': 3, 'b': 2, 'c': 1}\"\nprint(counts)"),
    ('10.5',"prices={'хлеб':10,'сыр':20,'чай':30}\ntotal='60'\nprint(total)"),
    ('10.6',"d=\"{'a': 1, 'b': 2, 'c': 3}\"\nprint(d)"),
    ('10.8','def sales_totals(orders):\n    out={}\n    for name,count in orders:\n        if count:\n            out[name]=out.get(name,0)+count\n    return out'),
    ('10.8','from collections import Counter\ndef sales_totals(orders):\n    out=Counter()\n    for name,count in orders:\n        out[name]+=count\n    return +out'),
    ('10.8','def sales_totals(orders):\n    out={}\n    while orders:\n        name,count=orders.pop(0)\n        out[name]=out.get(name,0)+count\n    return out'),
    ('10.8','def sales_totals(orders):\n    out={}\n    for name,count in orders:\n        name=name.lower()\n        out[name]=out.get(name,0)+count\n    return out'),
    ('10.8','def sales_totals(orders):\n    out={}\n    for name,count in orders:\n        out[name]=(out.get(name,0)+count) or False\n    return out'),
    ('10.9','def missing_stock(wanted,stock):\n    out={}\n    for name,count in wanted.items():\n        missing=count-stock.get(name,0)\n        if missing>=0:\n            out[name]=missing\n    return out'),
    ('10.9','def missing_stock(wanted,stock):\n    out={}\n    for name,count in wanted.items():\n        missing=count-stock.setdefault(name,0)\n        if missing>0:\n            out[name]=missing\n    return out'),
    ('11.6','s=[1,2,3]\nprint(sorted(s))'),
    ('11.7','a={1,2,3}\nb={2,3,4}\nboth=sorted(a&b)\nprint(sorted(both))'),
    ('11.7','a={1,2,3}\nb={2,3,4}\na.intersection_update(b)\nboth=a\nprint(sorted(both))'),
    ('11.8','def unique_count(items):\n    return len(set(items)) or False'),
    ('11.8','def unique_count(items):\n    return len(set(str(item) for item in items))'),
    ('11.9','def new_members(previous,current):\n    current[:]=set(current)-set(previous)\n    return set(current)'),
    ('11.10','def compare_tags(left,right):\n    a,b=set(left),set(right)\n    left.clear()\n    right.clear()\n    return a&b,a^b'),
])
def test_rejects_wrong_types_lost_zero_keys_and_mutation(tasks,task_id,code):
    with pytest.raises(AssertionError):
        checked(tasks[task_id],code)


@pytest.mark.parametrize(('task_id','code'),[
    ('10.3',"text='a b a c b a'\ncounts={}\nfor word in text.split():\n    if word not in counts:\n        counts[word]=0\n    counts[word]+=1\nprint(counts)"),
    ('10.5',"prices={'хлеб':10,'сыр':20,'чай':30}\ntotal=0\nfor price in prices.values():\n    total+=price\nprint(total)"),
    ('10.6',"d={'a':1,'b':2}\nd.update(c=3)\nprint(d)"),
    ('10.8','def sales_totals(orders):\n    totals={}\n    for name,count in orders:\n        if name not in totals:\n            totals[name]=0\n        totals[name]+=count\n    return totals'),
    ('10.9','def missing_stock(wanted,stock):\n    out={}\n    for name in wanted:\n        difference=wanted[name]-stock.get(name,0)\n        if difference>0:\n            out[name]=difference\n    return out'),
    ('11.6','s=frozenset([1,2,2,3,3,3])\nprint(sorted(s))'),
    ('11.7','a={1,2,3}\nb={2,3,4}\nboth=a.intersection(b)\nprint(sorted(both))'),
    ('11.8','def unique_count(items):\n    seen=[]\n    for value in items:\n        if value not in seen:\n            seen.append(value)\n    return len(seen)'),
    ('11.8','def unique_count(items):\n    assert isinstance(items,list)\n    return len(set(items))'),
    ('11.9','def new_members(previous,current):\n    return frozenset(current).difference(previous)'),
    ('11.10','def compare_tags(left,right):\n    a,b=frozenset(left),frozenset(right)\n    common=a&b\n    return common,(a|b)-common'),
])
def test_equivalent_dict_and_set_algorithms(tasks,task_id,code):
    checked(tasks[task_id],code)


def test_theory_small_examples_and_hints():
    support=build_tasks._load_support_content()
    for topic,count,ordinary in ((10,12,7),(11,8,8)):
        examples=[e for section in support['theory'][str(topic)]['sections'] for e in section['examples']]
        assert len(examples)==count and all('output' in e and not e.get('context') for e in examples)
        assert all(support['hints'].get(f'{topic}.{i}') for i in range(1,ordinary+1))
    unordered=[e for section in support['theory']['11']['sections'] for e in section['examples'] if e.get('outputKind')=='unordered']
    assert len(unordered)==1 and unordered[0].get('resultNote')


@pytest.mark.parametrize(('task_id','code','ok'),[
    ('10.6',None,True),
    ('10.6',"d={'a':1,'b':2,'c':3}",False),
    ('10.8','from collections import Counter\ndef sales_totals(orders):\n    out=Counter()\n    for name,count in orders:\n        out[name]+=count\n    return +out',False),
    ('11.9','def new_members(previous,current):\n    current[:]=set(current)-set(previous)\n    return set(current)',False),
])
def test_actual_runner_preserves_mixed_stdout_and_catches_contract_failure(tasks,task_id,code,ok):
    import importlib.util
    path=Path(__file__).resolve().parents[1]/'sandbox_http_plots/runner.py'
    spec=importlib.util.spec_from_file_location('dict_set_runner_test',path)
    runner=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    task=tasks[task_id]
    events=[]
    result=runner.execute({'code':build_tasks._reference_program(task) if code is None else code,
                          'check':task['check']['append'],'interactive':False,'reportTests':True},
                         io.StringIO(),lambda kind,**data:events.append((kind,data)))
    assert any(kind=='test_event' and data['event']['type']=='plan' for kind,data in events)
    passed=result['error'] is None and build_tasks._normalized_output(result['stdout'])==build_tasks._normalized_output(task['check']['expect'])
    assert passed is ok
    if task_id=='10.6':
        assert result['error'] is None and result['check_stdout']=='OK\n'
        assert bool(result['user_stdout']) is ok
    else:
        assert result['failure']['source']=='check' and result['failure']['type']=='AssertionError'


def test_unordered_theory_output_under_different_hash_seeds():
    import ast
    import os
    import subprocess
    support=build_tasks._load_support_content()
    example=next(e for section in support['theory']['11']['sections'] for e in section['examples'] if e.get('outputKind')=='unordered')
    for seed in ('1','7','31'):
        environment=os.environ.copy()
        environment['PYTHONHASHSEED']=seed
        result=subprocess.run([sys.executable,'-S','-P','-X','utf8','-c',example['code']],env=environment,
                              capture_output=True,encoding='utf-8',timeout=6)
        assert result.returncode==0,result.stderr
        actual=result.stdout.rstrip('\n').splitlines()
        expected=example['output'].splitlines()
        assert len(actual)==len(expected)
        assert all(a==b or ast.literal_eval(a)==ast.literal_eval(b) for a,b in zip(actual,expected))
