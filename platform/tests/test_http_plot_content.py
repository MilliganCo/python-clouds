"""HTTP failure semantics and graph data semantics; no external HTTP or GUI."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def stages():
    return {t['id']:t for p in build_tasks.parse() if p['id'] in (59,60) for t in p['tasks']}


def checked(task,source):
    output=io.StringIO()
    try:
        with contextlib.redirect_stdout(output):exec(source+'\n'+task['check']['append'],{})
        assert output.getvalue().strip()=='OK'
    finally:
        plot=sys.modules.get('matplotlib.pyplot')
        if plot:plot.close('all')


@pytest.mark.parametrize('id',[f'{topic}.{i}' for topic in (59,60) for i in (2,4,5,6,8,9,10) if topic==59]+[f'60.{i}' for i in (2,4,5,7,8,9,10)])
def test_http_and_graph_references_and_incomplete_programs(stages,id):
    task=stages[id];checked(task,task['answer'])
    for wrong in [task['code'],"print('OK')"]:
        with pytest.raises(Exception):checked(task,wrong)


@pytest.mark.parametrize(('id','before','after'),[
    ('59.6','if size>8192:','if size>20000:'),
    ('59.6','stream=True','stream=False'),
    ('59.9',"_same_origin(data['next'],current)","_same_origin(data['next'],url)"),
    ('59.9','for page in range(3):','for page in range(4):'),
    ('59.10','if temperature is None:','if not temperature:'),
])
def test_http_checks_read_limits_relative_pages_and_zero(stages,id,before,after):
    task=stages[id];wrong=task['answer'].replace(before,after);assert wrong!=task['answer']
    with pytest.raises(Exception):checked(task,wrong)


def test_weather_must_not_turn_timeout_into_data(stages):
    task=stages['59.10'];wrong=task['answer']+'''
_original_weather=weather_report
def weather_report(session,url):
    import requests
    try:return _original_weather(session,url)
    except requests.Timeout:return 'X: нет данных, ясно'
'''
    with pytest.raises(AssertionError,match='Таймаут'):checked(task,wrong)


@pytest.mark.parametrize(('id','before','after'),[
    ('60.9',"totals.get(row['sku'],0)+row['qty']","row['qty']"),
    ('60.10','np.nan if value is None else value','0 if value is None else value'),
    ('60.10','sharex=True','sharex=False'),
    ('60.10',"linestyle='--'","linestyle='-'"),
    ('60.8',"open('xb')","open('wb')"),
])
def test_graph_checks_aggregation_gaps_shared_axis_and_overwrite(stages,id,before,after):
    task=stages[id];wrong=task['answer'].replace(before,after);assert wrong!=task['answer']
    with pytest.raises(AssertionError):checked(task,wrong)


def test_valid_bar_tick_label_alternative_is_accepted(stages):
    task=stages['60.4']
    alternative=task['answer'].replace('ax.bar(positions,values)','ax.bar(positions,values,tick_label=labels)').replace('    ax.set_xticks(positions,labels)\n','')
    checked(task,alternative)


def test_material_and_actual_http_fixture_are_present():
    support=build_tasks._load_support_content()
    for topic in (59,60):
        article=support['theory'][str(topic)]
        examples=[example for section in article['sections'] for example in section['examples']]
        assert len(examples)==12 and all('output' in example and not example.get('context') for example in examples)
        assert all(support['hints'].get(f'{topic}.{i}') for i in range(1,9))
        assert all(support['intros'][f'{topic}.{i}']['source']=='authored' for i in range(1,11))
    assert any('HTTPServer' in ex['code'] for section in support['theory']['59']['sections'] for ex in section['examples'])
