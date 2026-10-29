/* Private projects: explicit saves, owner-scoped recovery, server-owned checks and purchases. */
(function(root){
  'use strict';
  let active=null,serial=0;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const id=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');
  const api=async(path,options,owner)=>{
    const response=await root.LearningSession.fetch(path,options,owner),value=await response.json();
    if(!root.LearningSession.isCurrent(owner))throw new Error('Сессия изменилась.');
    if(!response.ok)throw Object.assign(new Error(value.error||'Запрос не выполнен.'),{status:response.status,code:value.code});
    return value;
  };
  const post=(path,body,owner)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},owner);
  const download=(name,value)=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const bundle=project=>({format:'pycloud-workshop',version:1,name:project.name,entry:project.entry,files:project.files});
  function current(state){return active===state&&state.node.isConnected&&root.LearningSession.isCurrent(state.owner)&&location.hash===state.hash;}
  function tell(state,text,error=false){if(!current(state))return;const node=state.node.querySelector('#wsStatus');if(node){node.textContent=text;node.classList.toggle('workshop-error',error);}}
  function payload(state){return {name:state.project.name,files:state.project.files,entry:state.project.entry};}
  function cache(state){
    if(!state.project||!state.dirty)return;
    try{localStorage.setItem(state.cacheKey,JSON.stringify({...payload(state),revision:state.project.revision,mutation_id:state.pending?.mutation_id||null}));}
    catch{tell(state,'Локальная копия недоступна. Сохраните на сервер или скачайте проект.',true);}
  }
  function changed(state){state.dirty=true;state.pending=null;cache(state);tell(state,'Есть несохранённые изменения.');}
  function leave(){if(active)cache(active);active=null;serial++;}
  root.addEventListener('beforeunload',event=>{if(active?.dirty){cache(active);event.preventDefault();event.returnValue='';}});
  root.LearningSession?.onChange(()=>leave());
  async function save(state){
    if(!current(state))return false;
    if(!state.dirty)return true;
    if(state.saving)return false;
    state.saving=true;const snapshot=JSON.stringify(payload(state));
    const body=state.pending||{...JSON.parse(snapshot),revision:state.project.revision,mutation_id:id()};state.pending=body;cache(state);
    tell(state,'Сохраняем проект…');
    try{
      const result=await post('/api/workshop/'+state.project.id+'/save',body,state.owner);
      if(!current(state))return false;
      state.project.revision=result.project.revision;state.project.mutation_id=result.project.mutation_id;
      state.dirty=JSON.stringify(payload(state))!==snapshot;state.pending=null;
      if(state.dirty)cache(state);else try{localStorage.removeItem(state.cacheKey);}catch{}
      tell(state,state.dirty?'Версия сохранена; новые изменения ещё в редакторе.':'Сохранено. Версия '+state.project.revision+'.');
      state.node.querySelector('#wsRevision').textContent='Версия '+state.project.revision;
      void refreshHistory(state);
      return !state.dirty;
    }catch(error){
      tell(state,error.message,true);
      if(current(state)&&error.status===409)state.node.querySelector('#wsConflict').hidden=false;
      return false;
    }finally{state.saving=false;}
  }
  const listing=(project,archived=false)=>`<li class="workshop-project-row"><div><a href="#/workshop/${esc(project.id)}">${esc(project.name)}</a><p>${esc(project.entry)} · версия ${project.revision}${archived?' · в архиве':''}</p></div><span>${esc(project.updated_at.slice(0,10))}</span></li>`;
  async function render(node){
    leave();const ownSerial=serial,owner=root.LearningSession.capture(),hash=location.hash;
    const state={node,owner,hash,dirty:false,busy:false};active=state;
    node.innerHTML='<section class="pane workshop-page"><h2>Мастерская</h2><p role="status">Загружаем ваши проекты…</p></section>';
    try{
      const catalog=await api('/api/workshop',undefined,owner);
      if(!current(state)||ownSerial!==serial)return;
      state.catalog=catalog;
      const match=hash.match(/^#\/workshop\/([0-9a-f]{32})$/);
      if(match){const detail=await api('/api/workshop/'+match[1],undefined,owner);if(current(state))editor(state,detail);}
      else hub(state);
    }catch(error){
      if(!current(state))return;
      node.innerHTML=`<section class="pane workshop-page"><h2>Мастерская не загрузилась</h2><p role="alert">${esc(error.message)}</p><button class="btn" id="wsRetry">Повторить</button></section>`;
      node.querySelector('#wsRetry').onclick=()=>render(node);
    }
  }
  function hub(state){
    const {node,catalog}=state,live=catalog.projects.filter(p=>!p.archived),archived=catalog.projects.filter(p=>p.archived);
    node.innerHTML=`<section class="task-page workshop-page"><nav class="task-nav"><a href="#/">Главная</a><a href="#/projects">Учебные проекты</a><a href="#/shop">Магазин</a></nav>
      <header class="workshop-heading"><div><h2>Мастерская проектов</h2><p>Свои программы, несколько файлов и место для экспериментов.</p></div><span>${live.length} из ${catalog.capacity} мест</span></header>
      <section class="pane"><form id="wsCreate" class="workshop-create"><label>Название проекта<input id="wsName" maxlength="80" required placeholder="Мой первый проект"></label><button class="btn dark" ${live.length>=catalog.capacity?'disabled':''}>Создать проект</button><label class="btn workshop-import">Импорт JSON<input id="wsImport" type="file" accept=".json,application/json"></label></form><p id="wsStatus" role="status" aria-live="polite"></p>
      ${live.length?`<ul class="workshop-projects">${live.map(p=>listing(p)).join('')}</ul>`:'<p>Три места доступны бесплатно. Начните с пустого проекта или выберите набор ниже.</p>'}
      ${archived.length?`<details><summary>Архив проектов (${archived.length})</summary><ul class="workshop-projects">${archived.map(p=>listing(p,true)).join('')}</ul></details>`:''}</section>
      <section class="workshop-catalog"><h3>Инженерные испытания</h3><p>Почините ошибку, проверьте чужую функцию и улучшите структуру кода.</p>${catalogHtml(catalog,'trial')}<h3>Проектные наборы</h3><p>Файлы с данными, три последовательных этапа и проверка результата.</p>${catalogHtml(catalog,'box')}</section>
      <p class="stat-note">До 12 файлов и 48 КБ в проекте. Последние 30 сохранённых версий и запусков доступны в истории. Архив освобождает место и сохраняет файлы.</p></section>`;
    node.querySelector('#wsCreate').onsubmit=async event=>{event.preventDefault();await create(state,{name:node.querySelector('#wsName').value});};
    node.querySelectorAll('[data-start-pack]').forEach(button=>button.onclick=()=>create(state,{name:button.dataset.name,catalog_id:button.dataset.startPack}));
    node.querySelector('#wsImport').onchange=async event=>{
      const file=event.target.files[0];if(!file)return;
      try{
        if(file.size>200000)throw new Error('Файл проекта слишком большой.');
        const value=JSON.parse(await file.text());
        if(value.format!=='pycloud-workshop'||value.version!==1)throw new Error('Выберите JSON, скачанный из мастерской.');
        await create(state,{name:value.name,files:value.files,entry:value.entry});
      }catch(error){tell(state,error.message,true);}finally{event.target.value='';}
    };
  }
  function catalogHtml(catalog,kind){return `<div class="workshop-catalog-list">${catalog.catalog.filter(p=>p.kind===kind).map(pack=>`<article><div><h4>${esc(pack.title)}</h4><p>${esc(pack.description)}</p><small>${pack.stages.length} ${pack.stages.length===1?'испытание':'этапа'}${pack.price?'':' · бесплатно'}</small></div>${pack.owned?`<button class="btn" data-start-pack="${pack.id}" data-name="${esc(pack.title)}">Начать</button>`:`<a class="btn" href="#/shop">В магазине · ${pack.price} капель</a>`}</article>`).join('')}</div>`;}
  async function create(state,values){
    if(state.busy||!current(state))return;state.busy=true;tell(state,'Создаём проект…');
    const signature=JSON.stringify(values);
    if(state.pendingCreate?.signature!==signature)state.pendingCreate={signature,body:{id:id(),...values}};
    try{const result=await post('/api/workshop',state.pendingCreate.body,state.owner);if(current(state))location.hash='#/workshop/'+result.project.id;}
    catch(error){tell(state,error.message,true);}finally{state.busy=false;}
  }
  function editor(state,detail){
    const {node,catalog}=state;state.project=detail.project;state.file=state.project.entry;state.detail=detail;
    const ownerName=String(state.owner.username||state.owner.user||'');
    state.cacheKey='pycloud:workshop:'+ownerName+':'+state.project.id;
    let recovery=null;
    try{recovery=JSON.parse(localStorage.getItem(state.cacheKey)||'null');}catch{}
    const project=state.project,pack=catalog.catalog.find(item=>item.id===project.catalog_id),readonly=!!project.archived;
    const validRecovery=recovery&&typeof recovery.name==='string'&&typeof recovery.entry==='string'&&Array.isArray(recovery.files)&&recovery.files.length>0&&recovery.files.length<=12&&recovery.files.every(f=>f&&typeof f.name==='string'&&typeof f.code==='string')&&recovery.files.some(f=>f.name===recovery.entry);
    if(validRecovery&&!readonly&&recovery.revision===project.revision){
      project.files=recovery.files;project.name=recovery.name;project.entry=recovery.entry;state.file=project.entry;state.dirty=true;
      if(recovery.mutation_id)state.pending={...payload(state),revision:project.revision,mutation_id:recovery.mutation_id};
    }
    node.innerHTML=`<section class="task-page workshop-page"><nav class="task-nav"><a href="#/workshop">Все проекты</a><a href="#/shop">Магазин</a></nav>
      <header class="workshop-heading"><label>Название проекта<input id="wsProjectName" maxlength="80" value="${esc(project.name)}" ${readonly?'disabled':''}></label><span id="wsRevision">Версия ${project.revision}</span></header>
      <div class="workshop-actions"><button class="btn dark" id="wsSave" ${readonly?'disabled':''}>Сохранить</button><button class="btn" id="wsDownload">Скачать проект</button><button class="btn" id="wsArchive">${readonly?'Вернуть из архива':'В архив'}</button></div>
      <p id="wsStatus" role="status" aria-live="polite">${readonly?'Проект в архиве. Его можно скачать или вернуть в работу.':state.dirty?'Восстановлена локальная копия. Сохраните изменения на сервер.':'Проект сохранён.'}</p>
      <div id="wsConflict" class="pane" ${recovery&&(!validRecovery||recovery.revision!==project.revision)?'':'hidden'}><p>Есть другая локальная версия. Скачайте свою копию перед загрузкой серверной.</p><button class="btn" id="wsConflictDownload">Скачать мою копию</button><button class="btn" id="wsReload">Загрузить серверную</button></div>
      ${pack?`<details class="pane workshop-brief" open><summary>${esc(pack.title)}</summary>${pack.stages.map(stage=>`<section><h3>${esc(stage.title)}</h3><p>${esc(stage.prompt)}</p><button class="btn" data-check="${stage.id}" ${readonly?'disabled':''}>Проверить этап</button><span class="workshop-check" data-check-state="${stage.id}">${project.checks[stage.id]?'Пройдено в версии '+project.checks[stage.id]:''}</span></section>`).join('')}</details>`:''}
      <section class="pane workshop-workspace"><div class="workshop-files" id="wsFiles" role="group" aria-label="Файлы проекта"></div>
      <div class="workshop-file-actions"><form id="wsAddFile"><label>Новый файл<input id="wsNewFile" placeholder="helpers.py" maxlength="52" ${readonly?'disabled':''}></label><button class="btn" ${readonly?'disabled':''}>Добавить</button></form><label>Запускать<select id="wsEntry" ${readonly?'disabled':''}></select></label><button class="btn" id="wsRemoveFile" ${readonly?'disabled':''}>Удалить файл</button></div>
      <label class="workshop-editor-label" for="wsCode">Содержимое файла <span id="wsFilename"></span></label><textarea id="wsCode" class="editor" spellcheck="false" autocomplete="off" autocapitalize="off" ${readonly?'readonly':''}></textarea>
      <details class="workshop-stdin"><summary>Ввод для input()</summary><label>Один ответ на каждой строке<textarea id="wsInput" rows="3" maxlength="8000"></textarea></label></details>
      <div class="workshop-actions"><button class="btn dark" id="wsRun">Запустить Python</button><span>Файлы запуска живут в изолированной среде.</span></div><pre id="wsOutput" class="terminal-body" tabindex="0" aria-label="Вывод программы"></pre></section>
      <details class="pane workshop-tools"><summary>Инструменты для данных</summary><div class="workshop-tool-controls"><label>Инструмент<select id="wsTool"><option value="csv">Таблица CSV</option><option value="json">Дерево JSON</option><option value="diff">Сравнение файлов</option><option value="sql">SQL по CSV</option></select></label><label>Файл<select id="wsToolFile"></select></label><label id="wsOtherLabel" hidden>Сравнить с<select id="wsOtherFile"></select></label><label id="wsDelimiterLabel">Разделитель<select id="wsDelimiter"><option value=",">Запятая</option><option value=";">Точка с запятой</option><option value="tab">Табуляция</option></select></label></div>
      <label id="wsSqlLabel" hidden>SELECT-запрос к таблице data<textarea id="wsSql" rows="3">SELECT * FROM data LIMIT 20</textarea></label><button class="btn" id="wsToolRun">Открыть инструмент</button><p id="wsToolNote"></p><div id="wsToolOutput"></div></details>
      <details class="pane"><summary>Разбор проекта наставником</summary><p>До пяти замечаний по файлам сохранённой версии. Стоимость — ${catalog.review_price} капель; списание только после готового разбора. Повторное открытие этого разбора бесплатно.</p><button class="btn" id="wsReview" ${catalog.ai_available?'':'disabled'}>Заказать разбор</button>${catalog.ai_available?'':'<p>Наставник сейчас недоступен.</p>'}<div id="wsReviews">${detail.reviews.map(review=>`<article><h4>Версия ${review.revision}</h4><p class="workshop-report">${esc(review.report||'Текст разбора удалён. Учёт оплаты сохранён; повторного списания нет.')}</p></article>`).join('')}</div></details>
      <details class="pane"><summary>История версий и запусков</summary><div class="workshop-history"><section><h3>Сохранённые версии</h3>${detail.versions.map(version=>`<p>Версия ${version.revision} <button class="btn" data-download-version="${version.revision}">Скачать</button></p>`).join('')}</section><section><h3>Последние запуски</h3>${detail.runs.length?detail.runs.map(run=>`<details><summary>Версия ${run.revision} — ${run.error?'ошибка':run.passed?'проверка пройдена':'запуск завершён'}</summary><pre>${esc(run.stdout)}${run.error?'\n'+esc(run.error):''}</pre></details>`).join(''):'<p>Запусков пока нет.</p>'}</section></div></details></section>`;
    const $=selector=>node.querySelector(selector);
    function files(){
      $('#wsFiles').innerHTML=project.files.map(file=>`<button class="btn" data-file="${esc(file.name)}" aria-pressed="${file.name===state.file}">${esc(file.name)}</button>`).join('');
      $('#wsEntry').innerHTML=project.files.filter(f=>f.name.endsWith('.py')).map(f=>`<option ${project.entry===f.name?'selected':''}>${esc(f.name)}</option>`).join('');
      for(const selector of ['#wsToolFile','#wsOtherFile'])$(selector).innerHTML=project.files.map(f=>`<option>${esc(f.name)}</option>`).join('');
      const selected=project.files.find(f=>f.name===state.file)||project.files[0];state.file=selected.name;$('#wsCode').value=selected.code;$('#wsFilename').textContent=selected.name;
      $('#wsFiles').querySelectorAll('[data-file]').forEach(button=>button.onclick=()=>{state.file=button.dataset.file;files();});
    }
    files();
    $('#wsCode').oninput=event=>{project.files.find(f=>f.name===state.file).code=event.target.value;changed(state);};
    root.EditorKeys?.bind?.($('#wsCode'));
    $('#wsProjectName').oninput=event=>{project.name=event.target.value;changed(state);};
    $('#wsEntry').onchange=event=>{project.entry=event.target.value;changed(state);};
    $('#wsSave').onclick=()=>save(state);
    $('#wsDownload').onclick=()=>download(project.id+'.json',bundle(project));
    $('#wsConflictDownload').onclick=()=>{download(project.id+'-local.json',recovery?{format:'pycloud-workshop',version:1,...recovery}:bundle(project));state.conflictDownloaded=true;};
    $('#wsReload').onclick=()=>{
      if(!state.conflictDownloaded){tell(state,'Сначала скачайте свою копию — она может содержать несохранённые правки.',true);return;}
      state.dirty=false;try{localStorage.removeItem(state.cacheKey);}catch{}render(node);
    };
    $('#wsAddFile').onsubmit=event=>{
      event.preventDefault();const name=$('#wsNewFile').value.trim();
      if(!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,47}\.(py|csv|json|txt|sql)$/.test(name)||name.includes('..')){tell(state,'Например: helpers.py, data.csv или config.json; без папок.',true);return;}
      if(project.files.length>=12||project.files.some(f=>f.name.toLowerCase()===name.toLowerCase())){tell(state,'Имя занято или уже добавлено 12 файлов.',true);return;}
      project.files.push({name,code:''});state.file=name;$('#wsNewFile').value='';changed(state);files();
    };
    $('#wsRemoveFile').onclick=()=>{
      if(state.file===project.entry){tell(state,'Сначала выберите другой файл для запуска.',true);return;}
      if(!confirm('Удалить '+state.file+' из текущей версии? Предыдущие сохранённые версии останутся в истории.'))return;
      project.files=project.files.filter(f=>f.name!==state.file);state.file=project.entry;changed(state);files();
    };
    $('#wsArchive').onclick=async()=>{
      if(state.dirty&&!await save(state))return;
      try{await post('/api/workshop/'+project.id+'/archive',{revision:project.revision,archived:!readonly},state.owner);if(current(state))location.hash='#/workshop';}catch(error){tell(state,error.message,true);}
    };
    async function run(stage=''){
      if(state.busy||!current(state))return;if(!await save(state)||state.busy||!current(state))return;state.busy=true;tell(state,'Python выполняет программу…');
      const revision=project.revision;
      try{
        const response=await post('/api/workshop/'+project.id+'/run',{revision,stage,stdin:$('#wsInput').value},state.owner);
        if(!current(state))return;const result=response.result;
        $('#wsOutput').textContent=(result.user_stdout??result.stdout??'')+(result.error?'\n'+result.error:'')||'(нет вывода)';
        root.OutputFiles?.show($('#wsOutput'),result.artifacts);
        tell(state,result.error?'В программе есть ошибка. Подробности — под редактором.':stage?(response.passed?'Проверка пройдена.':'Проверка не пройдена.'):'Запуск завершён.',!!result.error);
        if(response.passed){const label=node.querySelector('[data-check-state="'+stage+'"]');if(label)label.textContent='Пройдено в версии '+revision;}
        void refreshHistory(state);
      }catch(error){tell(state,error.message,true);}finally{state.busy=false;}
    }
    $('#wsRun').onclick=()=>run();node.querySelectorAll('[data-check]').forEach(button=>button.onclick=()=>run(button.dataset.check));
    node.querySelectorAll('[data-download-version]').forEach(button=>button.onclick=async()=>{
      try{const version=await api('/api/workshop/'+project.id+'/versions/'+button.dataset.downloadVersion,undefined,state.owner);if(current(state))download(project.id+'-v'+version.revision+'.json',bundle(version));}catch(error){tell(state,error.message,true);}
    });
    function toolChoice(){const kind=$('#wsTool').value;$('#wsOtherLabel').hidden=kind!=='diff';$('#wsDelimiterLabel').hidden=!['csv','sql'].includes(kind);$('#wsSqlLabel').hidden=kind!=='sql';const owned=catalog.tools.includes('tool_'+kind);$('#wsToolRun').disabled=!owned;$('#wsToolNote').innerHTML=owned?(kind==='sql'?'Данные CSV доступны в таблице data. Для чисел используйте CAST(column AS INTEGER). Только SELECT.':''):'Инструмент можно приобрести в <a href="#/shop">магазине</a> навсегда.';}
    $('#wsTool').onchange=toolChoice;toolChoice();
    $('#wsToolRun').onclick=async()=>{
      if(state.busy||!await save(state))return;state.busy=true;
      try{const kind=$('#wsTool').value,result=await post('/api/workshop/'+project.id+'/tool',{revision:project.revision,tool:kind,file:$('#wsToolFile').value,other:$('#wsOtherFile').value,delimiter:$('#wsDelimiter').value==='tab'?'\t':$('#wsDelimiter').value,query:$('#wsSql').value},state.owner);
        if(!current(state))return;const target=$('#wsToolOutput');
        if(kind==='json'){target.replaceChildren();target.append(jsonTree(result.value));}
        else if(kind==='diff')target.innerHTML=`<pre>${esc(result.diff||'Файлы одинаковые.')}</pre>${result.truncated?'<p>Показаны первые 1500 строк.</p>':''}`;
        else{target.innerHTML=`${kind==='csv'?'<label>Найти строку<input id="wsRowSearch" type="search"></label>':''}<p>${result.total>200||result.truncated?'Показаны первые 200 строк.':'Строк: '+result.rows.length}</p><div class="workshop-table"><table><thead><tr>${result.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${result.rows.map(row=>`<tr>${row.map(value=>`<td>${esc(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
          if(kind==='csv')$('#wsRowSearch').oninput=event=>target.querySelectorAll('tbody tr').forEach(row=>row.hidden=!row.textContent.toLocaleLowerCase().includes(event.target.value.toLocaleLowerCase()));}
        tell(state,'Инструмент открыл сохранённую версию '+project.revision+'.');
      }catch(error){tell(state,error.message,true);}finally{state.busy=false;}
    };
    $('#wsReview').onclick=async()=>{
      if(state.busy||!await save(state))return;
      const existing=detail.reviews.find(review=>review.revision===project.revision);
      if(!existing&&!confirm('Заказать разбор версии '+project.revision+' за '+catalog.review_price+' капель? Списание произойдёт только после готового отчёта.'))return;
      state.busy=true;tell(state,'Наставник читает файлы. Разбор появится здесь.');
      try{const review=await post('/api/workshop/'+project.id+'/review',{revision:project.revision,confirmed_price:catalog.review_price},state.owner);if(!current(state))return;detail.reviews.unshift(review);$('#wsReviews').innerHTML=`<h4>Версия ${review.revision}</h4><p class="workshop-report">${esc(review.report||'Текст разбора удалён. Учёт оплаты сохранён; повторного списания нет.')}</p>`;tell(state,review.cached?'Открыта сохранённая запись. Повторного списания нет.':'Разбор сохранён. Списано '+review.price+' капель.');root.dispatchEvent(new Event('workshop-wallet-changed'));}
      catch(error){tell(state,error.message,true);}finally{state.busy=false;}
    };
  }
  async function refreshHistory(state){
    try{
      const detail=await api('/api/workshop/'+state.project.id,undefined,state.owner);
      if(!current(state))return;const host=state.node.querySelector('.workshop-history');if(!host)return;
      host.innerHTML=`<section><h3>Сохранённые версии</h3>${detail.versions.map(v=>`<p>Версия ${v.revision} <button class="btn" data-version="${v.revision}">Скачать</button></p>`).join('')}</section><section><h3>Последние запуски</h3>${detail.runs.map(run=>`<details><summary>Версия ${run.revision} — ${run.error?'ошибка':run.passed?'проверка пройдена':'запуск завершён'}</summary><pre>${esc(run.stdout)}${run.error?'\n'+esc(run.error):''}</pre></details>`).join('')||'<p>Запусков пока нет.</p>'}</section>`;
      host.querySelectorAll('[data-version]').forEach(button=>button.onclick=async()=>{
        try{const version=await api('/api/workshop/'+state.project.id+'/versions/'+button.dataset.version,undefined,state.owner);if(current(state))download(state.project.id+'-v'+version.revision+'.json',bundle(version));}catch(error){tell(state,error.message,true);}
      });
    }catch{/* The durable save/run already succeeded; history can be reloaded independently. */}
  }
  function jsonTree(value,key='JSON',depth=0,budget={left:1000}){
    const node=document.createElement('div');
    if(--budget.left<0||depth>24){node.textContent=key+': … (слишком большой фрагмент; исходный файл сохранён)';return node;}
    if(value===null||typeof value!=='object'){node.textContent=key+': '+JSON.stringify(value);return node;}
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=key+' — '+(Array.isArray(value)?'массив':'объект')+' ('+Object.keys(value).length+')';details.append(summary);
    for(const [name,child] of Object.entries(value)){if(budget.left<0)break;details.append(jsonTree(child,name,depth+1,budget));}node.append(details);return node;
  }
  root.Workshop=Object.freeze({render,leave});
})(window);
