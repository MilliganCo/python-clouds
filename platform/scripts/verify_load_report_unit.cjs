/* Pure Node fixtures: no server, real network, browser, database or model. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const staticDir = path.join(__dirname, '..', 'static');
const source = name => fs.readFileSync(path.join(staticDir, name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const privateText = 'PRIVATE_LEARNER_CODE_password_TOKEN_real_user_secret';
const clean = value => assert.doesNotMatch(JSON.stringify(value), /PRIVATE|LEARNER|password|TOKEN|real_user|secret|safe_quest_slug|\/api\/|https?:|@local/i);
const plain = value => JSON.parse(JSON.stringify(value));

class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(kind, fn, options) {
    const entries = this.listeners.get(kind) || [];
    entries.push({ fn, once: options?.once }); this.listeners.set(kind, entries);
  }
  removeEventListener(kind, fn) {
    this.listeners.set(kind, (this.listeners.get(kind) || []).filter(entry => entry.fn !== fn));
  }
  dispatch(kind, properties = {}) {
    const event = { type: kind, target: this, preventDefault() {}, ...properties };
    for (const entry of [...(this.listeners.get(kind) || [])]) {
      if (entry.once) this.removeEventListener(kind, entry.fn);
      entry.fn.call(this, event);
    }
  }
}
class Node extends Target {
  constructor(tagName = 'div', id = '') {
    super(); this.tagName = tagName.toUpperCase(); this.id = id;
    this.hidden = false; this.disabled = false; this.open = false;
    this.dataset = {}; this.attributes = new Map(); this.children = [];
    this.style = {}; this.value = ''; this.textContent = ''; this.isConnected = true;
    this.classList = { add() {}, remove() {}, contains() { return false; }, toggle() {} };
  }
  get childElementCount() { return this.children.length; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.has(key) ? this.attributes.get(key) : null; }
  hasAttribute(key) { return this.attributes.has(key); }
  removeAttribute(key) { this.attributes.delete(key); }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  remove() { this.isConnected = false; }
  focus() { this.focused = true; }
  click() { this.dispatch('click'); if (this.onclick) this.onclick(); }
  closest(selector) { return selector === '[data-load-report-open]' && this.hasAttribute('data-load-report-open') ? this : null; }
  getBoundingClientRect() { return { width: this.hidden ? 0 : 100, height: this.hidden ? 0 : 100 }; }
  getClientRects() { return this.hidden ? [] : [this.getBoundingClientRect()]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
function fixture({ readyState = 'complete', reportOnly = true, markup = true } = {}) {
  const nodes = {}, document = new Target(), root = new Target();
  const created = [], timers = [], fetches = [], logs = [], blobs = [], anchors = [], stylesheets = [];
  const clock = { value: 100 };
  document.readyState = readyState; document.hidden = false;
  document.documentElement = new Node('html'); document.head = new Node('head'); document.body = new Node('body');
  document.currentScript = new Node('script');
  if (reportOnly) {
    document.currentScript.dataset.loadReportOnly = '';
    document.currentScript.setAttribute('data-load-report-only', '');
    document.documentElement.dataset.loadReportOnly = '';
    document.documentElement.setAttribute('data-load-report-only', '');
  }
  document.createElement = tag => {
    const node = new Node(tag); created.push(node);
    if (tag === 'a') anchors.push(node);
    return node;
  };
  document.createTextNode = value => ({ textContent: String(value) });
  document.getElementById = id => nodes[id] || null;
  const generation = new Node('meta'); generation.content = 'a'.repeat(64);
  document.querySelector = selector => {
    if (selector === 'meta[name="pycloud-content-generation"]') return generation;
    if (selector.includes('[data-load-report-only]')) return reportOnly ? document.currentScript : null;
    if (selector.startsWith('#')) return nodes[selector.slice(1)] || null;
    return null;
  };
  document.querySelectorAll = selector => {
    if (selector === '[data-load-report-open]') return Object.values(nodes).filter(node => node.hasAttribute('data-load-report-open'));
    if (selector.startsWith('link') && selector.includes('stylesheet')) return stylesheets;
    return [];
  };
  const add = (id, tag = 'div') => (nodes[id] = new Node(tag, id));
  add('authView').hidden = true; add('appView').hidden = true;
  add('catalogueLoadStatus').hidden = true; add('taskView');
  if (markup) {
    add('loadReportHelp', 'details'); add('loadReportText', 'textarea').readOnly = true;
    add('loadReportDownload', 'button').disabled = true;
    add('loadReportClose', 'button'); add('loadReportOpen', 'button').setAttribute('data-load-report-open', '');
  }
  const forbidden = () => { throw new Error('Fixture caught forbidden private-data or automatic-output access'); };
  const fetcher = async (...args) => { fetches.push(args); throw new Error(privateText); };
  Object.assign(root, {
    document, location: { hash: '#/project/safe_quest_slug/private_task?token=' + privateText, search: '?password=' + privateText,
      href: 'https://real_user:password@local/#/project/safe_quest_slug?token=' + privateText, pathname: '/' },
    fetch: fetcher, performance: { now: () => clock.value },
    setTimeout(fn, delay) { const timer = { fn, delay, active: true }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.active = false; },
    requestAnimationFrame(fn) { return root.setTimeout(fn, 16); },
    cancelAnimationFrame(timer) { root.clearTimeout(timer); },
    getComputedStyle(node) { return { display: node.hidden ? 'none' : 'block', visibility: 'visible' }; },
    URL: class FixtureURL extends URL {
      static createObjectURL(blob) { blobs.push(blob); return 'blob:fixture'; }
      static revokeObjectURL() {}
    },
    Blob, navigator: { clipboard: { writeText: forbidden }, sendBeacon: forbidden },
    localStorage: { getItem: forbidden, setItem: forbidden }, sessionStorage: { getItem: forbidden, setItem: forbidden },
    console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe() {} disconnect() {} },
  });
  const context = vm.createContext({ window: root, document, location: root.location, fetch: fetcher,
    performance: root.performance, setTimeout: root.setTimeout, clearTimeout: root.clearTimeout,
    MutationObserver: root.MutationObserver, getComputedStyle: root.getComputedStyle,
    console: root.console, URL: root.URL, Blob, Headers, Response, TextEncoder, Uint8Array,
    btoa: value => Buffer.from(value, 'binary').toString('base64') });
  return { root, document, nodes, clock, fetches, logs, blobs, anchors, timers, generation, created, context,
    stylesheet(media = null, loaded = false) {
      const link = new Node('link'); link.rel = 'stylesheet'; link.sheet = loaded ? {} : null;
      link.href = '/style-' + stylesheets.length + '.css'; link.integrity = 'sha256-fixture';
      link.disabled = false; link.mediaWrites = 0;
      if (media !== null) link.setAttribute('media', media);
      Object.defineProperty(link, 'media', {
        get() { return link.getAttribute('media') || ''; },
        set(value) { link.mediaWrites++; link.setAttribute('media', value); },
      });
      stylesheets.push(link); return link;
    },
    run() { return vm.runInContext(source('catalogue-loader.js'), context, { timeout: 1000 }); },
    ready() { document.readyState = 'complete'; document.dispatch('DOMContentLoaded'); },
    fireWatchdog() { for (const timer of [...timers]) if (timer.active && timer.delay >= 12000) { clock.value += timer.delay; timer.active = false; timer.fn(); } },
  };
}
function sessionModule(extra = {}) {
  const context = vm.createContext({ module: { exports: {} }, Headers, performance: { now: () => 200 }, ...extra });
  vm.runInContext(source('session-scope.js'), context, { timeout: 1000 });
  return context.module.exports;
}
function assertNetwork(network) {
  assert.ok(network && Array.isArray(network.pending) && Array.isArray(network.recent));
  assert.ok(network.pending.length <= 8); assert.ok(network.recent.length <= 12);
  assert.ok(Number.isInteger(network.droppedPending) && network.droppedPending >= 0);
  for (const entry of [...network.pending, ...network.recent]) {
    for (const [key, value] of Object.entries(entry)) {
      if (/Ms$/.test(key)) assert.ok(Number.isFinite(value) && value >= 0 && value <= 600000, key);
      if (key === 'status') assert.ok(value === null || (Number.isInteger(value) && value >= 100 && value <= 599));
    }
  }
  clean(network);
}

const cases = {};

cases.session = async () => {
  const { createSession } = sessionModule();
  const headers = deferred(), body = deferred();
  let transportOptions;
  const session = createSession({ fetch: async (_, opts) => {
    transportOptions = opts; await headers.promise;
    return { status: 200, ok: true, json: () => body.promise };
  } });
  session.setUser(privateText);
  const result = session.json('/api/progress');
  let snapshot = session.loadSnapshot();
  assert.equal(snapshot.pending.length, 1); assert.equal(snapshot.pending[0].state, 'pending');
  assert.equal(transportOptions.credentials, 'same-origin');
  headers.resolve(); await tick();
  snapshot = session.loadSnapshot();
  assert.equal(snapshot.pending.length, 1); assert.equal(snapshot.pending[0].state, 'body');
  assert.equal(snapshot.pending[0].status, 200);
  body.resolve({ code: privateText }); assert.equal((await result).code, privateText);
  snapshot = session.loadSnapshot(); assert.equal(snapshot.pending.length, 0);
  assert.equal(snapshot.recent.at(-1).state, 'finished'); assertNetwork(snapshot);

  const startHeaders = deferred(), startBody = deferred();
  const start = createSession({ fetch: async (_, options) => {
    assert.equal(options.method, 'POST'); assert.equal(options.body, privateText);
    await startHeaders.promise;
    return { status: 201, ok: true, json: () => startBody.promise };
  } });
  start.setUser(privateText);
  const starting = start.json('/api/project-courses/safe_quest_slug/start?token=' + privateText,
    { method: 'POST', body: privateText });
  assert.equal(start.loadSnapshot().pending.length, 1, 'stage-opening POST must remain observable before editor creation');
  assert.equal(start.loadSnapshot().pending[0].kind, 'quest-start');
  assert.equal(start.loadSnapshot().pending[0].state, 'pending'); assertNetwork(start.loadSnapshot());
  startHeaders.resolve(); await tick();
  assert.equal(start.loadSnapshot().pending[0].state, 'body');
  assert.equal(start.loadSnapshot().pending[0].status, 201); assertNetwork(start.loadSnapshot());
  startBody.resolve({ private: privateText }); await starting;
  assert.equal(start.loadSnapshot().pending.length, 0);
  assert.equal(start.loadSnapshot().recent.at(-1).kind, 'quest-start');
  assert.equal(start.loadSnapshot().recent.at(-1).state, 'finished'); assertNetwork(start.loadSnapshot());

  const cloneGate = deferred(), finalGate = deferred();
  const conflict = createSession({ fetch: async () => ({ status: 409, ok: false,
    clone: () => ({ json: () => cloneGate.promise }), json: () => finalGate.promise }) });
  conflict.setUser(privateText);
  const rejected = conflict.json('/api/wallet');
  await tick(); assert.equal(conflict.loadSnapshot().pending[0].state, 'body');
  cloneGate.resolve({ code: 'version_conflict', error: privateText }); await tick();
  assert.equal(conflict.loadSnapshot().pending.length, 1, '409 clone parsing must not settle the trace before the final body');
  finalGate.resolve({ code: 'version_conflict', error: privateText });
  await assert.rejects(rejected, error => error.code === 'version_conflict');
  assert.equal(conflict.capture().user, privateText);
  snapshot = conflict.loadSnapshot(); assert.equal(snapshot.pending.length, 0);
  assert.equal(snapshot.recent.at(-1).state, 'failed'); assert.equal(snapshot.recent.at(-1).status, 409); assertNetwork(snapshot);

  const staleBody = deferred();
  const stale = createSession({ fetch: async () => ({ status: 200, ok: true, json: () => staleBody.promise }) });
  stale.setUser(privateText); const staleResult = stale.json('/api/me'); await tick();
  stale.setUser('second_owner'); staleBody.resolve({ username: privateText });
  await assert.rejects(staleResult, error => error.code === 'session_changed');
  assert.equal(stale.capture().user, 'second_owner');
  assert.equal(stale.loadSnapshot().pending.length, 0); assertNetwork(stale.loadSnapshot());

  const unauthorized = createSession({ fetch: async () => new Response('{}', { status: 401 }) });
  unauthorized.setUser(privateText);
  await assert.rejects(unauthorized.json('/api/me'), error => error.code === 'session_changed');
  assert.equal(unauthorized.capture().user, '');
  assert.equal(unauthorized.loadSnapshot().recent.at(-1).status, 401); assertNetwork(unauthorized.loadSnapshot());
  const offline = createSession({ fetch: async () => { throw new Error(privateText); } });
  offline.setUser(privateText);
  await assert.rejects(offline.json('/api/progress'), error => error.message === privateText);
  assert.equal(offline.loadSnapshot().recent.at(-1).state, 'failed'); assertNetwork(offline.loadSnapshot());

  for (const reporter of [undefined, { snapshot() { throw new Error(privateText); } }]) {
    const { createSession: isolated } = sessionModule({ CloudLoadReport: reporter });
    const normal = isolated({ fetch: async () => new Response('{"value":1}', { status: 200 }) });
    normal.setUser(privateText); assert.equal((await normal.json('/api/progress')).value, 1);
  }
  console.log('PASS load report session: pending through headers/body and 409 clone, error privacy, stale owner, independent transport');
};

cases.bounds = async () => {
  const { createSession } = sessionModule();
  const stalled = deferred();
  const session = createSession({ fetch: () => stalled.promise }); session.setUser(privateText);
  const promises = Array.from({ length: 15 }, () => session.json('/api/progress'));
  let snapshot = session.loadSnapshot(); assert.equal(snapshot.pending.length, 8); assert.equal(snapshot.droppedPending, 7);
  try { if (snapshot.pending.length) snapshot.pending[0].state = privateText; } catch (error) { assert.ok(error instanceof TypeError || error.name === 'TypeError'); }
  try { snapshot.pending.length = 0; snapshot.recent.push({ error: privateText }); } catch (error) { assert.ok(error instanceof TypeError || error.name === 'TypeError'); }
  assert.equal(session.loadSnapshot().pending.length, 8); assertNetwork(session.loadSnapshot());
  stalled.resolve(new Response('{"private":"' + privateText + '"}', { status: 200 }));
  await Promise.all(promises); snapshot = session.loadSnapshot();
  assert.equal(snapshot.pending.length, 0); assert.ok(snapshot.recent.length <= 12); assertNetwork(snapshot);

  const bounded = createSession({ fetch: async () => new Response('{}', { status: 200 }) }); bounded.setUser(privateText);
  for (let n = 0; n < 20; n++) await bounded.json('/api/wallet');
  assert.equal(bounded.loadSnapshot().recent.length, 12);
  const before = JSON.stringify(bounded.loadSnapshot());
  for (const request of [
    ['/api/private/' + privateText],
    ['/api/project-courses/../../' + privateText], ['/api/project-courses/a/b'],
    ['https://real_user:password@local/api/me'], ['/api/v1/mobile/me'], ['/api/wallet', { method: 'POST', body: privateText }],
    ['/api/project-courses/safe_quest_slug/run', { method: 'POST', body: privateText }],
    ['/api/project-courses/safe_quest_slug/save', { method: 'POST', body: privateText }],
    ['/api/login', { method: 'POST', body: privateText }], ['/api/progress', { method: 'POST', body: privateText }],
  ]) await bounded.json(...request);
  assert.equal(JSON.stringify(bounded.loadSnapshot()), before, 'only exact known GET boot paths are retained');
  await bounded.json('/api/me?token=' + privateText);
  assert.equal(bounded.loadSnapshot().recent.at(-1).kind, 'session');
  await bounded.json('/api/progress#' + privateText);
  assert.equal(bounded.loadSnapshot().recent.at(-1).kind, 'progress');
  await bounded.json('/api/project-courses/safe_quest_slug');
  assert.equal(bounded.loadSnapshot().recent.at(-1).kind, 'quest');
  assertNetwork(bounded.loadSnapshot()); clean(bounded.loadSnapshot());
  for (const record of bounded.loadSnapshot().recent) assert.deepEqual(Object.keys(record).sort(), ['elapsedMs', 'kind', 'state', 'status']);
  console.log('PASS load report bounds: eight pending/twelve recent, copied snapshots, no private or unknown request paths');
};

cases.report = async () => {
  const f = fixture();
  f.nodes.appView.hidden = false;
  const editor = new Node('textarea', 'projectEditor'); f.nodes.projectEditor = editor;
  for (const key of ['value', 'textContent', 'innerHTML']) Object.defineProperty(editor, key, {
    get() { throw new Error('Reporter read private editor contents: ' + key); }, set() {},
  });
  let snapshots = 0;
  f.root.LearningSession = { loadSnapshot() { snapshots++; return {
    pending: [{ kind: 'progress', state: 'body', status: 200, elapsedMs: 13000, url: privateText, headers: privateText }],
    recent: [{ kind: 'quest', state: 'failed', status: 503, elapsedMs: 31, body: privateText, error: privateText },
      { kind: 'quest-start', state: 'finished', status: 201, elapsedMs: 21, body: privateText }],
    droppedPending: 0, username: privateText,
  }; } };
  const originalFetch = f.root.fetch;
  await f.run();
  assert.equal(f.root.fetch, originalFetch, 'reporter must never replace global fetch');
  assert.equal(f.fetches.length, 0); assert.equal(f.logs.length, 0); assert.equal(f.blobs.length, 0);
  const report = f.root.CloudLoadReport;
  assert.ok(Object.isFrozen(report));
  let snapshot = plain(report.snapshot());
  assert.equal(snapshot.schema, 1); assert.equal(snapshot.observer, 'running');
  assert.ok(Number.isInteger(snapshot.deferredStyles) && snapshot.deferredStyles >= 0 && snapshot.deferredStyles <= 999);
  assert.equal(snapshot.route, 'project-stage'); assert.equal(snapshot.generation, 'a'.repeat(64));
  assert.deepEqual(snapshot.view, { appVisible: true, authVisible: false, editorPresent: true });
  assert.equal(snapshot.network.available, true); assertNetwork(snapshot.network); clean(snapshot);
  assert.equal(snapshot.network.recent.length, 2, 'reporter retains the critical stage-start classification');
  assert.equal(snapshot.network.recent.at(-1).kind, 'quest-start');
  assert.deepEqual(Object.keys(snapshot).sort(), ['assetErrors', 'deferredStyles', 'elapsedMs', 'generation', 'network', 'observer', 'phase', 'route', 'schema', 'scriptErrors', 'view']);
  const routes = new Set(['home', 'task', 'theory', 'project-stage', 'project', 'showcase', 'topics', 'projects', 'shop', 'games', 'profile', 'atlas', 'review', 'diagnostic', 'updates', 'other']);
  for (const hash of ['#/task/6.2?token=' + privateText, '#/topic/12/theory', '#/project/safe_quest_slug', '#/project/__proto__/constructor', '#/showcase/' + privateText, '#/' + privateText, '#/profile?token=' + privateText]) {
    f.root.location.hash = hash; snapshot = report.snapshot(); assert.ok(routes.has(snapshot.route)); clean(snapshot);
  }
  for (const invalid of [privateText, {}, '__proto__']) { report.mark(invalid); assert.equal(report.snapshot().phase, 'shell'); }
  report.mark('manifest'); assert.equal(report.snapshot().phase, 'manifest');
  f.root.PYCLOUD_CONTENT_GENERATION = privateText;
  assert.equal(report.snapshot().generation, null);
  f.root.PYCLOUD_CONTENT_GENERATION = 'b'.repeat(64);
  assert.equal(report.snapshot().generation, 'b'.repeat(64));
  f.clock.value = 1e9; assert.equal(report.snapshot().elapsedMs, 600000);
  f.clock.value = -1e9; assert.equal(report.snapshot().elapsedMs, 0);
  for (let n = 0; n < 110; n++) {
    f.root.dispatch('error', { target: { tagName: 'SCRIPT', src: privateText }, error: new Error(privateText), message: privateText });
    f.root.dispatch('unhandledrejection', { reason: new Error(privateText) });
  }
  snapshot = report.snapshot(); assert.equal(snapshot.assetErrors, 99); assert.equal(snapshot.scriptErrors, 99); clean(snapshot);
  assert.equal(f.blobs.length, 0, 'snapshot/error collection must never download automatically');
  f.document.dispatch('click', { target: f.nodes.loadReportOpen });
  assert.equal(f.nodes.loadReportHelp.open, true); assert.equal(f.nodes.loadReportHelp.hidden, false);
  clean(JSON.parse(f.nodes.loadReportText.value));
  assert.equal(f.nodes.loadReportDownload.disabled, false);
  f.nodes.loadReportDownload.click();
  assert.equal(f.blobs.length, 1); assert.equal(f.anchors.length, 1);
  assert.equal(f.anchors[0].download, 'pycloud-load-report.json');
  assert.equal(f.anchors[0].href, 'blob:fixture'); assert.equal(f.anchors[0].isConnected, false);
  clean(JSON.parse(await f.blobs[0].text()));
  f.nodes.loadReportClose.click(); assert.equal(f.nodes.loadReportHelp.open, false);
  assert.equal(f.nodes.loadReportHelp.hidden, true);
  assert.ok(snapshots > 0); assert.equal(f.fetches.length, 0); assert.equal(f.logs.length, 0);
  f.root.LearningSession = { loadSnapshot() { throw new Error(privateText); } };
  assert.equal(report.snapshot().network.available, false); clean(report.snapshot());
  console.log('PASS load report report: strict metadata projection, private DOM traps, route/generation enums, bounded clocks/errors, explicit local download');
};

cases.loader = async () => {
  const renderBlocked = fixture({ readyState: 'loading' });
  const pendingStyles = [renderBlocked.stylesheet(), renderBlocked.stylesheet('all'), renderBlocked.stylesheet('screen')];
  const unaffectedStyles = [renderBlocked.stylesheet(null, true), renderBlocked.stylesheet('print'),
    renderBlocked.stylesheet('screen and (min-width: 1px)')];
  const assetIdentity = pendingStyles.map(link => ({ href: link.href, integrity: link.integrity }));
  await renderBlocked.run();
  assert.ok(pendingStyles.every(link => link.media !== 'print'), 'the reporter must not alter stylesheet media before its watchdog');
  renderBlocked.fireWatchdog();
  assert.ok(pendingStyles.every(link => link.media === 'print'),
    'after 12 seconds with no visible app/auth, pending screen styles must stop blocking paint of native help');
  assert.deepEqual(unaffectedStyles.map(link => link.media), ['', 'print', 'screen and (min-width: 1px)']);
  assert.ok(unaffectedStyles.every(link => link.mediaWrites === 0), 'loaded sheets and unrelated media stay untouched');
  assert.equal(renderBlocked.root.CloudLoadReport.snapshot().deferredStyles, 3);
  renderBlocked.root.dispatch('hashchange'); renderBlocked.fireWatchdog();
  assert.ok(pendingStyles.every(link => link.mediaWrites === 1), 'rearmed watchdog must not defer the same pending sheet twice');
  assert.deepEqual(pendingStyles.map(link => ({ href: link.href, integrity: link.integrity })), assetIdentity);
  pendingStyles[0].dispatch('load'); pendingStyles[1].dispatch('error'); pendingStyles[2].dispatch('load');
  assert.deepEqual(pendingStyles.map(link => link.media), ['', 'all', 'screen'], 'load/error restores every original media value');
  assert.equal(pendingStyles[0].getAttribute('media'), null, 'a missing original media attribute stays missing');
  assert.deepEqual(pendingStyles.map(link => ({ href: link.href, integrity: link.integrity })), assetIdentity);
  assert.equal(renderBlocked.fetches.length, 0, 'visual help fallback must not fetch or retry assets');

  const parserStalled = fixture({ readyState: 'loading' });
  await parserStalled.run(); await tick();
  assert.equal(parserStalled.nodes.loadReportDownload.disabled, false,
    'head async reporter must bind available help controls while DOMContentLoaded is blocked by a hanging stylesheet or classic script');
  assert.equal(parserStalled.timers.filter(timer => timer.active && timer.delay === 12000).length, 1,
    'report watchdog must start even when DOMContentLoaded never fires');
  parserStalled.root.CloudLoadReport.show(); parserStalled.nodes.loadReportDownload.click();
  assert.equal(parserStalled.blobs.length, 1, 'explicit download works before DOMContentLoaded');
  assert.equal(parserStalled.document.readyState, 'loading');
  assert.equal(parserStalled.fetches.length, 0);

  const only = fixture({ readyState: 'loading' });
  await only.run(); assert.ok(only.root.CloudLoadReport, 'reporter exists while HTML is still parsing');
  assert.equal(only.fetches.length, 0);
  const identity = only.root.CloudLoadReport;
  await only.run(); only.ready(); await tick();
  assert.equal(only.root.CloudLoadReport, identity); assert.equal(only.fetches.length, 0);
  assert.equal(only.timers.filter(timer => timer.active && timer.delay === 12000).length, 1, 'repeated reporter bootstrap has one watchdog owner');
  assert.equal(only.nodes.loadReportDownload.disabled, false);

  const f = fixture({ readyState: 'loading', reportOnly: false });
  const declared = new Node('script'); declared.dataset.courseSrc = 'app.js';
  const originalQuery = f.document.querySelectorAll;
  f.document.querySelectorAll = selector => selector === 'script[data-course-src]' ? [declared] : originalQuery(selector);
  const appended = [];
  for (const parent of [f.document.head, f.document.body]) {
    const append = parent.appendChild.bind(parent);
    parent.appendChild = node => {
      appended.push(node); append(node); queueMicrotask(() => node.onload?.()); return node;
    };
  }
  f.context.fetch = async (url, options) => {
    f.fetches.push([url, options]);
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store');
    return { ok: true, json: async () => ({ version: 1, generation: 'a'.repeat(64),
      scripts: ['app.js'], styles: ['styles.css'], sha256: { 'app.js': 'b'.repeat(64), 'styles.css': 'c'.repeat(64) } }) };
  };
  const loading = f.run(); await f.run();
  assert.equal(f.fetches.length, 0, 'catalogue boot must wait for HTML parser before reading declaration nodes');
  f.ready(); await loading;
  assert.equal(f.fetches.length, 1, 'repeated bootstrap cannot create a second catalogue owner');
  assert.equal(f.fetches[0][0], '/course-content/' + 'a'.repeat(64) + '/manifest.json');
  assert.deepEqual(appended.map(node => node.tagName), ['LINK', 'SCRIPT']);
  assert.match(appended[0].integrity, /^sha256-[A-Za-z0-9+/]+=*$/);
  assert.match(appended[1].integrity, /^sha256-[A-Za-z0-9+/]+=*$/);
  assert.equal(appended[1].async, false); assert.equal(f.root.CloudLoadReport.snapshot().phase, 'catalogue-ready');
  assert.equal(f.nodes.catalogueLoadStatus.hidden, true);

  for (const visible of ['appView', 'authView']) {
    const healthy = fixture(); healthy.nodes[visible].hidden = false; await healthy.run();
    const healthyStyle = healthy.stylesheet();
    healthy.fireWatchdog(); assert.equal(healthy.nodes.loadReportHelp.hidden, true, 'missing editor alone is not a failure');
    assert.equal(healthyStyle.media, '', 'a healthy visible app/auth never changes stylesheets');
  }
  const wallet = fixture(); wallet.nodes.appView.hidden = false;
  wallet.root.LearningSession = { loadSnapshot: () => ({ pending: [{ kind: 'wallet', state: 'body', status: 200, elapsedMs: 12000 }], recent: [], droppedPending: 0 }) };
  await wallet.run(); wallet.fireWatchdog(); assert.equal(wallet.nodes.loadReportHelp.hidden, true);
  for (const kind of ['session', 'progress', 'quest', 'quest-start']) {
    const stuck = fixture(); stuck.nodes.appView.hidden = false;
    const pendingStyle = stuck.stylesheet('screen');
    stuck.root.LearningSession = { loadSnapshot: () => ({ pending: [{ kind, state: 'body', status: 200, elapsedMs: 12000 }], recent: [], droppedPending: 0 }) };
    await stuck.run(); stuck.fireWatchdog(); assert.equal(stuck.nodes.loadReportHelp.open, true, kind + ' is a critical boot dependency');
    assert.equal(pendingStyle.media, 'screen', 'a pending critical request with visible app offers help without deferring styles');
    assert.equal(pendingStyle.mediaWrites, 0);
  }
  const invisible = fixture(); await invisible.run(); invisible.fireWatchdog(); assert.equal(invisible.nodes.loadReportHelp.open, true);
  const tiny = fixture({ markup: false }); await tiny.run(); tiny.root.CloudLoadReport.show(); tiny.fireWatchdog();
  const untrusted = fixture({ reportOnly: false });
  untrusted.root.CloudLoadReport = { mark() { throw new Error(privateText); }, fail() { throw new Error(privateText); } };
  await untrusted.run(); assert.equal(untrusted.fetches.length, 1, 'diagnostic hook failures must not block the normal manifest attempt');
  console.log('PASS load report loader: DOM-ready boot, report-only isolation, one owner, ordered SRI assets, neutral watchdog and missing-markup fallback');
};

cases.shell = async () => {
  const html = source('index.html');
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1]; assert.ok(head);
  assert.match(head, /<script\b[^>]*src=["']catalogue-loader\.js["'][^>]*\basync\b[^>]*>\s*<\/script>/);
  assert.doesNotMatch(head, /<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i);
  const details = html.match(/<details\b[^>]*id=["']loadReportHelp["'][^>]*>([\s\S]*?)<\/details>/i);
  assert.ok(details, 'fallback must be native details even if loader fails');
  assert.ok(html.indexOf(details[0]) < html.indexOf('id="authView"'));
  assert.ok(html.indexOf(details[0]) < html.indexOf('id="appView"'));
  assert.match(details[1], /<textarea\b[^>]*id=["']loadReportText["'][^>]*\breadonly\b[^>]*>[\s\S]*?"observer":"not_started"/i);
  assert.match(details[1], /<button\b[^>]*id=["']loadReportDownload["'][^>]*\bdisabled\b/i);
  assert.match(details[1], /id=["']loadReportClose["']/);
  assert.doesNotMatch(details[0], /\son(?:click|error|load)\s*=/i);
  console.log('PASS load report shell: independent external async head script, native details before application, readonly initial evidence and disabled download');
};

(async () => {
  const name = process.argv[2];
  assert.ok(Object.hasOwn(cases, name), 'Pass a known focused case: ' + Object.keys(cases).join(', '));
  await cases[name]();
})().catch(error => { console.error(error); process.exitCode = 1; });
