const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const staticDir=process.env.PYCLOUD_TASK_ASSETS||path.join(__dirname,'../static');
const read=name=>fs.readFileSync(path.join(staticDir,name),'utf8');
const loader=read('catalogue-loader.js');
async function fixture({legacy=false,mode='auto'}={}){
 const generation='a'.repeat(64),scripts=[],requests=[],timers=new Map();let sequence=0;
 const indexWindow={};vm.runInNewContext(read('task-index.js'),{window:indexWindow});
 const bankNames=Object.values(indexWindow.TASK_INDEX.banks);
 const names=[...(legacy?[]:['task-index.js']),'tasks.js',...bankNames,'app.js'];
 const manifest={version:1,generation,scripts:names,styles:[],sha256:Object.fromEntries(names.map(n=>[n,'b'.repeat(64)]))};
 const window={addEventListener(){},performance:{now:()=>0},setTimeout(fn,ms){timers.set(++sequence,{fn,ms});return sequence;},clearTimeout:id=>timers.delete(id)};
 const doc={readyState:'complete',currentScript:{hasAttribute:()=>false},getElementById:()=>null,addEventListener(){},querySelector:()=>({content:generation}),querySelectorAll:s=>s.startsWith('script')?names.map(name=>({dataset:{courseSrc:name}})):[],createElement:tag=>({tagName:tag.toUpperCase(),remove(){this.removed=true;}}),head:{appendChild(){throw new Error('No CSS');}},body:{appendChild(node){
  scripts.push(node);const name=node.src.split('/'+generation+'/')[1];requests.push(name);
  if(name==='app.js'){queueMicrotask(()=>node.onload());return;}
  if(mode==='manual'&&name.startsWith('task-banks/')&&!legacy)return;
  vm.runInContext(read(name),context);queueMicrotask(()=>node.onload());
 }}};
 const context=vm.createContext({window,document:doc,console,fetch:async()=>({ok:true,json:async()=>manifest}),btoa:s=>Buffer.from(s,'binary').toString('base64')});
 vm.runInContext(loader,context);for(let i=0;i<90;i++)await new Promise(setImmediate);
 return{window,context,scripts,requests,generation,timers,bank:id=>scripts.filter(s=>s.src.endsWith('/task-banks/topic-'+id+'.js')),
  evaluateBank(id){vm.runInContext(read('task-banks/topic-'+id+'.js'),context);}};
}
test('bank generation is exact, search-ready and lighter; legacy full source remains compatible',async()=>{
 const f=await fixture(),original={window:{}};vm.runInNewContext(read('tasks.js'),original);
 const actual=f.window.TASKS,full=original.window.TASKS;
 assert.equal(actual.length,66);assert.equal(actual.flatMap(t=>t.tasks).length,642);
 assert.equal(f.window.SOURCE_RULES_PYTHON,original.window.SOURCE_RULES_PYTHON);
 assert(f.requests.includes('task-index.js'));assert(!f.requests.includes('tasks.js'));assert(!f.requests.some(n=>n.startsWith('task-banks/')));
 const fields=['id','type','title','prompt','code','displayType','finale','learning'];
 for(let i=0;i<full.length;i++){
  const topic=actual[i],expected=full[i];assert.equal(topic.id,expected.id);
  for(let n=0;n<expected.tasks.length;n++){
   const task=topic.tasks[n],base=expected.tasks[n];for(const key of fields)assert.equal(JSON.stringify(task[key]),JSON.stringify(base[key]),task.id+' '+key);
   assert(!('answer' in task)&&!('check' in task));
  }
 }
 for(const query of ['def','print','список','class','[0]','пуст','assert']){
  const matches=topics=>topics.flatMap(t=>t.tasks).filter(t=>[t.title,t.prompt,t.code].some(s=>(s||'').toLowerCase().includes(query))).map(t=>t.id);
  assert.equal(JSON.stringify(matches(actual)),JSON.stringify(matches(full)),query);
 }
 const references=actual.flatMap(t=>t.tasks);
 for(const topic of actual){await f.window.CourseAssets.loadTask(topic.tasks[0].id);assert(f.window.CourseAssets.isTaskLoaded(topic.tasks.at(-1).id));}
 assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(full)));
 assert(actual.flatMap(t=>t.tasks).every((t,i)=>t===references[i]),'Hydration preserves every task identity');
 for(const task of references)if(task.check)assert.equal(f.window.CHECKS[task.id],task.check);
 assert.equal(f.requests.filter(n=>n.startsWith('task-banks/')).length,66);
 const legacy=await fixture({legacy:true});assert(legacy.requests.includes('tasks.js'));assert(legacy.window.CourseAssets.isTaskLoaded('3.1'));
 assert.deepEqual(JSON.parse(JSON.stringify(legacy.window.TASKS)),JSON.parse(JSON.stringify(full)));
 assert(Buffer.byteLength(read('task-index.js'))<Buffer.byteLength(read('tasks.js'))*.5);
});
test('one bank request is shared; SRI and immutable prefix are retained',async()=>{
 const f=await fixture({mode:'manual'}),a=f.window.CourseAssets.loadTask('3.1'),b=f.window.CourseAssets.loadTask('3.2');
 assert.equal(f.bank(3).length,1);const script=f.bank(3)[0];assert.equal(script.src,'/course-content/'+f.generation+'/task-banks/topic-3.js');assert(script.integrity.startsWith('sha256-'));
 f.evaluateBank(3);script.onload();await Promise.all([a,b]);await f.window.CourseAssets.loadTask('3.1');assert.equal(f.bank(3).length,1);
});
test('failed or incomplete groups are retryable and never partially change task objects',async()=>{
 const f=await fixture({mode:'manual'}),topic=f.window.TASKS.find(t=>t.id===3),before=JSON.stringify(topic);
 let p=f.window.CourseAssets.loadTask('3.1');f.bank(3)[0].onerror();await assert.rejects(p,/unavailable/);assert.equal(JSON.stringify(topic),before);
 p=f.window.CourseAssets.loadTask('3.1');f.evaluateBank(3);f.window.TASK_BANKS[3].tasks.at(-1).prompt='injected';f.bank(3)[1].onload();await assert.rejects(p,/Invalid/);assert.equal(JSON.stringify(topic),before);
 p=f.window.CourseAssets.loadTask('3.1');f.evaluateBank(3);f.bank(3)[2].onload();await p;assert('answer' in topic.tasks[0]);
});
test('unknown IDs and full-bank replacement are rejected; independent topic loads do not block',async()=>{
 const f=await fixture({mode:'manual'});for(const id of ['__proto__','../3.js','3.999','C3',null])await assert.rejects(f.window.CourseAssets.loadTask(id),/Unsupported/);
 await assert.rejects(f.window.CourseAssets.load('tasks.js'),/Unsupported/);
 const a=f.window.CourseAssets.loadTask('3.1'),b=f.window.CourseAssets.loadTask('55.1');f.evaluateBank(55);f.bank(55)[0].onload();await b;
 assert(!f.window.CourseAssets.isTaskLoaded('3.1'));f.evaluateBank(3);f.bank(3)[0].onload();await a;
});
