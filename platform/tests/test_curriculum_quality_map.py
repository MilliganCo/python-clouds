"""An editorial map must remain tied to real content, without changing curriculum gates."""
import copy,json,runpy,sys
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'platform/scripts'));import curriculum_quality as quality


@pytest.fixture
def sample():
    # IDs intentionally don't follow course order: prerequisites use presentation order.
    topics=[{'id':10,'title':'Start','tasks':[{'id':'10.1','title':'One','finale':1,'check':{'append':'x'}},
        {'id':'10.2','title':'Two','finale':2,'check':{'append':'x'}}]},
        {'id':3,'title':'Next','prerequisites':[10],'tasks':[{'id':'3.1','title':'One','finale':1,'check':{'append':'x'}},
        {'id':'3.2','title':'Two','finale':2,'check':{'append':'x'}}]}]
    article={'sections':[{'title':'Example','text':'<code>x</code>','examples':[{'code':'print(1)','output':'<p>`1`</p>'}]}],
             'mistakes':['A real mistake']}
    support={'theory':{'10':copy.deepcopy(article),'3':copy.deepcopy(article)},'hints':{},'intros':{}}
    records=[{'id':t['id'],'prerequisites_editorial':[] if i==0 else [{'id':10,'reason':'Uses Start'}],
        'terms':['first','second'],'example_section':0,'error_index':0,'finale_note':'Two independent behaviors.','gap':''}
        for i,t in enumerate(topics)]
    return {'version':1,'date':'2026-10-21','topics':records},topics,support


def test_map_uses_course_order_and_preserves_output_characters(sample):
    notes,topics,support=sample
    text=quality.render(notes,topics,support,source_locator=lambda _:('source.js',1))
    assert text.index('## 10.')<text.index('## 3.')
    assert '<p>`1`</p>' in text and 'A real mistake' in text
    assert 'не оценка ученика' in text
    assert 'curriculum-quality-source:' in text


@pytest.mark.parametrize('mutation',['missing-topic','duplicate-topic','future-foundation','changed-declared',
    'missing-example','missing-output','bad-error','missing-finale','empty-terms','unknown-field','boolean-id'])
def test_broken_or_unproven_anchors_are_rejected(sample,mutation):
    notes,topics,support=sample
    if mutation=='missing-topic':notes['topics'].pop()
    elif mutation=='duplicate-topic':notes['topics'][1]['id']=10
    elif mutation=='future-foundation':notes['topics'][0]['prerequisites_editorial']=[{'id':3,'reason':'Later'}]
    elif mutation=='changed-declared':notes['topics'][1]['prerequisites_editorial']=[]
    elif mutation=='missing-example':notes['topics'][0]['example_section']=9
    elif mutation=='missing-output':support['theory']['10']['sections'][0]['examples'][0]['output']=None
    elif mutation=='bad-error':notes['topics'][0]['error_index']=9
    elif mutation=='missing-finale':topics[0]['tasks'].pop()
    elif mutation=='empty-terms':notes['topics'][0]['terms']=[]
    elif mutation=='unknown-field':notes['topics'][0]['confidence']=100
    elif mutation=='boolean-id':notes['topics'][0]['id']=True
    with pytest.raises(ValueError):quality.validate(notes,topics,support)


def test_fingerprint_detects_content_and_intro_drift_without_learner_data(sample):
    notes,topics,support=sample
    original=quality.fingerprint(topics,support)
    support['theory']['10']['sections'][0]['examples'][0]['output']='2'
    assert quality.fingerprint(topics,support)!=original
    support['theory']['10']['sections'][0]['examples'][0]['output']='<p>`1`</p>'
    support['intros']['10.1']={'goal':'Changed'}
    assert quality.fingerprint(topics,support)!=original


def test_sample_output_is_labelled_and_requires_its_note(sample):
    notes,topics,support=sample;ex=support['theory']['10']['sections'][0]['examples'][0]
    ex['outputKind']='environment'
    with pytest.raises(ValueError):quality.validate(notes,topics,support)
    ex['resultNote']='Path depends on the machine'
    text=quality.render(notes,topics,support,source_locator=lambda _:('source.js',1))
    assert 'зависит от окружения' in text


def test_actual_map_has_every_current_topic_and_fresh_source_signature():
    notes=json.loads(quality.NOTES.read_text(encoding='utf-8'))
    topics=quality.build_tasks.parse();support=quality.build_tasks._load_support_content()
    assert len(quality.validate(notes,topics,support))==66
    assert quality.REPORT.read_text(encoding='utf-8')==quality.render(notes,topics,support)


@pytest.mark.parametrize('topic_id',[27,28,50])
def test_reviewed_goals_are_specific_and_generator_owned(topic_id):
    generator=runpy.run_path(str(ROOT/'platform/scripts/enrich_task_intros.py'))
    support=quality.build_tasks._load_support_content()
    topic=next(t for t in quality.build_tasks.parse() if t['id']==topic_id)
    for task in topic['tasks']:
        if topic_id in (27,28) and task.get('finale'):continue
        intro=generator['build_intro'](task)
        assert intro['source']=='authored' and intro['example'] is None
        assert intro['goal'] not in generator['TYPE_GOALS'].values()
        assert intro==support['intros'][task['id']]


@pytest.mark.parametrize('topic_ids',[{50},{27,28}])
def test_scoped_generation_preserves_other_intros(tmp_path,topic_ids):
    generator=runpy.run_path(str(ROOT/'platform/scripts/enrich_task_intros.py'))
    current=quality.build_tasks._load_support_content()['intros'];out=tmp_path/'intros.js'
    current['3.1']['goal']='Сохранить отдельную редакторскую правку другого блока'
    out.write_text(generator['dump_js'](current),encoding='utf-8')
    main=generator['main'];old=main.__globals__['OUT'];main.__globals__['OUT']=out
    try:main(topic_ids)
    finally:main.__globals__['OUT']=old
    new=json.loads(out.read_text(encoding='utf-8').split('window.TASK_INTRO = ',1)[1].rstrip().rstrip(';'))
    in_scope=lambda key:int(key.split('.')[0]) in topic_ids
    assert {k:v for k,v in new.items() if not in_scope(k)}=={k:v for k,v in current.items() if not in_scope(k)}


def test_exact_task_selection_preserves_same_topic_author_edits_and_finales(tmp_path):
    generator=runpy.run_path(str(ROOT/'platform/scripts/enrich_task_intros.py'))
    current=quality.build_tasks._load_support_content()['intros'];out=tmp_path/'selected.js'
    current['27.2']['goal']='Не заменять соседнюю авторскую правку'
    for key in ('27.9','27.10','28.10','28.11'):current[key]['goal']='Финал не входит в точечное обновление'
    out.write_text(generator['dump_js'](current),encoding='utf-8')
    main=generator['main'];old=main.__globals__['OUT'];main.__globals__['OUT']=out
    try:main({27,28},task_ids={'27.1','28.1'})
    finally:main.__globals__['OUT']=old
    new=json.loads(out.read_text(encoding='utf-8').split('window.TASK_INTRO = ',1)[1].rstrip().rstrip(';'))
    assert {k:v for k,v in new.items() if k not in ('27.1','28.1')}=={k:v for k,v in current.items() if k not in ('27.1','28.1')}


@pytest.mark.parametrize('topic_ids,task_ids',[(None,{'27.999'}),({27},{'28.1'})])
def test_unknown_or_contradictory_selection_does_not_write(tmp_path,topic_ids,task_ids):
    generator=runpy.run_path(str(ROOT/'platform/scripts/enrich_task_intros.py'))
    current=quality.build_tasks._load_support_content()['intros'];out=tmp_path/'untouched.js'
    out.write_text(generator['dump_js'](current),encoding='utf-8');before=out.read_bytes()
    main=generator['main'];old=main.__globals__['OUT'];main.__globals__['OUT']=out
    try:
        with pytest.raises(ValueError):main(topic_ids,task_ids=task_ids)
    finally:main.__globals__['OUT']=old
    assert out.read_bytes()==before
