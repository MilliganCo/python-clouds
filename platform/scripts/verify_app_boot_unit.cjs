// Real enterApp + wallet source, with only DOM/API/optional modules stubbed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
const wa=source.indexOf('  let wallet = '),wb=source.indexOf('  /* ── Скины / эффекты',wa);
const ea=source.indexOf('  async function enterApp('),eb=source.indexOf('  /* ── Факты дня',ea);
assert.ok(wa>=0&&wb>wa&&ea>=0&&eb>ea);
const nodes=Object.fromEntries(['userName','authView','appView','sandboxFab','footCount','dropsLabel'].map(id=>[id,{hidden:id==='appView',textContent:''}]));
const walletReads=[],achievementReads=[],statsOwners=[],routes=[],looks=[];let currentUser='';
const context={console,Set,authEpoch:1,lookUser:'',dailyAiCache:null,sandboxDraft:null,sandboxEditor:{},SANDBOX_STARTER:'',aiSubmitting:false,paintAIPreferences(){},
  earnedAchievements:{old:true},statsDates:['private-old-date'],serverStreak:99,solved:new Set(),taskXp:{},serverXp:null,
  RAW_TOPICS:[],TOPICS:[],ALL_TASKS:[],ITEM_TITLES:{},$:id=>nodes[id],
  document:{querySelectorAll:()=>[],body:{classList:{contains:()=>false}}},
  window:{LearningSession:{setUser:value=>{currentUser=value}},EntryDiagnostic:{reset(){}},OutputFiles:{clearAll(){}},
    CloudChest:{close(){}},EditorDrafts:{configure(){}},LearningArchive:{configure(){}},RuntimeHelp:{configure(){}},AIHelper:{configure(){}}},
  curriculum:{availableTopics:()=>[]},bindLocalDraft:()=>({destroy(){}}),
  syncLooksFromOwnership:()=>looks.push(currentUser),checkAchievements(){},renderList(){},
  route:()=>routes.push(currentUser),loadAchievements:()=>new Promise(resolve=>achievementReads.push(resolve)),
  api:async target=>{
    if(target==='/api/progress')return {solved:[],task_xp:{},xp:0,runtime_features:{}};
    if(target==='/api/wallet')return new Promise(resolve=>walletReads.push(resolve));
    if(target==='/api/stats'){statsOwners.push(currentUser);return {streak:0,solved:[]};}
    throw new Error('Unexpected API '+target);
  }};
vm.createContext(context);
vm.runInContext(source.slice(wa,wb)+'\n'+source.slice(ea,eb)+'\nthis.walletState=()=>({...wallet});',context);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  await context.enterApp('first');
  assert.deepEqual(routes,['first'],'route must run while wallet is pending');
  assert.equal(walletReads.length,1);assert.equal(nodes.dropsLabel.textContent,'—');assert.deepEqual(looks,[]);
  assert.deepEqual(Object.keys(context.earnedAchievements),[]);assert.equal(context.serverStreak,0);assert.equal(context.statsDates.length,0);
  await context.enterApp('second');
  assert.deepEqual(routes,['first','second']);assert.equal(walletReads.length,2);
  walletReads[0]({drops:999,freezes:1,owned:['private-old']});await settle();
  assert.equal(nodes.dropsLabel.textContent,'—');assert.deepEqual(looks,[]);assert.deepEqual(statsOwners,[]);
  assert.equal(achievementReads.length,0,'old-owner optional pipeline stops before a new API request');
  walletReads[1]({drops:10,freezes:0,owned:['new']});await settle();achievementReads[0]();await settle();
  assert.equal(nodes.dropsLabel.textContent,10);assert.deepEqual(looks,['second']);assert.deepEqual(statsOwners,['second']);
  assert.deepEqual(Array.from(context.walletState().owned),['new']);
  context.syncLooksFromOwnership=()=>{throw new Error('Synthetic unavailable local preferences')};
  await context.enterApp('third');walletReads[2]({drops:0,freezes:0,owned:[]});await settle();
  achievementReads[1]();await settle();
  assert.deepEqual(routes,['first','second','third']);
  assert.deepEqual(statsOwners,['second','third'],'optional preference failure cannot stop the rest of current-owner startup');
  console.log('PASS app boot: first route before optional wallet, unknown placeholder, cleared previous owner, guarded late wallet/achievements/stats');
})().catch(error=>{console.error(error);process.exitCode=1;});
