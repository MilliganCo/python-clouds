/* A bounded voluntary report starts independently of the application and its CSS. */
(function(root){
  'use strict';
  if(root.CloudLoadReport)return;
  try{
  const doc=root.document,started=root.performance?.now?.()??Date.now();
  const phases=new Set(['shell','pointer','manifest','styles','scripts','catalogue-ready','catalogue-error','navigation']);
  const kinds=new Set(['session','progress','quest','quest-start','wallet']),states=new Set(['pending','body','finished','failed']);
  let phase='shell',assetErrors=0,scriptErrors=0,deferredStyles=0,requested=false,timer=null,bound=false,earlyObserver=null;
  const deferredLinks=new WeakSet();
  const node=id=>doc.getElementById(id);
  const bounded=(value,max)=>Number.isFinite(value)?Math.min(max,Math.max(0,Math.round(value))):0;
  function route(){
    const hash=String(root.location.hash||'').split('?')[0];
    if(hash===''||hash==='#/'||hash==='#')return 'home';
    if(/^#\/task\/C?\d+\.\d+$/.test(hash))return 'task';
    if(/^#\/topic\/\d+\/theory$/.test(hash))return 'theory';
    if(/^#\/project\/[a-z0-9_]+\/[a-z0-9_]+$/.test(hash))return 'project-stage';
    if(/^#\/project\/[a-z0-9_]+$/.test(hash))return 'project';
    if(/^#\/showcase(?:\/|$)/.test(hash))return 'showcase';
    const routes={'#/topics':'topics','#/topics/tools':'topics','#/projects':'projects','#/shop':'shop',
      '#/game':'games','#/profile':'profile','#/atlas':'atlas','#/review':'review',
      '#/diagnostic':'diagnostic','#/updates':'updates'};
    return Object.hasOwn(routes,hash)?routes[hash]:'other';
  }
  function network(){
    try{
      const raw=root.LearningSession?.loadSnapshot?.();
      if(!raw||!Array.isArray(raw.pending)||!Array.isArray(raw.recent))throw new Error();
      const clean=record=>{
        if(!record||!kinds.has(record.kind)||!states.has(record.state))return null;
        return {kind:record.kind,state:record.state,
          status:Number.isInteger(record.status)&&record.status>=100&&record.status<=599?record.status:null,
          elapsedMs:Math.round(bounded(record.elapsedMs,600000)/100)*100};
      };
      return {available:true,pending:raw.pending.slice(-8).map(clean).filter(Boolean),
        recent:raw.recent.slice(-12).map(clean).filter(Boolean),droppedPending:bounded(raw.droppedPending,999)};
    }catch(_){return {available:false,pending:[],recent:[],droppedPending:null};}
  }
  function snapshot(){
    const value=root.PYCLOUD_CONTENT_GENERATION||doc.querySelector('meta[name="pycloud-content-generation"]')?.content;
    const visible=id=>node(id)?!node(id).hidden:null;
    return {schema:1,observer:'running',route:route(),generation:typeof value==='string'&&/^[0-9a-f]{64}$/.test(value)?value:null,
      phase,elapsedMs:Math.round(bounded((root.performance?.now?.()??Date.now())-started,600000)/100)*100,
      assetErrors,scriptErrors,deferredStyles,view:{appVisible:visible('appView'),authVisible:visible('authView'),editorPresent:!!node('projectEditor')},
      network:network()};
  }
  function refresh(){
    const text=JSON.stringify(snapshot(),null,2);
    if(node('loadReportText'))node('loadReportText').value=text;
    return text;
  }
  function show(manual){
    requested=true;
    const panel=node('loadReportHelp');
    if(!panel)return;
    panel.hidden=false;panel.open=true;refresh();
    if(manual)panel.scrollIntoView?.({block:'nearest'});
  }
  function check(){
    const panel=node('loadReportHelp');
    if(panel&&!requested&&!panel.open&&!panel.contains?.(doc.activeElement)
        &&(node('appView')&&!node('appView').hidden||node('authView')&&!node('authView').hidden))panel.hidden=true;
  }
  function arm(){
    if(timer!==null)root.clearTimeout(timer);
    timer=root.setTimeout(()=>{
      timer=null;
      const state=snapshot();
      const noVisibleView=!state.view.appVisible&&!state.view.authVisible;
      if(noVisibleView)deferBlockingStyles();
      if(noVisibleView||state.network.pending.some(record=>record.kind!=='wallet'&&record.elapsedMs>=12000))show(false);
    },12000);
  }
  function deferBlockingStyles(){
    // A stalled parser stylesheet can block first paint even after controls exist.
    // Keep its request/SRI intact, let native help paint, then restore its media.
    for(const link of [...doc.querySelectorAll('link[rel="stylesheet"]')].slice(0,8)){
      if(link.sheet||deferredLinks.has(link)||!['','all','screen'].includes(link.media||''))continue;
      const original=link.getAttribute('media');
      const restore=()=>{
        if(original===null)link.removeAttribute('media');else link.setAttribute('media',original);
        link.removeEventListener('load',restore);link.removeEventListener('error',restore);
      };
      link.addEventListener('load',restore);link.addEventListener('error',restore);
      deferredLinks.add(link);link.media='print';deferredStyles=Math.min(8,deferredStyles+1);
    }
  }
  function download(){
    const text=refresh();
    try{
      const url=root.URL.createObjectURL(new root.Blob([text],{type:'application/json'}));
      const link=doc.createElement('a');link.href=url;link.download='pycloud-load-report.json';
      doc.body.appendChild(link);
      try{link.click();}finally{link.remove();root.setTimeout(()=>root.URL.revokeObjectURL(url),0);}
      if(node('loadReportNotice'))node('loadReportNotice').textContent='Отчёт подготовлен. Отправьте его вместе с описанием проблемы.';
    }catch(_){
      if(node('loadReportNotice'))node('loadReportNotice').textContent='Скачивание недоступно. Скопируйте данные из поля вручную.';
      node('loadReportText')?.focus();node('loadReportText')?.select();
    }
  }
  function bind(){
    const panel=node('loadReportHelp'),button=node('loadReportDownload');
    if(bound||!panel||!button||!node('loadReportText'))return;
    bound=true;
    if(button){button.disabled=false;button.onclick=download;}
    if(node('loadReportClose'))node('loadReportClose').onclick=()=>{requested=false;if(panel){panel.open=false;panel.hidden=true;}};
    panel?.addEventListener('toggle',()=>{if(panel.open){requested=true;refresh();}});
    doc.addEventListener('click',event=>{if(event.target?.closest?.('[data-load-report-open]'))show(true);});
    check();if(requested)show(false);
  }
  root.addEventListener('hashchange',()=>{phase='navigation';check();arm();});
  root.addEventListener('error',event=>{
    if(['SCRIPT','LINK'].includes(event.target?.tagName)){assetErrors=Math.min(99,assetErrors+1);}
    else if(event.target===root)scriptErrors=Math.min(99,scriptErrors+1);
  },true);
  root.addEventListener('unhandledrejection',()=>{scriptErrors=Math.min(99,scriptErrors+1);});
  root.CloudLoadReport=Object.freeze({snapshot,show:()=>show(true),
    mark(value){if(phases.has(value))phase=value;},fail(){phase='catalogue-error';show(false);}});
  const viewsObserver=root.MutationObserver?new root.MutationObserver(check):null,watched=new Set();
  function discover(){
    bind();
    for(const id of ['appView','authView'])if(viewsObserver&&node(id)&&!watched.has(id)){
      viewsObserver.observe(node(id),{attributes:true,attributeFilter:['hidden']});watched.add(id);
    }
    if(bound&&watched.size===2)earlyObserver?.disconnect?.();
  }
  if(root.MutationObserver&&doc.documentElement){
    earlyObserver=new root.MutationObserver(discover);
    earlyObserver.observe(doc.documentElement,{childList:true,subtree:true});
  }
  discover();arm();
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',()=>{discover();earlyObserver?.disconnect?.();},{once:true});
  else earlyObserver?.disconnect?.();
  }catch(_){/* Diagnostics must never prevent the catalogue bootstrap. Native help remains. */}
})(window);

/* One validated manifest, ordered immutable scripts; never mix in flat fallback data. */
(async function(){
  'use strict';
  const report=(method,value)=>{try{window.CloudLoadReport?.[method]?.(value);}catch(_){}};
  const reportOnly=document.currentScript?.hasAttribute('data-load-report-only');
  if(reportOnly||window.__pycloudCatalogueStarted)return;
  window.__pycloudCatalogueStarted=true;
  if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
  const status=document.getElementById('catalogueLoadStatus');
  if(status){status.hidden=false;status.textContent='Загружаем учебный каталог…';}
  const hex=/^[0-9a-f]{64}$/;
  const safe=name=>typeof name==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(name)&&
    name.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!name.endsWith('runner-worker.js');
  const read=async url=>{
    const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});
    if(!response.ok)throw new Error('Teaching manifest unavailable');
    return response.json();
  };
  function integrity(value){
    if(typeof value!=='string'||!hex.test(value))throw new Error('Invalid asset digest');
    return 'sha256-'+btoa(String.fromCharCode(...value.match(/../g).map(n=>parseInt(n,16))));
  }
  try{
    let generation=document.querySelector('meta[name="pycloud-content-generation"]')?.content;
    if(!generation){
      report('mark','pointer');
      const pointer=await read('/content-current.json');
      if(pointer.version!==1)throw new Error('Unsupported teaching pointer');
      generation=pointer.generation;
    }
    if(typeof generation!=='string'||!hex.test(generation))throw new Error('Invalid teaching generation');
    const prefix='/course-content/'+generation+'/';
    report('mark','manifest');
    const manifest=await read(prefix+'manifest.json');
    if(manifest.version!==1||manifest.generation!==generation||!Array.isArray(manifest.scripts)||!manifest.scripts.length||
        !Array.isArray(manifest.styles)||!manifest.sha256||typeof manifest.sha256!=='object')throw new Error('Invalid teaching manifest');
    const declared=[...document.querySelectorAll('script[data-course-src]')].map(node=>node.dataset.courseSrc);
    if(JSON.stringify(declared)!==JSON.stringify(manifest.scripts))throw new Error('Teaching shell and script manifest disagree');
    if(new Set([...manifest.scripts,...manifest.styles]).size!==manifest.scripts.length+manifest.styles.length)throw new Error('Duplicate teaching assets');
    const asset=(name,extension)=>{
      if(!safe(name)||!name.endsWith(extension)||!Object.hasOwn(manifest.sha256,name))throw new Error('Unsafe teaching asset');
      return {url:prefix+name,sri:integrity(manifest.sha256[name])};
    };
    // Public optional data stays on this document's validated immutable set.
    // Do not broaden this allowlist without checking the feature's dependencies.
    const optional=new Set(['changelog.js','counterexample-data.js','counterexample-game.js','game-results.js','account-security.js','ai-settings.js']),pending=new Map();
    const theoryLazy=manifest.scripts.includes('theory-manifest.js');
    const theoryFile=name=>/^theory-articles-\d+(?:-\d+)?\.js$/.test(name);
    if(theoryLazy)manifest.scripts.filter(theoryFile).forEach(name=>optional.add(name));
    const tasksLazy=manifest.scripts.includes('task-index.js'),loadedTaskTopics=new Set();
    const taskFile=name=>/^task-banks\/topic-\d+\.js$/.test(name);
    if(tasksLazy){optional.add('tasks.js');manifest.scripts.filter(taskFile).forEach(name=>optional.add(name));}
    const taskTopic=id=>{
      const index=window.TASK_INDEX;
      if(typeof id!=='string'||!/^\d+\.\d+$/.test(id)||index?.version!==1||!Array.isArray(index.topics))throw new Error('Unsupported task');
      const topic=index.topics.find(topic=>Array.isArray(topic.tasks)&&topic.tasks.some(task=>task.id===id));
      if(!topic)throw new Error('Unsupported task');
      return topic;
    };
    window.CourseAssets=Object.freeze({load(name){
      if(!optional.has(name)||!manifest.scripts.includes(name)||name==='tasks.js')return Promise.reject(new Error('Unsupported optional asset'));
      if(pending.has(name))return pending.get(name);
      const promise=(async()=>{
        // The game freezes its authored bank at evaluation time: data first.
        if(name==='counterexample-game.js')await window.CourseAssets.load('counterexample-data.js');
        return new Promise((resolve,reject)=>{
        const info=asset(name,'.js'),script=document.createElement('script');
        script.src=info.url;script.integrity=info.sri;script.async=true; // Dependencies are awaited; independent groups must not queue behind each other.
        let settled=false;
        const finish=error=>{
          if(settled)return;settled=true;window.clearTimeout(timer);
          script.onload=null;script.onerror=null;
          if(error){script.remove();pending.delete(name);reject(error);}else resolve();
        };
        const timer=window.setTimeout(()=>finish(new Error('Optional asset timed out')),12000);
        script.onload=()=>finish();script.onerror=()=>finish(new Error('Optional asset unavailable'));
        document.body.appendChild(script);
        });
      })();
      promise.catch(()=>{if(pending.get(name)===promise)pending.delete(name);});
      pending.set(name,promise);return promise;
    },isTaskLoaded(id){
      if(!tasksLazy)return true;
      return loadedTaskTopics.has(taskTopic(id).id);
    },async loadTask(id){
      if(!tasksLazy)return;
      const topic=taskTopic(id),index=window.TASK_INDEX;
      if(loadedTaskTopics.has(topic.id))return;
      const file=Object.hasOwn(index.banks||{},topic.id)?index.banks[topic.id]:null;
      if(!taskFile(file)||!manifest.scripts.includes(file))throw new Error('Unsupported task bank');
      await window.CourseAssets.load(file);
      if(loadedTaskTopics.has(topic.id))return;
      const bank=window.TASK_BANKS?.[topic.id];
      try{
        if(bank?.version!==1||bank.topicId!==topic.id||!Array.isArray(bank.tasks)||bank.tasks.length!==topic.tasks.length)throw new Error('Invalid task bank');
        const targets=new Map(topic.tasks.map(task=>[task.id,task])),seen=new Set();
        const fields=new Set(['id','codeLang','answer','answerLang','explanation','verified','check','wrong','hint','questions']);
        for(const task of bank.tasks){
          if(!task||typeof task!=='object'||!targets.has(task.id)||seen.has(task.id)||Object.keys(task).some(key=>!fields.has(key)))throw new Error('Invalid task bank item');
          if(['codeLang','answer','answerLang','explanation','verified'].some(key=>typeof task[key]!=='string'))throw new Error('Incomplete task bank');
          if(('check' in task&&(!task.check||typeof task.check!=='object'||Array.isArray(task.check)))||('wrong' in task&&!Array.isArray(task.wrong))||('questions' in task&&!Array.isArray(task.questions))||('hint' in task&&typeof task.hint!=='string'))throw new Error('Invalid task bank data');
          seen.add(task.id);
        }
        // Validate the whole group before changing any existing catalogue object.
        window.CHECKS=window.CHECKS||{};
        for(const task of bank.tasks){Object.assign(targets.get(task.id),task);if(task.check)window.CHECKS[task.id]=task.check;}
        loadedTaskTopics.add(topic.id);
      }catch(error){pending.delete(file);throw error;}
    },async loadTheory(topicId){
      const id=String(topicId);
      if(!/^\d+$/.test(id))throw new Error('Unsupported theory topic');
      if(Object.hasOwn(window.THEORY_ARTICLES||{},id))return;
      const index=window.THEORY_MANIFEST;
      if(!theoryLazy||index?.version!==1||!Object.hasOwn(index.articles||{},id))throw new Error('Unsupported theory topic');
      const entry=index.articles[id];
      if(!entry||!theoryFile(entry.file)||!manifest.scripts.includes(entry.file))throw new Error('Unsupported theory article');
      await window.CourseAssets.load(entry.file);
      if(!Object.hasOwn(window.THEORY_ARTICLES||{},id)){
        pending.delete(entry.file);
        throw new Error('Theory article was not registered');
      }
    }});
    const previousStyles=[...document.querySelectorAll('link[rel="stylesheet"]')];
    report('mark','styles');
    await Promise.all(manifest.styles.map(name=>new Promise((resolve,reject)=>{
      const info=asset(name,'.css'),link=document.createElement('link');link.rel='stylesheet';
      link.integrity=info.sri;link.href=info.url;link.dataset.courseStyle=name;
      link.onload=resolve;link.onerror=()=>reject(new Error('Teaching stylesheet unavailable'));
      document.head.appendChild(link);
    })));
    previousStyles.forEach(link=>link.remove());
    window.PYCLOUD_CONTENT_GENERATION=generation;
    report('mark','scripts');
    for(const name of manifest.scripts){
      if(optional.has(name))continue;
      const info=asset(name,'.js');
      await new Promise((resolve,reject)=>{
        const script=document.createElement('script');script.src=info.url;script.integrity=info.sri;script.async=false;
        script.onload=resolve;script.onerror=()=>reject(new Error('Teaching script unavailable'));
        document.body.appendChild(script);
      });
    }
    if(status)status.hidden=true;
    report('mark','catalogue-ready');
  }catch(error){
    report('fail');
    console.error('Teaching catalogue load failed',error);
    if(status){
      status.hidden=false;status.setAttribute('role','alert');
      status.replaceChildren(document.createTextNode('Не удалось загрузить целую учебную версию. Обновите страницу. Сохранённые данные не изменены. '));
      const retry=document.createElement('button');retry.type='button';retry.className='btn';retry.textContent='Обновить страницу';retry.onclick=()=>location.reload();status.appendChild(retry);
    }
  }
})();
