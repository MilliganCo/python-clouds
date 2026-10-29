// Probes are transport data here; actual CPython isolation has separate container tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const platform = path.resolve(__dirname, '..');
const root = path.dirname(platform);
const probes = require('../tests/fixtures/isolation_probes.json');
async function main() {
  let workers = 0, inputs = 0;
  const requests = [];
  const forbidden = () => { workers++; throw new Error('Unexpected browser runtime'); };
  const window = {};
  let acceptInput;
  const fetch = async (url, options) => {
    assert.equal(options.credentials, 'same-origin');
    const body = JSON.parse(options.body);
    requests.push({url,body});
    if (url.endsWith('/input')) { acceptInput(); return {ok:true}; }
    assert.equal(url, '/api/python/run');
    assert.deepEqual(Object.keys(body).sort(), ['check','code','interactive','reportTests']);
    const events = [{type:'job',id:'a'.repeat(32)}];
    if (body.interactive) events.push({type:'output',chunk:'remote-only\n'}, {type:'input_request'});
    const data = new TextEncoder().encode(events.map(e=>JSON.stringify(e)).join('\n')+'\n');
    const result = new TextEncoder().encode(JSON.stringify({type:'result',stdout:'remote-only\n',error:null,failure:null,user_stdout:null,check_stdout:null})+'\n');
    const input = new Promise(resolve => { acceptInput = resolve; });
    let part=0;
    return {ok:true,body:{getReader:()=>({read:async()=>{
      if (part++ === 0) return {done:false,value:data};
      if (part === 2) { if (body.interactive) await input; return {done:false,value:result}; }
      return {done:true};
    }})}};
  };
  const context={window,fetch,Worker:forbidden,AbortController,TextDecoder,TextEncoder,Uint8Array};
  vm.runInNewContext(fs.readFileSync(path.join(platform,'static/python-execution.js'),'utf8'),context,{timeout:500});
  vm.runInNewContext(fs.readFileSync(path.join(platform,'static/runner.js'),'utf8'),context,{timeout:500});
  for(const probe of probes) {
    const normal = await window.PyRunner.run(probe.code);
    assert.equal(normal.error,null,probe.name);
    assert.equal(normal.stdout,'remote-only\n');
    const out=[];
    const interactive = await window.PyRunner.runInteractive(probe.code,{
      onOutput:chunk=>out.push(chunk), onInputRequest:()=>{inputs++;return 'canary';}
    });
    assert.equal(interactive.error,null,probe.name);
    assert.equal(out.join(''),'remote-only\n');
  }
  assert.equal(inputs,probes.length);
  const runRequests=requests.filter(r=>r.url==='/api/python/run');
  assert.equal(runRequests.length,probes.length*2);
  for(let i=0;i<probes.length;i++) {
    assert.equal(runRequests[i*2].body.code,probes[i].code);
    assert.equal(runRequests[i*2+1].body.code,probes[i].code);
  }
  for(const file of ['platform/static/runner-worker.js','platform/frontend/public/runner-worker.js','platform/frontend/src/workers/runner-worker.js']) {
    const source=fs.readFileSync(path.join(root,file),'utf8');
    await assert.rejects(vm.runInNewContext('(async()=>{\n'+source+'\n})()',{
      self:{location:{href:'https://isolation.invalid/'},postMessage:forbidden},Worker:forbidden,importScripts:forbidden
    },{timeout:500}),/EXECUTION_BLOCKED/);
  }
  assert.equal(workers,0);
  const failed={window:{},fetch:async()=>({ok:false,json:async()=>({error:'safe refusal'})}),Worker:forbidden,AbortController,TextDecoder,TextEncoder,Uint8Array};
  vm.runInNewContext(fs.readFileSync(path.join(platform,'static/python-execution.js'),'utf8'),failed,{timeout:500});
  assert.equal((await failed.window.PythonExecutionClient.run('print(4)')).blocked,true);
  let lateAnswer, lateCalls=0;
  const terminal={window:{},fetch:async(url)=>{
    lateCalls++;
    assert.equal(url,'/api/python/run');
    const lines=[{type:'job',id:'b'.repeat(32)},{type:'input_request'},{type:'result',stdout:'',error:'time limit'}];
    let part=0;
    return {ok:true,body:{getReader:()=>({read:async()=>part<lines.length
      ? {done:false,value:new TextEncoder().encode(JSON.stringify(lines[part++])+'\n')} : {done:true}})}};
  },Worker:forbidden,AbortController,TextDecoder,TextEncoder,Uint8Array};
  vm.runInNewContext(fs.readFileSync(path.join(platform,'static/python-execution.js'),'utf8'),terminal,{timeout:500});
  const completed=await terminal.window.PythonExecutionClient.runInteractive('input()',{
    onInputRequest:()=>new Promise(resolve=>{lateAnswer=resolve;})
  });
  assert.equal(completed.error,'time limit');
  lateAnswer('discard this answer');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(lateCalls,1,'late input must never be sent after completion');
  let firstSent, secondSent, finishFirstPost, answerCount=0, part=0;
  const firstInput=new Promise(resolve=>{firstSent=resolve;});
  const secondInput=new Promise(resolve=>{secondSent=resolve;});
  const race={window:{},fetch:async(url,options)=>{
    if(url.endsWith('/input')) {
      assert.equal(JSON.parse(options.body).answer,String(answerCount));
      if(answerCount===1) return new Promise(resolve=>{finishFirstPost=()=>resolve({ok:true});firstSent();});
      secondSent();return {ok:true};
    }
    assert.equal(url,'/api/python/run');
    const encode=event=>({done:false,value:new TextEncoder().encode(JSON.stringify(event)+'\n')});
    return {ok:true,body:{getReader:()=>({read:async()=>{
      if(part++===0) return encode({type:'job',id:'c'.repeat(32)});
      if(part===2) return encode({type:'input_request'});
      if(part===3) {await firstInput;return encode({type:'input_request'});}
      if(part===4) {finishFirstPost();await secondInput;return encode({type:'result',stdout:'two inputs',error:null});}
      return {done:true};
    }})}};
  },Worker:forbidden,AbortController,TextDecoder,TextEncoder,Uint8Array};
  vm.runInNewContext(fs.readFileSync(path.join(platform,'static/python-execution.js'),'utf8'),race,{timeout:500});
  let timer;
  try {
    const sequential=await Promise.race([
      race.window.PythonExecutionClient.runInteractive('a=input(); b=input()', {onInputRequest:()=>String(++answerCount)}),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Second input prompt was lost')),3000);})
    ]);
    assert.equal(sequential.stdout,'two inputs');assert.equal(answerCount,2);
  } finally {clearTimeout(timer);}
  console.log(`PASS: ${probes.length} probes x 2 modes transported without execution; sequential-input race; pending-input timeout; late answer discarded; 3 blocked browser assets; fail-closed infrastructure`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
