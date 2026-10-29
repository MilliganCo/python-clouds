const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/project-courses.js'), 'utf8');
let epoch = 1, dashboard, box, status = 200, calls = [], pending = [], inserted = [];
const app = { hidden: false };
const taskView = { hidden: false, content: '', firstElementChild: null,
  set innerHTML(value) {
    if (this.firstElementChild) this.firstElementChild.isConnected = false;
    this.content = value; this.firstElementChild = { isConnected: true };
  },
  get innerHTML() { return this.content; },
};
const listView = { hidden: false };
function home() {
  return { dataset: {}, isConnected: true, closest: () => null,
    querySelector: () => null, firstChild: null,
    insertBefore(el) { box = el; inserted.push(this); } };
}
dashboard = home();
const listeners = [], timers = [];
const context = { window: { getLearningAuthEpoch: () => epoch,
  addEventListener: (...args) => listeners.push(args), scrollTo() {} }, location: { hash: '#/' }, console,
  setTimeout: (...args) => timers.push(args),
  document: { getElementById: id => ({ appView: app, taskView, listView, projectReturnPrompts: box }[id]),
    querySelector: () => dashboard, querySelectorAll: () => [],
    body: { classList: { remove() {}, add() {} } }, createElement: () => ({ addEventListener() {} }) },
  fetch: async url => { calls.push(url); return { ok: status < 400, status, json: () => new Promise(resolve => pending.push(resolve)) }; },
};
vm.runInNewContext(source, context);
assert.equal(timers.length, 0, 'Loading project helpers must not schedule redraws');
assert.equal(listeners.length, 0, 'Only app.js owns route/bootstrap events');
assert.equal(typeof context.window.ProjectCourses.renderRoute, 'function');
assert.equal(typeof context.window.ProjectCourses.renderHomePrompts, 'function');
const prompt = { course_id: 'chatbot_to_telegram', stage_id: 'conditions', short_title: '<test>', message: 'Continue', href: '#/project/chatbot_to_telegram/conditions' };
async function resolveNext(data = { prompts: [prompt] }) {
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(pending.length, 'Expected a pending prompt request');
  pending.shift()(data);
}

function interactionHarness() {
  let owner = 1, elements = {}, slides = [], dots = [], root, track, form;
  const requests = [], globalKeys = [];
  const element = (tagName = 'DIV') => ({
    tagName, isConnected: true, dataset: {}, style: {}, attributes: {}, handlers: {},
    value: '', textContent: '', disabled: false, inert: false,
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name]; },
    addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); },
    emit(type, event = {}) { return Promise.all((this.handlers[type] || []).map(handler => handler(event))); },
    focus() { env.document.activeElement = this; },
    closest(selector) { return /input|textarea|select/.test(selector) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(this.tagName) ? this : null; },
    querySelectorAll() { return []; },
  });
  const app = { hidden: false }, list = { hidden: false };
  const view = { hidden: false, firstElementChild: null,
    set innerHTML(value) {
      Object.values(elements).forEach(node => { node.isConnected = false; });
      if (root) root.isConnected = false;
      this.content = value; elements = {}; root = element(); this.firstElementChild = root;
      for (const match of value.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const node = element(match[1].toUpperCase());
        node.disabled = /\bdisabled\b/.test(match[0]);
        node.value = match[2] === 'showTitle' ? 'Мини-проект' : match[2] === 'showDesc' ? 'Описание моей программы' : match[2] === 'showMain' ? 'print(1)' : match[2] === 'showCover' ? 'aurora' : '';
        elements[match[2]] = node;
      }
      root.querySelector = selector => selector === '.project-epic-stage' ? elements.projectEpicStage : selector === '.project-epic' ? root : null;
      root.contains = node => Object.values(elements).includes(node) || node === root;
      track = elements.projectEpicTrack;
      if (track) {
        elements.projectEpicStage = element();
        slides = [...value.matchAll(/<article class="project-epic-slide[^>]*data-index="(\d+)"[^>]*>/g)].map(match => {
          const node = element(); node.dataset.index = match[1]; node.inert = /\binert\b/.test(match[0]); return node;
        });
        dots = slides.map((_, i) => element('BUTTON'));
        dots.forEach((node, i) => { node.dataset.index = String(i); });
        track.querySelectorAll = () => slides;
        track.style.transform = value.match(/id="projectEpicTrack" style="transform: ([^"]+)/)?.[1];
        elements.projectEpicDots.querySelectorAll = () => dots;
      }
      form = elements.showCreateForm;
      if (form) form.querySelector = selector => elements[selector.replace('#', '')];
    },
    get innerHTML() { return this.content; },
    querySelector(selector) { return selector === '.project-epic' ? root : null; },
    querySelectorAll() { return []; },
    contains(node) { return node === root || Object.values(elements).includes(node); },
  };
  const env = { window: { getLearningAuthEpoch: () => owner, scrollTo() {},
      addEventListener(type, fn) { if (type === 'keydown') globalKeys.push(fn); }, removeEventListener() {} },
    location: { hash: '#/projects' }, console, setTimeout,
    document: { activeElement: null, getElementById: id => ({ appView: app, listView: list, taskView: view }[id] || elements[id]),
      querySelectorAll: () => [], body: { classList: { add() {}, remove() {} } } },
    fetch: async (url, opts) => { const request = { url, opts, code: 200 }; requests.push(request);
      return { get ok() { return request.code < 400; }, get status() { return request.code; }, json: () => new Promise(resolve => { request.resolve = resolve; }) }; },
  };
  vm.runInNewContext(source, env);
  async function finish(request, payload, code = 200) {
    await new Promise(resolve => setImmediate(resolve));
    request.code = code; request.resolve(payload);
    await new Promise(resolve => setImmediate(resolve));
  }
  return { env, view, requests, globalKeys, finish, element, changeOwner() { owner++; },
    get elements() { return elements; }, get slides() { return slides; }, get dots() { return dots; }, get form() { return form; } };
}

async function verifyCarouselInteractions() {
  const courses = ['unavailable', 'available', 'available'].map((status, i) => ({
    id: `course_${i}`, title: `Course ${i}`, status, status_label: status, total_stages: 3,
  }));
  const h = interactionHarness();
  h.env.window.ProjectCourses.renderRoute();
  await h.finish(h.requests[0], { courses });
  assert.equal(h.elements.projectEpicTrack.style.transform, 'translateX(-100%)', 'Without started quests, show the first available quest');
  assert.deepEqual(h.slides.map(slide => slide.inert), [true, false, true], 'Only the current slide may receive focus');
  assert.equal(h.globalKeys.length, 0, 'Carousel arrows must not capture keys from the rest of the page');
  let prevented = false;
  const key = { key: 'ArrowRight', target: h.element('BUTTON'), preventDefault() { prevented = true; } };
  await h.elements.projectEpicStage.emit('keydown', key);
  assert.equal(h.elements.projectEpicTrack.style.transform, 'translateX(-200%)');
  assert.equal(prevented, true, 'Handled carousel arrows must not also scroll the page');
  assert.deepEqual(h.slides.map(slide => slide.inert), [true, true, false]);
  for (const target of ['INPUT', 'TEXTAREA', 'SELECT']) {
    await h.elements.projectEpicStage.emit('keydown', { ...key, key: 'ArrowLeft', target: h.element(target) });
    assert.equal(h.elements.projectEpicTrack.style.transform, 'translateX(-200%)', 'Editing controls retain their arrow keys');
  }
  await h.elements.projectEpicDots.emit('keydown', { ...key, key: 'ArrowLeft' });
  assert.equal(h.elements.projectEpicTrack.style.transform, 'translateX(-100%)', 'Dots share local carousel keys');
  h.env.window.ProjectCourses.renderRoute();
  await h.finish(h.requests[1], { courses: courses.map((course, i) => i === 2 ? { ...course, status: 'started' } : course) });
  assert.equal(h.elements.projectEpicTrack.style.transform, 'translateX(-200%)', 'Started quests take priority over available quests');
}

async function verifyPublicationInteractions() {
  async function open() {
    const h = interactionHarness(); h.env.location.hash = '#/showcase/new';
    h.env.window.ProjectCourses.renderRoute();
    await h.finish(h.requests[0], { covers: ['aurora'], can_multi_file: false });
    assert.ok(h.form, 'Publishing uses a semantic form');
    assert.match(h.view.innerHTML, /id="showPublishStatus"[^>]*role="status"/);
    return h;
  }
  const submit = h => h.form.emit('submit', { preventDefault() {} });
  const h = await open();
  h.elements.showTitle.value = '  x  ';
  await submit(h);
  assert.equal(h.requests.length, 1, 'Invalid trimmed title is rejected before publishing');
  assert.match(h.elements.showPublishStatus.textContent, /3.*80/);
  h.elements.showTitle.value = 'Мини-проект'; h.elements.showDesc.value = ' коротко ';
  await submit(h);
  assert.equal(h.requests.length, 1);
  assert.match(h.elements.showPublishStatus.textContent, /10.*500/);
  h.elements.showDesc.value = 'Описание моей программы';
  const pending = submit(h); await submit(h);
  assert.equal(h.requests.length, 2, 'Repeated submission while pending sends one POST');
  assert.equal(h.elements.showPublish.disabled, true);
  await h.finish(h.requests[1], { error: 'Сервис временно недоступен' }, 503); await pending;
  assert.equal(h.elements.showPublish.disabled, false, 'An error allows retry');
  assert.equal(h.elements.showMain.value, 'print(1)', 'An error preserves code');
  assert.equal(h.elements.showDesc.value, 'Описание моей программы');
  assert.match(h.elements.showPublishStatus.textContent, /Сервис временно недоступен/);
  const retry = submit(h);
  await h.finish(h.requests[2], { card: { id: 7 } }); await retry;
  assert.equal(h.env.location.hash, '#/showcase/7');
  for (const reason of ['route', 'dom', 'account']) for (const code of [200, 401, 503]) {
    const late = await open(), form = late.form, statusEl = late.elements.showPublishStatus;
    const sent = submit(late);
    if (reason === 'route') late.env.location.hash = '#/topics';
    else if (reason === 'dom') late.view.innerHTML = 'A newer form/page';
    else late.changeOwner();
    const expectedHash = late.env.location.hash, expectedStatus = statusEl.textContent;
    await late.finish(late.requests[1], code === 200 ? { card: { id: 8 } } : { error: 'Late failure' }, code); await sent;
    assert.equal(late.env.location.hash, expectedHash, `${reason}: stale publication must not navigate`);
    assert.equal(statusEl.textContent, expectedStatus, `${reason}: stale publication must not update detached/other-owner status`);
    assert.equal(form.isConnected, reason !== 'dom');
  }
}
(async () => {
  const first = context.window.ProjectCourses.renderHomePrompts();
  const duplicate = context.window.ProjectCourses.renderHomePrompts();
  assert.equal(calls.length, 1, 'Same dashboard must share an in-flight request');
  await resolveNext(); await Promise.all([first, duplicate]);
  assert.equal(inserted.length, 1);
  assert.ok(box.innerHTML.includes('&lt;test&gt;'));
  assert.equal(dashboard.dataset.projectPromptsLoading, undefined);
  await context.window.ProjectCourses.renderHomePrompts();
  assert.equal(calls.length, 1, 'Existing prompt box must not be duplicated');
  box = null; inserted = []; dashboard = home();
  const old = dashboard, stale = context.window.ProjectCourses.renderHomePrompts();
  old.isConnected = false; dashboard = home(); epoch++;
  await resolveNext(); await stale;
  assert.equal(inserted.length, 0, 'Old dashboard/account response must not insert');
  assert.equal(old.dataset.projectPromptsLoading, undefined);
  const oldAccount = context.window.ProjectCourses.renderHomePrompts();
  epoch++;
  await resolveNext(); await oldAccount;
  assert.equal(inserted.length, 0, 'Account epoch alone must invalidate an otherwise connected dashboard');
  const current = context.window.ProjectCourses.renderHomePrompts();
  await resolveNext(); await current;
  assert.deepEqual(inserted, [dashboard]);
  box = null; dashboard = home();
  const hidden = context.window.ProjectCourses.renderHomePrompts();
  dashboard.closest = () => ({ hidden: true });
  await resolveNext(); await hidden;
  assert.equal(inserted.length, 1, 'Response after leaving home must not insert into hidden content');
  app.hidden = true;
  const count = calls.length;
  await context.window.ProjectCourses.renderHomePrompts();
  assert.equal(calls.length, count, 'No request before login');
  app.hidden = false;
  for (const hash of ['#/showcase', '#/showcase/101', '#/showcase/new']) {
    for (status of [200, 401, 503]) for (const reason of ['navigation', 'account']) {
      context.location.hash = hash;
      context.window.ProjectCourses.renderRoute();
      if (reason === 'navigation') taskView.innerHTML = 'New route already rendered';
      else epoch++;
      const expected = taskView.innerHTML;
      await resolveNext(status === 200 ? { cards: [], card: { title: 'Example', files: [], owner_name: 'fixture', description: '', score: 0 } } : { error: 'Late failure' });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(taskView.innerHTML, expected, hash + ': late ' + status + ' after ' + reason + ' must not overwrite another route/account');
      assert.equal(app.hidden, false, 'A stale 401 must not log out the current account');
    }
  }
  await verifyCarouselInteractions();
  await verifyPublicationInteractions();
  console.log('PASS: project lifecycle, available/started carousel selection, inert slides/local arrows, publication validation/deduplication/retry and stale route/DOM/account guards');
})().catch(error => { console.error(error); process.exitCode = 1; });
