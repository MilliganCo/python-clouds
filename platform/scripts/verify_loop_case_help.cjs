/* Actual static helper + actual failure renderer; no browser, Python, model or writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let sideEffects = 0;
const forbidden = () => { sideEffects++; throw new Error('Unexpected network, storage, grading or model call'); };
const context = vm.createContext({ window: {}, fetch: forbidden, post: forbidden, api: forbidden,
  XMLHttpRequest: forbidden, WebSocket: forbidden,
  localStorage: new Proxy({}, { get: forbidden }), PyRunner: new Proxy({}, { get: forbidden }),
}, { codeGeneration: { strings: false, wasm: false } });
vm.runInContext(read('platform/static/error-help.js'), context);
const help = context.window.LearningErrorHelp;
if (process.argv.includes('--examples-json')) {
  process.stdout.write(JSON.stringify(help.caseExamples || {}));
  process.exit(0);
}
assert.equal(typeof help.renderCase, 'function', 'Optional case guidance API must exist');
const keys = ['loop_filter', 'loop_empty', 'loop_boundary', 'growth_initial', 'growth_threshold', 'growth_integer'];
assert.deepEqual(Object.keys(help.caseExamples).sort(), [...keys].sort());
assert(Object.isFrozen(help.caseExamples));
for (const key of keys) {
  const entry = help.caseExamples[key];
  assert(Object.isFrozen(entry), key + ': authored data must be immutable');
  for (const field of ['title', 'purpose', 'step', 'code', 'output']) assert.equal(typeof entry[field], 'string', key + ': ' + field);
  assert(entry.title && entry.purpose && entry.step && entry.code);
}
const cases = [
  ...[[16,'loop_filter'],[0,'loop_empty'],[1,'loop_empty'],[2,'loop_empty'],[3,'loop_boundary'],[5,'loop_filter'],[6,'loop_boundary'],[15,'loop_filter'],[18,'loop_boundary'],[30,'loop_filter'],[31,'loop_filter'],[33,'loop_boundary']]
    .map(([n,key]) => ['7.8', `Проверка: sum_multiples(${n})`, key]),
  ...[[3,20,'growth_threshold'],[5,5,'growth_initial'],[8,2,'growth_initial'],[1,17,'growth_threshold'],[2,4,'growth_threshold'],[2,5,'growth_threshold'],[3,24,'growth_threshold'],[1,0,'growth_initial'],[1,'1152921504606846977','growth_integer']]
    .map(([start,target,key]) => ['7.9', `Проверка: growth_steps(${start}, ${target})`, key]),
];
const failure = message => ({ type: 'AssertionError', source: 'check', message });
for (const [taskId, firstLine, key] of cases) {
  const issue = Object.freeze({ ...failure(firstLine + '\nОжидалось: 0\nПолучено: неизвестное значение'),
    get actual() { throw new Error('Actual result must not be interpreted'); } });
  const html = help.renderCase(issue, { taskId });
  assert(html.includes(`data-case-help="${key}"`), taskId + ': ' + firstLine);
  assert(html.includes('learning-case-help') && html.startsWith('<details'));
  assert(!/<details[^>]*\bopen(?:\s|=|>)/i.test(html), 'Help stays collapsed and free');
  assert(!html.includes('неизвестное значение'), 'Never diagnose using a learner result');
}
const known = failure('Проверка: sum_multiples(16)\nОжидалось: 30\nПолучено: 0');
for (const issue of [null, {}, { ...known, type: 'TypeError' }, { ...known, type: '__proto__' },
  { ...known, type: 'constructor' }, ...['solution','runner','exactcheck','',null,undefined].map(source => ({ ...known, source }))]) {
  assert.equal(help.renderCase(issue, { taskId: '7.8' }), '', 'Unsupported failure context must not suggest a case');
}
for (const taskId of [undefined, null, 7.8, '7.80', '7.9', '57.8', '__proto__', 'constructor', {}]) {
  assert.equal(help.renderCase(known, { taskId }), '');
}
for (const firstLine of [
  'Проверка: sum_multiples(4)', 'Проверка: sum_multiples(016)', 'Проверка: sum_multiples(16.0)',
  'Проверка: sum_multiples("16")', 'Проверка: sum_multiples(16) ', ' Проверка: sum_multiples(16)',
  'Проверка: sum_multiples(16) units', 'sum_multiples(16)', 'Проверка: __proto__(16)',
  'Проверка: sum_multiples(16)<script>bad()</script>',
]) assert.equal(help.renderCase(failure(firstLine), { taskId: '7.8' }), '');
for (const firstLine of ['Проверка: growth_steps(3,20)', 'Проверка: growth_steps(3, 21)',
  'Проверка: growth_steps(3, 20.0)', 'Проверка: growth_steps("3", 20)']) {
  assert.equal(help.renderCase(failure(firstLine), { taskId: '7.9' }), '');
}
const malicious = failure('Проверка: sum_multiples(16)\nПолучено: <script>bad()</script><img onerror=bad()>');
const safe = help.renderCase(malicious, { taskId: '7.8' });
assert(safe.includes('data-case-help="loop_filter"'));
assert(!/<script|<img|onerror=|bad\(\)/i.test(safe), 'The failure body must not be copied into authored guidance');
assert(!help.render({ ...known, source: 'check' }).includes('learning-error-help'), 'General check errors retain existing guidance rules');

const app = read('platform/static/app.js'), start = app.indexOf('function codeFailureHtml(');
const end = app.indexOf('\n  /* Возвращает {', start);
assert(start > 0 && end > start);
context.esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
vm.runInContext(app.slice(start, end) + '\nwindow.failureForTest = codeFailureHtml;', context);
const result = { failure: malicious, error: '<script>trace()</script>', got: '<img src=x onerror=bad()>', guidance: '<b>run guidance</b>' };
const original = JSON.stringify(result);
const rendered = context.window.failureForTest(result, 'def sum_multiples(n):\n    return 0', { append: 'check' }, '7.8');
assert(rendered.includes('data-case-help="loop_filter"'));
assert(rendered.includes('check-message') && rendered.includes('Подробности Python') && rendered.includes('Вывод до остановки'));
assert(rendered.includes('&lt;script&gt;') && rendered.includes('&lt;img'));
assert(!rendered.includes('<script') && !rendered.includes('<img') && !rendered.includes('<b>run guidance</b>'));
assert.equal(JSON.stringify(result), original, 'Optional help must not modify grading/failure data');
assert(!context.window.failureForTest(result, 'code', { append: 'check' }).includes('data-case-help'), 'Atlas/no task context must retain ordinary failure rendering');
assert(!context.window.failureForTest({ ...result, failure: { ...malicious, source: undefined, line: 999 } }, 'code', { append: 'check' }, '7.8').includes('data-case-help'), 'Legacy inferred-check position must not enable authored case selection');
context.window.LearningErrorHelp = { render: help.render, sourceHtml: help.sourceHtml, examples: help.examples };
const cached = context.window.failureForTest(result, 'code', { append: 'check' }, '7.8');
assert(cached.includes('check-message') && cached.includes('Подробности Python') && !cached.includes('data-case-help'), 'Cached helper without renderCase keeps original error');
delete context.window.LearningErrorHelp;
const absent = context.window.failureForTest(result, 'code', { append: 'check' }, '7.8');
assert(absent.includes('check-message') && absent.includes('Подробности Python'), 'Missing optional helper cannot break failure feedback');
assert.match(app, /codeFailureHtml\(res,\s*payload\.code\s*\|\|\s*"",\s*window\.CHECKS\[task\.id\],\s*task\.id\)/, 'Ordinary course passes public task context');
assert.match(app, /codeFailureHtml\(\{\s*\.\.\.r,\s*got:\s*r\.stdout\s*\},\s*code,\s*\{\s*append:\s*t\.tests\s*\}\)/, 'Atlas retains its existing context-free call');
assert.equal(sideEffects, 0);
console.log('PASS loop case help: all 21 canonical cases, strict source/type/task/header allowlist, collapsed frozen examples, untrusted result ignored, actual failure renderer and cached/missing helper fallbacks, no side effects');
