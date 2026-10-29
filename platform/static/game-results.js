/* Owner-bound round outbox. Only an acknowledged server receipt means saved. */
(function(root){
  'use strict';
  function createGameResults({capture,isCurrent,request,storage,randomId,now=()=>new Date().toISOString(),schedule=setTimeout,cancel=clearTimeout,Controller=AbortController}){
    const games=new Set(['blitz','order','match','trace','fill']),memory=new Map(),states=new Map(),inflight=new Map(),listeners=new Set();
    const prefix=owner=>'pycloud:u:'+encodeURIComponent(owner.user)+':game-result:v1:';
    const key=(owner,id)=>prefix(owner)+id;
    const notify=event=>{for(const listener of listeners)try{listener(event);}catch{}};
    const valid=entry=>entry&&/^[0-9a-f]{32}$/.test(entry.id)&&games.has(entry.game)&&Number.isInteger(entry.score)&&entry.score>=0&&entry.score<=1_000_000&&typeof entry.created==='string'&&entry.created.length<=40&&Array.isArray(entry.review)&&entry.review.length<=3&&entry.review.every(item=>item&&['prompt','chosen','expected'].every(field=>typeof item[field]==='string'&&item[field].length<=2400));
    function read(owner){
      const found=new Map();if(!owner?.user)return found;
      try{const start=prefix(owner);for(let i=0;i<storage.length;i++){
        const name=storage.key(i);if(!name?.startsWith(start))continue;
        try{const entry=JSON.parse(storage.getItem(name));if(valid(entry)&&name===key(owner,entry.id))found.set(entry.id,{entry,durable:true});}catch{}
      }}catch{}
      for(const [name,value] of memory)if(name.startsWith(prefix(owner)))found.set(value.entry.id,value);
      return found;
    }
    function list(game){
      const owner=capture();return [...read(owner).values()].filter(({entry})=>!game||entry.game===game)
        .sort((a,b)=>a.entry.created.localeCompare(b.entry.created)||a.entry.id.localeCompare(b.entry.id));
    }
    function find(owner,id){
      const name=key(owner,id);if(memory.has(name))return memory.get(name);
      try{const entry=JSON.parse(storage.getItem(name));if(valid(entry)&&entry.id===id)return{entry,durable:true};}catch{}
      return null;
    }
    function enqueue(game,score,review=[]){
      const owner=capture();if(!owner?.user)throw new Error('Войдите в аккаунт, чтобы сохранить результат.');
      const entry={id:randomId(),game,score,created:now(),review:review.slice(0,3).map(item=>Object.fromEntries(['prompt','chosen','expected'].map(field=>[field,String(item[field]??'').slice(0,2400)])))};
      if(!valid(entry))throw new Error('Неверный результат раунда.');
      const name=key(owner,entry.id),text=JSON.stringify(entry);let durable=false;
      try{storage.setItem(name,text);durable=storage.getItem(name)===text;}catch{}
      const value={entry,durable};memory.set(name,value);states.set(name,{status:'pending',durable});notify({type:'change',owner,entry});return value;
    }
    function state(id){
      const owner=capture(),name=key(owner,id),value=find(owner,id);let durable=false;
      try{durable=!!value&&storage.getItem(name)===JSON.stringify(value.entry);}catch{}
      return{...(states.get(name)||{status:'pending'}),durable};
    }
    function send(id){
      const owner=capture();if(!owner?.user)return Promise.resolve({saved:false,error:'Войдите в аккаунт.'});
      const name=key(owner,id);if(inflight.has(name))return inflight.get(name);
      const previous=states.get(name);if(previous?.status==='saved')return Promise.resolve({saved:true,result:previous.result});
      const found=find(owner,id);if(!found)return Promise.resolve({saved:false,error:'Сохранённая копия результата не найдена.'});
      const {entry,durable}=found;
      const promise=Promise.resolve().then(async()=>{
        const controller=new Controller();const timer=schedule(()=>controller.abort(),15000);
        states.set(name,{status:'saving',durable});notify({type:'change',owner,entry});
        try{
          const response=await request('/api/game/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game:entry.game,score:entry.score,request_id:entry.id}),signal:controller.signal},owner);
          let data;try{data=await response.json();}catch{throw new Error('Сервер не прислал подтверждение сохранения.');}
          if(!isCurrent(owner))throw new Error('Аккаунт изменился. Результат останется для прежнего владельца.');
          if(!response.ok)throw Object.assign(new Error(data.error||'Сервер пока не подтвердил сохранение.'),{status:response.status});
          if(data.ok!==true||data.request_id!==entry.id||data.score!==entry.score||typeof data.replayed!=='boolean'||!/^\d{4}-\d{2}-\d{2}$/.test(data.day)||!Number.isInteger(data.awarded)||data.awarded<0||data.awarded>30||!Number.isInteger(data.cap_left)||data.cap_left<0||data.cap_left>30||!Number.isInteger(data.best)||data.best<0)throw new Error('Получен неполный ответ. Сохранение пока не подтверждено.');
          memory.delete(name);try{storage.removeItem(name);}catch{}
          states.set(name,{status:'saved',durable,result:data});notify({type:'confirmed',owner,entry,result:data});notify({type:'change',owner,entry});
          return {saved:true,result:data};
        }catch(error){
          const message=error.name==='AbortError'?'Ответ сервера не пришёл вовремя.':error.name==='TypeError'?'Не удалось связаться с сервером.':error.message||'Не удалось связаться с сервером.';
          states.set(name,{status:'unconfirmed',durable,error:message});notify({type:'change',owner,entry});
          return {saved:false,error:message};
        }finally{cancel(timer);}
      });
      inflight.set(name,promise);promise.finally(()=>{if(inflight.get(name)===promise)inflight.delete(name);});return promise;
    }
    return Object.freeze({enqueue,list,state,send,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},changed(){notify({type:'change'});}});
  }
  if(typeof module==='object'&&module.exports)module.exports={createGameResults};
  if(!root.document||!root.LearningSession||root.GameResults)return;
  const storage={get length(){try{return root.localStorage.length;}catch{return 0;}},key:i=>root.localStorage.key(i),getItem:k=>root.localStorage.getItem(k),setItem:(k,v)=>root.localStorage.setItem(k,v),removeItem:k=>root.localStorage.removeItem(k)};
  root.GameResults=createGameResults({capture:()=>root.LearningSession.capture(),isCurrent:owner=>root.LearningSession.isCurrent(owner),request:(path,opts,owner)=>root.LearningSession.fetch(path,opts,owner),storage,
    randomId:()=>Array.from(root.crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')});
  root.LearningSession.onChange(()=>root.GameResults.changed());root.addEventListener('storage',()=>root.GameResults.changed());
})(typeof window==='object'?window:globalThis);
