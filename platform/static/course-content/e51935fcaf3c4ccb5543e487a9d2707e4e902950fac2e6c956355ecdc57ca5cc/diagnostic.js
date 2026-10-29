/* Optional entry diagnostic. One app router, ephemeral account-bound state, no rewards. */
(function (root) {
  'use strict';
  const categories = Object.freeze({first_pass:'Сразу пройдено', repaired:'После исправления',
    practice:'Стоит разобрать', unassessed:'Не проверено'});
  const makeEntries = bank => bank.tasks.map(task => ({draft:task.starter_code,attempts:0,first:null,last:null,lastCode:null,skipped:false,unavailable:false}));
  function classify(result) {
    if (!result || result.blocked || result.cancelled) return 'blocked';
    if (result.error) {
      const failure=result.failure;
      if (!failure || !['solution','check'].includes(failure.source) || ['MemoryError','OutputLimitExceeded'].includes(failure.type)) return 'blocked';
      return 'needs_practice';
    }
    if (typeof result.check_stdout !== 'string') return 'blocked';
    return result.check_stdout.trim()==='OK' ? 'passed' : 'needs_practice';
  }
  function record(entry, result, code) {
    const outcome=classify(result);
    if (outcome==='blocked') { entry.unavailable=true; return outcome; }
    entry.attempts++;
    entry.first ||= outcome;
    entry.last=outcome;entry.lastCode=code;entry.unavailable=false;entry.skipped=false;
    return outcome;
  }
  function category(entry) {
    if (entry.last==='passed') return entry.first==='passed' ? 'first_pass' : 'repaired';
    return entry.last==='needs_practice' ? 'practice' : 'unassessed';
  }
  function summarize(bank, entries) {
    const counts={first_pass:0,repaired:0,practice:0,unassessed:0};
    const evidence=entries.map(category);
    evidence.forEach(value=>counts[value]++);
    const index=evidence.findIndex(value=>value!=='first_pass');
    const assessed=entries.some(entry=>entry.attempts>0);
    return {counts, evidence, index,
      topic:!assessed ? bank.no_evidence_topic : index<0 ? bank.all_pass_topic : bank.tasks[index].topic_id,
      reason:!assessed ? 'no_evidence' : index<0 ? 'all_first_pass' : evidence[index]};
  }
  const model=Object.freeze({makeEntries,classify,record,category,summarize,categories});
  root.EntryDiagnosticModel=model;
  if (typeof module==='object' && module.exports) module.exports=model;
  if (!root.document) return;

  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let session=null, controller=null, generation=0;
  function leave() { generation++;controller?.abort();controller=null; }
  function reset() { leave();session=null; }
  function render(host, bank, topics, epoch) {
    leave();
    if (!host || !bank?.tasks?.length) {
      if (host) host.innerHTML='<section class="pane"><h2>Диагностика пока недоступна</h2><p>Обновите страницу или откройте обычный курс.</p><a class="btn" href="#/topics">К темам</a></section>';
      return;
    }
    if (!session || session.epoch!==epoch || session.bank!==bank) {
      session={epoch,bank,entries:makeEntries(bank),started:false,current:0,results:false};
    }
    const own=session, revision=generation;
    const live=()=>session===own && revision===generation && host.isConnected &&
      root.getLearningAuthEpoch?.()===epoch && !root.document.getElementById('appView')?.hidden && location.hash==='#/diagnostic';
    const draw=()=>render(host,bank,topics,epoch);
    const titleFor=id=>topics.find(topic=>topic.id===id)?.title || 'Тема '+id;
    const focusTitle=()=>{host.querySelector('[data-diagnostic-heading]')?.focus({preventScroll:true});host.scrollIntoView({block:'start',behavior:'auto'});};
    const top=`<nav class="task-nav"><a href="#/topics">← К темам</a><a href="#/">На главную</a></nav>`;
    if (!own.started) {
      host.innerHTML=top+`<section class="pane diagnostic-page">
        <span class="project-kicker">Ориентир для начала</span>
        <h2 tabindex="-1" data-diagnostic-heading>С чего начать Python?</h2>
        <p>${bank.tasks.length} новых заданий: написать или исправить небольшую функцию. Можно пропустить незнакомое и вернуться позже.</p>
        <ul class="diagnostic-skills">${bank.tasks.map(task=>`<li>${esc(task.skill)}</li>`).join('')}</ul>
        <p class="diagnostic-note">Без таймера, XP и зачёта обычных тем. Результат — ориентир по этим примерам, а не экзамен. Код проверяется на сервере в отдельной песочнице; черновики диагностики остаются в памяти вкладки до обновления страницы или выхода из аккаунта.</p>
        <div class="diagnostic-actions"><button type="button" class="btn dark" id="diagnosticStart">Начать диагностику</button><a class="btn" href="#/topics">Выбрать тему самому</a></div>
      </section>`;
      host.querySelector('#diagnosticStart').onclick=()=>{if(live()){own.started=true;draw();}};
      focusTitle();return;
    }
    if (own.results) {
      const summary=summarize(bank,own.entries), topicTitle=titleFor(summary.topic);
      const reason=summary.reason==='no_evidence' ? 'Пока нет проверенных ответов. Можно вернуться к заданиям или начать со знакомства с Python.' :
        summary.reason==='all_first_pass' ? 'Эти пять примеров прошли с первой попытки. Следующий ориентир — более подробная работа с функциями; остальные навыки курса ещё не проверялись.' :
        summary.reason==='unassessed' ? 'Один из ранних навыков не проверен. Предлагаем эту тему как точку для знакомства или самопроверки.' :
        summary.reason==='repaired' ? 'В этом задании понадобилось исправление. Полезно коротко повторить тему и попробовать другой пример.' :
        'В этом задании ещё остались непройденные условия. Предлагаем начать повторение с его темы.';
      host.innerHTML=top+`<section class="pane diagnostic-page">
        <h2 tabindex="-1" data-diagnostic-heading>Ваш ориентир по пяти заданиям</h2>
        <div class="diagnostic-counts">${Object.entries(categories).map(([key,label])=>`<span>${esc(label)}: <b>${summary.counts[key]}</b></span>`).join('')}</div>
        <section class="diagnostic-recommendation" aria-labelledby="diagnosticRecommendTitle">
          <h3 id="diagnosticRecommendTitle">Можно начать здесь: ${esc(topicTitle)}</h3><p>${esc(reason)}</p>
          <a class="btn dark" href="#/topic/${summary.topic}/theory">Открыть тему</a>
        </section>
        <p class="diagnostic-note">Обычный прогресс и награды не менялись. Диагностика не проверяет весь курс и библиотеки, не закрывает темы и не ограничивает ваш выбор.</p>
        <ol class="diagnostic-results">${bank.tasks.map((task,i)=>`<li><div><b>${esc(task.skill)}</b><span>${esc(categories[summary.evidence[i]])}${own.entries[i].attempts ? ' · проверок: '+own.entries[i].attempts : own.entries[i].unavailable ? ' · запуск не завершился' : ''}</span></div>
          ${own.entries[i].attempts ? `<p>${esc(task.explanation)}</p>` : ''}<button type="button" class="btn" data-diagnostic-return="${i}">Вернуться к заданию ${i+1}</button></li>`).join('')}</ol>
        <div class="diagnostic-actions"><a class="btn" href="#/topics">Все темы</a><button type="button" class="btn" id="diagnosticReset">Сбросить ответы и начать заново</button></div>
      </section>`;
      host.querySelectorAll('[data-diagnostic-return]').forEach(button=>button.onclick=()=>{
        if(live()){own.current=+button.dataset.diagnosticReturn;own.results=false;draw();}
      });
      host.querySelector('#diagnosticReset').onclick=()=>{if(live()){reset();render(host,bank,topics,epoch);}};
      focusTitle();return;
    }
    const index=own.current,task=bank.tasks[index],entry=own.entries[index];
    host.innerHTML=top+`<section class="pane diagnostic-page">
      <div class="diagnostic-heading"><div><span class="project-kicker">Диагностика · без зачёта</span><h2 tabindex="-1" data-diagnostic-heading>Шаг ${index+1} из ${bank.tasks.length}: ${esc(task.title)}</h2></div>
        <button type="button" class="btn" id="diagnosticResults">Посмотреть ориентир</button></div>
      <ol class="diagnostic-steps" aria-label="Задания диагностики">${bank.tasks.map((item,i)=>`<li><button type="button" class="btn" data-diagnostic-step="${i}" ${i===index?'aria-current="step"':''}>${i+1}. ${esc(item.title)}</button></li>`).join('')}</ol>
      <p class="diagnostic-note">${esc(task.skill)} · ${task.format==='repair'?'исправить функцию':'написать функцию'}. Проверяйте столько раз, сколько нужно; первая попытка учитывается отдельно.</p>
      <p class="diagnostic-prompt">${esc(task.prompt)}</p>
      <label class="diagnostic-editor-label" for="diagnosticEditor">Ваш код Python</label>
      <textarea id="diagnosticEditor" class="diagnostic-editor" spellcheck="false" autocapitalize="off" autocomplete="off" maxlength="12000" aria-describedby="diagnosticPrivacy"></textarea>
      <p id="diagnosticPrivacy" class="diagnostic-note">Черновик остаётся в памяти этой вкладки. Задания курса, очередь ошибок и достижения не изменяются.</p>
      <div class="diagnostic-actions"><button type="button" class="btn dark" id="diagnosticCheck">Проверить</button><button type="button" class="btn" id="diagnosticCancel" hidden>Отменить проверку</button>
        <button type="button" class="btn" id="diagnosticSkip">Не знаю · пропустить</button><button type="button" class="btn" id="diagnosticNext">${index+1===bank.tasks.length?'К результату':'Следующее задание'}</button></div>
      <div id="diagnosticFeedback" class="diagnostic-feedback" role="status" aria-live="polite"></div>
    </section>`;
    const editor=host.querySelector('#diagnosticEditor'),feedback=host.querySelector('#diagnosticFeedback');
    const checkButton=host.querySelector('#diagnosticCheck'),cancelButton=host.querySelector('#diagnosticCancel');
    editor.value=entry.draft;
    root.EditorKeys?.bind(editor);
    editor.setAttribute('aria-keyshortcuts','Control+M Control+Enter Meta+Enter');
    const feedbackText=(text,kind='neutral')=>{feedback.textContent=text;feedback.dataset.kind=kind;};
    if (entry.last && entry.lastCode===entry.draft) feedbackText(entry.last==='passed' ? 'Проверки пройдены. Это не зачёт задания курса.' : 'Пока не все условия пройдены. Можно исправить код или продолжить.',entry.last==='passed'?'passed':'practice');
    editor.oninput=()=>{if(live()){entry.draft=editor.value;if(entry.lastCode!==entry.draft)feedbackText('Код изменён после проверки. Новый вариант пока не проверен.');}};
    const go=i=>{if(live()){own.current=i;own.results=false;draw();}};
    host.querySelectorAll('[data-diagnostic-step]').forEach(button=>button.onclick=()=>go(+button.dataset.diagnosticStep));
    host.querySelector('#diagnosticResults').onclick=()=>{if(live()){own.results=true;draw();}};
    const next=()=>{if(live()){if(index+1<bank.tasks.length)own.current++;else own.results=true;draw();}};
    host.querySelector('#diagnosticNext').onclick=next;
    host.querySelector('#diagnosticSkip').onclick=()=>{if(live()){if(!entry.last)entry.skipped=true;next();}};
    let running=false;
    function busy(value) {
      running=value;checkButton.disabled=value;editor.readOnly=value;cancelButton.hidden=!value;cancelButton.disabled=false;
      host.querySelector('#diagnosticSkip').disabled=value;host.querySelector('#diagnosticNext').disabled=value;
    }
    cancelButton.onclick=()=>{if(live()){cancelButton.disabled=true;controller?.abort();}};
    checkButton.onclick=async()=>{
      if(!live() || running)return;
      const abort=new AbortController();controller=abort;
      const current=()=>live() && controller===abort;
      const code=editor.value;entry.draft=code;busy(true);feedbackText('Проверяем в изолированном Python…');
      let result;
      try {
        if(!root.PyRunner?.run)throw new Error('Раннер не загружен.');
        result=await root.PyRunner.run(code,text=>{if(current()&&!abort.signal.aborted&&text)feedbackText(text);},task.check.append,null,abort.signal);
        if(!current() || abort.signal.aborted)return;
        if(editor.value!==code){feedbackText('Код изменился во время проверки. Новый вариант не оценён; повторите проверку.');return;}
        const outcome=record(entry,result,code);
        if(outcome==='passed')feedbackText(entry.first==='passed'?'Проверки пройдены с первой попытки. XP не начисляется.':'После исправления проверки пройдены. В результате будет отмечен повтор.','passed');
        else if(outcome==='blocked')feedbackText('Проверку не удалось завершить. Это не оценка ответа: попробуйте ещё раз или пропустите.');
        else feedbackText('Пока не все условия пройдены. '+(result.failure?.message || 'Сопоставьте результат функции с условием.'),'practice');
      } catch (_) {
        if(current()&&!abort.signal.aborted){entry.unavailable=true;feedbackText('Проверка недоступна. Ответ не оценён; можно повторить или пропустить.');}
      } finally {
        if(current()){
          if(abort.signal.aborted)feedbackText('Проверка отменена. Эта попытка не учитывается.');
          controller=null;busy(false);
        }
      }
    };
    editor.addEventListener('keydown',event=>{
      if(!event.isComposing&&(event.ctrlKey||event.metaKey)&&!event.altKey&&event.key==='Enter'){
        event.preventDefault();checkButton.click();
      }
    });
    focusTitle();
  }
  root.EntryDiagnostic=Object.freeze({render,leave,reset});
})(typeof window==='object'?window:globalThis);
