/* Shared native stdout/stdin UI for quests, showcase and sandbox. No REPL. */
window.LiveTerminal = (function () {
  let activeTerminal = null;
  function create(container) {
    container.innerHTML = `
      <div class="live-term-controls" hidden>
        <span class="live-term-state" role="status">Программа работает…</span>
        <button type="button" class="live-term-stop">Остановить</button>
      </div>
      <div class="live-term-output" role="log" aria-live="polite" tabindex="-1"></div>
      <form class="live-term-input-row" hidden>
        <span class="live-term-prompt" aria-hidden="true">&gt;</span>
        <input type="text" class="live-term-input" autocomplete="off" autocapitalize="off" autocorrect="off" enterkeyhint="send" spellcheck="false" aria-label="Ответ программе">
        <button type="submit" class="live-term-send">Отправить</button>
      </form>
    `;
    const outEl = container.querySelector(".live-term-output");
    const formEl = container.querySelector(".live-term-input-row");
    const inputEl = container.querySelector(".live-term-input");
    const sendEl = container.querySelector(".live-term-send");
    const controlsEl = container.querySelector(".live-term-controls");
    const stateEl = container.querySelector(".live-term-state");
    const stopEl = container.querySelector(".live-term-stop");
    // A repeated native submit must never navigate after its input was settled.
    formEl.addEventListener("submit", event => event.preventDefault());
    let running = false, generation = 0, releaseInput = null, composing = false;
    let imeCommit = false, imeTimer = null;
    const current = id => running && generation === id;
    const hideInput = () => {
      formEl.hidden = true;
      inputEl.disabled = sendEl.disabled = true;
      composing = false;
      imeCommit = false;
      if (imeTimer !== null) clearTimeout(imeTimer);
      imeTimer = null;
    };
    hideInput();
    function scrollOutput() {
      // The terminal body, rather than its unbounded inner log, owns scrolling.
      container.scrollTop = container.scrollHeight;
    }
    function revealInput() {
      const id = generation;
      const reveal = () => {
        if (!current(id) || formEl.hidden) return;
        scrollOutput();
        formEl.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      };
      reveal();
      // One queued frame per focus/request; no viewport/global listener survives a run.
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(reveal);
    }
    inputEl.addEventListener("focus", revealInput);
    inputEl.addEventListener("compositionstart", () => { composing = true; sendEl.disabled = true; });
    inputEl.addEventListener("compositionend", () => {
      composing = false;
      if (formEl.hidden) return;
      // Some keyboards end composition before dispatching that same Enter's submit.
      // Block only this event-loop turn; a later deliberate Send/Enter is accepted.
      imeCommit = true;
      if (imeTimer !== null) clearTimeout(imeTimer);
      imeTimer = setTimeout(() => {
        imeTimer = null;
        imeCommit = false;
        sendEl.disabled = formEl.hidden;
      }, 0);
    });
    inputEl.addEventListener("keydown", event => {
      if (event.key === "Enter" && (composing || imeCommit || event.isComposing || event.keyCode === 229)) event.preventDefault();
    });
    function append(text, cls) {
      const follow = container.scrollHeight - container.scrollTop - container.clientHeight < 48;
      const span = document.createElement("span");
      if (cls) span.className = cls;
      span.textContent = text;
      outEl.appendChild(span);
      if (follow) scrollOutput();
    }
    function waitForInput(id) {
      if (!current(id)) return Promise.resolve("");
      return new Promise(resolve => {
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          formEl.removeEventListener("submit", onSubmit);
          hideInput();
          if (releaseInput === release) releaseInput = null;
          resolve(value);
        };
        const release = () => finish("");
        const onSubmit = event => {
          event.preventDefault();
          if (settled || !current(id) || composing || imeCommit || event.isComposing || inputEl.disabled) return;
          const value = inputEl.value;
          append(value + "\n", "live-term-echo");
          stateEl.textContent = "Программа работает…";
          finish(value);
        };
        releaseInput?.();
        releaseInput = release;
        formEl.addEventListener("submit", onSubmit);
        composing = false;
        inputEl.value = "";
        inputEl.disabled = sendEl.disabled = false;
        formEl.hidden = false;
        stateEl.textContent = "Программа ждёт ввод";
        inputEl.focus({ preventScroll: true });
        revealInput();
      });
    }
    async function run(code, onStatus) {
      if (activeTerminal && activeTerminal !== terminal) activeTerminal.cancel();
      if (running) cancel();
      activeTerminal = terminal;
      const runId = ++generation;
      const filesEpoch = window.OutputFiles?.epoch();
      running = true;
      window.OutputFiles?.clear(outEl);
      outEl.textContent = "";
      hideInput();
      controlsEl.hidden = false;
      stateEl.textContent = "Программа работает…";
      let result;
      try {
        result = await window.PyRunner.runInteractive(code, {
          onOutput: chunk => { if (current(runId)) append(chunk); },
          onInputRequest: () => waitForInput(runId),
          onStatus: status => { if (current(runId)) onStatus?.(status); },
        });
      } catch (error) { result = { error: error.message || String(error) }; }
      if (runId !== generation) return { error: null, cancelled: true };
      const { error, cancelled } = result;
      releaseInput?.();
      running = false;
      hideInput();
      controlsEl.hidden = true;
      if (activeTerminal === terminal) activeTerminal = null;
      if (error) append("\n" + (window.RuntimeHelp?.errorText?.(result) || error), "live-term-error");
      else if (!cancelled) append("\n[программа завершена]", "live-term-done");
      if (!cancelled) window.OutputFiles?.show(outEl, result.artifacts, filesEpoch);
      return { error, ...(cancelled ? { cancelled: true } : {}), ...(result.artifacts ? { artifacts: result.artifacts } : {}) };
    }
    function cancel() {
      if (!running) return;
      generation++;
      running = false;
      releaseInput?.();
      hideInput();
      controlsEl.hidden = true;
      if (activeTerminal === terminal) activeTerminal = null;
      window.PyRunner.cancelInteractive();
    }
    stopEl.addEventListener("click", () => {
      if (!running) return;
      cancel();
      append("\n[программа остановлена]", "live-term-done");
      outEl.focus({ preventScroll: true });
    });
    function setStatic(text, cls, artifacts) {
      if (running) cancel();
      window.OutputFiles?.clear(outEl);
      hideInput();
      outEl.textContent = "";
      append(text || "(нет вывода)", cls);
      window.OutputFiles?.show(outEl, artifacts);
    }
    function clear() {
      window.OutputFiles?.clear(outEl);
      if (running) cancel();
      hideInput();
      outEl.textContent = "";
    }
    const terminal = { run, cancel, setStatic, clear, isRunning: () => running };
    return terminal;
  }
  // A single current owner; route changes also settle the pending native input UI.
  window.addEventListener("hashchange", () => {
    if (activeTerminal) activeTerminal.cancel();
    else window.PyRunner?.cancelInteractive();
  });
  return { create };
})();
