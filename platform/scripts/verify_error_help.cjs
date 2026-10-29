/* Pure Node integration checks; no browser, network, storage, model or progress API. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const context = vm.createContext({ window: {} }, { codeGeneration: { strings: false, wasm: false } });
vm.runInContext(read('platform/static/error-help.js'), context);
const help = context.window.LearningErrorHelp;
assert.equal(typeof help.sourceHtml, 'function');
const sentCode = ['def report():', '    value = "<img src=x onerror=alert(1)>"', '    label = "Пример"', '    print(missing)', 'report()', '# конец', '# вне фрагмента'].join('\r\n');
const located = { type: 'NameError', source: 'solution', line: 4, message: 'not defined' };
const fragment = help.sourceHtml(located, sentCode);
assert(fragment.includes('отправленного кода') && fragment.toLowerCase().includes('строка 4'));
assert.equal((fragment.match(/data-source-line=/g) || []).length, 5);
assert(fragment.includes('data-source-line="2"') && fragment.includes('data-source-line="6"'));
assert(!fragment.includes('data-source-line="1"') && !fragment.includes('data-source-line="7"'));
assert(fragment.includes('is-error" data-source-line="4"'));
assert(fragment.includes('&lt;img') && !fragment.includes('<img'));
assert(help.sourceHtml({ ...located, line: 1 }, '\tfirst\rsecond').includes('\tfirst'));
for (const line of [0, -1, 1.5, NaN, Infinity, '2', null, undefined, 999]) assert.equal(help.sourceHtml({ ...located, line }, sentCode), '');
for (const source of ['check', 'runner', '', undefined]) assert.equal(help.sourceHtml({ ...located, source }, sentCode), '');
assert.equal(help.sourceHtml(located, sentCode, { inCheck: true }), '');
assert.equal(help.sourceHtml(located, null), '');
assert.equal(help.sourceHtml(null, sentCode), '');
assert.equal(Object.keys(help.examples).length, 16);
for (const [type, item] of Object.entries(help.examples)) {
  assert(item.code && typeof item.output === 'string' && item.reason && item.step);
  if (type.includes('_')) continue;
  const html = help.render({ type, source: 'solution', message: 'example' });
  assert(html.startsWith('<details'));
  assert(html.includes(item.title));
  assert(!/<details[^>]*\bopen\b/.test(html), 'Help must be collapsed by default');
  assert(!html.includes('<script') && !html.includes('onclick='));
  assert.equal(help.render({ type, source: 'check', message: 'example' }), '');
  assert.equal(help.render({ type, source: 'solution' }, { inCheck: true }), '');
}
assert(help.render({ type: 'TypeError', message: "f() missing 1 required positional argument: 'a'" }).includes('Проверьте обязательные аргументы'));
assert(help.render({ type: 'TypeError', message: "f() missing 1 required keyword-only argument: 'a'" }).includes('Проверьте обязательные аргументы'));
assert(help.render({ type: 'TypeError', message: 'unsupported operand type(s)' }).includes('С чего начать при TypeError'));
assert(help.render({ type: 'IndentationError', message: 'unexpected indent' }).includes('Проверьте лишний отступ'));
for (const type of ['__proto__', 'constructor', 'TypeError_arguments', 'IndentationError_unexpected', 'TimeoutError', 'AssertionError', '', null, {}]) {
  assert.equal(help.render({ type, source: 'solution', message: '<img src=x onerror=alert(1)>' }), '');
}
assert.equal(help.render(null), '');
assert.equal(help.render({ type: 'NameError', source: 'runner' }), '');
assert(!help.render({ type: 'NameError', message: '<img src=x onerror=alert(1)>' }).includes('<img'));

const app = read('platform/static/app.js');
const start = app.indexOf('function codeFailureHtml(');
const end = app.indexOf('\n  /* Возвращает {', start);
assert(start > 0 && end > start);
context.esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
vm.runInContext(app.slice(start, end) + '\nwindow.renderFailure = codeFailureHtml;', context);
const error = { error: '<img src=x onerror=alert(1)>', got: '<script>bad</script>', failure: { type: 'NameError', source: 'solution', line: 1, message: 'name not defined' } };
const rendered = context.window.renderFailure(error, 'print(missing)', {});
assert(rendered.includes('learning-error-help') && rendered.includes('Строка 1'));
assert(!rendered.includes('<img') && !rendered.includes('<script'));
assert(rendered.includes('Подробности Python') && rendered.includes('Вывод до остановки'));
assert(rendered.includes('<figure class="error-source">'));
assert(!context.window.renderFailure({ ...error, failure: { ...error.failure, source: 'check' } }, '', { append: 'check' }).includes('learning-error-help'));
assert(!context.window.renderFailure({ ...error, failure: null }, '', {}).includes('learning-error-help'));
assert(!context.window.renderFailure({ ...error, failure: { ...located, source: 'check' } }, sentCode, { append: 'check' }).includes('<figure class="error-source">'));
context.window.LearningErrorHelp = { render: help.render, examples: help.examples };
assert(!context.window.renderFailure(error, 'print(missing)', {}).includes('<figure class="error-source">'), 'Cached helper without sourceHtml must retain the error');
delete context.window.LearningErrorHelp;
assert(!context.window.renderFailure(error, '', {}).includes('learning-error-help'), 'Old HTML without the new asset must still show the original error');
context.window.LearningErrorHelp = help;

const projects = read('platform/static/project-courses.js');
const projectStart = projects.indexOf('async function checkStage(');
const projectEnd = projects.indexOf('\n  function closeSuccessModal', projectStart);
assert(projectStart > 0 && projectEnd > projectStart);
vm.runInContext(projects.slice(projectStart, projectEnd) + '\nwindow.checkStageForTest = checkStage;', context);
(async () => {
  context.window.LearningErrorHelp = help;
  const dailyStart = app.indexOf('$("dailySubmitBtn").addEventListener("click", async () => {');
  const dailyEnd = app.indexOf('\n    });', dailyStart);
  assert(dailyStart > 0 && dailyEnd > dailyStart);
  const elements = Object.fromEntries(['dailySubmitBtn', 'dailyVerdict', 'dailyOutput', 'dailyTests'].map(id => [id, { scrollIntoView() {} }]));
  let resolveRun, submitted;
  Object.assign(context, { $: id => elements[id], editor: { value: sentCode }, t: { tests: 'assert example' },
    active: () => true, status() {}, requestAnimationFrame: fn => fn(),
    SubmissionChecks: { start: () => ({ finish: async () => {} }) },
    PyRunner: { run: code => { submitted = code; return new Promise(resolve => { resolveRun = resolve; }); } },
    post() { throw new Error('Unexpected learner write'); } });
  vm.runInContext('window.submitDailyForTest = async () => {' + app.slice(app.indexOf('\n', dailyStart), dailyEnd) + '\n};', context);
  const attempt = context.window.submitDailyForTest();
  context.editor.value = '# NEW EDITOR CONTENT';
  resolveRun({ ...error, failure: located }); await attempt;
  assert.equal(submitted, sentCode);
  assert(elements.dailyVerdict.innerHTML.includes('print(missing)'));
  assert(!elements.dailyVerdict.innerHTML.includes('NEW EDITOR CONTENT'));
  assert.equal(elements.dailySubmitBtn.disabled, false);
  for (const stage of [{ check: { append: 'assert ok', expect: 'OK' } }, {}]) {
    context.window.PyRunner = { run: async () => error };
    const result = await context.window.checkStageForTest(stage, 'print(missing)');
    assert.equal(result.ok, false);
    assert.equal(result.failure, error.failure);
    assert(help.render(result.failure).includes('learning-error-help'));
  }
  context.window.PyRunner = { run: async () => ({ blocked: true, error: 'unavailable' }) };
  const blocked = await context.window.checkStageForTest({ check: { append: 'check' } }, 'code');
  assert(blocked.blocked && !blocked.failure);
  context.window.PyRunner = { run: async () => ({ stdout: 'debug\nOK\n', user_stdout: 'debug\n', check_stdout: 'OK\n' }) };
  const passed = await context.window.checkStageForTest({ check: { append: 'check', expect: 'OK' } }, 'code');
  assert.equal(passed.ok, true);
  assert.equal(passed.stdout, 'debug\n');
  assert(projects.includes('LearningErrorHelp?.render(lastCheck.failure)'));
  assert(projects.includes('LearningErrorHelp?.sourceHtml?.(lastCheck.failure, code)'));
  assert(!projects.includes('Проверить код в браузере') && !projects.includes('Код проверен в браузере'));
  if (process.argv.includes('--browser')) throw new Error('Browser harness is excluded from this source-only QA entrypoint');
  console.log('PASS: 14 exception types, 2 contextual variants, escaping, check/system gating, real app/project handlers, legacy fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
