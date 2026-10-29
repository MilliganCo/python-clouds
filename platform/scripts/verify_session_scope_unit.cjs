const assert=require('node:assert/strict');
const {createSession,HEADER,clearOwnerStorage}=require('../static/session-scope.js');
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
(async()=>{
  const calls=[];let notify=0,invalid=0;
  const session=createSession({fetch:async(path,opts)=>{calls.push({path,opts});return response({username:'first',value:1});},notify:()=>notify++});
  session.onInvalid(()=>invalid++);
  await session.json('/api/me');assert.equal(calls[0].opts.headers,undefined);
  await assert.rejects(session.json('/api/progress'),error=>error.code==='session_changed');
  session.setUser('ученик');
  await session.json('/api/progress');
  assert.equal(calls.at(-1).opts.headers.get(HEADER),encodeURIComponent('ученик'));
  const old=session.capture();session.setUser('second');
  await assert.rejects(session.fetch('/api/progress',{},old),error=>error.code==='session_changed');
  assert.equal(invalid,0,'late first-owner work must not invalidate the second owner');
  session.announce();assert.equal(notify,1);

  let release;
  const gate=new Promise(resolve=>release=resolve);
  const pending=createSession({fetch:async()=>new Response(new ReadableStream({async start(c){await gate;c.enqueue(new TextEncoder().encode('{"private":"first"}'));c.close();}}))});
  pending.setUser('first');const json=pending.json('/api/private');
  await new Promise(resolve=>setImmediate(resolve));pending.setUser('second');release();
  await assert.rejects(json,error=>error.code==='session_changed');
  assert.equal(pending.capture().user,'second');

  for(const [status,data] of [[401,{}],[409,{code:'session_changed'}]]){
    const s=createSession({fetch:async()=>response(data,status)});let clears=0;
    s.onInvalid(()=>clears++);s.setUser('first');
    await assert.rejects(s.json('/api/private'),error=>error.code==='session_changed');
    assert.equal(s.capture().user,'');assert.equal(clears,1);
  }
  const ordinaryConflict=createSession({fetch:async()=>response({error:'conflict',code:'version_conflict'},409)});
  ordinaryConflict.setUser('first');await assert.rejects(ordinaryConflict.json('/api/private'),error=>error.code==='version_conflict');
  assert.equal(ordinaryConflict.capture().user,'first');
  const updated=createSession({fetch:async()=>response({error:'reload',code:'content_changed'},409)});
  updated.setUser('first');let contentInvalidations=0;updated.onInvalid(()=>contentInvalidations++);
  await assert.rejects(updated.json('/api/private'),error=>error.code==='content_changed');
  assert.equal(updated.capture().user,'first');assert.equal(contentInvalidations,0);
  globalThis.PYCLOUD_CONTENT_GENERATION='a'.repeat(64);
  assert.equal(updated.headersFor(updated.capture()).get('X-Pycloud-Content'),'a'.repeat(64));
  delete globalThis.PYCLOUD_CONTENT_GENERATION;

  let identity='first';const verifying=createSession({fetch:async()=>identity===null?response({},401):response({username:identity})});
  verifying.setUser('first');const revision=verifying.capture().revision;
  assert.equal(await verifying.verify(),true);assert.equal(verifying.capture().revision,revision);
  identity='second';await verifying.verify();assert.equal(verifying.capture().user,'');
  const offline=createSession({fetch:async()=>{throw new Error('offline');}});
  offline.setUser('first');await offline.verify();assert.equal(offline.capture().user,'first');
  const saved=new Map([['pycloud:u:ученик:draft:task:0.1','secret'],['pycloud:u:'+encodeURIComponent('ученик')+':game-result:v1:a','score'],['pycloud:workshop:ученик:a','project'],['pycloud:u:ученик2:draft:a','other'],['pycloud:draft:legacy','unattributed']]);
  const storage={get length(){return saved.size;},key:i=>[...saved.keys()][i],removeItem:key=>saved.delete(key)};
  let deletedNotice=null;
  const erased=createSession({fetch:async()=>response({code:'account_deleted'},401),clearLocal:user=>clearOwnerStorage(user,[storage])});
  erased.setUser('ученик');erased.onChange(()=>saved.set('pycloud:workshop:ученик:last','last leave cache'));
  erased.onInvalid((message,details)=>deletedNotice={message,details});await erased.verify();
  assert.equal(erased.capture().user,'');assert(deletedNotice.details.deleted&&deletedNotice.details.cleaned.ok);
  assert.deepEqual([...saved.keys()],['pycloud:u:ученик2:draft:a','pycloud:draft:legacy']);
  const switched=createSession({fetch:async()=>response({}),clearLocal:user=>clearOwnerStorage(user,[storage])});
  switched.setUser('ученик');const previous=switched.capture();switched.setUser('ученик2');switched.deleted(previous);assert.equal(switched.capture().user,'ученик2');assert(saved.has('pycloud:u:ученик2:draft:a'));
  assert.equal(clearOwnerStorage('ученик',[{get length(){throw new Error('denied');}}]).ok,false);
  console.log('PASS deletion: exact raw/encoded owner cleanup after leave handlers, other owner and legacy copies preserved, denied storage reported');
  console.log('PASS session scope: encoded identity, no-owner/stale work rejected, late JSON suppressed without clearing new owner, actual session error versus ordinary conflict, same-user/offline verification preserves state');
})().catch(error=>{console.error(error);process.exitCode=1;});
