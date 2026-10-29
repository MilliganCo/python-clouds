/* File code stays inert. The server checks ownership, signature and preview before restore. */
(function(root){
  'use strict';
  const FILE_FORMAT='pycloud-learning-file',MAX_FILE=26*1024*1024,MAX_LOCAL=8*1024*1024;
  const labels={progress:'Решённые задания',notes:'Заметки',survey:'Анкета',review_fixes:'Исправления ошибок',review_practice:'Отложенный повтор',
    ai_messages:'Переписка с наставником',attempts:'Попытки решения',project_course_progress:'Проектные курсы',project_stage_progress:'Этапы проектов',
    project_code_snapshots:'Снимки кода проектов',project_course_events:'История проектов',daily_ai_solves:'Задания дня',atlas_tasks:'Личные задачи Атласа',
    atlas_solves:'Решения Атласа',editor_drafts:'Серверные черновики',drop_awards:'Учёт наград за задания',achievements:'Полученные достижения',
    freeze_uses:'Использованные заморозки',hint_unlocks:'Открытые подсказки',daily_claims:'Полученные сундуки',chest_grants:'Бонусные запуски',
    chest_launches:'История запусков',game_log:'Учёт наград мини-игр',wallet:'Кошелёк',purchases:'Покупки',showcase_cards:'Опубликованные работы',
    showcase_votes:'Ваши голоса',ai_memory:'Память и счётчики наставника',riddle_sessions:'Счётчики загадок',weekly_reward_keys:'Учёт наград практикума',
    workshop_projects:'Личные проекты мастерской',workshop_versions:'Версии файлов мастерской',workshop_runs:'Запуски мастерской',workshop_reviews:'Разборы проектов'};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
  function conflictText(section,row){
    if(section==='notes')return row.text;
    if(section==='project_stage_progress'){
      let text=row.current_code;
      try{
        const evidence=JSON.parse(row.local_evidence_json||'{}');
        if(evidence.checked?.length||evidence.reflection)text+='\n\nСамопроверка: отмечено '+(evidence.checked?.length||0)+' действий.\n'+(evidence.reflection||'');
      }catch(_){}
      return text;
    }
    if(section==='editor_drafts')return row.code===null?'Сброс к шаблону:\n'+row.starter:row.code+'\n\nШаблон:\n'+row.starter;
    const fields={status:'Состояние',current_stage_id:'Текущий этап',started_at:'Начато',completed_at:'Завершено',updated_at:'Изменено',
      fixed_at:'Исправлено',last_failed_at:'Последняя ошибка',issue:'Тип ошибки',data:'Ответы анкеты',payload:'Условие задачи',solved_at:'Решено'};
    return Object.entries(row).filter(([k])=>fields[k]).map(([k,v])=>fields[k]+': '+(v===null?'не указано':v)).join('\n');
  }
  const scopeAllowed=scope=>typeof scope==='string'&&scope.length<=160&&
    /^(sandbox|task:\d+\.\d+|atlas:[a-z0-9-]{1,80}|daily:\d{4}-\d{2}-\d{2}:(intermediate|advanced|expert)(?::[0-9a-f]{64})?)$/.test(scope);
  function parseFile(value){
    if(value?.format===FILE_FORMAT){
      if(value.version!==1||!value.server||!value.browser||!Array.isArray(value.browser.entries)||value.browser.entries.length>2000)
        throw new Error('Неизвестная версия файла учебной работы. Сохраните исходный файл.');
      if(typeof value.browser.owner!=='string'||value.browser.entries.some(e=>!e||typeof e.name!=='string'||e.name.length>512||
          !/^(draft:|draft-sync:)/.test(e.name)||typeof e.value!=='string')||bytes(value.browser)>MAX_LOCAL)
        throw new Error('Неверный раздел локальных черновиков.');
      if(value.browser.owner!==value.server.payload?.owner?.username)throw new Error('Владельцы серверной и локальной копий различаются.');
      return {server:value.server,browser:value.browser};
    }
    if(value?.payload?.format==='pycloud-learning-archive')return {server:value,browser:null};
    throw new Error('Выберите личный архив учебной работы, а не экспорт заметок или копию всей установки.');
  }
  function localCopies(browser){
    if(!browser)return [];
    const result=[];
    for(const entry of browser.entries){
      if(entry.name.startsWith('draft:')){
        const scope=entry.name.slice(6);if(!scopeAllowed(scope))continue;
        let starter='';
        try{
          const meta=JSON.parse(browser.entries.find(e=>e.name==='draft-sync:'+scope)?.value||'null');
          if(meta?.schema===1&&typeof meta.record?.starter==='string')starter=meta.record.starter;
        }catch(_){}
        result.push({scope,code:entry.value,starter});
      }else if(entry.name.includes(':copy:')){
        try{
          const copy=JSON.parse(entry.value);
          if(copy?.schema===1&&scopeAllowed(copy.scope)&&(copy.code===null||typeof copy.code==='string')&&typeof copy.starter==='string')
            result.push({scope:copy.scope,code:copy.code,starter:copy.starter});
        }catch(_){}
      }
    }
    return result;
  }
  const model=Object.freeze({parseFile,localCopies,scopeAllowed});
  if(typeof module==='object'&&module.exports)module.exports=model;
  if(!root.document)return;
  let supported=false;
  const bindings=new Set();
  function collectLocal(user){
    const prefix='pycloud:u:'+user+':',entries=[];
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;
      const name=key.slice(prefix.length);if(!/^(draft:|draft-sync:)/.test(name))continue;
      const value=localStorage.getItem(key);if(typeof value==='string')entries.push({name,value});
    }
    const data={owner:user,entries};
    if(entries.length>2000||bytes(data)>MAX_LOCAL)throw new Error('Локальные черновики больше лимита личного файла. Серверные данные можно скачать без них.');
    return data;
  }
  function download(value,name){
    const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function restoreLocal(user,file,receipt){
    const copies=localCopies(file.browser);let restored=0;
    for(let i=0;i<copies.length;i++){
      const row={schema:1,...copies[i],base:null,pending:null,archived:true,saved_at:file.server.payload.created_at};
      let name='pycloud:u:'+user+':draft-sync:'+row.scope+':copy:archive-'+file.server.signature+'-'+i;
      try{
        const old=localStorage.getItem(name);
        if(old!==null){
          if(old===JSON.stringify(row)){restored++;continue;}
          name+='-'+receipt+'-'+root.crypto.getRandomValues(new Uint32Array(2)).join('-');
          if(localStorage.getItem(name)!==null)throw new Error('Локальная копия уже существует.');
        }
        localStorage.setItem(name,JSON.stringify(row));restored++;
      }catch(_){break;}
    }
    return {restored,total:copies.length};
  }
  function bind(pane,{active:parentActive}){
    const owner=root.LearningSession?.capture();
    let destroyed=false,busy=false,file=null,plan=null,confirmed=false;
    const abort=new AbortController(),active=()=>!destroyed&&pane.isConnected&&parentActive()&&root.LearningSession?.isCurrent(owner);
    const item={destroy};bindings.add(item);
    const observer=new MutationObserver(()=>{if(!pane.isConnected)destroy();});observer.observe(document.body,{childList:true,subtree:true});
    pane.innerHTML=`<details class="learning-archive"><summary>Архив учебной работы</summary>
      <p>Скачайте прогресс, заметки, черновики и проекты вместе с историей. Восстановление работает для этого аккаунта на той же установке платформы.</p>
      <p>Капли и покупки не откатываются, публикации не создаются заново. Память и счётчики наставника включены для чтения. Файл содержит ваш код и переписку — храните его лично.</p>
      <div class="archive-actions"><button class="btn" type="button" data-archive-export>Скачать учебную работу</button>
      <label><input type="checkbox" data-archive-with-local checked> Добавить черновики этого браузера</label></div>
      <label class="archive-file">Файл для восстановления <input type="file" accept=".json,application/json" data-archive-file></label>
      <p data-archive-status role="status" aria-live="polite"></p>
      <div class="archive-import" hidden data-archive-import>
        <p data-archive-file-info></p><label>Если значения различаются <select data-archive-choice><option value="keep_current">Сохранить текущие, добавить недостающее</option><option value="use_archive">Взять архивные, сохранить предыдущую копию</option></select></label>
        <div class="archive-actions"><button class="btn" type="button" data-archive-preview>Проверить файл без изменений</button></div><div data-archive-plan></div>
      </div>
      <details class="archive-history"><summary>История восстановления серверных данных</summary>
        <button class="btn" type="button" data-archive-history-refresh>Обновить историю</button><div data-archive-history></div></details>
      <button class="btn" type="button" data-archive-reload hidden>Обновить страницу с восстановленным прогрессом</button>
    </details>`;
    const find=selector=>pane.querySelector(selector),status=find('[data-archive-status]'),choice=find('[data-archive-choice]'),input=find('[data-archive-file]');
    function controls(){pane.querySelectorAll('button,input,select').forEach(el=>el.disabled=busy||!supported);}
    async function api(path,options={}){
      const response=await root.LearningSession.fetch(path,{...options,signal:abort.signal},owner);
      const data=await response.json();if(!active())throw new Error('Аккаунт или страница изменились.');
      if(!response.ok)throw Object.assign(new Error(data.error||'Не удалось обработать архив.'),{status:response.status,code:data.code});
      return data;
    }
    const post=(path,data)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    async function work(action){
      if(!active()||busy||!supported)return;
      busy=true;controls();
      try{await action();}catch(error){if(active())status.textContent=error.message;}
      finally{busy=false;if(active())controls();}
    }
    function clearPlan(){plan=null;confirmed=false;find('[data-archive-plan]').replaceChildren();}
    function drawPlan(){
      const rows=plan.sections.filter(s=>s.add||s.update||s.conflict||s.read_only||s.unchanged);
      find('[data-archive-plan]').innerHTML=`<p>Добавить: ${plan.add}. Обновить: ${plan.update}. Различий: ${plan.conflict_count}. Предпросмотр ничего не записал.</p>
        <div class="archive-table-wrap"><table><thead><tr><th scope="col">Раздел</th><th scope="col">Добавить</th><th scope="col">Обновить</th><th scope="col">Различия</th></tr></thead>
        <tbody>${rows.map(s=>`<tr><th scope="row">${esc(labels[s.section]||s.section)}${s.read_only?' · только копия':''}</th><td>${s.add}</td><td>${s.update}</td><td>${s.conflict}</td></tr>`).join('')}</tbody></table></div>
        ${plan.conflicts.length?`<details class="archive-conflicts"><summary>Сравнить различия (${Math.min(20,plan.conflict_count)} из ${plan.conflict_count})</summary>
          ${plan.conflicts.map(c=>`<section><h4>${esc(labels[c.section]||c.section)} · ${esc(c.title||c.key.join(' / '))}</h4><div class="draft-sync-columns"><div><b>Сейчас</b><pre>${esc(conflictText(c.section,c.current))}</pre></div><div><b>В архиве</b><pre>${esc(conflictText(c.section,c.incoming))}</pre></div></div></section>`).join('')}</details>`:''}
        <p>Текущая серверная копия останется в истории восстановления. Старые снимки проектов не удаляются. Если вы или другая вкладка измените данные, понадобится новая проверка.</p>
        ${file.browser?`<label><input type="checkbox" data-archive-local checked> Добавить локальные копии кода (${localCopies(file.browser).length}) для ручного восстановления; текущий редактор не заменять</label><p>Служебные записи других версий остаются в исходном файле. Подпись сервера подтверждает только серверную часть.</p>`:''}
        <label class="archive-confirm"><input type="checkbox" data-archive-confirm> Подтверждаю выбранное правило восстановления</label>
        <div class="archive-actions"><button class="btn" type="button" data-archive-restore>Восстановить учебную работу</button></div>`;
      find('[data-archive-confirm]').onchange=event=>{confirmed=event.target.checked;};
      find('[data-archive-restore]').onclick=()=>void work(async()=>{
        if(!confirmed){status.textContent='Подтвердите выбранное правило восстановления.';return;}
        status.textContent='Восстанавливаем. При потере ответа повторите отправку: записи не продублируются.';
        try{
          const result=await post('/api/learning-archive/restore',{archive:file.server,choice:choice.value,token:plan.token});
          const local=find('[data-archive-local]')?.checked?restoreLocal(owner.user,file,result.receipt_id):{restored:0,total:0};
          status.textContent=(result.replayed?'Это восстановление уже выполнено. ':'Серверная работа восстановлена. ')+
            `Локальные копии: ${local.restored} из ${local.total}. `+(local.restored<local.total?'Остальные есть в загруженном файле; локальное хранилище недоступно или заполнено. ':'')+
            'Баланс капель не изменён. Обновите страницу, чтобы увидеть прогресс.';
          find('[data-archive-reload]').hidden=false;
          await loadHistory().catch(()=>{if(active())status.textContent+=' Историю не удалось загрузить; её можно обновить отдельно.';});
        }catch(error){
          if(error.status===409)clearPlan();
          throw new Error('Не удалось получить подтверждение восстановления. '+error.message);
        }
      });
    }
    async function loadHistory(){
      const data=await api('/api/learning-archive/history');
      find('[data-archive-history]').innerHTML=data.history.length?data.history.map(row=>`<div class="archive-history-row"><p>${esc(row.applied_at)} · ${row.choice==='use_archive'?'Взяты архивные значения':'Сохранены текущие значения'}</p>
        <div class="archive-actions"><button class="btn" type="button" data-history-id="${row.id}" data-history-which="before">Копия до восстановления</button><button class="btn" type="button" data-history-id="${row.id}" data-history-which="incoming">Загруженный архив</button></div></div>`).join(''):'<p>Восстановлений пока не было.</p>';
      pane.querySelectorAll('[data-history-id]').forEach(button=>button.onclick=()=>void work(async()=>{
        const data=await api('/api/learning-archive/history/'+button.dataset.historyId+'/'+button.dataset.historyWhich);
        if(active())download(data,'python-learning-'+button.dataset.historyWhich+'.json');
      }));
    }
    find('[data-archive-export]').onclick=()=>void work(async()=>{
      status.textContent='Готовим файл учебной работы…';
      let browser={owner:owner.user,entries:[]};
      if(find('[data-archive-with-local]').checked){
        try{browser=collectLocal(owner.user);}catch(_){throw new Error('Не удалось прочитать локальные черновики или они больше лимита. Снимите отметку «Добавить черновики этого браузера», чтобы скачать серверные данные отдельно.');}
      }
      const server=await api('/api/learning-archive');
      if(!active())return;
      download({format:FILE_FORMAT,version:1,server,browser},'python-learning-work.json');
      status.textContent='Файл передан браузеру для скачивания. Проверьте, что он появился в загрузках.';
    });
    input.onchange=()=>void work(async()=>{
      clearPlan();file=null;find('[data-archive-import]').hidden=true;
      const selected=input.files?.[0];if(!selected)return;
      if(selected.size>MAX_FILE)throw new Error('Файл больше 26 МиБ. Ничего не изменено.');
      const text=await selected.text();if(!active())return;
      let parsed;try{parsed=JSON.parse(text);}catch(_){throw new Error('Файл не является корректным JSON.');}
      file=parseFile(parsed);
      if(file.server.payload?.owner?.username!==owner.user)throw new Error('Выбран архив другого аккаунта.');
      choice.value='keep_current';find('[data-archive-import]').hidden=false;
      find('[data-archive-file-info]').textContent='Архив: '+String(file.server.payload.created_at||'')+'. Локальных копий кода: '+localCopies(file.browser).length+'.';
      status.textContent='Файл прочитан. Теперь проверьте подпись и изменения на сервере.';
    });
    choice.onchange=()=>{clearPlan();status.textContent='Правило изменено. Проверьте файл заново.';};
    find('[data-archive-preview]').onclick=()=>void work(async()=>{
      if(!file)return;clearPlan();status.textContent='Проверяем подпись, владельца и различия…';
      plan=await post('/api/learning-archive/preview',{archive:file.server,choice:choice.value});
      drawPlan();status.textContent='Предпросмотр готов. Данные ещё не изменены.';
    });
    find('[data-archive-history-refresh]').onclick=()=>void work(loadHistory);
    find('.archive-history').ontoggle=event=>{if(event.target.open)void work(loadHistory);};
    find('[data-archive-reload]').onclick=()=>{if(active())root.location.reload();};
    function destroy(){
      if(destroyed)return;destroyed=true;abort.abort();observer.disconnect();file=null;plan=null;input.value='';bindings.delete(item);
    }
    controls();
    if(!supported)status.textContent='Личный архив появится после обновления сервера. Экспорт заметок выше доступен сейчас.';
    return item;
  }
  root.LearningArchive=Object.freeze({configure(value){supported=value===true;if(!supported)for(const item of [...bindings])item.destroy();},bind});
  root.LearningSession?.onChange(()=>{supported=false;for(const item of [...bindings])item.destroy();});
})(typeof window==='object'?window:globalThis);
