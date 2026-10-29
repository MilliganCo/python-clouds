const assert=require('node:assert/strict');
const m=require('../static/diagnostic.js');
const bank={all_pass_topic:13,no_evidence_topic:0,tasks:[{topic_id:3,starter_code:'a'},{topic_id:6,starter_code:'b'},{topic_id:7,starter_code:'c'},{topic_id:10,starter_code:'d'},{topic_id:18,starter_code:'e'}]};
const pass={error:null,check_stdout:'OK\n'};
const wrong={error:'AssertionError',failure:{source:'check',type:'AssertionError'}};
let entries=m.makeEntries(bank);
assert.equal(m.summarize(bank,entries).topic,0);
for(const neutral of [null,{blocked:true},{cancelled:true},{error:'network'},
  {error:'limit',failure:{source:'solution',type:'MemoryError'}},{error:null,check_stdout:null}]){
  assert.equal(m.record(entries[0],neutral,'private code'),'blocked');
  assert.equal(entries[0].attempts,0);assert.equal(entries[0].first,null);
}
m.record(entries[0],wrong,'first');m.record(entries[0],pass,'fixed');
assert.equal(entries[0].attempts,2);assert.equal(m.category(entries[0]),'repaired');
entries.slice(1).forEach(entry=>m.record(entry,pass,'correct'));
let summary=m.summarize(bank,entries);
assert.deepEqual(summary.counts,{first_pass:4,repaired:1,practice:0,unassessed:0});
assert.equal(summary.topic,3);assert.equal(summary.reason,'repaired');
entries=m.makeEntries(bank);entries.forEach(entry=>m.record(entry,pass,'correct'));
assert.equal(m.summarize(bank,entries).topic,13);
assert.equal(m.summarize(bank,entries).reason,'all_first_pass');
m.record(entries[2],wrong,'broken');
assert.equal(m.summarize(bank,entries).topic,7);
m.record(entries[2],{blocked:true},'infrastructure');
assert.equal(entries[2].attempts,2);assert.equal(m.category(entries[2]),'practice');
entries=m.makeEntries(bank);m.record(entries[0],pass,'correct');entries[1].skipped=true;
assert.equal(m.summarize(bank,entries).topic,6);
assert.equal(m.summarize(bank,entries).reason,'unassessed');
console.log('PASS diagnostic model: first/latest evidence, repaired versus first pass, neutral infrastructure/cancel, missing checks, partial and complete recommendations');
