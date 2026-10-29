const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../static/catalogue-loader.js'),'utf8');
async function fixture(){
 const scripts=[],timers=new Map();let seq=0;const generation='a'.repeat(64);
 const manifest={version:1,generation,scripts:['changelog.js','counterexample-data.js','counterexample-game.js','app.js'],styles:[],sha256:{'changelog.js':'b'.repeat(64),'app.js':'c'.repeat(64),'counterexample-data.js':'d'.repeat(64),'counterexample-game.js':'e'.repeat(64)}};
 const window={addEventListener(){},performance:{now:()=>0},setTimeout(fn,ms){timers.set(++seq,{fn,ms});return seq;},clearTimeout:id=>timers.delete(id)};
 const document={readyState:'complete',currentScript:{hasAttribute:()=>false},getElementById:()=>null,addEventListener(){},
  querySelector:()=>({content:generation}),querySelectorAll:selector=>selector.startsWith('script')?manifest.scripts.map(name=>({dataset:{courseSrc:name}})):[],
  createElement:tag=>({tagName:tag.toUpperCase(),remove(){this.removed=true;}}),body:{appendChild(node){scripts.push(node);if(node.src.endsWith('/app.js'))queueMicrotask(()=>node.onload());}},head:{appendChild(){throw new Error('No CSS expected');}}};
 const context={window,document,fetch:async()=>({ok:true,json:async()=>manifest}),console,btoa:s=>Buffer.from(s,'binary').toString('base64'),setTimeout,clearTimeout};
 vm.runInNewContext(source,context);
 for(let i=0;i<10;i++)await new Promise(setImmediate);
 assert(window.CourseAssets);return{window,scripts,timers,generation,optional:()=>scripts.filter(s=>s.src.endsWith('/changelog.js')),named:name=>scripts.filter(s=>s.src.endsWith('/'+name))};
}
test('boot skips changelog but executes core app; optional script is pinned and SRI protected',async()=>{
 const f=await fixture();assert.equal(f.optional().length,0);assert.equal(f.scripts.length,1);
 const p=f.window.CourseAssets.load('changelog.js'),script=f.optional()[0];
 assert.equal(script.src,'/course-content/'+f.generation+'/changelog.js');assert(script.integrity.startsWith('sha256-'));assert.equal(script.async,true);
 script.onload();await p;
});
test('game group deduplicates and evaluates the bank before its engine',async()=>{
 const f=await fixture(),p=f.window.CourseAssets.load('counterexample-game.js');assert.equal(f.window.CourseAssets.load('counterexample-game.js'),p);
 assert.equal(f.named('counterexample-data.js').length,1);assert.equal(f.named('counterexample-game.js').length,0);
 f.named('counterexample-data.js')[0].onload();for(let i=0;i<4;i++)await Promise.resolve();
 assert.equal(f.named('counterexample-game.js').length,1);f.named('counterexample-game.js')[0].onload();await p;
 assert.equal(f.window.CourseAssets.load('counterexample-game.js'),p);
});
test('failed bank retries the whole dependency chain; a failed engine reuses loaded data',async()=>{
 const f=await fixture(),p=f.window.CourseAssets.load('counterexample-game.js');f.named('counterexample-data.js')[0].onerror();await assert.rejects(p,/unavailable/);
 const retry=f.window.CourseAssets.load('counterexample-game.js');assert.equal(f.named('counterexample-data.js').length,2);assert.equal(f.named('counterexample-game.js').length,0);
 f.named('counterexample-data.js')[1].onload();for(let i=0;i<4;i++)await Promise.resolve();f.named('counterexample-game.js')[0].onerror();await assert.rejects(retry,/unavailable/);
 const engineRetry=f.window.CourseAssets.load('counterexample-game.js');for(let i=0;i<4;i++)await Promise.resolve();assert.equal(f.named('counterexample-data.js').length,2);f.named('counterexample-game.js')[1].onload();await engineRetry;
});
test('independent optional groups do not block each other while dependencies still load in order',async()=>{
 const f=await fixture(),history=f.window.CourseAssets.load('changelog.js'),game=f.window.CourseAssets.load('counterexample-game.js');
 assert(f.optional()[0].async&&f.named('counterexample-data.js')[0].async);
 f.named('counterexample-data.js')[0].onload();for(let i=0;i<4;i++)await Promise.resolve();f.named('counterexample-game.js')[0].onload();await game;
 assert.equal(typeof f.optional()[0].onload,'function','History is still pending after the independent game completes');
 f.optional()[0].onload();await history;
});
test('concurrent and successful calls share one request; unrelated paths cannot be loaded',async()=>{
 const f=await fixture(),p=f.window.CourseAssets.load('changelog.js');assert.equal(f.window.CourseAssets.load('changelog.js'),p);assert.equal(f.optional().length,1);
 f.optional()[0].onload();await p;assert.equal(f.window.CourseAssets.load('changelog.js'),p);assert.equal(f.optional().length,1);
 await assert.rejects(f.window.CourseAssets.load('app.js'),/Unsupported/);await assert.rejects(f.window.CourseAssets.load('../private.js'),/Unsupported/);
});
test('failed load is removed and a user retry can fetch the same pinned asset',async()=>{
 const f=await fixture(),p=f.window.CourseAssets.load('changelog.js'),first=f.optional()[0];first.onerror();await assert.rejects(p,/unavailable/);assert(first.removed);
 const retry=f.window.CourseAssets.load('changelog.js');assert.equal(f.optional().length,2);assert.equal(f.optional()[1].src,first.src);f.optional()[1].onload();await retry;
});
test('optional timeout releases its slot; a late event cannot settle a newer attempt',async()=>{
 const f=await fixture(),p=f.window.CourseAssets.load('changelog.js'),first=f.optional()[0],late=first.onload;
 const timeout=[...f.timers.values()].find(t=>t.ms===12000&&t.fn.toString().includes('Optional asset timed out'));assert(timeout);timeout.fn();await assert.rejects(p,/timed out/);
 const retry=f.window.CourseAssets.load('changelog.js');late();assert.equal(f.optional()[1].removed,undefined);f.optional()[1].onload();await retry;
});
