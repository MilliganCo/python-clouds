const test=require('node:test'),assert=require('node:assert/strict');
const {createGameResults}=require('../static/game-results.js');
function fixture({storage,request}={}){
 const data=new Map();storage||={get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 let owner={user:'first',revision:1},counter=0;const timers=new Map(),calls=[];
 const response=body=>({ok:true,json:async()=>({ok:true,request_id:body.request_id,score:body.score,day:'2026-10-28',awarded:body.score,cap_left:30-body.score,best:body.score,replayed:false})});
 const api=createGameResults({capture:()=>({...owner}),isCurrent:value=>value.user===owner.user&&value.revision===owner.revision,
  request:async(path,options,bound)=>{const body=JSON.parse(options.body);calls.push({path,body,bound});return request?request(body,options,bound):response(body);},storage,
  randomId:()=>String(++counter).padStart(32,'0'),now:()=> '2026-10-28T12:00:00Z',schedule:(fn,ms)=>{const id=Symbol();timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id)});
 return{api,storage,calls,timers,setOwner(user){owner={user,revision:owner.revision+1};api.changed();},response};
}
test('a round is durable before HTTP; parallel sends share one request and receipt removes pending copy',async()=>{
 let finish;const f=fixture({request:()=>new Promise(resolve=>finish=resolve)}),saved=f.api.enqueue('blitz',5);
 assert(saved.durable);assert.equal(f.api.list().length,1);assert.equal(f.calls.length,0);
 const a=f.api.send(saved.entry.id),b=f.api.send(saved.entry.id);assert.equal(a,b);await Promise.resolve();assert.equal(f.calls.length,1);
 finish(f.response(f.calls[0].body));assert((await a).saved);assert.equal(f.api.list().length,0);assert.equal(f.api.state(saved.entry.id).status,'saved');
 assert((await f.api.send(saved.entry.id)).saved);assert.equal(f.calls.length,1);
});
test('lost response after commit is retried after reload with the identical key, without another award',async()=>{
 const receipts=new Map();let drops=0,lose=true;
 const request=async body=>{
  const replayed=receipts.has(body.request_id);if(!replayed){drops+=body.score;receipts.set(body.request_id,body);}
  if(lose){lose=false;throw new Error('Network lost after commit');}
  return{ok:true,json:async()=>({ok:true,...body,day:'2026-10-28',awarded:body.score,cap_left:30-drops,best:body.score,replayed})};
 };
 const first=fixture({request}),entry=first.api.enqueue('trace',7).entry;
 assert.equal((await first.api.send(entry.id)).saved,false);assert.equal(drops,7);
 const second=fixture({storage:first.storage,request});assert.equal(second.api.list()[0].entry.id,entry.id);
 const result=await second.api.send(entry.id);assert(result.saved&&result.result.replayed);assert.equal(drops,7);assert.equal(second.api.list().length,0);
});
test('HTTP errors and malformed success remain unconfirmed and preserve score',async()=>{
 for(const response of [{ok:false,json:async()=>({error:'HTTP500'})},{ok:true,json:async()=>({ok:true,awarded:5})}]){
  const f=fixture({request:async()=>response}),entry=f.api.enqueue('order',5).entry;
  assert.equal((await f.api.send(entry.id)).saved,false);assert.equal(f.api.state(entry.id).status,'unconfirmed');assert.equal(f.api.list()[0].entry.score,5);
 }
});
test('owner changes cannot confirm into another account or send its predecessor records',async()=>{
 let finish;const f=fixture({request:()=>new Promise(resolve=>finish=resolve)}),entry=f.api.enqueue('fill',4).entry;
 const pending=f.api.send(entry.id);await Promise.resolve();f.setOwner('second');assert.equal(f.api.list().length,0);
 finish(f.response(f.calls[0].body));assert.equal((await pending).saved,false);assert.equal(f.api.list().length,0);
 assert.equal((await f.api.send(entry.id)).saved,false);assert.equal(f.calls.length,1);
 f.setOwner('first');assert.equal(f.api.list()[0].entry.id,entry.id);
});
test('blocked storage uses an honest memory fallback; each record has its own key',async()=>{
 const blocked={get length(){throw new Error('blocked');},key(){},getItem(){throw new Error('blocked');},setItem(){throw new Error('quota');},removeItem(){throw new Error('blocked');}};
 const f=fixture({storage:blocked}),entry=f.api.enqueue('match',3);assert.equal(entry.durable,false);assert.equal(f.api.list().length,1);assert((await f.api.send(entry.entry.id)).saved);
 const normal=fixture();normal.api.enqueue('match',1);normal.api.enqueue('match',2);assert.equal(normal.storage.length,2);
});
test('timeout aborts transport but keeps the same round for explicit retry',async()=>{
 const f=fixture({request:(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('timeout'),{name:'AbortError'}))))});
 const entry=f.api.enqueue('blitz',2).entry,pending=f.api.send(entry.id);await Promise.resolve();
 const timer=[...f.timers.values()][0];assert.equal(timer.ms,15000);timer.fn();assert.equal((await pending).saved,false);assert.equal(f.api.list()[0].entry.id,entry.id);
});
