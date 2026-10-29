/* Non-browser behavioral regression probes for the actual shared modules. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const moduleRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../static');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.dataset = {}; this.attrs = {}; this.listeners = new Map();
    this.children = []; this.value = ''; this.selectionStart = this.selectionEnd = 0;
    this.selectionDirection = 'none'; this.events = []; this._text = '';
    this.scrollTop = 0; this.scrollHeight = 100; this.clientHeight = 100;
  }
  set textContent(value) { this._text = value; this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  get disabled() { return !!this._disabled; }
  set disabled(value) { this._disabled = value; this.observer?.(); }
  get readOnly() { return !!this._readonly; }
  set readOnly(value) { this._readonly = value; this.observer?.(); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  insertAdjacentElement(position, child) {
    const list = this.parent.children, index = list.indexOf(this);
    list.splice(index + (position === 'afterend' ? 1 : 0), 0, child); child.parent = this.parent;
  }
  addEventListener(name, fn) { const handlers = this.listeners.get(name) || []; handlers.push(fn); this.listeners.set(name, handlers); }
  removeEventListener(name, fn) { this.listeners.set(name, (this.listeners.get(name) || []).filter(handler => handler !== fn)); }
  dispatchEvent(event) {
    this.events.push(event);
    for (const handler of [...(this.listeners.get(event.type) || [])]) handler(event);
    return !event.defaultPrevented;
  }
  fire(type, fields = {}) {
    const event = { type, prevented: false, preventDefault() { this.prevented = true; }, ...fields };
    this.dispatchEvent(event); return event;
  }
  focus(options) { this.focused = true; this.focusOptions = options; this.fire('focus'); }
  click() { if (!this.disabled) this.fire('click'); }
  setSelectionRange(start, end, direction = 'none') {
    assert.ok(start >= 0 && end >= start && end <= this.value.length, `invalid selection ${start}:${end} in ${this.value.length}`);
    this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
  }
  setRangeText(text, start, end, mode) {
    assert.equal(mode, 'end');
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    this.setSelectionRange(start + text.length, start + text.length);
  }
  scrollIntoView(options) { this.reveals = (this.reveals || 0) + 1; this.revealOptions = options; }
}

function contextFor(file, extra = {}) {
  const frames = [], listeners = new Map();
  const context = { Event, Intl, setTimeout, clearTimeout, document: { createElement: tag => new Element(tag) },
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe(element) { element.observer = this.callback; } },
    requestAnimationFrame: callback => frames.push(callback),
    window: { addEventListener: (name, callback) => listeners.set(name, callback), ...extra } };
  vm.runInNewContext(fs.readFileSync(path.join(moduleRoot, file), 'utf8'), context);
  return { context, frames, listeners };
}
function editorFixture(value = '', start = value.length, end = start, options = {}) {
  const { context } = contextFor('editor-keys.js');
  const parent = new Element(), editor = new Element('textarea');
  editor.id = 'testEditor'; editor.value = value; editor.setSelectionRange(start, end);
  Object.assign(editor, options); editor.attrs['aria-describedby'] = 'existingHint';
  editor.attrs['aria-keyshortcuts'] = 'Control+Enter';
  parent.appendChild(editor); const binding = context.window.EditorKeys.bind(editor);
  return { editor, parent, binding, context,
    press: label => binding.execute(label),
    edits: () => editor.events.filter(event => event.type === 'input').length };
}
const key = (editor, key, extra = {}) => editor.fire('keydown', { key, ...extra });

test('editor binds once without inline controls; native attributes and shortcuts survive', () => {
  const f = editorFixture('abc'); f.context.window.EditorKeys.bind(f.editor);
  assert.equal(f.parent.children.length, 2);
  assert.equal(f.editor.attrs['autocapitalize'], 'off'); assert.equal(f.editor.attrs['autocorrect'], 'off');
  assert.equal(f.editor.attrs['aria-describedby'], 'existingHint testEditorKeyboardHint');
  assert.equal(f.editor.attrs['aria-keyshortcuts'], 'Control+Enter Control+M');
  assert.equal(f.parent.children.filter(child => child.className === 'editor-touch-tools').length, 0);
  assert.equal(f.binding, f.context.window.EditorKeys.bind(f.editor));
});
test('symbol insertion replaces a selected range once and bubbles autosave input', () => {
  const f = editorFixture('abc', 1, 2); f.press(':');
  assert.equal(f.editor.value, 'a:c'); assert.equal(f.editor.selectionStart, 2);
  assert.equal(f.edits(), 1); assert.equal(f.editor.events.find(event => event.type === 'input').bubbles, true);
  assert.equal(f.editor.focusOptions.preventScroll, true);
});
test('pairs wrap selected Unicode, preserve selection direction and place empty caret inside', () => {
  const f = editorFixture('xёж🐍z', 1, 5); f.editor.selectionDirection = 'backward'; f.press('()');
  assert.equal(f.editor.value, 'x(ёж🐍)z'); assert.equal(f.editor.selectionStart, 2); assert.equal(f.editor.selectionEnd, 6);
  assert.equal(f.editor.selectionDirection, 'backward'); assert.equal(f.edits(), 1);
  const empty = editorFixture(''); empty.press('""');
  assert.equal(empty.editor.value, '""'); assert.equal(empty.editor.selectionStart, 1); assert.equal(empty.editor.selectionEnd, 1);
});
test('touch indent/outdent handles selected lines and excludes trailing unselected line', () => {
  const f = editorFixture('one\ntwo\nthree', 1, 8); f.press('⇥');
  assert.equal(f.editor.value, '    one\n    two\nthree');
  assert.equal(f.editor.selectionStart, 5); assert.equal(f.editor.selectionEnd, 16); assert.equal(f.edits(), 1);
  f.press('⇤'); assert.equal(f.editor.value, 'one\ntwo\nthree');
  assert.equal(f.editor.selectionStart, 1); assert.equal(f.editor.selectionEnd, 8); assert.equal(f.edits(), 2);
});
test('outdent removes partial spaces/tab only, preserves no-op and empty first line', () => {
  const f = editorFixture('  a\n\tb\nplain', 0, 7); f.press('⇤');
  assert.equal(f.editor.value, 'a\nb\nplain'); assert.equal(f.editor.selectionStart, 0); assert.equal(f.editor.selectionEnd, 4);
  f.editor.setSelectionRange(f.editor.value.length, f.editor.value.length); f.press('⇤'); assert.equal(f.edits(), 1);
  const emptyFirst = editorFixture('\n  b', 0, 4); emptyFirst.press('⇤');
  assert.equal(emptyFirst.editor.value, '\nb'); assert.equal(emptyFirst.editor.selectionStart, 0);
});
test('touch newline keeps current whitespace and indents a block without changing native Enter', () => {
  const f = editorFixture('    if ok:'); f.press('↵');
  assert.equal(f.editor.value, '    if ok:\n        '); assert.equal(f.edits(), 1);
  assert.equal(key(f.editor, 'Enter').prevented, false);
  const first = editorFixture('\nfoo', 0); first.press('↵'); assert.equal(first.editor.value, '\n\nfoo');
});
test('caret buttons collapse selections, cross graphemes and bounds, never emit input', () => {
  const f = editorFixture('a👩‍💻e\u0301z', 1); f.press('→'); assert.equal(f.editor.selectionStart, 6);
  f.press('→'); assert.equal(f.editor.selectionStart, 8); f.press('←'); assert.equal(f.editor.selectionStart, 6);
  f.editor.setSelectionRange(1, 8); f.press('←'); assert.equal(f.editor.selectionStart, 1); assert.equal(f.editor.selectionEnd, 1);
  f.editor.setSelectionRange(1, 8); f.press('→'); assert.equal(f.editor.selectionStart, 8);
  f.editor.setSelectionRange(0, 0); f.press('←'); assert.equal(f.editor.selectionStart, 0);
  f.editor.setSelectionRange(f.editor.value.length, f.editor.value.length); f.press('→'); assert.equal(f.editor.selectionStart, f.editor.value.length);
  assert.equal(f.edits(), 0);
});
test('readonly, disabled and composition guard every touch mutation and caret move', () => {
  for (const option of ['readOnly', 'disabled']) {
    const f = editorFixture('abc', 1); f.editor[option] = true;
    assert.equal(f.binding.writable(), false);
    for (const label of ['⇥','⇤','↵','←','→','()','[]','{}',"''",'""',':','=']) assert.equal(f.press(label), false);
    assert.equal(f.editor.value, 'abc'); assert.equal(f.editor.selectionStart, 1); assert.equal(f.edits(), 0);
    assert.equal(key(f.editor, 'Tab').prevented, false);
  }
  const f = editorFixture('abc', 1); f.editor.fire('compositionstart');
  assert.equal(f.binding.writable(), false); f.press(':'); assert.equal(f.edits(), 0);
  assert.equal(key(f.editor, 'Tab').prevented, false);
  f.editor.fire('compositionend'); assert.equal(f.binding.writable(), true); f.press(':'); assert.equal(f.edits(), 1);
});
test('physical Tab/Ctrl+M and Russian KeyM keep established modifiers and selection behavior', () => {
  const f = editorFixture('abc', 1, 2);
  assert.equal(key(f.editor, 'Tab').prevented, true); assert.equal(f.editor.value, 'a    c'); assert.equal(f.edits(), 1);
  for (const extra of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    assert.equal(key(f.editor, 'Tab', extra).prevented, false);
  }
  const before = f.editor.value;
  assert.equal(key(f.editor, 'ь', { code: 'KeyM', ctrlKey: true }).prevented, true);
  assert.equal(key(f.editor, 'Tab').prevented, false); assert.equal(f.editor.value, before);
  assert.equal(key(f.editor, 'm', { ctrlKey: true, repeat: true }).prevented, false);
  assert.equal(key(f.editor, 'm', { ctrlKey: true }).prevented, true);
  assert.equal(key(f.editor, 'Enter', { ctrlKey: true }).prevented, false);
  assert.equal(key(f.editor, 'Escape').prevented, false);
  f.editor.value = '    '; f.editor.setSelectionRange(0, 4);
  const editsBefore = f.edits(); key(f.editor, 'Tab');
  assert.equal(f.editor.value, '    '); assert.equal(f.editor.selectionStart, 4);
  assert.equal(f.editor.selectionEnd, 4); assert.equal(f.edits(), editsBefore + 1);
});
test('binding rejects unknown commands and detached editors without changing the draft', () => {
  const f = editorFixture('abc', 1);
  assert.equal(f.press('__proto__'),false);assert.equal(f.press('missing'),false);
  f.editor.isConnected=false;assert.equal(f.press(':'),false);assert.equal(f.editor.value,'abc');assert.equal(f.edits(),0);
});
test('compound operators and paired raw/f strings are one native edit with preserved selection',()=>{
  const f=editorFixture('xёж🐍z',1,5);f.press('f""');assert.equal(f.editor.value,'xf"ёж🐍"z');assert.equal(f.editor.selectionStart,3);assert.equal(f.editor.selectionEnd,7);assert.equal(f.edits(),1);
  const operator=editorFixture('abc',1,2);operator.press('!=');assert.equal(operator.editor.value,'a!=c');assert.equal(operator.edits(),1);
  const triple=editorFixture('');triple.press("'''");assert.equal(triple.editor.value,"''''''");assert.equal(triple.editor.selectionStart,3);assert.equal(triple.edits(),1);
});
test('double indent and line-above are single edits with deliberate caret placement',()=>{
  const f=editorFixture('a\nb',0,3);f.press('⇥2');assert.equal(f.editor.value,'        a\n        b');assert.equal(f.edits(),1);
  const above=editorFixture('  x\ny',3);above.press('↑↵');assert.equal(above.editor.value,'  \n  x\ny');assert.equal(above.editor.selectionStart,2);assert.equal(above.edits(),1);
  const plain=editorFixture('    if ok:');plain.press('↵0');assert.equal(plain.editor.value,'    if ok:\n');assert.equal(plain.edits(),1);
});
test('line/document/word navigation handles Unicode without input events',()=>{
  const f=editorFixture('one ёж\nlast',5);f.press('Home');assert.equal(f.editor.selectionStart,0);
  f.press('w→');assert.equal(f.editor.selectionStart,3);f.press('w→');assert.equal(f.editor.selectionStart,6);f.press('←w');assert.equal(f.editor.selectionStart,4);
  f.press('End');assert.equal(f.editor.selectionStart,6);f.press('↓↓');assert.equal(f.editor.selectionStart,11);f.press('Home');assert.equal(f.editor.selectionStart,7);f.press('↑↑');assert.equal(f.editor.selectionStart,0);assert.equal(f.edits(),0);
});

function terminalEnvironment() {
  const jobs = []; let cancels = 0;
  const result = contextFor('terminal.js', { PyRunner: {
    runInteractive(code, handlers) { const job = { code, handlers }; jobs.push(job); return new Promise(resolve => { job.resolve = resolve; }); },
    cancelInteractive() { cancels++; },
  } });
  function create() {
    const container = new Element(), nodes = {};
    for (const name of ['output', 'input-row', 'input', 'send', 'controls', 'state', 'stop']) nodes[name] = new Element();
    container.querySelector = selector => nodes[selector.slice('.live-term-'.length)];
    const terminal = result.context.window.LiveTerminal.create(container);
    return { container, nodes, terminal, start(code = 'input()') { const pending = terminal.run(code); return { pending, job: jobs.at(-1) }; } };
  }
  return { ...result, create, jobs, cancels: () => cancels };
}
function submit(nodes, value, extra = {}) { nodes.input.value = value; return nodes['input-row'].fire('submit', extra); }
function text(fixture) { return fixture.nodes.output.textContent; }

test('stdin is native input with an explicit submit and accessible stop/status', async () => {
  const env = terminalEnvironment(), f = env.create(), { pending, job } = f.start();
  assert.match(f.container.innerHTML, /type="submit"[^>]+live-term-send/);
  assert.match(f.container.innerHTML, /enterkeyhint="send"/); assert.match(f.container.innerHTML, /autocapitalize="off" autocorrect="off"/);
  assert.equal(f.nodes.controls.hidden, false); assert.equal(f.nodes.state.textContent, 'Программа работает…');
  const input = job.handlers.onInputRequest(); assert.equal(f.nodes['input-row'].hidden, false);
  assert.equal(f.nodes.state.textContent, 'Программа ждёт ввод'); assert.ok(f.nodes['input-row'].reveals >= 1);
  assert.equal(f.nodes.input.focusOptions.preventScroll, true);
  submit(f.nodes, 'да'); assert.equal(await input, 'да'); job.resolve({ error: null }); await pending;
  assert.equal(f.nodes.controls.hidden, true); assert.equal(f.terminal.isRunning(), false);
});
test('stdin preserves empty/spaces/Unicode, submits once, and supports sequential prompts', async () => {
  const env = terminalEnvironment(), f = env.create(), { pending, job } = f.start();
  for (const answer of ['', '  ', 'ёж 🐍 <script>']) {
    const input = job.handlers.onInputRequest(); submit(f.nodes, answer); submit(f.nodes, 'duplicate');
    assert.equal(await input, answer); assert.equal(f.nodes['input-row'].hidden, true);
    assert.equal(f.nodes['input-row'].fire('submit').prevented, true, 'Settled forms never fall through to native navigation');
  }
  assert.equal(text(f), '\n  \nёж 🐍 <script>\n');
  assert.equal(f.nodes.output.children.length, 3);
  job.resolve({ error: null }); await pending;
});
test('composition blocks submit/Enter; committed text then submits and keyCode229 stays native-safe', async () => {
  const env = terminalEnvironment(), f = env.create(), { pending, job } = f.start();
  const input = job.handlers.onInputRequest(); f.nodes.input.fire('compositionstart');
  assert.equal(f.nodes.send.disabled, true); assert.equal(key(f.nodes.input, 'Enter', { isComposing: true }).prevented, true);
  submit(f.nodes, '未確定'); assert.equal(f.nodes['input-row'].hidden, false); assert.equal(text(f), '');
  f.nodes.input.fire('compositionend');
  submit(f.nodes, '確定'); assert.equal(f.nodes['input-row'].hidden, false);
  assert.equal(key(f.nodes.input, 'Enter').prevented, true);
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(f.nodes.send.disabled, false);
  assert.equal(key(f.nodes.input, 'Enter', { keyCode: 229 }).prevented, true);
  submit(f.nodes, '確定', { isComposing: true }); assert.equal(f.nodes['input-row'].hidden, false);
  submit(f.nodes, '確定'); assert.equal(await input, '確定'); job.resolve({ error: null }); await pending;
});
test('stop settles pending input once, ignores old output/status and deactivates controls', async () => {
  const env = terminalEnvironment(), f = env.create(), statuses = [];
  const pending = f.terminal.run('input()', status => statuses.push(status)), job = env.jobs.at(-1);
  const input = job.handlers.onInputRequest(); f.nodes.stop.click(); f.nodes.stop.click();
  assert.equal(await input, ''); assert.equal(env.cancels(), 1); assert.equal(f.nodes['input-row'].hidden, true);
  assert.equal(f.nodes.controls.hidden, true); assert.equal(f.terminal.isRunning(), false);
  const before = text(f); job.handlers.onOutput('stale'); job.handlers.onStatus('stale');
  assert.equal(await job.handlers.onInputRequest(), ''); assert.equal(text(f), before); assert.deepEqual(statuses, []);
  for (const frame of env.frames) frame();
  job.resolve({ error: 'late error', artifacts: ['late'] }); assert.equal((await pending).cancelled, true);
  assert.equal(text(f), '\n[программа остановлена]');
});
test('new run has one owner and stale completion cannot hide or mutate the next input', async () => {
  const env = terminalEnvironment(), first = env.create(), second = env.create();
  const a = first.start(), inputA = a.job.handlers.onInputRequest();
  const b = second.start(), inputB = b.job.handlers.onInputRequest();
  assert.equal(await inputA, ''); assert.equal(env.cancels(), 1); assert.equal(first.nodes.controls.hidden, true);
  a.job.resolve({ error: null }); await a.pending;
  assert.equal(second.nodes['input-row'].hidden, false); assert.equal(second.nodes.controls.hidden, false);
  a.job.handlers.onOutput('stale'); assert.equal(text(first), '');
  submit(second.nodes, 'second'); assert.equal(await inputB, 'second'); b.job.resolve({ error: null }); await b.pending;
});
test('route cancellation, clear and static output cancel input without accidental echo/submission', async () => {
  for (const action of ['route', 'clear', 'static']) {
    const env = terminalEnvironment(), f = env.create(), { pending, job } = f.start();
    const input = job.handlers.onInputRequest();
    if (action === 'route') env.listeners.get('hashchange')();
    if (action === 'clear') f.terminal.clear();
    if (action === 'static') f.terminal.setStatic('checked', 'result');
    assert.equal(await input, ''); assert.equal(env.cancels(), 1); assert.equal(f.nodes['input-row'].hidden, true);
    submit(f.nodes, 'late'); job.handlers.onOutput('late');
    assert.equal(text(f), action === 'static' ? 'checked' : '');
    job.resolve({ error: null }); await pending;
  }
});
test('output follows only near bottom; stdin reveal scrolls its real container and expires after cancel', async () => {
  const env = terminalEnvironment(), f = env.create(), { pending, job } = f.start();
  f.container.scrollHeight = 500; f.container.clientHeight = 100; f.container.scrollTop = 20;
  job.handlers.onOutput('reading'); assert.equal(f.container.scrollTop, 20);
  f.container.scrollTop = 400; job.handlers.onOutput('new output'); assert.equal(f.container.scrollTop, 500);
  job.handlers.onInputRequest(); assert.equal(f.container.scrollTop, 500);
  f.terminal.cancel(); f.container.scrollTop = 10;
  for (const frame of env.frames) frame(); assert.equal(f.container.scrollTop, 10);
  job.resolve({ error: null }); await pending;
});
test('sync runner failures render safely and result artifacts retain the existing epoch contract', async () => {
  const env = terminalEnvironment(), shown = [], cleared = [];
  env.context.window.OutputFiles = { epoch: () => 7, clear: output => cleared.push(output), show: (...args) => shown.push(args) };
  env.context.window.PyRunner.runInteractive = () => { throw new Error('<unsafe>'); };
  const f = env.create(); assert.equal((await f.terminal.run('pass')).error, '<unsafe>');
  assert.equal(text(f), '\n<unsafe>'); assert.equal(f.nodes.controls.hidden, true);
  env.context.window.PyRunner.runInteractive = async () => ({ error: null, artifacts: [{ name: 'report.txt' }] });
  const result = await f.terminal.run('pass'); assert.equal(result.artifacts.length, 1);
  assert.equal(shown.at(-1)[2], 7); assert.equal(shown.at(-1)[1][0].name, 'report.txt'); assert.equal(cleared.length, 2);
});

test('native text insertion emits only its own input and keeps a working fallback', () => {
  const f = editorFixture('abc', 1, 2); let calls = 0;
  f.context.document.activeElement = f.editor;
  f.context.document.execCommand = (command, ui, value) => {
    assert.equal(command, 'insertText'); assert.equal(ui, false); calls++;
    f.editor.setRangeText(value, f.editor.selectionStart, f.editor.selectionEnd, 'end');
    f.editor.dispatchEvent(new Event('input', { bubbles: true })); return true;
  };
  f.press(':'); assert.equal(f.editor.value, 'a:c'); assert.equal(f.edits(), 1); assert.equal(calls, 1);
  f.editor.setSelectionRange(1, 2); f.press(':');
  assert.equal(f.editor.value, 'a:c'); assert.equal(f.edits(), 2);
  f.context.document.execCommand = () => { throw new Error('unavailable'); };
  f.editor.setSelectionRange(3, 3); f.press('=');
  assert.equal(f.editor.value, 'a:c='); assert.equal(f.edits(), 3);
});

test('one viewport owner keeps focused input reachable, respects zoom and clears drawer geometry', () => {
  const viewportListeners = new Map(), documentListeners = new Map(), windowListeners = new Map();
  const styles = new Map(); let queued = null, sequence = 0, cancelled = null;
  const viewport = { height: 344, offsetTop: 20, scale: 1,
    addEventListener(name, fn) { assert(!viewportListeners.has(name)); viewportListeners.set(name, fn); } };
  const drawer = { style: { setProperty: (name, value) => styles.set(name, value), removeProperty: name => styles.delete(name) } };
  const editor = new Element('textarea'); editor.isConnected = true; editor.reveals = 0;
  editor.value = 'private code'; editor.setSelectionRange(1, 3);
  editor.matches = () => true; editor.closest = () => drawer;
  editor.getBoundingClientRect = () => ({ top: 600, bottom: 644 });
  const context = { Event, Intl, document: { activeElement: editor,
    addEventListener(name, fn) { assert(!documentListeners.has(name)); documentListeners.set(name, fn); } },
    window: { visualViewport: viewport, innerHeight: 844, matchMedia: () => ({ matches: true }),
      requestAnimationFrame(fn) { queued = fn; return ++sequence; }, cancelAnimationFrame(id) { cancelled = id; queued = null; },
      addEventListener(name, fn) { assert(!windowListeners.has(name)); windowListeners.set(name, fn); } } };
  const source = fs.readFileSync(path.join(moduleRoot, 'editor-keys.js'), 'utf8');
  vm.runInNewContext(source, context); vm.runInNewContext(source, context);
  assert.deepEqual([...viewportListeners.keys()].sort(), ['resize', 'scroll']);
  assert.deepEqual([...documentListeners.keys()].sort(), ['focusin', 'focusout', 'keydown', 'pointerdown']);
  assert.equal(documentListeners.has('input'), false, 'Native editor input must not dismiss the sticky palette');
  viewportListeners.get('resize')(); viewportListeners.get('scroll')();
  assert.equal(sequence, 1, 'Viewport events share one queued frame'); queued();
  assert.equal(styles.get('--input-viewport-height'), '344px');
  assert.equal(styles.get('--input-keyboard-inset'), '480px');
  assert.equal(editor.reveals, 0, 'Viewport CSS is applied before revealing the input');
  queued();
  assert.equal(editor.reveals, 1); assert.equal(editor.selectionStart, 1); assert.equal(editor.selectionEnd, 3);
  viewport.scale = 2; viewportListeners.get('resize')(); queued();
  assert.equal(styles.size, 0); assert.equal(editor.reveals, 1, 'Pinch zoom is never forced back');
  viewport.scale = 1; viewportListeners.get('resize')(); queued();
  context.document.activeElement = null; documentListeners.get('focusout')(); queued();
  assert.equal(styles.size, 0);
  context.document.activeElement = editor; documentListeners.get('focusin')();
  windowListeners.get('pagehide')(); assert.equal(cancelled, sequence); assert.equal(queued, null);
});
