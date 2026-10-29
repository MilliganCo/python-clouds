const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {buildTheoryManifest}=require('./build_theory_manifest.cjs');
const source=fs.readFileSync(path.join(__dirname,'../static/catalogue-loader.js'),'utf8');
const indexSource=buildTheoryManifest(path.join(__dirname,'../static'));
test('generated index covers all 66 current articles with exact source leads and no article bodies',()=>{
 const context={window:{}};vm.runInNewContext(indexSource,context);const index=context.window.THEORY_MANIFEST;
 assert.equal(index.version,1);assert.equal(Object.keys(index.articles).length,66);assert(Object.isFrozen(index)&&Object.isFrozen(index.articles));
 for(const [id,entry] of Object.entries(index.articles)){
  const full={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static',entry.file),'utf8'),full);
  assert.equal(entry.lead,full.window.THEORY_ARTICLES[id].lead);assert(!('sections' in entry));assert(Object.isFrozen(entry));
 }
 assert.equal(fs.readFileSync(path.join(__dirname,'../static/theory-manifest.js'),'utf8'),indexSource,'Generated source is current');
});
async function fixture({legacy=false}={}){
 const generation='a'.repeat(64),scripts=[],timers=new Map();let sequence=0;
 const declared=[...(legacy?[]:['theory-manifest.js']),'theory-articles-0-6.js','theory-articles-7-12.js','changelog.js','app.js'];
 const manifest={version:1,generation,scripts:declared,styles:[],sha256:Object.fromEntries(declared.map(name=>[name,'b'.repeat(64)]))};
 const window={addEventListener(){},performance:{now:()=>0},setTimeout(fn,ms){timers.set(++sequence,{fn,ms});return sequence;},clearTimeout:id=>timers.delete(id)};
 const document={readyState:'complete',currentScript:{hasAttribute:()=>false},getElementById:()=>null,addEventListener(){},querySelector:()=>({content:generation}),querySelectorAll:selector=>selector.startsWith('script')?declared.map(name=>({dataset:{courseSrc:name}})):[],createElement:tag=>({tagName:tag.toUpperCase(),remove(){this.removed=true;}}),head:{appendChild(){throw new Error('No CSS');}},body:{appendChild(node){scripts.push(node);if(node.src.endsWith('/theory-manifest.js')){window.THEORY_MANIFEST={version:1,articles:{0:{file:'theory-articles-0-6.js'},1:{file:'theory-articles-0-6.js'},7:{file:'theory-articles-7-12.js'}}};queueMicrotask(()=>node.onload());}else if(node.src.endsWith('/app.js')||legacy)queueMicrotask(()=>node.onload());}}};
 vm.runInNewContext(source,{window,document,console,fetch:async()=>({ok:true,json:async()=>manifest}),btoa:s=>Buffer.from(s,'binary').toString('base64')});
 for(let i=0;i<10;i++)await new Promise(setImmediate);
 return{window,scripts,timers,generation,named:name=>scripts.filter(node=>node.src.endsWith('/'+name)),register(ids){window.THEORY_ARTICLES||={};for(const id of ids)window.THEORY_ARTICLES[id]={id,sections:[]};}};
}
test('new publication defers all articles while old publications keep eager compatibility',async()=>{
 const fresh=await fixture();assert.equal(fresh.scripts.length,2);assert(fresh.named('app.js').length);assert(!fresh.named('theory-articles-0-6.js').length);
 const old=await fixture({legacy:true});assert.equal(old.named('theory-articles-0-6.js').length,1);assert.equal(old.named('theory-articles-7-12.js').length,1);
});
test('same group deduplicates, pins SRI and makes all its topics available',async()=>{
 const f=await fixture(),first=f.window.CourseAssets.loadTheory(0),second=f.window.CourseAssets.loadTheory(1),nodes=f.named('theory-articles-0-6.js');assert.equal(nodes.length,1);
 assert.equal(nodes[0].src,'/course-content/'+f.generation+'/theory-articles-0-6.js');assert(nodes[0].integrity.startsWith('sha256-'));
 f.register([0,1]);nodes[0].onload();await Promise.all([first,second]);await f.window.CourseAssets.loadTheory(1);assert.equal(f.named('theory-articles-0-6.js').length,1);
});
test('failure retries the same pinned group; unregistered article cannot become a silent short fallback',async()=>{
 const f=await fixture();let promise=f.window.CourseAssets.loadTheory(0);f.named('theory-articles-0-6.js')[0].onerror();await assert.rejects(promise,/unavailable/);
 promise=f.window.CourseAssets.loadTheory(0);f.named('theory-articles-0-6.js')[1].onload();await assert.rejects(promise,/not registered/);
 promise=f.window.CourseAssets.loadTheory(0);f.register([0]);f.named('theory-articles-0-6.js')[2].onload();await promise;
});
test('article loading stays independent of history and other topic groups; bad map entries reject',async()=>{
 const f=await fixture(),history=f.window.CourseAssets.load('changelog.js'),a=f.window.CourseAssets.loadTheory(0),b=f.window.CourseAssets.loadTheory(7);
 f.register([7]);f.named('theory-articles-7-12.js')[0].onload();await b;assert.equal(typeof f.named('changelog.js')[0].onload,'function');
 f.register([0]);f.named('theory-articles-0-6.js')[0].onload();await a;f.named('changelog.js')[0].onload();await history;
 for(const value of [-1,'__proto__','../app.js',999])await assert.rejects(f.window.CourseAssets.loadTheory(value),/Unsupported/);
 f.window.THEORY_MANIFEST.articles[8]={file:'app.js'};await assert.rejects(f.window.CourseAssets.loadTheory(8),/Unsupported/);
});
