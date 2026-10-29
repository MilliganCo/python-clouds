const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createBootDiagnostics, readBootDom } = require('./boot_diagnostics.cjs');
const vm = require('node:vm');
class Page extends EventEmitter {
  url() { return 'http://user:password@local/#/project/practice_environment/same_python?token=secret'; }
  async evaluate() { return { appHidden: false, editorPresent: false, generation: 'a'.repeat(64) }; }
}
const page = new Page(), emitted = [];
let clock = 100;
const diagnostics = createBootDiagnostics(page, { now: () => clock, limit: 8, emit: (label, value) => emitted.push({ label, value }) });
const request = (path, method = 'GET') => ({ url: () => 'http://user:password@local' + path,
  method: () => method, failure: () => ({ errorText: 'net::ERR_ABORTED ?password=secret' }) });
const response = (req, status = 200) => ({ request: () => req, status: () => status });
const finished = req => { page.emit('response', response(req)); page.emit('requestfinished', req); };
(async () => {
  diagnostics.begin({ iteration: 1, route: page.url() });
  const me = request('/api/me?token=secret'), progress = request('/api/progress?password=secret');
  page.emit('request', me); clock += 10; finished(me);
  page.emit('request', progress); clock += 50;
  let state = diagnostics.snapshot();
  assert.equal(state.latestCompletedStep, 'session');
  assert.equal(state.pending[0].path, '/api/progress'); assert.equal(state.pending[0].elapsedMs, 50);
  assert.equal(state.pending[0].iteration, 1); assert.equal(state.pending[0].status, null);
  page.emit('response', response(progress)); clock += 30;
  state = diagnostics.snapshot();
  assert.equal(state.pending[0].state, 'response', 'Received headers without completion remain pending');
  assert.equal(state.pending[0].responseMs, 50); assert.equal(state.latestCompletedStep, 'session');
  page.emit('requestfinished', progress); assert.equal(diagnostics.snapshot().latestCompletedStep, 'progress');
  const css = request('/course-content/' + 'a'.repeat(64) + '/styles.css');
  page.emit('request', css); finished(css);
  assert.equal(diagnostics.snapshot().latestCompletedStep, 'stylesheet:styles.css');
  const script = request('/course-content/' + 'a'.repeat(64) + '/app.js');
  page.emit('request', script); finished(script);
  assert.equal(diagnostics.snapshot().latestCompletedStep, 'script:app.js');
  const quest = request('/api/project-courses/practice_environment');
  page.emit('request', quest); clock += 5; page.emit('requestfailed', quest);
  assert.equal(diagnostics.snapshot().pending.length, 0);
  assert.equal(diagnostics.snapshot().recent.at(-1).error, 'net::ERR_ABORTED');
  assert.equal(diagnostics.snapshot().latestCompletedStep, 'script:app.js', 'Failure does not advance completed step');
  const old = request('/api/project-courses/practice_environment'); page.emit('request', old);
  diagnostics.begin({ iteration: 2, route: '/#/project/practice_environment/same_python' });
  finished(old); assert.equal(diagnostics.snapshot().latestCompletedStep, 'none', 'Late old-navigation result cannot advance the new iteration');
  page.emit('response', response(old)); assert.equal(diagnostics.snapshot().pending.length, 0, 'Late response cannot resurrect a finished request');
  const unavailable = request('/api/progress'); page.emit('request', unavailable);
  page.emit('response', response(unavailable, 503)); page.emit('requestfinished', unavailable);
  assert.equal(diagnostics.snapshot().latestCompletedStep, 'none', 'HTTP errors are completed traffic, not completed boot steps');
  const manifest = request('/course-content/' + 'a'.repeat(64) + '/manifest.json');
  page.emit('request', manifest); finished(manifest);
  assert.equal(diagnostics.snapshot().latestCompletedStep, 'catalogue-manifest');
  const currentQuest = request('/api/project-courses/practice_environment');
  page.emit('request', currentQuest); finished(currentQuest);
  assert.equal(diagnostics.snapshot().latestCompletedStep, 'quest');
  page.emit('pageerror', new Error('password=secret; private learner code'));
  assert.equal(diagnostics.snapshot().pageErrors, 1);
  for (let i = 0; i < 12; i++) page.emit('request', request('/api/pending/' + i + '?secret=hidden'));
  state = diagnostics.snapshot(); assert.equal(state.pending.length, 8); assert.equal(state.recent.length, 8); assert.equal(state.droppedPending, 4);
  assert.doesNotMatch(JSON.stringify(state), /password|token|secret|user:/);
  let getCalled = false;
  const evidence = await diagnostics.capture('FAILURE', { timeoutMs: 15, courseUrl: 'http://local/api/project-courses/practice_environment?token=secret',
    requestContext: { get(url, opts) {
      getCalled = true; assert.equal(opts.timeout, 15); assert.equal(emitted[0].label, 'FAILURE');
      assert.equal(emitted[0].value.dom.editorPresent, false, 'Immediate DOM snapshot exists before secondary GET');
      return new Promise(() => {});
    } } });
  assert.equal(getCalled, true); assert.equal(evidence.probe.timedOut, true); assert.equal(emitted[1].label, 'FAILURE_API');
  assert.doesNotMatch(JSON.stringify(emitted), /password|token|secret|user:/);
  const originalEvaluate = page.evaluate;
  page.evaluate = () => new Promise(() => {});
  const noDom = await diagnostics.capture('HUNG_DOM', { timeoutMs: 15 });
  assert.equal(noDom.dom.unavailable, true, 'An unresponsive DOM evaluation still emits bounded traffic evidence');
  assert.equal(emitted.at(-1).label, 'HUNG_DOM');
  page.evaluate = originalEvaluate;
  const nodes = { appView: { hidden: false }, authView: { hidden: true }, projectEditor: { value: 'private learner code', getBoundingClientRect: () => ({ width: 100, height: 100 }) },
    taskView: { childElementCount: 1 }, catalogueLoadStatus: { hidden: true, textContent: 'private content', getAttribute: () => 'status' } };
  const dom = vm.runInNewContext('(' + readBootDom.toString() + ')()', { document: { getElementById: id => nodes[id], querySelector: () => null },
    window: { LearningSession: { capture: () => ({ user: 'private account', revision: 5 }) }, getLearningAuthEpoch: () => 7,
      PYCLOUD_CONTENT_GENERATION: 'b'.repeat(64), ProjectCourses: { renderRoute() {} } } });
  assert.equal(dom.sessionRevision, 5); assert.equal(dom.authEpoch, 7); assert.equal(dom.hasSessionOwner, true); assert.equal(dom.editorHasArea, true);
  assert.doesNotMatch(JSON.stringify(dom), /private|learner|account/);
  diagnostics.markEditorVisible(); assert.equal(diagnostics.snapshot().latestCompletedStep, 'editor-visible');
  diagnostics.dispose();
  for (const event of ['request', 'response', 'requestfinished', 'requestfailed', 'pageerror']) assert.equal(page.listenerCount(event), 0);
  assert.equal(diagnostics.snapshot().pending.length, 0);
  console.log('PASS boot diagnostics: pending/headers/finished/failure timing, critical steps, late iterations, bounded redacted evidence, immediate snapshot before hung GET, listener cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
