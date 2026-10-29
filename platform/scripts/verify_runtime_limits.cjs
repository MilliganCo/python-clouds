/* Actual shared helper + HTTP transport, without a browser, Python or learner writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');
const context = { window: {}, document: { querySelectorAll: () => [] } };
vm.runInNewContext(read('runtime-help.js'), context);
const hint = context.window.RuntimeHelp.errorHint;
assert.equal(typeof hint, 'function');

const timeout = 'Превышено время выполнения (10 секунд). Проверьте условие выхода.';
const cases = [
  [{ error: timeout }, {}, 'условие выхода'],
  [{ error: timeout }, { interactive: true }, 'ввода'],
  [{ error: 'Превышен лимит памяти Python (256 МиБ).' }, {}, 'память'],
  [{ error: 'Превышен лимит вывода (64 КиБ).' }, {}, 'print'],
  [{ error: 'Превышен лимит потока вывода.' }, {}, 'print'],
  [{ error: 'Слишком большой поток вывода. Запуск остановлен.' }, {}, 'print'],
  [{ error: 'Слишком много событий вывода.' }, {}, 'print'],
  [{ error: 'Достигнут лимит времени или ресурсов Python.' }, {}, 'Точная причина'],
  [{ error: 'Python остановлен из-за ошибки или ограничения ресурсов.' }, {}, 'Точная причина'],
  [{ error: 'Traceback\nMemoryError', failure: { type: 'MemoryError', source: 'solution' } }, {}, 'память'],
  [{ error: 'Traceback\nOutputLimitExceeded', failure: { type: 'OutputLimitExceeded', source: 'solution' } }, {}, 'print'],
  [{ error: 'Traceback', failure: { type: 'OutputLimitExceeded', source: 'check' } }, {}, 'дополнительной проверки'],
  [{ error: 'Слишком часто', blocked: true }, { httpStatus: 429 }, 'минуту'],
  [{ error: 'Нет входа', blocked: true }, { httpStatus: 401 }, 'войдите'],
  [{ error: 'Большой запрос', blocked: true }, { httpStatus: 413 }, 'объём'],
  [{ error: 'Неверный запрос', blocked: true }, { httpStatus: 400 }, 'объём'],
  [{ error: 'Docker недоступен', blocked: true }, { httpStatus: 503 }, 'администратору'],
  [{ error: 'Failed to fetch', blocked: true }, {}, 'соединение'],
];
for (const [result, options, expected] of cases) {
  const before = JSON.stringify(result);
  const text = hint(result, options);
  assert.ok(text.includes(expected), expected + ': ' + text);
  assert.equal(JSON.stringify(result), before, 'Guidance must not mutate result or verdict');
  assert.ok(!text.includes('<') && !text.includes('НеизвестноеИмя'));
}
for (const result of [null, {}, { error: null }, { cancelled: true, error: timeout },
  { error: '<img src=x>' }, { error: timeout, failure: { type: 'ValueError', source: 'solution' } },
  { error: 'MemoryError in message', failure: { type: 'TypeError', source: 'check' } }]) {
  assert.equal(hint(result), '', 'Do not guess from arbitrary Python messages or successful/cancelled runs');
}

async function transport(reply, options = {}) {
  const calls = [];
  const ctx = { window: {}, document: { querySelectorAll: () => [] }, AbortController, TextDecoder, Uint8Array,
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      if (options.status) return { ok: false, status: options.status,
        json: async () => { if (options.html) throw new SyntaxError('HTML response'); return { error: 'safe refusal' }; } };
      let sent = false;
      const events = [{ type: 'job', id: 'a'.repeat(32) }, { type: 'result', ...reply }];
      return { ok: true, body: { getReader: () => ({ read: async () => {
        if (sent) return { done: true };
        sent = true;
        return { done: false, value: new TextEncoder().encode(events.map(e => JSON.stringify(e)).join('\n') + '\n') };
      } }) } };
    },
  };
  if (!options.missingAsset) vm.runInNewContext(read('runtime-help.js'), ctx);
  if (options.oldAsset) ctx.window.RuntimeHelp = { html: () => '' };
  vm.runInNewContext(read('python-execution.js'), ctx);
  const result = options.interactive ? await ctx.window.PythonExecutionClient.runInteractive('pass')
    : await ctx.window.PythonExecutionClient.run('pass');
  assert.equal(calls.length, 1, 'Never retry or send a model/progress request');
  assert.equal(calls[0].url, '/api/python/run');
  return result;
}

(async () => {
  for (const interactive of [false, true]) {
    const result = await transport({ stdout: 'partial\n', error: timeout, failure: null,
      user_stdout: null, check_stdout: null }, { interactive });
    assert.equal(result.error, timeout, 'Technical error remains unchanged');
    assert.ok(result.guidance.includes(interactive ? 'ввода' : 'условие выхода'));
    assert.equal(context.window.RuntimeHelp.errorText(result), timeout + '\n\n' + result.guidance);
    assert.equal(result.stdout, 'partial\n');
    assert.equal(result.failure, null);
    assert.equal(result.blocked, undefined, 'Do not reclassify a stopped program as an infrastructure refusal');
  }
  for (const status of [400, 401, 413, 429, 503]) {
    const result = await transport({}, { status, html: status === 413 });
    assert.equal(result.blocked, true);
    assert.equal(result.guidance, hint({ error: 'x', blocked: true }, { httpStatus: status }));
    assert.equal(result.failure, null);
  }
  const failure = { type: 'ValueError', message: timeout, line: 3, source: 'solution' };
  const ordinary = await transport({ error: '<img src=x>', failure });
  assert.equal(ordinary.error, '<img src=x>');
  assert.deepEqual(JSON.parse(JSON.stringify(ordinary.failure)), failure);
  assert.equal((await transport({ stdout: 'OK', error: null })).error, null);
  assert.equal((await transport({ error: timeout }, { missingAsset: true })).error, timeout);
  assert.equal((await transport({ error: timeout }, { oldAsset: true })).guidance, undefined);

  // Execute the actual task/Atlas render and grading functions, not a duplicate renderer.
  context.esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = read('app.js');
  const renderStart = app.indexOf('function codeFailureHtml('), renderEnd = app.indexOf('\n  /* Возвращает {', renderStart);
  assert.ok(renderStart > 0 && renderEnd > renderStart);
  vm.runInNewContext(app.slice(renderStart, renderEnd) + '\nwindow.renderFailure = codeFailureHtml;', context);
  const stopped = { error: 'Traceback\nMemoryError', failure: { type: 'MemoryError', source: 'solution', line: 2, message: '' },
    guidance: 'Совет <img src=x>', got: 'partial' };
  const rendered = context.window.renderFailure(stopped, 'x\ny', {});
  assert.ok(rendered.indexOf('Совет &lt;img') < rendered.indexOf('<details'), 'Hint must be visible before collapsed technical details');
  assert.ok(!rendered.includes('<img'));
  assert.ok(context.window.renderFailure({ error: timeout, guidance: 'Проверьте цикл' }, '', {}).includes('Проверьте цикл'));
  const currentHelp = context.window.RuntimeHelp;
  context.window.RuntimeHelp = { html: () => '' };
  assert.ok(context.window.renderFailure({ error: timeout }, '', {}).includes(timeout), 'Cached previous helper without errorText must keep the editor usable');
  context.window.RuntimeHelp = currentHelp;
  const gradeStart = app.indexOf('async function grade('), gradeEnd = app.indexOf('\n  /* ── Страница задания', gradeStart);
  assert.ok(gradeStart > 0 && gradeEnd > gradeStart);
  context.window.CHECKS = { 'test.1': { expect: 'OK', append: 'assert ok' } };
  context.taskCheckScript = () => 'assert ok';
  context.PyRunner = { run: async () => stopped };
  vm.runInNewContext(app.slice(gradeStart, gradeEnd) + '\nwindow.gradeForTest = grade;', context);
  const graded = await context.window.gradeForTest({ id: 'test.1', type: 'дописать код' }, { code: 'x' });
  assert.equal(graded.ok, false);
  assert.equal(graded.error, stopped.error);
  assert.equal(graded.guidance, stopped.guidance);
  context.PyRunner = { run: async () => ({ blocked: true, error: 'unavailable', guidance: 'Повторите позже' }) };
  const blockedGrade = await context.window.gradeForTest({ id: 'test.1', type: 'дописать код' }, { code: 'x' });
  assert.equal(blockedGrade.kind, 'blocked');
  assert.equal(blockedGrade.guidance, 'Повторите позже');

  // A refused daily/Atlas run is not displayed as a failed solution or sent for reward.
  const dailyStart = app.indexOf('$("dailySubmitBtn").addEventListener("click", async () => {');
  const dailyEnd = app.indexOf('\n    });', dailyStart);
  assert.ok(dailyStart > 0 && dailyEnd > dailyStart);
  const dailyBody = app.slice(app.indexOf('\n', dailyStart), dailyEnd);
  const elements = Object.fromEntries(['dailySubmitBtn', 'dailyVerdict', 'dailyOutput', 'dailyTests'].map(id => [id, {}]));
  const refused = { blocked: true, error: 'safe refusal', guidance: 'Подождите и повторите' };
  let reports = 0;
  Object.assign(context, { $: id => elements[id], editor: { value: 'pass' }, t: { tests: 'assert ok' },
    active: () => true, status: () => {}, SubmissionChecks: { start: () => ({ finish: async () => { reports++; } }) },
    PyRunner: { run: async () => refused }, post: () => { throw new Error('Unexpected learner write'); } });
  vm.runInNewContext('window.dailySubmitForTest = async () => {' + dailyBody + '\n};', context);
  await context.window.dailySubmitForTest();
  assert.equal(reports, 0);
  assert.equal(elements.dailyTests.hidden, true);
  assert.equal(elements.dailySubmitBtn.disabled, false);
  assert.equal(elements.dailyVerdict.className, 'verdict show');
  assert.ok(elements.dailyVerdict.textContent.includes(refused.guidance));
  context.window.RuntimeHelp = { html: () => '' };
  await context.window.dailySubmitForTest();
  assert.equal(elements.dailyVerdict.textContent, refused.error);
  assert.equal(elements.dailySubmitBtn.disabled, false);
  context.window.RuntimeHelp = currentHelp;

  const projects = read('project-courses.js');
  const projectStart = projects.indexOf('async function checkStage('), projectEnd = projects.indexOf('\n  function closeSuccessModal', projectStart);
  assert.ok(projectStart > 0 && projectEnd > projectStart);
  vm.runInNewContext(projects.slice(projectStart, projectEnd) + '\nwindow.projectCheckForTest = checkStage;', context);
  for (const stage of [{ check: { append: 'assert ok', expect: 'OK' } }, {}]) {
    for (const result of [stopped, refused]) {
      context.window.PyRunner = { run: async () => result };
      const checked = await context.window.projectCheckForTest(stage, 'pass');
      assert.equal(checked.ok, false);
      assert.equal(checked.guidance, result.guidance);
      assert.equal(checked.error, result.error);
      assert.equal(!!checked.blocked, !!result.blocked);
    }
  }

  const log = [], output = { appendChild: el => log.push(el.textContent) };
  const form = { hidden: true, addEventListener() {}, removeEventListener() {} }, input = {addEventListener(){}};
  const controls={hidden:true},state={},stop={addEventListener(){}},send={};
  context.window.addEventListener = () => {};
  context.document.createElement = () => ({});
  context.window.PyRunner = { runInteractive: async () => stopped };
  vm.runInNewContext(read('terminal.js'), context);
  const term = context.window.LiveTerminal.create({ querySelector: selector => ({ '.live-term-output': output, '.live-term-input-row': form, '.live-term-input': input, '.live-term-controls': controls, '.live-term-state': state, '.live-term-stop': stop, '.live-term-send': send }[selector]) });
  assert.equal((await term.run('pass')).error, stopped.error);
  assert.equal(log.length, 1);
  assert.ok(log[0].includes(stopped.guidance), 'Live terminal must render guidance as text, including literal markup');
  assert.equal(form.hidden, true);
  assert.equal(term.isRunning(), false);
  context.window.RuntimeHelp = { html: () => '' };
  assert.equal((await term.run('pass')).error, stopped.error);
  assert.equal(log.at(-1), '\n' + stopped.error);
  console.log('PASS:18 guidance cases,7 non-matches,real transport/task/Atlas/project/terminal handlers,5 HTTP refusals,HTML413,no mutation/retry/learner writes,cached-asset fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
