/* ai-helper.js — клиент ИИ-помощника. Всё общение идёт через бэкенд:
 *   POST /api/ai/ask     { task, question, context } -> { reply, engine }
 *   GET  /api/ai/history?task_id=..                  -> { messages }
 * История и память ИИ хранятся на сервере в БД (per-user).
 * Обычные подсказки независимы от доступности ИИ.
 */
window.AIHelper = {
  _settings:null,
  configure(value){this._settings=value&&['enabled','automatic_review','history_context','provider_available'].every(key=>typeof value[key]==='boolean')?{...value}:null;},
  settings(){return this._settings||{enabled:true,automatic_review:true,history_context:true,provider_available:true};},
  canReview(automatic=true){const value=this.settings();return value.enabled&&value.provider_available&&(!automatic||value.automatic_review);},
  // Отложить только автоматический разбор успеха, не запросы ученика.
  // Смена страницы отменяет ожидание; уже отправленный запрос не отменяется.
  waitForReview() {
    const hash = location.hash;
    return new Promise((resolve) => {
      const finish = (ready) => {
        clearTimeout(timer);
        window.removeEventListener("hashchange", cancel);
        window.removeEventListener("pagehide", cancel);
        resolve(ready);
      };
      const cancel = () => finish(false);
      const timer = setTimeout(() => finish(location.hash === hash), 3000);
      window.addEventListener("hashchange", cancel);
      window.addEventListener("pagehide", cancel);
    });
  },

  async ask(task, question, context) {
    if(!this.settings().enabled)throw Object.assign(new Error('ИИ отключён в настройках аккаунта.'),{status:403,code:'ai_disabled'});
    if(!this.settings().provider_available)throw Object.assign(new Error('Наставник сейчас недоступен. Обычные подсказки работают.'),{status:503,code:'ai_unavailable'});
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, question, context }),
    };
    let data;
    if (window.LearningSession) data = await window.LearningSession.json("/api/ai/ask", options);
    else {
      const res = await fetch("/api/ai/ask", options);
      if (!res.ok) throw new Error((await res.json()).error || "Ошибка сервиса");
      data = await res.json();
    }
    return {
      reply: data.reply,
      engine: data.engine || "offline",
      cost: data.cost || 0,
      free_left: data.free_left,
      drops: data.drops,
    };
  },

  async history(taskId) {
    if (window.LearningSession) {
      return (await window.LearningSession.json("/api/ai/history?task_id=" + encodeURIComponent(taskId))).messages;
    }
    const res = await fetch("/api/ai/history?task_id=" + encodeURIComponent(taskId));
    if (!res.ok) throw new Error('Не удалось загрузить историю.');
    return (await res.json()).messages;
  },
};
