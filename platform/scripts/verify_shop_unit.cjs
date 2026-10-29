// Execute the actual selector/card renderer without DOM, network or learner data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const begin = source.indexOf('  function selectShopItems(');
const end = source.indexOf('  let shopPreviewTimer', begin);
assert.ok(begin > 0 && end > begin);
const wallet = {drops:100, owned:['owned'], freezes:2};
let known = true;
const context = vm.createContext({wallet, authEpoch:1, shopBuying:new Set(),
  SHOP_NOTES:{sky:'Меняет небо', banner:'Оформляет профиль'},
  getLook:()=>'', esc:value=>String(value), shopDisplayName:value=>value});
vm.runInContext('let walletKnownDrops=true;'+source.slice(begin,end),context);
const catalog = [['owned',{kind:'sky',price:10,title:'Небо: ёлка'}],
  ['cheap',{kind:'banner',price:80,title:'Обложка: геометрия'}],
  ['expensive',{kind:'sky',price:120,title:'Небо: лес'}],
  ['freeze',{kind:'consumable',price:60,title:'Заморозка'}]];
const keys = (...args) => Array.from(context.selectShopItems(catalog,...args), row=>row[0]);
assert.deepEqual(keys('all','ЕЛКА','catalog',false),['owned']);
assert.deepEqual(keys('all','небо лес','catalog',false),['expensive']);
assert.deepEqual(keys('all','','price-up',true),['freeze','cheap']);
assert.deepEqual(keys('owned','','catalog',true),[]);
assert.deepEqual(keys('profile','','catalog',false),['cheap']);
assert.deepEqual(keys('all','','price-down',false),['expensive','cheap','freeze','owned']);
assert.equal(catalog[0][0],'owned','sorting must preserve server catalog order');
vm.runInContext('walletKnownDrops=false;',context);
assert.deepEqual(keys('all','','catalog',true),[]);
assert.match(context.shopItemHtml('cheap',catalog[1][1]),/disabled/);
vm.runInContext('walletKnownDrops=true;',context);
assert.match(context.shopItemHtml('expensive',catalog[2][1]),/Не хватает 20 капель/);
assert.match(context.shopItemHtml('freeze',catalog[3][1]),/В запасе: 2/);
console.log('PASS shop selector: search normalization, intersections, prices, ownership, unknown balance, stock');
