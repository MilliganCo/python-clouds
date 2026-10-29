const assert = require('node:assert/strict');
const c = require('../static/curriculum.js');
const topics = [
  {id: 0, tasks: [{id: '0.1'}, {id: '0.2'}]},
  {id: 52, track: 'tools', tasks: [{id: '52.1'}]},
  {id: 1, tasks: [{id: '1.1'}]},
  {id: 53, track: 'tools', tasks: [{id: '53.1'}]},
];
assert.deepEqual(c.topicsIn(topics, 'python').map(t => t.id), [0, 1]);
assert.deepEqual(c.topicsIn(topics, 'tools').map(t => t.id), [52, 53]);
assert.equal(c.nextTask(topics, {id:'0.2'}).id, '1.1');
assert.equal(c.nextTask(topics, {id:'1.1'}), null);
assert.equal(c.nextTask(topics, {id:'52.1'}).id, '53.1');
assert.equal(c.nextTask(topics, {id:'53.1'}), null);
assert.equal(c.nextTask(topics, {id:'missing'}), null);
assert.equal(c.nextTask(topics, {id:'52.boss', challenge:true}), null);
assert.equal(c.nextTopic(topics, topics[0]).id, 1);
assert.equal(c.nextTopic(topics, topics[2]), null);
assert.equal(c.fromHash('#/topics/tools'), 'tools');
assert.equal(c.href(c.branchOf(topics[1])), '#/topics/tools');
assert.equal(c.fromHash('#/topics'), 'python');
assert.deepEqual(c.availableTopics(topics,{'0.1':10,'0.2':10,'1.1':10}).map(t=>t.id),[0,1]);
assert.deepEqual(c.availableTopics(topics,{'52.1':10}).map(t=>t.id),[52]);
assert.equal(c.availableTopics(topics,undefined),topics);
console.log('PASS curriculum: branch membership, direct links, task/topic boundaries, missing/challenge IDs');
