/* Recovery secrets live only in the current form and an explicitly downloaded file. */
(function(root){
 'use strict';if(root.AccountSecurity)return;
 const cleanups=new Set();let revision=0;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const when=value=>new Date(value).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'});
 const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
 const acknowledged=data=>data?.ok===true&&data.reauthenticate===true;
 function leave(){revision++;for(const cleanup of [...cleanups])cleanup();cleanups.clear();}
 async function api(path,body,owner){
  const options=body===undefined?{cache:'no-store'}:{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
  let response;try{response=await root.LearningSession.fetch(path,options,owner);}catch(error){if(error.status)throw error;throw new Error('Подтверждение сервера не получено. Проверьте соединение.');}
  let data;try{data=await response.json();}catch{throw new Error('Сервер не прислал подтверждение действия.');}
  if(!root.LearningSession.isCurrent(owner))throw Object.assign(new Error('Аккаунт изменился.'),{status:409});
  if(!response.ok)throw Object.assign(new Error(data.error||'Действие не выполнено.'),{status:response.status});return data;
 }
 function clearSecrets(host){host.querySelectorAll('input[type=password],textarea[data-recovery-secret]').forEach(node=>{node.value='';});}
 function mount(host,onReauthenticate){
  const owner=root.LearningSession.capture(),ticket=revision;let turn=0,batch=null,busy=false;
  const current=()=>ticket===revision&&host.isConnected&&host.open&&root.LearningSession.isCurrent(owner);
  const fields=document.createElement('div');fields.className='account-security-fields';host.appendChild(fields);
  const erase=()=>{turn++;batch=null;clearSecrets(fields);fields.replaceChildren();busy=false;};
  const onToggle=()=>{if(host.open)void render();else erase();};host.addEventListener('toggle',onToggle);
  cleanups.add(()=>{host.removeEventListener('toggle',onToggle);erase();});
  async function render(){
   const attempt=++turn;fields.innerHTML='<p role="status">Загружаем настройки входа…</p>';
   let status;try{status=await api('/api/account/security',undefined,owner);if(!Number.isInteger(status.recovery_codes_remaining)||status.recovery_codes_remaining<0||status.recovery_codes_remaining>8||status.password_min_length!==15||status.password_max_length!==128||(status.recovery_codes_remaining>0&&!validDate(status.recovery_expires_at)))throw new Error('Не удалось получить полный статус входа.');}catch(error){if(!current()||attempt!==turn)return;fields.innerHTML='<p role="alert">'+esc(error.message)+'</p><button class="btn" id="securityRetry">Повторить</button>';fields.querySelector('button').onclick=render;return;}
   if(!current()||attempt!==turn)return;
   const active=()=>current()&&attempt===turn;
   fields.innerHTML=`<section><h3>Коды восстановления</h3><p id="recoveryCurrentStatus">${status.recovery_codes_remaining?`Активных кодов: ${status.recovery_codes_remaining}. Действуют до ${esc(when(status.recovery_expires_at))}.`:'Активных кодов пока нет.'}</p><p>Если забудете пароль, один код поможет вернуть доступ. Сохраните набор отдельно от этого устройства. После восстановления все старые коды и сеансы будут отменены.</p>
    <form id="securityCodesForm"><label>Текущий пароль<input id="securityCodesPassword" type="password" autocomplete="current-password" required></label><button class="btn" type="submit">Подготовить новые коды</button></form>
    <div id="recoveryCodesBox" hidden><p>Сохраните эти коды, затем подтвердите. До подтверждения прежний набор продолжает работать.</p><label>Новые коды<textarea id="recoveryCodesText" data-recovery-secret readonly rows="8" autocomplete="off" spellcheck="false"></textarea></label><div class="account-actions"><button class="btn" id="downloadRecoveryCodes" type="button">Скачать коды</button><button class="btn dark" id="activateRecoveryCodes" type="button">Я сохранил коды — активировать</button></div><p id="recoveryCodesExpiry"></p></div></section>
    <section><h3>Изменить пароль</h3><p>Используйте уникальную фразу от ${status.password_min_length} символов. Смена пароля завершит все сеансы и отменит коды восстановления.</p><form id="securityPasswordForm"><label>Текущий пароль<input id="securityOldPassword" type="password" autocomplete="current-password" required></label><label>Новый пароль<input id="securityNewPassword" type="password" autocomplete="new-password" minlength="${status.password_min_length}" maxlength="${status.password_max_length}" required></label><label>Повторите новый пароль<input id="securityRepeatPassword" type="password" autocomplete="new-password" minlength="${status.password_min_length}" maxlength="${status.password_max_length}" required></label><button class="btn" type="submit">Изменить пароль</button></form></section>
    <section><h3>Выйти на всех устройствах</h3><p>Завершит текущий сеанс, другие сеансы браузера и входы в приложение. Пароль и активные коды восстановления сохранятся.</p><form id="securityRevokeForm"><label>Текущий пароль<input id="securityRevokePassword" type="password" autocomplete="current-password" required></label><button class="btn" type="submit">Выйти на всех устройствах</button></form></section><p id="securityStatus" role="status" aria-live="polite"></p>`;
   const $=id=>fields.querySelector('#'+id);
   const message=(text,error=false)=>{if(active()){$('securityStatus').textContent=text;$('securityStatus').classList.toggle('account-error',error);}};
   const lock=value=>{busy=value;fields.querySelectorAll('button,input').forEach(control=>control.disabled=value);};
   $('securityCodesForm').onsubmit=async event=>{
    event.preventDefault();if(busy)return;lock(true);message('Подготавливаем коды…');
    try{
     const result=await api('/api/account/recovery-codes',{password:$('securityCodesPassword').value},owner);
     if(!active())return;
     if(!Array.isArray(result.codes)||result.codes.length!==8||!result.codes.every(code=>/^[A-F0-9]{8}(?:-[A-F0-9]{8}){3}$/.test(code))||!/^[0-9a-f]{64}$/.test(result.activation_token)||!/^[0-9a-f]{32}$/.test(result.batch)||!validDate(result.expires_at))throw new Error('Неполный набор кодов. Подготовьте новый.');
     batch=result;$('securityCodesPassword').value='';$('recoveryCodesText').value=result.codes.join('\n');$('recoveryCodesBox').hidden=false;
     $('recoveryCodesExpiry').textContent='После активации коды действуют до '+when(result.expires_at)+'. Подтвердите этот набор в течение 10 минут.';
     message('Коды ещё не активированы. Сначала сохраните их.');$('recoveryCodesText').focus();
    }catch(error){message(error.message+' Действующий набор не изменён.',true);}finally{if(active())lock(false);}
   };
   $('downloadRecoveryCodes').onclick=()=>{
    if(!batch)return;
    const text='Python в облаках — коды восстановления\nАккаунт: '+owner.user+'\nСрок: '+batch.expires_at+'\n\n'+batch.codes.join('\n')+'\n\nПодтвердите активацию набора в профиле. Один код восстанавливает доступ и отменяет весь набор.\nХраните этот файл отдельно от устройства с платформой.\n';
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='python-clouds-recovery.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   };
   $('activateRecoveryCodes').onclick=async()=>{
    if(!batch||busy)return;const activating=batch;lock(true);message('Активируем сохранённый набор…');
    try{
     const result=await api('/api/account/recovery-codes/activate',{activation_token:activating.activation_token},owner);
     if(result.ok!==true||result.batch!==activating.batch||typeof result.replayed!=='boolean')throw new Error('Подтверждение активации не получено.');
     if(!active())return;batch=null;clearSecrets(fields);$('recoveryCodesBox').hidden=true;$('recoveryCurrentStatus').textContent='Активных кодов: 8. Действуют до '+when(activating.expires_at)+'.';message('Коды активированы. Скачанный набор теперь можно использовать для восстановления.');
    }catch(error){message(error.message+(error.status===409?' Подготовьте новый набор.':' Можно повторить подтверждение того же набора.'),true);}finally{if(active())lock(false);}
   };
   $('securityPasswordForm').onsubmit=async event=>{
    event.preventDefault();if(busy)return;
    if($('securityNewPassword').value!==$('securityRepeatPassword').value){message('Новые пароли не совпадают.',true);return;}
    lock(true);message('Изменяем пароль…');
    try{
     const result=await api('/api/account/password',{password:$('securityOldPassword').value,new_password:$('securityNewPassword').value},owner);
     if(!acknowledged(result))throw new Error('Подтверждение смены пароля не получено.');
     if(root.LearningSession.isCurrent(owner))onReauthenticate('Пароль изменён. Войдите с новым паролем и подготовьте новый набор кодов восстановления.');
    }catch(error){message(error.message+(!error.status?' Действие могло выполниться; проверьте вход с новым паролем.':''),true);}finally{if(active())lock(false);}
   };
   $('securityRevokeForm').onsubmit=async event=>{
    event.preventDefault();if(busy)return;lock(true);message('Завершаем сеансы…');
    try{const result=await api('/api/account/revoke-sessions',{password:$('securityRevokePassword').value},owner);if(!acknowledged(result))throw new Error('Подтверждение завершения сеансов не получено.');if(root.LearningSession.isCurrent(owner))onReauthenticate('Сеансы на всех устройствах завершены. Войдите заново.');}
    catch(error){message(error.message+(!error.status?' Подтверждение не получено; сеансы уже могли завершиться.':''),true);}finally{if(active())lock(false);}
   };
   const deletion=document.createElement('details');deletion.className='account-delete';deletion.id='accountDeletion';deletion.innerHTML='<summary>Удалить аккаунт</summary><div class="account-delete-body"></div>';fields.appendChild(deletion);bindDeletion(deletion,owner,active);
  }
  if(host.open)void render();
 }
 function bindDeletion(host,owner,parentActive){
  const body=host.querySelector('.account-delete-body');let attempt=0,plan=null,busy=false;
  const clear=()=>{attempt++;plan=null;clearSecrets(body);body.replaceChildren();busy=false;};
  const toggle=()=>{if(host.open)void render();else clear();};host.addEventListener('toggle',toggle);
  cleanups.add(()=>{host.removeEventListener('toggle',toggle);clear();});
  async function render(){
   const turn=++attempt,active=()=>turn===attempt&&parentActive()&&host.open&&host.isConnected;
   body.innerHTML='<p role="status">Проверяем условия удаления…</p>';
   let preview;try{preview=await api('/api/account/deletion-preview',undefined,owner);if(preview?.policy?.version!==1||!['active_database','backups','devices','reservation'].every(key=>typeof preview.policy[key]==='string'&&preview.policy[key])||!Number.isSafeInteger(preview.records)||!Number.isSafeInteger(preview.publications))throw new Error('Условия удаления недоступны.');}
   catch(error){if(active())body.innerHTML='<p role="alert">'+esc(error.message)+'</p>';return;}
   if(!active())return;
   const policy=preview.policy;
   body.innerHTML=`<h3>Сначала сохраните нужное</h3><p>${esc(policy.active_database)} Сейчас записей: ${preview.records}; публикаций: ${preview.publications}.</p>
    <button class="btn" type="button" id="accountExportBeforeDelete">Скачать данные аккаунта</button><p>Файл включает серверную учебную работу и локальные копии этого браузера. Он нужен для чтения и сохранения кода; удалённый аккаунт восстановить из него нельзя.</p>
    <h3>Что останется после удаления</h3><p>${esc(policy.backups)}</p><p>${esc(policy.devices)}</p><p>${esc(policy.reservation)}</p>
    <form id="accountDeleteForm"><label>Текущий пароль<input id="accountDeletePassword" type="password" autocomplete="current-password" required></label>
    <label>Введите имя ${esc(owner.user)}<input id="accountDeleteName" autocomplete="off" spellcheck="false" required></label>
    <label class="account-delete-check"><input id="accountDeleteAcknowledgement" type="checkbox" required><span>Я сохранил нужное и понимаю, какие копии останутся.</span></label>
    <button class="btn" type="submit">Проверить удаление</button></form>
    <div id="accountDeleteConfirmation" hidden><p>Удаление необратимо. Все сеансы аккаунта ${esc(owner.user)} завершатся.</p><button class="btn account-danger" type="button" id="accountDeleteCommit">Удалить аккаунт навсегда</button></div>
    <p id="accountDeleteStatus" role="status" aria-live="polite"></p><button class="btn" type="button" id="accountDeleteReceipt" hidden>Проверить результат удаления</button>`;
   const $=id=>body.querySelector('#'+id),message=text=>{if(active())$('accountDeleteStatus').textContent=text;};
   const lock=value=>{busy=value;body.querySelectorAll('button,input').forEach(node=>node.disabled=value);};
   function download(value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='python-clouds-account.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
   $('accountExportBeforeDelete').onclick=async()=>{
    if(busy)return;lock(true);message('Собираем файл…');
    try{const controls=await api('/api/ai/settings',undefined,owner);const server=await api('/api/learning-archive',undefined,owner);if(!active())return;
     if(!controls?.preferences||!['enabled','automatic_review','history_context'].every(key=>typeof controls.preferences[key]==='boolean'))throw new Error('Не удалось получить настройки ИИ для экспорта.');
     if(server?.payload?.owner?.username!==owner.user||server.payload.format!=='pycloud-learning-archive'||typeof server.signature!=='string')throw new Error('Сервер не подтвердил владельца архива.');
     const prefixes=['pycloud:u:'+owner.user+':','pycloud:u:'+encodeURIComponent(owner.user)+':','pycloud:workshop:'+owner.user+':'],entries=[];
     for(let i=0;i<localStorage.length;i++){const name=localStorage.key(i);if(prefixes.some(prefix=>name?.startsWith(prefix)))entries.push({name,value:localStorage.getItem(name)});}
     const browser={owner:owner.user,entries};if(new TextEncoder().encode(JSON.stringify(browser)).length>8*1024*1024)throw new Error('Локальные копии превышают 8 МиБ. Скачайте проекты отдельно; файл не обрезан.');
     download({format:'pycloud-account-export',version:1,server,browser,ai_preferences:controls.preferences});message('Файл передан браузеру. Убедитесь, что он сохранён, прежде чем удалять аккаунт.');
    }catch(error){message('Не удалось собрать полный файл. '+error.message);}finally{if(active())lock(false);}
   };
   $('accountDeleteForm').onsubmit=async event=>{
    event.preventDefault();if(busy)return;
    if($('accountDeleteName').value!==owner.user||!$('accountDeleteAcknowledgement').checked){message('Введите точное имя и подтвердите условия.');return;}
    lock(true);message('Проверяем пароль…');
    try{const result=await api('/api/account/deletion-prepare',{password:$('accountDeletePassword').value},owner);
     if(!active())return;if(!/^[0-9a-f]{32}$/.test(result.request_id)||!/^[0-9a-f]{64}$/.test(result.token)||result.policy_version!==policy.version)throw new Error('Подтверждение удаления не получено.');
     plan=result;$('accountDeleteConfirmation').hidden=false;message('Проверьте сохранённый файл. Последняя кнопка удалит аккаунт.');$('accountDeleteCommit').focus();
    }catch(error){message(error.message);}finally{if(active()){lock(false);if(plan)$('accountDeleteCommit').focus();}}
   };
   for(const input of body.querySelectorAll('#accountDeleteForm input'))input.addEventListener('input',()=>{plan=null;$('accountDeleteConfirmation').hidden=true;});
   const receiptValid=(data,proof)=>data?.ok===true&&data.deleted===true&&data.request_id===proof.request_id;
   async function requestDeletion(path,data){
    // Keep the receipt alive after our own deletion; a generic 401 handler must
    // not destroy it before the dedicated confirmation request can finish.
    const response=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:root.LearningSession.headersFor(owner,{'Content-Type':'application/json'}),body:JSON.stringify(data)});
    const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error||'Подтверждение не получено.'),{status:response.status});return value;
   }
   function finish(result,proof){if(!receiptValid(result,proof))throw new Error('Неполное подтверждение удаления.');root.LearningSession.deleted(owner);}
   $('accountDeleteCommit').onclick=async()=>{
    if(!plan||busy||!active())return;const proof=plan;lock(true);message('Удаляем аккаунт…');
    try{const result=await requestDeletion('/api/account/delete',{password:$('accountDeletePassword').value,confirmation:$('accountDeleteName').value,acknowledge_copies:$('accountDeleteAcknowledgement').checked,policy_version:proof.policy_version,request_id:proof.request_id,token:proof.token});finish(result,proof);}
    catch(error){message('Подтверждение удаления не получено. '+error.message+' Проверьте результат перед повторной попыткой.');if(active())$('accountDeleteReceipt').hidden=false;}
    finally{if(active())lock(false);}
   };
   $('accountDeleteReceipt').onclick=async()=>{
    if(!plan||busy)return;const proof=plan;lock(true);message('Проверяем результат…');
    try{finish(await requestDeletion('/api/account/deletion-status',{request_id:proof.request_id,token:proof.token}),proof);}
    catch(error){message(error.status===404?'Сервер пока не подтвердил удаление. Проверьте вход; при необходимости подготовьте удаление заново.':'Не удалось проверить результат. Восстановите соединение и повторите проверку.');}
    finally{if(active())lock(false);}
   };
  }
 }
 function recover(host,username,onBack){
  leave();const ticket=revision,owner=root.LearningSession.capture();let busy=false;
  const current=()=>ticket===revision&&host.isConnected&&!host.hidden&&root.LearningSession.isCurrent(owner);
  host.hidden=false;host.innerHTML=`<h3>Восстановить доступ</h3><p>Нужен код, который вы заранее сохранили в профиле. Без кода обратитесь к владельцу сервера: автоматического сброса через почту здесь нет.</p><form id="accountRecoveryForm"><label>Имя аккаунта<input id="recoverUser" autocomplete="username" value="${esc(username)}" minlength="3" maxlength="32" required></label><label>Код восстановления<input id="recoverCode" type="password" autocomplete="off" maxlength="128" spellcheck="false" required></label><label>Новый пароль<input id="recoverPassword" type="password" autocomplete="new-password" minlength="15" maxlength="128" required></label><label>Повторите новый пароль<input id="recoverRepeat" type="password" autocomplete="new-password" minlength="15" maxlength="128" required></label><p>Пароль — от 15 символов. Старые сеансы и коды будут отменены; прогресс и покупки сохранятся.</p><button class="btn dark" type="submit">Восстановить доступ</button></form><p id="recoverStatus" role="status" aria-live="polite"></p><button class="link-btn" id="recoverBack" type="button">Вернуться ко входу</button>`;
  cleanups.add(()=>{clearSecrets(host);host.replaceChildren();host.hidden=true;});
  const $=id=>host.querySelector('#'+id);
  $('recoverBack').onclick=()=>{const name=$('recoverUser')?.value||username;leave();onBack(name,'');};
  $('accountRecoveryForm').onsubmit=async event=>{
   event.preventDefault();if(busy)return;
   if($('recoverPassword').value!==$('recoverRepeat').value){$('recoverStatus').textContent='Новые пароли не совпадают.';return;}
   busy=true;host.querySelectorAll('button,input').forEach(control=>control.disabled=true);$('recoverStatus').textContent='Проверяем код…';
   const name=$('recoverUser').value;
   try{
    const result=await api('/api/account/recover',{username:name,code:$('recoverCode').value,new_password:$('recoverPassword').value},owner);
    if(!acknowledged(result))throw new Error('Подтверждение восстановления не получено.');
    if(!current())return;leave();onBack(name,'Доступ восстановлен. Войдите с новым паролем. Старые сеансы и коды отменены.');root.LearningSession.announce();
   }catch(error){if(current())$('recoverStatus').textContent=error.message+(!error.status?' Пароль мог измениться; попробуйте войти с новым.':'');}
   finally{busy=false;if(current())host.querySelectorAll('button,input').forEach(control=>control.disabled=false);}
  };
  $('recoverUser').focus();
 }
 root.LearningSession?.onChange(leave);root.AccountSecurity=Object.freeze({mount,recover,leave});
})(window);
