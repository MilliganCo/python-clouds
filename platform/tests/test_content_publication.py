"""A build failure cannot publish a partial teaching set."""
from pathlib import Path
import sys
import pytest
import json,threading,time
from concurrent.futures import ThreadPoolExecutor
import content_generation as cg
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import build_tasks


def test_late_mobile_validation_failure_leaves_every_output_untouched(tmp_path,monkeypatch):
    base=tmp_path/'platform';static=base/'static';static.mkdir(parents=True)
    mobile=tmp_path/'android/content-bundle.json';mobile.parent.mkdir()
    targets=[static/'tasks.js',static/'diagnostic-tasks.js',static/'counterexample-data.js',base/'tasks_meta.json',base/'atlas_tasks.json',
             base/'practice_quests.json',base/'weekly_tasks.json',mobile]
    for file in targets:file.write_text('original complete output',encoding='utf-8')
    before={p:p.read_bytes() for p in targets}
    monkeypatch.setattr(build_tasks,'OUT',static/'tasks.js');monkeypatch.setattr(build_tasks,'MOBILE_OUT',mobile)
    monkeypatch.setattr(build_tasks,'parse',lambda:[{'id':0,'level':'beginner','tasks':[{'id':'0.1'}]}])
    monkeypatch.setattr(build_tasks,'validate_choice_wrongs',lambda *_:None)
    monkeypatch.setattr(build_tasks,'verify_mobile_tasks',lambda *_:{'python':'synthetic','checked':0})
    monkeypatch.setattr(build_tasks,'parse_atlas',lambda:[])
    monkeypatch.setattr(build_tasks,'parse_practice_quests',lambda:[])
    monkeypatch.setattr(build_tasks,'parse_diagnostics',lambda:{'tasks':[]})
    monkeypatch.setattr(build_tasks,'parse_weekly',lambda:{'tasks':[]})
    monkeypatch.setattr(build_tasks,'parse_counterexamples',lambda:[])
    monkeypatch.setattr(build_tasks,'build_mobile_bundle',lambda *_:(_ for _ in ()).throw(ValueError('synthetic late validation failure')))
    with pytest.raises(ValueError,match='synthetic late validation failure'):build_tasks.main()
    assert {p:p.read_bytes() for p in targets}==before


def artifacts(marker):
    private={name:json.dumps({'marker':marker}).encode() for name in cg.PRIVATE_FILES}
    private['index.html']=b'<html><head></head><body><script src="app.js"></script></body></html>'
    public={'app.js':('window.marker='+json.dumps(marker)+';').encode(),'styles.css':b'body {color:white}'}
    return public,private,['app.js'],['styles.css']


def test_successful_build_mirrors_new_generated_game_bank(tmp_path,monkeypatch):
    base=tmp_path/'platform';static=base/'static';static.mkdir(parents=True)
    mobile=tmp_path/'android/app/src/main/assets/content/content-bundle.json';mobile.parent.mkdir(parents=True)
    monkeypatch.setattr(build_tasks,'OUT',static/'tasks.js');monkeypatch.setattr(build_tasks,'MOBILE_OUT',mobile)
    generated={'tasks.js':b'window.TASKS = [];\n','diagnostic-tasks.js':b'window.DIAGNOSTIC_TASKS = {};\n',
               'counterexample-data.js':b'window.COUNTEREXAMPLE_QUESTIONS = [{id:"synthetic"}];\n'}
    private={name:b'{}\n' for name in cg.PRIVATE_FILES if name!='index.html'}
    summary={'topics':0,'tasks':0,'mobile':'synthetic','verification':{'python':'synthetic','checked':0}}
    monkeypatch.setattr(build_tasks,'_prepare_outputs',lambda:(generated,private,summary))
    build_tasks.main()
    selected=cg.capture(base)
    assert selected.public['counterexample-data.js']==generated['counterexample-data.js']
    assert (static/'counterexample-data.js').read_bytes()==selected.public['counterexample-data.js']
    assert (static/'tasks.js').read_bytes()==generated['tasks.js']
    assert mobile.read_bytes()==private['mobile/content-bundle.json']


def publish(base,marker,**kwargs):
    pub,private,scripts,styles=artifacts(marker)
    mirrors={base/'static/app.js':pub['app.js'],base/'tasks_meta.json':private['tasks_meta.json']}
    with cg.writer_lock(base):return cg.publish(base,pub,private,scripts,styles,mirrors,**kwargs)


def test_complete_generation_and_private_public_separation(tmp_path):
    base=tmp_path/'platform';first=publish(base,'A');loaded=cg.capture(base)
    assert loaded.generation==first.generation
    assert loaded.json('weekly_tasks.json')=={'marker':'A'}
    pub,manifest=cg.public_manifest(base,first.generation)
    assert 'weekly_tasks.json' not in manifest['sha256'] and 'index.html' not in manifest['sha256']
    assert not (pub/'weekly_tasks.json').exists() and not (pub/'index.html').exists()
    with pytest.raises(TypeError):loaded.private['tasks_meta.json']=b'changed'


@pytest.mark.parametrize('phase',['staged','installed','mirror:tasks_meta.json','before_commit'])
def test_failure_keeps_previous_authority_and_recovers_compatibility(tmp_path,phase):
    base=tmp_path/'platform';old=publish(base,'A')
    before={p:p.read_bytes() for p in (base/'static/app.js',base/'tasks_meta.json',base/'static'/cg.POINTER)}
    def fail(point):
        if point==phase:raise OSError('synthetic publication failure')
    with pytest.raises(OSError,match='synthetic publication failure'):publish(base,'B',fault=fail)
    assert cg.capture(base).generation==old.generation
    assert {p:p.read_bytes() for p in before}==before


def test_concurrent_readers_never_mix_versions(tmp_path):
    base=tmp_path/'platform';publish(base,'A');stop=threading.Event();seen=[]
    def reader():
        while not stop.is_set():
            snap=cg.capture(base);marker=snap.json('tasks_meta.json')['marker']
            assert marker.encode() in snap.public['app.js']
            assert all(snap.json(name)['marker']==marker for name in cg.PRIVATE_FILES if name!='index.html')
            seen.append(marker)
    with ThreadPoolExecutor(max_workers=2) as pool:
        workers=[pool.submit(reader) for _ in range(2)]
        try:
            for i in range(10):publish(base,'B' if i%2==0 else 'A')
        finally:stop.set()
        for worker in workers:worker.result()
    assert seen and set(seen)<=set(('A','B'))


def test_process_selection_is_pinned_and_explicit_rollback_is_verified(tmp_path):
    base=tmp_path/'platform';old=publish(base,'A');pin=cg.process_snapshot(base)
    new=publish(base,'B')
    assert cg.process_snapshot(base) is pin and pin.json('tasks_meta.json')['marker']=='A'
    assert cg.capture(base).generation==new.generation
    cg.activate(base,old.generation);assert cg.capture(base).generation==old.generation
    assert cg.capture_generation(base,new.generation).json('tasks_meta.json')['marker']=='B'


@pytest.mark.parametrize('kind',['pointer','missing','tamper','private_manifest'])
def test_damage_is_not_silently_replaced_with_flat_copies(tmp_path,kind):
    base=tmp_path/'platform';snap=publish(base,'A');pub,private=cg._roots(base,snap.generation)
    if kind=='pointer':(base/'static'/cg.POINTER).write_text('{bad',encoding='utf-8')
    elif kind=='missing':(pub/'app.js').unlink()
    elif kind=='tamper':(pub/'app.js').write_text('wrong version',encoding='utf-8')
    else:(private/'manifest.json').write_text('{}',encoding='utf-8')
    with pytest.raises(cg.ContentError):cg.capture(base)


def test_os_lock_excludes_another_writer_and_releases_after_exit(tmp_path):
    with cg.writer_lock(tmp_path):
        with pytest.raises(cg.BuildBusy):
            with cg.writer_lock(tmp_path):pass
    with cg.writer_lock(tmp_path):pass


@pytest.mark.parametrize('name',['../private.json','/outside.js','a/../../secret.js','runner-worker.js','weekly_tasks.json'])
def test_unsafe_or_private_public_paths_are_rejected(tmp_path,name):
    public,private,scripts,styles=artifacts('A');public[name]=b'not public';scripts=[name]
    with cg.writer_lock(tmp_path),pytest.raises(cg.ContentError):cg.publish(tmp_path,public,private,scripts,styles,{})


def test_input_snapshot_does_not_reread_mutated_originals(tmp_path,monkeypatch):
    source=tmp_path/'canonical.md';source.write_text('original',encoding='utf-8')
    rules=tmp_path/'rules.py';rules.write_text('VALUE=1',encoding='utf-8')
    exporter=tmp_path/'export.mjs';exporter.write_text('// original exporter',encoding='utf-8')
    monkeypatch.setattr(build_tasks,'SRC',source);monkeypatch.setattr(build_tasks,'SOURCE_RULES',rules);monkeypatch.setattr(build_tasks,'SUPPORT_EXPORTER',exporter)
    with build_tasks._captured_inputs(tmp_path):
        source.write_text('changed',encoding='utf-8');rules.write_text('VALUE=2',encoding='utf-8')
        assert build_tasks.SRC.read_text(encoding='utf-8')=='original'
        assert build_tasks.SOURCE_RULES.read_text(encoding='utf-8')=='VALUE=1'
    assert build_tasks.SRC==source and build_tasks.SOURCE_RULES==rules


def test_publication_cannot_write_a_learner_file_even_inside_workspace(tmp_path):
    base=tmp_path/'platform';pub,private,scripts,styles=artifacts('A')
    secret=base/'instance/app.db';secret.parent.mkdir(parents=True);secret.write_bytes(b'learner data')
    with cg.writer_lock(base),pytest.raises(cg.ContentError):
        cg.publish(base,pub,private,scripts,styles,{secret:b'overwrite'})
    assert secret.read_bytes()==b'learner data'


def test_captured_inputs_are_restored_after_validation_exception(tmp_path,monkeypatch):
    original=build_tasks.SRC
    with pytest.raises(ValueError):
        with build_tasks._captured_inputs(tmp_path):raise ValueError('synthetic')
    assert build_tasks.SRC==original


def test_css_dependencies_and_source_capture_exclude_unisolated_worker(tmp_path):
    static=tmp_path/'static';(static/'vendor').mkdir(parents=True)
    (static/'index.html').write_text('<link rel="stylesheet" href="style.css"><script src="app.js"></script>',encoding='utf-8')
    (static/'app.js').write_bytes(b'window.marker=1;\r\n')
    (static/'style.css').write_text('@font-face {src:url("vendor/font.ttf")}',encoding='utf-8')
    (static/'vendor/font.ttf').write_bytes(b'font')
    (static/'runner-worker.js').write_bytes(b'blocked')
    pub,scripts,styles=cg.collect_public(static)
    assert scripts==['app.js'] and styles==['style.css']
    assert pub['app.js']==b'window.marker=1;\n' and pub['vendor/font.ttf']==b'font'
    assert 'runner-worker.js' not in pub


@pytest.mark.parametrize('url',['../secret.json','https://outside.example/font.ttf','/instance/secret_key'])
def test_css_cannot_smuggle_external_or_private_dependencies(tmp_path,url):
    (tmp_path/'index.html').write_text('<link rel="stylesheet" href="style.css"><script src="app.js"></script>',encoding='utf-8')
    (tmp_path/'app.js').write_bytes(b'// valid')
    (tmp_path/'style.css').write_text('x{src:url("'+url+'")}',encoding='utf-8')
    with pytest.raises(cg.ContentError):cg.collect_public(tmp_path)


def test_server_shell_and_flat_compatibility_routes_stay_on_the_loaded_generation(tmp_path):
    from flask import Flask
    from ui_serve import register_ui_routes
    base=tmp_path/'platform';old=publish(base,'A')
    app=Flask('content-route',static_folder=str(base/'static'),static_url_path='')
    register_ui_routes(app,ui_mode='legacy',base=base,legacy_static=base/'static',content_snapshot=old)
    newer=publish(base,'B');client=app.test_client()
    for url in ('/','/index.html','/legacy/','/legacy/index.html'):
        response=client.get(url)
        assert response.status_code==200
        assert response.headers['X-Pycloud-Content-Generation']==old.generation
        assert ('/course-content/'+old.generation+'/app.js').encode() in response.data
    assert b'A' in client.get('/app.js').data
    assert b'A' in client.get('/legacy/app.js').data
    assert client.get('/content-current.json').get_json()['generation']==newer.generation
    assert client.get('/course-content/'+newer.generation+'/app.js').data==newer.public['app.js']
    for name in ('weekly_tasks.json','index.html','mobile/content-bundle.json','../../instance/app.db'):
        assert client.get('/course-content/'+old.generation+'/'+name).status_code==404


def test_clean_checkout_legacy_shell_executes_captured_scripts_without_a_pointer(tmp_path):
    from flask import Flask
    from ui_serve import register_ui_routes
    base=tmp_path/'platform';static=base/'static';static.mkdir(parents=True)
    (static/'index.html').write_text('<html><head></head><body><script type="application/x-pycloud-script" data-course-src="app.js"></script><script src="catalogue-loader.js" data-course-loader></script></body></html>',encoding='utf-8')
    (static/'app.js').write_bytes(b'window.marker="legacy";');(static/cg.LOADER).write_bytes(b'// loader')
    snap=cg.capture(base);assert snap.generation is None
    app=Flask('legacy-snapshot',static_folder=str(static),static_url_path='')
    register_ui_routes(app,ui_mode='legacy',base=base,legacy_static=static,content_snapshot=snap)
    html=app.test_client().get('/').data
    assert b'<script src="app.js"></script>' in html and b'data-course-src' not in html
    assert html.count(b'src="catalogue-loader.js"')==1
    assert b'data-load-report-only async' in html
    assert html.index(b'catalogue-loader.js')<html.index(b'<script src="app.js"')


def test_runtime_digest_does_not_claim_current_disk_is_loaded(tmp_path):
    import runtime_ops
    from types import SimpleNamespace
    base=tmp_path/'platform'
    for name in runtime_ops.CORE_FILES:
        file=base/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(b'fixture source')
    old=publish(base,'A');new=publish(base,'B')
    sandbox=SimpleNamespace(IMAGE='pycloud-python-sandbox:test',RUNTIME_CONTEXT=Path('sandbox'),source_digest=lambda:'a'*64)
    loaded=runtime_ops.capture_runtime(base,sandbox,{'0.1':'beginner'},content_snapshot=old)
    candidate=runtime_ops.capture_runtime(base,sandbox,{'0.1':'beginner'},content_snapshot=new)
    assert loaded['source_digest']!=candidate['source_digest']
    assert loaded['content_generation']==old.generation and candidate['content_generation']==new.generation


def test_generation_compatibility_policy(tmp_path):
    # Pure guard policy also covers old clients without the header.
    old=publish(tmp_path/'platform','A');new=publish(tmp_path/'platform','B')
    assert cg.generation_matches(None,new)
    assert cg.generation_matches(new.generation,new)
    assert not cg.generation_matches(old.generation,new)
    assert not cg.generation_matches('non-ascii-версия',new)
