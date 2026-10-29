/* One report for course tasks, daily challenges and project checks. Events come from Python. */
window.SubmissionChecks = (() => {
  let sequence = 0;
  const labels = { waiting: "Ожидает", running: "Проверяется", passed: "Пройден", failed: "Ошибка", skipped: "Не запущен" };
  const symbols = { waiting: "○", running: "◌", passed: "✓", failed: "✕", skipped: "—" };

  function start(host, source = "") {
    if (!host) return { onTest() {}, async finish() {} };
    const run = String(++sequence);
    host.dataset.checkRun = run;
    host.hidden = false;
    host.replaceChildren();
    host.className = "test-report";
    const heading = document.createElement("h3");
    heading.textContent = "Тесты решения";
    const summary = document.createElement("p");
    summary.className = "test-summary";
    summary.setAttribute("role", "status");
    summary.textContent = "Подготавливаю проверку…";
    const list = document.createElement("ol");
    list.className = "test-list";
    host.append(heading, summary, list);
    if (source) {
      const details = document.createElement("details"), title = document.createElement("summary"), code = document.createElement("pre");
      title.textContent = "Посмотреть весь код тестов";
      code.textContent = source;
      details.append(title, code);
      host.append(details);
    }
    const rows = new Map();
    let pumping = Promise.resolve(), delay = 140;
    const current = () => host.isConnected && host.dataset.checkRun === run;

    function add(id, code, line) {
      const row = document.createElement("li"), state = document.createElement("span"), text = document.createElement("code"), note = document.createElement("span");
      row.className = "test-step";
      row.dataset.state = "waiting";
      state.className = "test-state";
      text.textContent = code;
      if (line) text.title = `Строка ${line} проверочного кода`;
      note.className = "test-note";
      row.append(state, text, note);
      list.append(row);
      const entry = { row, state, note };
      rows.set(id, entry);
      update(entry, "waiting");
      return entry;
    }
    function update(entry, state, message = "") {
      entry.row.dataset.state = state;
      entry.state.textContent = `${symbols[state]} ${labels[state]}`;
      entry.note.textContent = message || (state === "failed" ? "Условие этого теста не выполнено." : "");
    }
    function onTest(event) {
      if (!current()) return;
      if (event.type === "plan") {
        summary.textContent = "Проверяю условия по порядку…";
        delay = Math.min(140, 1800 / Math.max(1, event.tests.length));
        event.tests.forEach(test => add(test.id, test.code, test.line));
        host.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      } else if (event.type === "test") {
        pumping = pumping.then(async () => {
          if (!current()) return;
          const entry = rows.get(event.id);
          if (!entry) return;
          update(entry, event.state, event.message);
          if (event.state === "running" && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        });
      }
    }
    async function finish(result) {
      summary.textContent = "Проверка завершена, показываю результаты…";
      await pumping;
      if (!current()) return;
      if (!rows.size) add("result", source ? "Выполнение проверочного кода" : result.expected != null ? "Сравнение вывода" : "Проверка результата");
      for (const [id, entry] of rows) {
        if (id === "result") update(entry, result.ok ? "passed" : "failed", result.failure?.message || result.message || result.error || "");
        else if (["waiting", "running"].includes(entry.row.dataset.state)) update(entry, "skipped");
      }
      const states = [...rows.values()].map(entry => entry.row.dataset.state);
      const passed = states.filter(state => state === "passed").length;
      const failed = states.filter(state => state === "failed").length;
      const skipped = states.filter(state => state === "skipped").length;
      summary.textContent = `${result.ok ? "Проверка пройдена" : "Решение не прошло проверку"} · ${passed} пройдено` +
        (failed ? ` · ${failed} с ошибкой` : "") + (skipped ? ` · ${skipped} не запущено` : "");
      if (!result.ok && !failed) {
        const note = document.createElement("p");
        note.className = "test-note";
        note.textContent = result.failure?.message || result.message || result.error || "Итоговый вывод не совпал с ожидаемым.";
        host.append(note);
      }
    }
    return { onTest, finish };
  }
  return { start };
})();
