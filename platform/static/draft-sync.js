/* Optional cloud mirror for existing local drafts. No project/diagnostic/learning records. */
(function(root){
  'use strict';
  const validId=value=>typeof value==='string'&&/^[0-9a-f]{32}$/.test(value);
  function validRecord(record,scope){
    return !!record&&record.scope===scope&&Number.isSafeInteger(record.version)&&record.version>=0&&
      (record.code===null||typeof record.code==='string')&&
      (record.version===0 ? record.mutation_id===null&&record.starter===null&&record.code===null : validId(record.mutation_id)&&typeof record.starter==='string');
  }
  const sameBase=(a,b)=>!!a&&a.version===b.version&&a.mutation_id===b.mutation_id;
  function decide({base,remote,code,starter,dirty,pending}){
    if(remote.version>0&&remote.starter!==starter)return 'template';
    if(base&&(remote.version<base.version||(remote.version===base.version&&!sameBase(base,remote))))return 'conflict';
    if(pending&&remote.mutation_id===pending.mutation_id&&remote.code===pending.code&&remote.starter===pending.starter)return 'ack';
    if(remote.code===code&&(remote.version===0||remote.starter===starter))return 'same';
    if(!dirty)return 'load';
    if(pending)return remote.version===pending.base_version&&remote.mutation_id===pending.base_mutation_id?'save':'conflict';
    if(sameBase(base,remote)||(!base&&remote.version===0))return 'save';
    return 'conflict';
  }
  function syncLabel(state,record){
    if(state==='blocked')return 'Синхронизация приостановлена — проверьте копии.';
    if(state==='conflict')return 'Копии различаются — выберите, какую сохранить.';
    if(state==='offline')return 'Синхронизация недоступна. Проверьте копии перед выходом.';
    if(state==='saving')return 'Обновляем…';
    if(state==='pending')return 'Ожидает сохранения';
    if(!record)return 'Загружаем черновик…';
    if(record.version===0)return 'Исходный код задания';
    return record.code===null?'Сброс сохранён':'Сохранено';
  }
  const model=Object.freeze({validRecord,sameBase,decide,syncLabel});
  if(typeof module==='object'&&module.exports)module.exports=model;
  root.EditorDraftModel=model;
  if(!root.document)return;
  let supported=false;
  const bindings=new Set();
  const nonce=()=>{
    if(!root.crypto?.getRandomValues)throw new Error('Нет безопасного идентификатора записи.');
    const bytes=new Uint8Array(16);root.crypto.getRandomValues(bytes);
    return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  };
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function bind({editor,scope,starter,key,hasLocal,active:parentActive,writeLocal}){
    if(!key)return {changed(){},reset(){},destroy(){}};
    const panel=document.createElement('section');panel.className='draft-sync-panel';
    panel.innerHTML='<p class="draft-sync-warning" hidden></p><details class="draft-sync-tools"><summary>Черновик <span class="draft-sync-status" role="status"></span></summary><div class="draft-sync-body"></div></details>';
    const statusLine=panel.querySelector('.draft-sync-status'),warning=panel.querySelector('.draft-sync-warning');
    const tools=panel.querySelector('.draft-sync-tools'),summary=tools.querySelector('summary'),body=panel.querySelector('.draft-sync-body');
    let previousProblem='';
    const owner=root.LearningSession?.capture();
    let destroyed=false,busy=false,timer=null,base=null,pending=null,remote=null,conflict=false,blocked=false,lastError=false;
    let touched=false,localPresent=hasLocal,mirrorFailed=false,hardBlocked=false,templateAccepted=false,blockReason='',status='Подключаем синхронизацию…',ownKey;
    const metaKey=key.replace(':draft:',':draft-sync:'),copyPrefix=metaKey+':copy:';
    const active=()=>!destroyed&&parentActive()&&(!root.LearningSession||root.LearningSession.isCurrent(owner));
    const code=()=>localPresent?editor.value:null;
    const dirty=()=>touched||!!pending||(localPresent&&(!base||code()!==base.code));
    const observer=new MutationObserver(()=>{if(!editor.isConnected)destroy();});
    const item={refresh,destroy};
    function store(action){try{return action();}catch(_){mirrorFailed=true;return undefined;}}
    function readJSON(name){
      const raw=store(()=>localStorage.getItem(name));
      if(raw==null)return null;
      try{return JSON.parse(raw);}catch(_){blocked=hardBlocked=true;return {schema:'unknown'};}
    }
    function copies(){
      const result=[];
      store(()=>{
        for(let i=0;i<localStorage.length;i++){
          const name=localStorage.key(i);if(!name?.startsWith(copyPrefix)||name===ownKey)continue;
          const value=readJSON(name);
          if(!value||value.schema!==1||value.scope!==scope){blocked=hardBlocked=true;continue;}
          if((value.code!==null&&typeof value.code!=='string')||typeof value.starter!=='string'||
            (value.base!=null&&!validRecord(value.base,scope))||(value.pending!=null&&!validPending(value.pending))){blocked=hardBlocked=true;continue;}
          result.push({name,value});
        }
      });
      return result;
    }
    function cache(){store(()=>localStorage.setItem(metaKey,JSON.stringify({schema:1,record:base,mirrorFailed})));}
    function recovery(value={code:code(),starter,base,pending,archived:false}){
      if(!active())return;
      if(!ownKey){try{ownKey=copyPrefix+nonce();}catch(_){blocked=true;return;}}
      store(()=>localStorage.setItem(ownKey,JSON.stringify({schema:1,scope,...value,saved_at:new Date().toISOString()})));
    }
    function archive(record){
      try{
        const name=copyPrefix+nonce();
        store(()=>localStorage.setItem(name,JSON.stringify({schema:1,scope,code:record.code,starter:record.starter||starter,base:record,pending:null,archived:true,saved_at:new Date().toISOString()})));
      }catch(_){mirrorFailed=true;}
    }
    function removeOwn(){if(ownKey)store(()=>localStorage.removeItem(ownKey));ownKey=null;}
    function adopt(record,{apply=false}={}){
      base=record;pending=null;touched=false;
      if(apply){
        editor.value=record.code===null?starter:record.code;
        localPresent=record.code!==null;
        if(!writeLocal(record.code))mirrorFailed=true;
      }
      cache();if(code()===record.code&&!mirrorFailed)removeOwn();
      conflict=false;lastError=false;status='На сервере сохранена версия '+record.version+'.';
    }
    function download(){
      const blob=new Blob([JSON.stringify({schema:1,scope,local:{code:code(),starter},server:remote,recovery:copies().map(row=>row.value)},null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='draft-copies.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    function draw(){
      if(!active())return;
      const alternatives=copies().filter(row=>!base||row.value.code!==base.code||row.value.starter!==base.starter||row.value.pending);
      panel.dataset.state=blocked?'blocked':conflict?'conflict':busy?'saving':lastError?'offline':(touched||pending)?'pending':'ready';
      const problem=blocked?'blocked:'+blockReason:conflict?'conflict:'+remote?.mutation_id:mirrorFailed?'mirror':lastError?'offline':'';
      statusLine.textContent=blocked
        ? blockReason || (status!=='Подключаем синхронизацию…'?status:'Служебная копия другой версии или повреждена. Синхронизация приостановлена; проверьте копии.')
        : conflict||lastError?status:syncLabel(panel.dataset.state,base);
      statusLine.hidden=panel.dataset.state==='ready'&&base?.version===0&&!localPresent&&!touched&&!pending&&!mirrorFailed;
      warning.hidden=!mirrorFailed;warning.textContent=mirrorFailed?'Не удалось надёжно сохранить локальную копию. Скопируйте код или скачайте копии перед уходом.':'';
      panel.dataset.risk=problem?'true':'false';
      if(problem&&problem!==previousProblem)tools.open=true;
      previousProblem=problem;
      const focused=document.activeElement,focusAttrs=['data-sync-retry','data-sync-download','data-sync-mine','data-sync-remote','data-recover','data-remove-copy'];
      const focusedAttr=body.contains(focused)&&focusAttrs.find(name=>focused.hasAttribute(name));
      const focusedValue=focusedAttr?focused.getAttribute(focusedAttr):null;
      body.innerHTML=`<p class="draft-sync-detail">${esc(blocked?(blockReason||'Служебная копия другой версии или повреждена. Синхронизация приостановлена; обновите страницу.'):status)}</p>
        ${conflict&&remote?`<section class="draft-sync-compare"><h4>Сравнить копии · серверная версия ${remote.version}</h4><div class="draft-sync-columns">
          <section><h4>В этом редакторе</h4><pre>${esc(code()===null?'Сброс к текущему шаблону':code())}</pre></section>
          <section><h4>На сервере</h4><pre>${esc(remote.code===null?'Черновик сброшен':remote.code)}</pre></section></div>
          <div class="draft-sync-actions"><button type="button" class="btn" data-sync-mine>Сохранить мой код на сервере</button><button type="button" class="btn" data-sync-remote>Взять серверную копию</button></div></section>`:''}
        ${alternatives.length?`<section class="draft-sync-recovery"><h4>Локальные копии на этом устройстве: ${alternatives.length}</h4>${alternatives.map((row,i)=>`<section><p>${esc(row.value.saved_at||'Локальная копия')}</p><pre>${esc(row.value.code===null?'Сброс к шаблону':row.value.code)}</pre><div class="draft-sync-actions"><button class="btn" type="button" data-recover="${i}">Восстановить в редакторе</button><button class="btn" type="button" data-remove-copy="${i}">Удалить эту локальную копию</button></div></section>`).join('')}</section>`:''}
        <div class="draft-sync-actions"><button type="button" class="btn" data-sync-retry>${busy?'Синхронизация…':'Проверить синхронизацию'}</button><button type="button" class="btn" data-sync-download>Скачать копии</button></div>`;
      panel.querySelector('[data-sync-retry]').disabled=busy||blocked;
      panel.querySelector('[data-sync-retry]').onclick=()=>void refresh();
      panel.querySelector('[data-sync-download]').onclick=()=>{if(active())download();};
      const mine=panel.querySelector('[data-sync-mine]'),other=panel.querySelector('[data-sync-remote]');
      if(mine){mine.disabled=busy||blocked;mine.onclick=()=>{
        if(!active()||busy||blocked)return;
        archive(remote);base=remote;pending=null;conflict=false;templateAccepted=true;touched=true;recovery();void flush();
      };}
      if(other){other.disabled=busy||blocked;other.onclick=()=>{
        if(!active()||busy||blocked)return;
        recovery({code:code(),starter,base,pending,archived:true});ownKey=null;templateAccepted=true;adopt(remote,{apply:true});draw();
      };}
      panel.querySelectorAll('[data-recover]').forEach(button=>button.onclick=()=>{
        if(!active()||busy)return;
        const copy=alternatives[+button.dataset.recover]?.value;if(!copy)return;
        recovery({code:code(),starter,base,pending,archived:true});ownKey=null;
        editor.value=copy.code===null?starter:copy.code;localPresent=copy.code!==null;touched=true;
        if(!writeLocal(copy.code))mirrorFailed=true;
        base=validRecord(copy.base,scope)?copy.base:null;pending=validPending(copy.pending)?copy.pending:null;
        blocked=hardBlocked;blockReason='';conflict=false;templateAccepted=false;recovery();void refresh();
      });
      panel.querySelectorAll('[data-remove-copy]').forEach(button=>button.onclick=()=>{
        if(active()){store(()=>localStorage.removeItem(alternatives[+button.dataset.removeCopy].name));draw();}
      });
      if(focusedAttr){
        const next=[...body.querySelectorAll('button')].find(button=>button.getAttribute(focusedAttr)===focusedValue);
        (next&&!next.disabled?next:summary).focus({preventScroll:true});
      }
    }
    function validPending(value){
      return value&&value.scope===scope&&validId(value.mutation_id)&&Number.isSafeInteger(value.base_version)&&value.base_version>=0&&
        (value.base_version===0?value.base_mutation_id===null:validId(value.base_mutation_id))&&
        (value.code===null||typeof value.code==='string')&&typeof value.starter==='string';
    }
    async function request(method,payload){
      const session=root.LearningSession;
      if(!session)throw new Error('Владелец сессии не определён.');
      const response=await session.fetch('/api/drafts'+(method==='GET'?'?scope='+encodeURIComponent(scope):''),{
        method,signal:abort.signal,...(payload?{headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}:{})},owner);
      const data=await response.json();
      if(!active())throw new Error('Область редактора изменилась.');
      if(!response.ok)throw Object.assign(new Error(data.error||'Не удалось синхронизировать.'),{status:response.status,code:data.code,draft:data.draft});
      if(!validRecord(data.draft,scope))throw new Error('Сервер вернул неизвестный формат черновика.');
      return data.draft;
    }
    function failed(error){
      if(!active())return;
      if(error.status===409&&validRecord(error.draft,scope)){
        remote=error.draft;conflict=true;status='Есть другая версия. Ничего не заменено автоматически; выберите копию.';recovery();
      }else{
        if(error.status===413||error.status===400){pending=null;recovery();}
        lastError=true;
        status=error.status?error.message:'Сервер не подтвердил запись. Локальный код сохранён; повторите позже.';
      }
    }
    function schedule(){clearTimeout(timer);timer=setTimeout(()=>void flush(),700);}
    async function refresh(){
      if(!active()||busy||blocked)return;
      busy=true;status='Проверяем серверную копию…';draw();
      let send=false;
      try{
        remote=await request('GET');
        const uncertain=mirrorFailed&&!touched&&localPresent&&base&&code()!==base.code;
        const action=uncertain?'conflict':decide({base,remote,code:code(),starter,dirty:dirty(),pending});
        if(action==='template'||action==='conflict'){
          conflict=true;status=action==='template'?'Шаблон задания изменился. Сравните копии; код не заменён.':'Есть другая версия. Выберите копию явно.';recovery();
        }else if(action==='load'){adopt(remote,{apply:true});}
        else if(action==='same'){adopt(remote);}
        else if(action==='ack'){
          const latest=code();adopt(remote);if(latest!==remote.code){touched=true;status='Предыдущая копия подтверждена; новые изменения ждут записи.';recovery();send=true;}
        }else{base=remote;cache();send=true;}
      }catch(error){failed(error);}
      finally{if(active()){busy=false;draw();if(send)schedule();}}
    }
    async function flush(){
      if(!active()||busy||blocked||conflict)return;
      if(!base){void refresh();return;}
      if(base.version>0&&base.starter!==starter&&!templateAccepted){
        remote ||= base;conflict=true;status='Шаблон задания изменился. Сравните последнюю известную копию перед записью; код не заменён.';recovery();draw();return;
      }
      if(!pending&&!touched&&code()===base.code&&starter===base.starter){status='На сервере сохранена версия '+base.version+'.';draw();return;}
      try{
        pending ||= {scope,code:code(),starter,base_version:base.version,base_mutation_id:base.mutation_id,mutation_id:nonce()};
      }catch(error){blocked=true;status=error.message;draw();return;}
      recovery();busy=true;status='Сохраняем на сервере…';draw();
      let again=false;
      try{
        const saved=await request('PUT',pending),latest=code();
        adopt(saved);
        if(latest!==saved.code){touched=true;status='Предыдущая копия подтверждена; новые изменения ждут записи.';recovery();again=true;}
      }catch(error){failed(error);}
      finally{if(active()){busy=false;draw();if(again)schedule();}}
    }
    function changed(mirrored=true){
      if(!active())return;
      localPresent=true;touched=true;mirrorFailed=!mirrored;
      status='Локальные изменения ожидают подтверждения сервера.';
      recovery();draw();if(!conflict)schedule();
    }
    function resetDraft(mirrored=true){
      if(!active())return;
      localPresent=false;touched=true;mirrorFailed=!mirrored;
      status='Сброс ожидает подтверждения сервера.';
      recovery();draw();if(!conflict)schedule();
    }
    function destroy(){
      if(destroyed)return;
      destroyed=true;clearTimeout(timer);abort.abort();observer.disconnect();panel.remove();bindings.delete(item);
    }
    const abort=new AbortController();
    function placePanel(){
      const frame=editor.closest('.terminal-glass')||editor;
      let anchor=frame;
      for(let next=frame.nextElementSibling;next;next=next.nextElementSibling){
        if(next.matches('.run-row,.sandbox-actions')){anchor=next;break;}
        if(next.matches('.terminal-glass,.task-output-wrap'))break;
      }
      anchor.after(panel);
    }
    if(!supported){
      panel.dataset.state='local';panel.textContent='Черновик хранится в этом браузере.';
      placePanel();
      return {changed(){},reset(){},destroy(){panel.remove();}};
    }
    const metadata=readJSON(metaKey);
    if(metadata){
      if(metadata.schema!==1||!validRecord(metadata.record,scope))blocked=hardBlocked=true;
      else{base=metadata.record;mirrorFailed=!!metadata.mirrorFailed;}
    }
    const recoveryCopies=copies().filter(row=>!row.value.archived);
    const matching=recoveryCopies.filter(row=>row.value.code===code()&&row.value.starter===starter);
    if(matching.length && matching.every(row=>JSON.stringify({base:row.value.base,pending:row.value.pending})===JSON.stringify({base:matching[0].value.base,pending:matching[0].value.pending}))){
      const copy=matching[0].value;
      base=validRecord(copy.base,scope)?copy.base:base;pending=validPending(copy.pending)?copy.pending:null;touched=true;
    }else if(recoveryCopies.length){
      blocked=true;blockReason='Есть другая локальная копия. Скачайте копии и восстановите нужную; автоматическая запись приостановлена.';
    }
    placePanel();
    bindings.add(item);observer.observe(document.body,{childList:true,subtree:true});draw();
    if(!blocked)void refresh();
    return {changed,reset:resetDraft,destroy,refresh};
  }
  root.EditorDrafts=Object.freeze({
    configure(value){supported=value===true;if(!supported)for(const item of [...bindings])item.destroy();},
    bind,
  });
  root.LearningSession?.onChange(()=>{supported=false;for(const item of [...bindings])item.destroy();});
  root.addEventListener('focus',()=>{for(const item of bindings)void item.refresh();});
  root.addEventListener('online',()=>{for(const item of bindings)void item.refresh();});
})(typeof window==='object'?window:globalThis);
