const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function node(tag) {
  return { tagName:tag, attrs:{}, children:[], handlers:new Map(),
    setAttribute(name,value){this.attrs[name]=value;},
    appendChild(child){this.children.push(child);child.parent=this;},
    addEventListener(name,fn){const list=this.handlers.get(name)||[];list.push(fn);this.handlers.set(name,list);},
    insertAdjacentElement(where,child){const list=this.parent.children,index=list.indexOf(this);list.splice(index+(where==='afterend'?1:0),0,child);child.parent=this.parent;},
  };
}
const context = { window: {}, Event, document: { createElement: node } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/editor-keys.js'), 'utf8'), context);
const editor = { id: 'exampleEditor', dataset: {}, value: 'abc', selectionStart: 1, selectionEnd: 2,
  attrs: { 'aria-describedby': 'existingHint' }, listeners: new Map(), events: [],
  addEventListener(name, fn) { const list=this.listeners.get(name)||[];list.push(fn);this.listeners.set(name,list); },
  removeEventListener(name, fn) { this.listeners.set(name,(this.listeners.get(name)||[]).filter(item=>item!==fn)); },
  getAttribute(name) { return this.attrs[name]; }, setAttribute(name, value) { this.attrs[name] = value; },
  insertAdjacentElement(where, el) { this.hint = el;const list=this.parent.children;list.splice(list.indexOf(this)+1,0,el);el.parent=this.parent; },
  dispatchEvent(event) { this.events.push(event);for(const fn of [...(this.listeners.get(event.type)||[])])fn(event); },
  focus() {}, setSelectionRange(start,end,direction) {this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;},
  setRangeText(text, start, end, mode) { assert.equal(mode, 'end'); this.value = this.value.slice(0, start) + text + this.value.slice(end); this.selectionStart = this.selectionEnd = start + text.length; },
};
editor.parent = {children:[editor]};
context.window.EditorKeys.bind(editor);
context.window.EditorKeys.bind(editor);
assert.equal(editor.listeners.get('keydown').length, 1);
assert.equal(editor.attrs['aria-describedby'], 'existingHint exampleEditorKeyboardHint');
assert.equal(editor.hint.role, 'status');
function key(key, extra = {}) {
  const event = { key, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
  editor.listeners.get('keydown')[0](event);
  return event;
}
assert.equal(key('Tab').prevented, true);
assert.equal(editor.value, 'a    c');
assert.equal(editor.events.length, 1);
assert.equal(editor.events[0].type, 'input');
assert.equal(editor.events[0].bubbles, true);
for (const extra of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
  assert.equal(key('Tab', extra).prevented, false);
}
const before = editor.value;
assert.equal(key('ь', { code: 'KeyM', ctrlKey: true }).prevented, true);
assert.ok(editor.hint.textContent.includes('переход'));
assert.equal(key('Tab').prevented, false);
assert.equal(key('m', { ctrlKey: true, repeat: true }).prevented, false);
assert.equal(key('M', { ctrlKey: true, shiftKey: true }).prevented, false);
assert.equal(editor.events.length, 1);
assert.equal(editor.value, before);
assert.equal(key('m', { ctrlKey: true }).prevented, true);
assert.equal(key('Tab').prevented, true);
assert.equal(editor.events.length, 2);
const app = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const renderSource = app.slice(app.indexOf('  function terminalEditorHtml('), app.indexOf('  let solved ='));
context.esc = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
context.window.RuntimeHelp = { html: () => '<details>Runtime</details>' };
vm.runInNewContext(renderSource, context);
const editable = context.terminalEditorHtml('solution<&".py', '<textarea id="test"></textarea>', { editorId: 'test"', resetId: 'reset' });
assert.ok(editable.includes('<label class="terminal-title" for="test&quot;">solution&lt;&amp;&quot;.py</label>'));
assert.ok(editable.includes('<textarea id="test"></textarea>'));
assert.ok(editable.includes('id="reset"'));
assert.ok(editable.endsWith('<details>Runtime</details>'));
const readonly = context.terminalEditorHtml('вывод', '<pre>OK</pre>');
assert.ok(readonly.includes('<span class="terminal-title">вывод</span>'));
assert.ok(!readonly.includes('<label'));
console.log('PASS:shared editor Tab,Shift+Tab,Ctrl+M/Russian layout,repeat/modifiers/IME,selection,input event,no code mutation on mode switch,bind once');
