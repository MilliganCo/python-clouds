/* Expected account for API work; auth hints contain no names, code or credentials. */
(function(root){
  'use strict';
  const HEADER='X-Pycloud-User',AUTH=new Set(['/api/login','/api/register','/api/account/recover','/api/account/deletion-status']);
  function clearOwnerStorage(user,stores){
    if(typeof user!=='string'||!user)return {ok:false,removed:0};
    const prefixes=[...new Set(['pycloud:u:'+user+':','pycloud:u:'+encodeURIComponent(user)+':','pycloud:workshop:'+user+':'])];
    let ok=true,removed=0;
    for(const storage of stores){try{const keys=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(prefixes.some(prefix=>key?.startsWith(prefix)))keys.push(key);}for(const key of keys){storage.removeItem(key);removed++;}}catch{ok=false;}}
    return {ok,removed};
  }
  const isApi=path=>typeof path==='string' && path.startsWith('/api/') && !path.startsWith('/api/v1/mobile/');
  function createLoadTrace(){
    const pending=new Set(),recent=[];
    const kinds={'/api/me':'session','/api/progress':'progress','/api/wallet':'wallet'};
    let droppedPending=0;
    const clock=()=>root.performance?.now?.()??Date.now();
    const elapsed=record=>Math.min(600000,Math.max(0,Math.round(((record.ended??clock())-record.started)/100)*100));
    const publicRecord=record=>({kind:record.kind,state:record.state,status:record.status,elapsedMs:elapsed(record)});
    function begin(path,opts){
      if(typeof path!=='string')return null;
      const method=opts?.method==null?'GET':typeof opts.method==='string'?opts.method.toUpperCase():'';
      const clean=path.split(/[?#]/,1)[0];
      const kind=method==='GET'?((Object.hasOwn(kinds,clean)?kinds[clean]:null)
        ||(/^\/api\/project-courses\/[a-z0-9_]+$/.test(clean)?'quest':null))
        :method==='POST'&&/^\/api\/project-courses\/[a-z0-9_]+\/start$/.test(clean)?'quest-start':null;
      if(!kind)return null;
      const record={kind,state:'pending',status:null,started:clock(),ended:null};
      pending.add(record);
      if(pending.size>8){pending.delete(pending.values().next().value);droppedPending=Math.min(999,droppedPending+1);}
      return {
        headers(status){record.status=Number.isInteger(status)&&status>=100&&status<=599?status:null;record.state='body';},
        finish(failed){
          if(record.ended!==null)return;
          record.ended=clock();record.state=failed?'failed':'finished';pending.delete(record);
          recent.push(publicRecord(record));if(recent.length>12)recent.shift();
        },
      };
    }
    return {begin,snapshot:()=>({pending:[...pending].map(publicRecord),recent:recent.map(record=>({...record})),droppedPending})};
  }
  function createSession({fetch:fetcher,notify=()=>{},clearLocal=()=>({ok:false,removed:0})}){
    let user='',revision=0,checking=null;
    const loadTrace=createLoadTrace();
    const changes=new Set(),invalidations=new Set();
    const capture=()=>Object.freeze({user,revision});
    const isCurrent=owner=>!owner || (owner.revision===revision && owner.user===user);
    const error=()=>Object.assign(new Error('Сессия изменилась. Войдите в нужный аккаунт заново.'),{status:409,code:'session_changed'});
    const assertCurrent=owner=>{if(!isCurrent(owner))throw error();};
    function setUser(value){
      user=String(value||'');revision++;
      changes.forEach(fn=>fn());
      return capture();
    }
    function invalidate(owner,deleted=false){
      if(!owner?.user || !isCurrent(owner))return;
      setUser('');
      const cleaned=deleted?clearLocal(owner.user):null;
      const message=deleted?'Аккаунт удалён. '+(cleaned.ok?'Локальные копии этого аккаунта в браузере очищены.':'Не все локальные копии удалось очистить. Очистите данные сайта в настройках браузера.') : error().message;
      invalidations.forEach(fn=>fn(message,{deleted,cleaned}));
    }
    function headersFor(owner,initial){
      const headers=new Headers(initial||{});
      if(owner?.user)headers.set(HEADER,encodeURIComponent(owner.user));
      const generation=root.PYCLOUD_CONTENT_GENERATION||root.document?.querySelector('meta[name="pycloud-content-generation"]')?.content;
      if(typeof generation==='string'&&/^[0-9a-f]{64}$/.test(generation))headers.set('X-Pycloud-Content',generation);
      return headers;
    }
    function boundOwner(path,owner){
      if(!isApi(path)||AUTH.has(path))return null;
      if(!owner?.user){
        if(path==='/api/me'||path==='/api/health')return null;
        throw error(); // A detached callback cannot become an anonymous/new-owner request.
      }
      return owner;
    }
    async function scopedFetch(path,opts={},owner=capture(),observation=null){
      const bound=boundOwner(path,owner);
      assertCurrent(bound);
      const response=await fetcher(path,{...opts,credentials:'same-origin',
        ...(bound?{headers:headersFor(bound,opts.headers)}:{})});
      observation?.headers(response.status);
      assertCurrent(bound);
      if(bound && (response.status===401||response.status===409)){
        const data=await response.clone().json().catch(()=>({}));
        assertCurrent(bound);
        if(response.status===401 || data.code==='session_changed'){
          invalidate(bound,data.code==='account_deleted');throw error();
        }
      }
      return response;
    }
    async function json(path,opts){
      const owner=boundOwner(path,capture());
      const observation=loadTrace.begin(path,opts);
      try{
        const response=await scopedFetch(path,opts,owner,observation);
        const data=await response.json().catch(()=>({}));
        assertCurrent(owner);
        if(!response.ok)throw Object.assign(new Error(data.error||'Ошибка'),{status:response.status,code:data.code});
        observation?.finish(false);
        return data;
      }catch(error){observation?.finish(true);throw error;}
    }
    async function verify(){
      const owner=capture();
      if(!owner.user)return false;
      if(checking?.revision===owner.revision)return checking.promise;
      const entry={revision:owner.revision,promise:null};
      checking=entry;
      entry.promise=(async()=>{
        try{
          const response=await fetcher('/api/me',{credentials:'same-origin',cache:'no-store'});
          const data=await response.json().catch(()=>({}));
          if(isCurrent(owner) && (response.status===401 || (response.ok&&typeof data.username==='string'&&data.username!==owner.user)))invalidate(owner,data.code==='account_deleted');
          return isCurrent(owner);
        }catch(_){return false;} // Offline is not evidence of another identity; keep drafts.
        finally{if(checking===entry)checking=null;}
      })();
      return entry.promise;
    }
    return Object.freeze({capture,isCurrent,setUser,headersFor,fetch:scopedFetch,json,verify,loadSnapshot:loadTrace.snapshot,
      deleted(owner){if(isCurrent(owner))invalidate(owner,true);else if(owner?.user)clearLocal(owner.user);notify();},
      announce(){notify();},
      onChange(fn){changes.add(fn);return()=>changes.delete(fn);},
      onInvalid(fn){invalidations.add(fn);return()=>invalidations.delete(fn);}});
  }
  if(typeof module==='object'&&module.exports)module.exports={createSession,HEADER,clearOwnerStorage};
  if(!root.document || !root.fetch)return;
  const nativeFetch=root.fetch.bind(root),key='pycloud:auth-hint:v1';
  const random=()=>{
    if(root.crypto?.getRandomValues){const bytes=new Uint8Array(16);root.crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
    return String(Date.now())+String(Math.random()); // Nonsecret wake-up hint, never an auth token.
  };
  const sender=random();let channel=null;
  try{if(root.BroadcastChannel)channel=new root.BroadcastChannel(key);}catch(_){}
  const session=createSession({fetch:nativeFetch,clearLocal(user){try{return clearOwnerStorage(user,[root.localStorage,root.sessionStorage]);}catch{return {ok:false,removed:0};}},notify(){
    const hint={kind:'auth',sender,nonce:random()};
    if(channel){channel.postMessage(hint);return;}
    try{root.localStorage.setItem(key,JSON.stringify(hint));}catch(_){}
  }});
  function receive(hint){
    if(hint?.kind==='auth' && typeof hint.sender==='string' && hint.sender!==sender && typeof hint.nonce==='string')void session.verify();
  }
  if(channel)channel.onmessage=event=>receive(event.data);
  root.addEventListener('storage',event=>{
    if(event.key!==key || !event.newValue)return;
    try{receive(JSON.parse(event.newValue));}catch(_){}
  });
  root.addEventListener('focus',()=>void session.verify());
  root.addEventListener('pageshow',()=>void session.verify());
  root.document.addEventListener('visibilitychange',()=>{if(!root.document.hidden)void session.verify();});
  root.LearningSession=session;
})(typeof window==='object'?window:globalThis);
