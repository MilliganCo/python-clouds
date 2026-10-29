const assert=require('node:assert/strict');
const {parseFile,localCopies,scopeAllowed}=require('../static/learning-archive.js');
const server={payload:{format:'pycloud-learning-archive',owner:{username:'learner'}}};
assert.deepEqual(parseFile(server),{server,browser:null});
const file={format:'pycloud-learning-file',version:1,server,browser:{owner:'learner',entries:[
  {name:'draft:task:2.9',value:''},
  {name:'draft-sync:task:2.9',value:JSON.stringify({schema:1,record:{starter:'# template'}})},
  {name:'draft-sync:sandbox:copy:abc',value:JSON.stringify({schema:1,scope:'sandbox',code:null,starter:'# reset'})},
  {name:'draft-sync:sandbox:copy:future',value:JSON.stringify({schema:2,scope:'sandbox',code:'future'})},
]}};
assert.equal(parseFile(file).browser,file.browser);
assert.deepEqual(localCopies(file.browser),[{scope:'task:2.9',code:'',starter:'# template'},{scope:'sandbox',code:null,starter:'# reset'}]);
assert.equal(file.browser.entries[3].value,JSON.stringify({schema:2,scope:'sandbox',code:'future'}));
assert.throws(()=>parseFile({...file,version:2}));
assert.throws(()=>parseFile({...file,browser:{owner:'other',entries:[]}}));
assert.throws(()=>parseFile({...file,browser:{owner:'learner',entries:[{name:'password',value:'x'}]}}));
assert.throws(()=>parseFile({version:1,notes:[]}));
for(const scope of ['sandbox','task:2.9','atlas:my-task','daily:2026-10-21:expert'])assert.ok(scopeAllowed(scope));
for(const scope of ['../other','__proto__','user:other:sandbox','task:2.9<script>'])assert.equal(scopeAllowed(scope),false);
console.log('PASS archive file model: signed/raw wrapper, local empty/reset copies, future metadata preserved, scope and owner checks');
