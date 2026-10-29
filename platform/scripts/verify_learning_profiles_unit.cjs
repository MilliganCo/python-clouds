/* Real legacy renderer, pure Node: no browser, learner state, network or AI. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'platform/static/app.js'), 'utf8');
const escStart = app.indexOf('const esc = ');
const escEnd = app.indexOf('\n  /* Условия', escStart);
const start = app.indexOf('function learningProfileHtml(');
const end = app.indexOf('\n  function stageTrainHtml(', start);
assert(escStart > 0 && escEnd > escStart && start > 0 && end > start);
const context = vm.createContext({ window: {} }, { codeGeneration: { strings: false, wasm: false } });
vm.runInContext(app.slice(escStart, escEnd) + '\n' + app.slice(start, end) + '\nwindow.renderProfile = learningProfileHtml;', context);
vm.runInContext(fs.readFileSync(path.join(root, 'platform/static/tasks.js'), 'utf8'), context);
const tasks = context.window.TASKS.flatMap(topic => topic.tasks);
const labelled = tasks.filter(task => task.learning);
assert.equal(labelled.length, 168);
assert.equal(labelled.filter(task => task.id.startsWith('16.')).length, 10);
for (const task of labelled) {
  const html = context.window.renderProfile(task);
  assert(html.includes('сложность внутри темы'));
  assert(html.includes(task.learning.reason));
  for (const skill of task.learning.skills) assert(html.includes(skill));
  assert(!html.includes('<button') && !html.includes('<a ') && !html.includes('<pre'));
}
assert.equal(context.window.renderProfile(tasks.find(task => task.id === '2.4')), '');
assert.equal(context.window.renderProfile({ learning: { difficulty: 'constructor' } }), '');
assert.equal(context.window.renderProfile({ learning: { difficulty: 'easy', skills: null, reason: 'test' } }), '');
const hostile = context.window.renderProfile({ learning: { difficulty: 'easy', skills: ['<img src=x onerror=alert(1)>'], reason: '<script>bad</script>' } });
assert(!hostile.includes('<img') && !hostile.includes('<script'));
assert(hostile.includes('&lt;img') && hostile.includes('&lt;script'));
console.log(`PASS: ${labelled.length} author profiles, real renderer and escaping, absent/unknown profile fallback, noninteractive markup`);
