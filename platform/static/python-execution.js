/* Account-bound transport; untrusted Python never runs in this origin. */
(function () {
  // The browser only transports code; a fresh OS-isolated container executes it.
  let remoteActive = null, remoteEpoch = 0, remoteReady = false;
  const captureOwner = () => window.LearningSession?.capture();
  const currentOwner = task => !window.LearningSession || window.LearningSession.isCurrent(task.owner);
  const scopedFetch = (path,opts,owner) => window.LearningSession
    ? window.LearningSession.fetch(path,opts,owner) : fetch(path,opts);
  const cancelledResult = () => ({ stdout: '', error: null, cancelled: true, blocked: true });
  const withGuidance = (result, context) => {
    const hint = window.RuntimeHelp?.errorHint?.(result, context);
    return hint ? { ...result, guidance: hint } : result;
  };
  const unavailableResult = (error, httpStatus) => withGuidance(
    { stdout: '', error, failure: null, user_stdout: null, check_stdout: null, blocked: true }, { httpStatus });
  async function stopRemote(task) {
    if (!task || task.finished) return;
    if (task.stopping) return task.stopping;
    task.cancelled = true;
    task.controller.abort();
    task.stopping = task.id ? fetch('/api/python/' + task.id + '/cancel', {
      method: 'POST', credentials: 'same-origin', headers: window.LearningSession?.headersFor(task.owner, { 'Content-Type': 'application/json' }) || { 'Content-Type': 'application/json' }, body: '{}',
    }).catch(() => {}) : Promise.resolve();
    await task.stopping;
  }
  async function executeRemote(code, check, onStatus, onTest, handlers, signal) {
    const owner = captureOwner();
    const epoch = ++remoteEpoch;
    await stopRemote(remoteActive);
    if (epoch !== remoteEpoch) return cancelledResult();
    const task = { controller: new AbortController(), owner, id: null, interactive: !!handlers, cancelled: false, finished: false, inputPending: false };
    remoteActive = task;
    const cancel = () => void stopRemote(task);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const aborted = task.controller.signal.aborted ? Promise.resolve('') : new Promise(resolve => task.controller.signal.addEventListener('abort', () => resolve(''), { once: true }));
    async function supplyInput() {
      task.inputPending = true;
      task.inputRequested = false;
      try {
        const answer = await Promise.race([Promise.resolve().then(() => handlers.onInputRequest?.() ?? ''), aborted]);
        if (task.cancelled || task.finished) return;
        const supplied = await scopedFetch('/api/python/' + task.id + '/input', {
          method: 'POST', credentials: 'same-origin', signal: task.controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: String(answer ?? '') }),
        }, task.owner);
        if (!supplied.ok) throw new Error('Не удалось передать ввод в Python.');
      } catch (error) {
        if (!task.cancelled && !task.finished) {
          task.inputError = error;
          await stopRemote(task);
        }
      } finally {
        task.inputPending = false;
        if (task.inputRequested && !task.finished && !task.cancelled) void supplyInput();
      }
    }
    try {
      onStatus?.('Запускаю изолированный Python…');
      const response = await scopedFetch('/api/python/run', {
        method: 'POST', credentials: 'same-origin', signal: task.controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, check: typeof check === 'string' ? check : '', interactive: !!handlers, reportTests: typeof onTest === 'function' }),
      }, task.owner);
      if (!response.ok) {
        remoteReady = false;
        const failure = await response.json().catch(() => ({}));
        return unavailableResult(failure?.error || 'Изолированный Python недоступен.', response.status);
      }
      remoteReady = true;
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '', result = null;
      while (true) {
        const chunk = await reader.read();
        if (!currentOwner(task)) return cancelledResult();
        buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          if (!currentOwner(task)) return cancelledResult();
          if (event.type === 'job') task.id = event.id;
          else if (event.type === 'status') onStatus?.(String(event.text || ''));
          else if (event.type === 'test_event') onTest?.(event.event);
          else if (event.type === 'output') handlers?.onOutput?.(String(event.chunk || ''));
          else if (event.type === 'input_request' && handlers && !task.finished) {
            if (task.inputPending) task.inputRequested = true;
            else void supplyInput();
          }
          else if (event.type === 'result') { result = event; task.finished = true; }
        }
        if (chunk.done) break;
      }
      if (!result) throw new Error('Раннер не вернул результат.');
      if (!currentOwner(task)) return cancelledResult();
      return withGuidance({ stdout: result.stdout || '', error: result.error || null, failure: result.failure || null,
        user_stdout: result.user_stdout ?? null, check_stdout: result.check_stdout ?? null,
        ...(Array.isArray(result.artifacts) && result.artifacts.length ? {artifacts:result.artifacts} : {}) }, { interactive: task.interactive });
    } catch (error) {
      if (task.inputError) return unavailableResult(task.inputError.message);
      if (task.cancelled || error.name === 'AbortError') return cancelledResult();
      await stopRemote(task);
      return unavailableResult(error.message || 'Изолированный Python недоступен.');
    } finally {
      task.finished = true;
      task.controller.abort();
      signal?.removeEventListener('abort', cancel);
      onStatus?.('');
      if (remoteActive === task) remoteActive = null;
    }
  }
  window.PythonExecutionClient = Object.freeze({
    run: (code, onStatus, check, onTest, signal) => executeRemote(code, check, onStatus, onTest, null, signal),
    runInteractive: (code, handlers = {}) => executeRemote(code, '', handlers.onStatus, null, handlers),
    cancelInteractive() { if (remoteActive?.interactive) { remoteEpoch++; void stopRemote(remoteActive); } },
    warmup() {},
    ready: () => remoteReady,
  });
  window.LearningSession?.onChange(() => {
    remoteEpoch++;
    if (remoteActive) void stopRemote(remoteActive);
  });

})();
