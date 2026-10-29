// Execute the real wallet block with controlled promises; no server/model/browser.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
const start=source.indexOf('  let wallet = '),end=source.indexOf('  /* ── Скины / эффекты',start);
assert.ok(start>=0&&end>start);
function harness(){
  const pending=[],label={textContent:''};
  let closed=0;
  const dialog={close:()=>{closed++;}};
  const context={authEpoch:1,ITEM_TITLES:{},$:id=>id==='shopPurchaseDialog'?dialog:label,document:{getElementById:()=>label,querySelectorAll:()=>[]},
    api:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),console};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end)+'\nthis.testWallet={setWallet,loadWallet,resetWallet,addOwnedItem,refreshWalletAfterReward,state:()=>({...wallet})};',context);
  return {pending,label,context,api:context.testWallet,closed:()=>closed};
}
(async()=>{
  const h=harness();h.api.setWallet({drops:200});
  const reading=h.api.loadWallet();h.api.setWallet({drops:240});
  h.pending[0].resolve({drops:200,freezes:1,owned:['sky_night']});await reading;
  assert.equal(h.api.state().drops,240,'late GET cannot overwrite a confirmed newer balance');
  assert.equal(h.api.state().freezes,1);assert.ok(h.api.state().owned.includes('sky_night'));
  const same=harness();same.api.resetWallet();
  assert.equal(same.closed(),1,'owner reset closes an open checkout');
  assert.equal(same.label.textContent,'—','unknown is not a made-up zero balance');
  const first=same.api.loadWallet(),second=same.api.loadWallet();
  assert.equal(first,second);assert.equal(same.pending.length,1,'identical reads coalesce');
  same.api.addOwnedItem('set_recent');
  same.pending[0].resolve({drops:0,freezes:0,owned:['older_item']});await first;
  assert.equal(same.label.textContent,0);assert.deepEqual(Array.from(same.api.state().owned).sort(),['older_item','set_recent']);

  const owner=harness();owner.api.setWallet({drops:999,owned:['private_old']});
  const oldRead=owner.api.loadWallet();owner.context.authEpoch++;owner.api.resetWallet();
  assert.equal(owner.label.textContent,'—');assert.deepEqual(Array.from(owner.api.state().owned),[]);
  const newRead=owner.api.loadWallet();owner.pending[0].resolve({drops:999,freezes:2,owned:['private_old']});
  assert.equal(await oldRead,false);assert.equal(owner.api.loadWallet(),newRead,'late cleanup cannot clear new-owner pending read');
  owner.pending[1].resolve({drops:10,freezes:0,owned:['new_item']});await newRead;
  assert.equal(owner.api.state().drops,10);assert.deepEqual(Array.from(owner.api.state().owned),['new_item']);

  const order=harness();const slower=order.api.loadWallet();order.api.setWallet({freezes:2});
  const newer=order.api.loadWallet();order.pending[1].resolve({drops:300,freezes:2,owned:['new']});await newer;
  order.pending[0].resolve({drops:100,freezes:0,owned:['old']});assert.equal(await slower,false);
  assert.equal(order.api.state().drops,300);assert.deepEqual(Array.from(order.api.state().owned),['new']);

  const reward=harness();reward.api.setWallet({drops:200});const beforeReward=reward.api.loadWallet();
  const afterReward=reward.api.refreshWalletAfterReward();assert.equal(reward.label.textContent,'—');
  reward.pending[0].resolve({drops:200,freezes:0,owned:[]});assert.equal(await beforeReward,false);
  reward.pending[1].resolve({drops:225,freezes:0,owned:[]});await afterReward;
  assert.equal(reward.api.state().drops,225,'relative reward refresh reads server total rather than adding locally');

  const failed=harness();failed.api.resetWallet();const broken=failed.api.loadWallet();failed.pending[0].reject(new Error('offline'));
  assert.equal(await broken,false);assert.equal(failed.label.textContent,'—');
  const retry=failed.api.loadWallet();assert.equal(failed.pending.length,2);
  failed.pending[1].resolve({drops:5,owned:'malformed'});assert.equal(await retry,false);assert.equal(failed.label.textContent,'—');
  console.log('PASS wallet boot state: owner reset/late response, coalescing, mutation clocks, inventory grants, unknown balance, authoritative rewards, errors and malformed reads');
})().catch(error=>{console.error(error);process.exitCode=1;});
