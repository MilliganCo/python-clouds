const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.resolve(__dirname, '..');
const data = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : null;
function environment(override) {
  const context = { window: {}, Math, Object, Number };
  vm.createContext(context);
  if (data) context.window.COUNTEREXAMPLE_QUESTIONS = data;
  else vm.runInContext(fs.readFileSync(path.join(base, 'static/counterexample-data.js'), 'utf8'), context);
  if (override) context.window.COUNTEREXAMPLE_QUESTIONS = override(context.window.COUNTEREXAMPLE_QUESTIONS);
  for (const key of ['fetch','setTimeout','setInterval']) context[key] = context.window[key] = () => { throw new Error('Unexpected ' + key); };
  context.window.localStorage = new Proxy({}, { get() { throw new Error('Unexpected storage'); } });
  vm.runInContext(fs.readFileSync(path.join(base, 'static/counterexample-game.js'), 'utf8'), context);
  return context.window.CounterexampleGame;
}
const breaking = choice => choice.error || choice.actual !== choice.expected;
const answerIndex = model => model.state().options.findIndex(breaking);
const model = () => environment().createRound(undefined, () => 0);

test('intro has no active question; start produces six unique authored cards and four inputs', () => {
  const round = model(); assert.equal(round.state().phase, 'intro'); assert.equal(round.answer(0), false); assert.equal(round.next(), false);
  assert(round.start()); assert.equal(round.state().total, 6);
  const ids = new Set();
  for (let i=0;i<6;i++) {
    const state=round.state(); ids.add(state.question.id);
    assert.equal(state.options.length,4); assert.equal(state.options.filter(breaking).length,1);
    round.answer(answerIndex(round)); round.next();
  }
  assert.equal(ids.size,6);
});
test('invalid selections and premature next leave the current card intact', () => {
  const round=model(); round.start();
  for(const index of [-1,4,0.1,NaN,'0',null,undefined]) assert.equal(round.answer(index),false);
  assert.equal(round.next(),false); assert.equal(round.state().phase,'question'); assert.equal(round.state().answers.length,0);
});
test('one answer moves to review and repeated clicks cannot change or double count it', () => {
  const round=model();round.start();assert(round.answer(answerIndex(round)));
  assert.equal(round.state().phase,'review');assert.equal(round.state().correct,1);
  assert.equal(round.answer(0),false);assert.equal(round.state().answers.length,1);
});
test('a passing input is reviewed as a miss; the next card requires explicit advancement', () => {
  const round=model();round.start();const first=round.state().question.id;
  round.answer(round.state().options.findIndex(choice=>!breaking(choice)));
  assert.equal(round.state().correct,0);assert.equal(round.state().question.id,first);
  assert(round.next());assert.equal(round.state().phase,'question');assert.equal(round.state().position,1);assert.equal(round.state().selected,null);
});
test('summary follows exactly six reviewed cards; a new round resets counts', () => {
  const round=model();round.start();
  for(let i=0;i<6;i++){round.answer(answerIndex(round));round.next();}
  assert.equal(round.state().phase,'summary');assert.equal(round.state().correct,6);assert.equal(round.state().question,null);
  assert.equal(round.answer(0),false);assert.equal(round.next(),false);
  assert(round.start());assert.equal(round.state().correct,0);assert.equal(round.state().position,0);assert.equal(round.state().answers.length,0);
});
test('stop is final across intro, question, review and summary; stale actions stay inert', () => {
  for(const phase of ['intro','question','review','summary']){
    const round=model();if(phase!=='intro')round.start();if(phase==='review')round.answer(0);
    if(phase==='summary')for(let i=0;i<6;i++){round.answer(0);round.next();}
    round.stop();assert.equal(round.state().phase,'closed');assert.equal(round.start(),false);assert.equal(round.answer(0),false);assert.equal(round.next(),false);
  }
});
test('state and nested authored options resist accidental mutation', () => {
  const round=model();round.start();const state=round.state(), call=state.options[0].call;
  assert(Object.isFrozen(state));assert(Object.isFrozen(state.options));assert(Object.isFrozen(state.question));assert(Object.isFrozen(state.options[0]));
  state.options[0].call='changed';assert.equal(round.state().options[0].call,call);
  round.answer(0);assert(Object.isFrozen(round.state().answers));assert(Object.isFrozen(round.state().answers[0]));
});

class Root {
  constructor(){this.handlers=new Map();this.innerHTML='';this.focused=null;}
  addEventListener(type,handler){assert(!this.handlers.has(type));this.handlers.set(type,handler);}
  removeEventListener(type,handler){assert.equal(this.handlers.get(type),handler);this.handlers.delete(type);}
  contains(button){return button.inside!==false;}
  querySelector(selector){return{focus:()=>{this.focused=selector;}};}
  click(action,index,extra={}){
    const button={dataset:{counterAction:action,index:String(index)},...extra};
    this.handlers.get('click')?.({target:{closest:()=>button}});
  }
}
test('real delegated view requires one choice, focuses feedback, advances and disposes its single listener', () => {
  const root=new Root(),view=environment().mount(root,{random:()=>0});
  assert.match(root.innerHTML,/Начать практику/);root.click('start');assert.equal(root.focused,'#counterHeading');
  assert.match(root.innerHTML,/Карточка 1 из 6/);assert.doesNotMatch(root.innerHTML,/counter-feedback/);
  root.click('answer',0);assert.equal(root.focused,'#counterFeedbackTitle');
  assert.equal((root.innerHTML.match(/disabled/g)||[]).length,4);assert.match(root.innerHTML,/Ваш выбор/);
  const reviewed=root.innerHTML;root.click('answer',1);assert.equal(root.innerHTML,reviewed);
  root.click('next');assert.match(root.innerHTML,/Карточка 2 из 6/);assert.equal(root.focused,'#counterHeading');
  const stable=root.innerHTML;const queued=root.handlers.get('click');view.stop();assert.equal(root.handlers.size,0);
  queued({target:{closest:()=>({dataset:{counterAction:'start'}})}});assert.equal(root.innerHTML,stable);
});
test('view ignores unrelated, foreign and disabled buttons', () => {
  const root=new Root();environment().mount(root);const initial=root.innerHTML;
  root.click('unknown');root.click('start',0,{inside:false});root.click('start',0,{disabled:true});assert.equal(root.innerHTML,initial);
});
test('all authored content is escaped and no timers, storage or network are needed', () => {
  const game=environment(questions=>questions.map(q=>({...q,title:'<img src=x onerror=bad>',contract:'<script>bad</script>',code:'a < b',
    explanation:'<svg onload=bad>',choices:q.choices.map(c=>({...c,call:c.call+' <x>',actual:c.actual+' <y>',expected:c.expected+' <z>'}))})));
  const root=new Root();game.mount(root,{random:()=>0});root.click('start');root.click('answer',0);
  assert.doesNotMatch(root.innerHTML,/<(?:img|script|svg|x|y|z)(?:\s|>)/);
  assert.match(root.innerHTML,/&lt;img/);assert.match(root.innerHTML,/&lt;script/);assert.match(root.innerHTML,/&lt;svg/);
});
