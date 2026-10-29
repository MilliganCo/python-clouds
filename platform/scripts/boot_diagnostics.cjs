// Test-only boot evidence. No cookies, request/response bodies, headers or editor text.
const safePath = value => {
  try { return new URL(value, 'http://diagnostic.invalid').pathname.slice(0, 240); }
  catch (_) { return '(invalid-url)'; }
};
const safeRoute = value => {
  try {
    const url = new URL(value, 'http://diagnostic.invalid');
    const hash = url.hash.split('?')[0];
    return safePath(value) + (/^#\/[a-z0-9_./-]{0,160}$/i.test(hash) ? hash : '');
  } catch (_) { return '(invalid-url)'; }
};
function criticalStep(path) {
  if (path.endsWith('/manifest.json') || path === '/content-current.json') return 'catalogue-manifest';
  if (/\.css$/.test(path)) return 'stylesheet:' + path.split('/').pop();
  if (/\.js$/.test(path)) return 'script:' + path.split('/').pop();
  if (path === '/api/me') return 'session';
  if (path === '/api/progress') return 'progress';
  if (/^\/api\/project-courses\/[a-z0-9_]+$/.test(path)) return 'quest';
  return null;
}
async function bounded(work, timeoutMs) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(), { name: 'DiagnosticTimeout' })), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
function readBootDom() {
  const node = id => document.getElementById(id);
  const session = window.LearningSession?.capture?.();
  const editor = node('projectEditor'), rect = editor?.getBoundingClientRect();
  const generation = window.PYCLOUD_CONTENT_GENERATION || document.querySelector('meta[name="pycloud-content-generation"]')?.content;
  return {
    appHidden: node('appView')?.hidden ?? null, authHidden: node('authView')?.hidden ?? null,
    editorPresent: !!editor, editorHasArea: !!rect && rect.width > 0 && rect.height > 0,
    taskChildCount: node('taskView')?.childElementCount ?? null,
    loaderHidden: node('catalogueLoadStatus')?.hidden ?? null,
    loaderIsAlert: node('catalogueLoadStatus')?.getAttribute('role') === 'alert',
    sessionRevision: Number.isFinite(session?.revision) ? session.revision : null,
    hasSessionOwner: !!session?.user,
    authEpoch: window.getLearningAuthEpoch?.() ?? null,
    generation: /^[0-9a-f]{64}$/.test(generation || '') ? generation : null,
    projectModuleReady: typeof window.ProjectCourses?.renderRoute === 'function',
  };
}
function createBootDiagnostics(page, { now = Date.now, limit = 120,
  emit = (label, value) => console.error(label, JSON.stringify(value)) } = {}) {
  let context = { iteration: 'setup', route: '/' }, latestCompletedStep = 'none', sequence = 0, dropped = 0, pageErrors = 0, disposed = false;
  const records = new WeakMap(), pending = new Map(), recent = [];
  const summary = record => ({ id: record.id, path: record.path, method: record.method,
    iteration: record.iteration, route: record.route, state: record.state,
    elapsedMs: Math.max(0, now() - record.started), status: record.status,
    ...(record.responseMs == null ? {} : { responseMs: record.responseMs }),
    ...(record.step ? { step: record.step } : {}), ...(record.error ? { error: record.error } : {}) });
  const remember = record => { recent.push(summary(record)); if (recent.length > limit) recent.shift(); };
  const onRequest = request => {
    if (disposed) return;
    const record = { ...context, id: ++sequence, path: safePath(request.url()),
      method: request.method(), state: 'pending', status: null, started: now() };
    record.step = criticalStep(record.path);
    records.set(request, record); pending.set(record.id, record);
    if (pending.size > limit) { pending.delete(pending.keys().next().value); dropped++; }
    remember(record);
  };
  const onResponse = response => {
    const record = records.get(response.request());
    if (disposed || !record || record.state === 'finished' || record.state === 'failed') return;
    record.status = response.status(); record.state = 'response'; record.responseMs = Math.max(0, now() - record.started);
    remember(record);
  };
  const complete = (request, failed) => {
    const record = records.get(request);
    if (disposed || !record || record.state === 'finished' || record.state === 'failed') return;
    record.state = failed ? 'failed' : 'finished';
    if (failed) record.error = String(request.failure()?.errorText || '').match(/(?:net::)?ERR_[A-Z_]+/)?.[0] || 'request_failed';
    if (!failed && record.status >= 200 && record.status < 300 && record.step
        && record.iteration === context.iteration && record.route === context.route) latestCompletedStep = record.step;
    pending.delete(record.id); remember(record);
  };
  const handlers = { request: onRequest, response: onResponse,
    requestfinished: request => complete(request, false), requestfailed: request => complete(request, true),
    pageerror: () => { pageErrors++; recent.push({ ...context, state: 'pageerror' }); if (recent.length > limit) recent.shift(); } };
  Object.entries(handlers).forEach(([event, handler]) => page.on(event, handler));
  const snapshot = () => ({ ...context, latestCompletedStep, droppedPending: dropped, pageErrors,
    pending: [...pending.values()].map(summary), recent: recent.map(record => ({ ...record })) });
  return {
    begin({ iteration, route }) { context = { iteration, route: safeRoute(route) }; latestCompletedStep = 'none'; },
    markEditorVisible() { latestCompletedStep = 'editor-visible'; },
    snapshot,
    async capture(label, { requestContext, courseUrl, timeoutMs = 2000 } = {}) {
      let dom;
      try { dom = await bounded(() => page.evaluate(readBootDom), timeoutMs); }
      catch (_) { dom = { unavailable: true }; }
      const evidence = { ...snapshot(), dom, observedRoute: safeRoute(page.url()) };
      emit(label, evidence); // Must precede the secondary request, even if that request never settles.
      if (requestContext && courseUrl) {
        let probe;
        try {
          probe = await bounded(async () => {
            const response = await requestContext.get(courseUrl, { timeout: timeoutMs });
            try { return { status: response.status() }; }
            finally { await response.dispose?.(); }
          }, timeoutMs);
        } catch (error) { probe = { unavailable: true, timedOut: error.name === 'DiagnosticTimeout' || error.name === 'TimeoutError' }; }
        evidence.probe = probe;
        emit(label + '_API', { ...context, path: safePath(courseUrl), ...probe });
      }
      return evidence;
    },
    dispose() {
      disposed = true;
      Object.entries(handlers).forEach(([event, handler]) => page.off(event, handler));
      pending.clear(); recent.length = 0;
    },
  };
}
module.exports = { createBootDiagnostics, safePath, safeRoute, criticalStep, readBootDom };
