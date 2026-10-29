/* Optional, account-scoped AI controls; no local persistence or model calls. */
(function(root){
 'use strict';if(root.AISettings)return;const bindings=new Set();
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const valid=data=>data&&typeof data.provider_available==='boolean'&&data.preferences&&['enabled','automatic_review','history_context'].every(k=>typeof data.preferences[k]==='boolean')&&Number.isInteger(data.preferences.version)&&[0,30,90].includes(data.preferences.retention_days)&&['chat','attempts','project_reviews','riddles'].every(k=>Number.isSafeInteger(data.counts?.[k])&&data.counts[k]>=0);
 const descriptions={chat:'Удалить переписку с наставником по всем заданиям? Память и попытки останутся. Лимит вопросов и капли не изменятся.',attempts:'Удалить сохранённые попытки и историю исправления ошибок? Решённые задания, опыт, заметки и покупки останутся.',project_reviews:'Удалить тексты разборов проектов? Файлы, версии и учёт оплаты сохранятся; удалённый разбор заново не списывается и не восстанавливается.',riddles:'Удалить диалоги загадок и завершить сегодняшний раунд? Новые загадки будут доступны завтра.'};
 function leave(){for(const item of [...bindings])item();bindings.clear();}
 function mount(host,{onChange=()=>{},onCleared=()=>{}}={}){
  const owner=root.LearningSession.capture(),parent=host.closest('details');let serial=0,dead=false,busy=false,value=null;
  const active=()=>!dead&&host.isConnected&&parent.open&&root.LearningSession.isCurrent(owner);
  const cleanup=()=>{dead=true;serial++;parent.removeEventListener('toggle',toggle);host.replaceChildren();};bindings.add(cleanup);
  const toggle=()=>{serial++;if(parent.open)void render();else{host.replaceChildren();value=null;}};parent.addEventListener('toggle',toggle);
  async function api(path,body,method='POST'){
   const response=await root.LearningSession.fetch(path,body===undefined?{cache:'no-store'}:{method,cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},owner);
   const data=await response.json();if(!active())throw new Error('Страница или аккаунт изменились.');
   if(!response.ok)throw Object.assign(new Error(data.error||'Настройки не подтверждены.'),{status:response.status,code:data.code});return data;
  }
  async function render(){
   const ticket=++serial;host.innerHTML='<p role="status">Загружаем настройки ИИ…</p>';
   try{const data=await api('/api/ai/settings');if(!active()||ticket!==serial)return;if(!valid(data))throw new Error('Сервер прислал неполные настройки.');value=data;paint();onChange({...data.preferences,provider_available:data.provider_available});}
   catch(error){if(active()&&ticket===serial){host.innerHTML='<p role="alert">'+esc(error.message)+'</p><button class="btn" type="button">Обновить настройки</button>';host.querySelector('button').onclick=render;}}
  }
  function paint(){
   const pref=value.preferences;busy=false;
   host.innerHTML=`<form class="ai-settings-form"><label><input type="checkbox" id="aiEnabled" ${pref.enabled?'checked':''}><span>Разрешить обращения к ИИ</span></label>
    <label><input type="checkbox" id="aiAutomatic" ${pref.automatic_review?'checked':''}><span>Автоматически разбирать попытки</span></label>
    <label><input type="checkbox" id="aiHistoryContext" ${pref.history_context?'checked':''}><span>Добавлять прошлую историю и память к запросам</span></label>
    <p>${esc(value.context)}</p><label class="ai-retention">Хранить переписку и заметки наставника<select id="aiRetention"><option value="0">До ручного удаления</option><option value="30">30 дней</option><option value="90">90 дней</option></select></label>
    <p>${esc(value.retention)}</p><button class="btn" type="submit">Сохранить настройки ИИ</button></form>
    ${value.provider_available?'':'<p>Сервис ИИ сейчас недоступен. Настройки сохраняются; теория, подсказки и Python работают.</p>'}
    <details class="ai-data-controls"><summary>Очистить историю</summary><p>Вопросов сегодня: ${value.usage_today}. Очистка переписки не возвращает бесплатный лимит и не меняет баланс.</p>
    <label>Что очистить<select id="aiClearSection"><option value="chat">Переписка (${value.counts.chat})</option><option value="attempts">Попытки и исправления (${value.counts.attempts})</option><option value="project_reviews">Разборы проектов (${value.counts.project_reviews})</option><option value="riddles">Диалоги загадок (${value.counts.riddles})</option></select></label>
    <button class="btn" type="button" id="aiClearData">Очистить выбранное</button><p>${esc(value.copies)}</p></details>
    <p id="aiSettingsStatus" role="status" aria-live="polite"></p><button class="link-btn" type="button" id="aiSettingsRefresh">Обновить настройки</button>`;
   const $=id=>host.querySelector('#'+id),message=text=>{if(active())$('aiSettingsStatus').textContent=text;};
   $('aiRetention').value=String(pref.retention_days);
   const lock=flag=>{busy=flag;host.querySelectorAll('button,input,select').forEach(node=>node.disabled=flag);};
   host.querySelector('form').onsubmit=async event=>{
    event.preventDefault();if(busy)return;
    const days=Number($('aiRetention').value),reducing=days&&(!pref.retention_days||days<pref.retention_days);
    if(reducing&&!confirm('Удалить переписку и заметки наставника старше '+days+' дней? Перед этим можно скачать учебный архив.'))return;
    lock(true);message('Сохраняем…');
    try{const data=await api('/api/ai/settings',{version:pref.version,enabled:$('aiEnabled').checked,automatic_review:$('aiAutomatic').checked,history_context:$('aiHistoryContext').checked,retention_days:days,confirm_retention:!!reducing},'PATCH');
     if(!valid(data)||data.preferences.version!==pref.version+1)throw new Error('Подтверждение изменения не получено.');
     value=data;paint();onChange({...data.preferences,provider_available:data.provider_available});onCleared();message('Настройки сохранены. Уже отправленный запрос может завершиться.');host.querySelector('form button').focus();
    }catch(error){message(error.message+(error.code==='ai_settings_changed'?' Обновите настройки ниже.':' Изменение могло сохраниться; обновите настройки, чтобы проверить.'));}
    finally{if(active())lock(false);}
   };
   $('aiSettingsRefresh').onclick=render;
   $('aiClearData').onclick=async()=>{
    if(busy)return;const section=$('aiClearSection').value;if(!confirm(descriptions[section]))return;lock(true);message('Очищаем выбранный раздел…');
    try{const data=await api('/api/ai/clear',{section,confirmed:true});if(data.ok!==true||data.cleared!==section||!valid(data))throw new Error('Подтверждение очистки не получено.');value=data;paint();host.querySelector('.ai-data-controls').open=true;$('aiClearSection').value=section;onCleared();message('Выбранный раздел очищен. Прогресс и баланс сохранены.');$('aiClearData').focus();}
    catch(error){message(error.code==='ai_busy'?error.message:'Очистка не подтверждена. '+error.message+' Обновите состояние перед повтором.');}
    finally{if(active())lock(false);}
   };
  }
  if(parent.open)void render();
 }
 root.LearningSession.onChange(leave);root.AISettings=Object.freeze({mount,leave});
})(window);
