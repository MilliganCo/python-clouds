const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){let now=0;const timeouts=[];const context=vm.createContext({window:{},performance:{now:()=>now},setInterval:()=>1,clearInterval(){},setTimeout:fn=>(timeouts.push(fn),timeouts.length),clearTimeout(){}});vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/minigame.js'),'utf8'),context);return{window:context.window,context,timeouts,time(value){now=value;}};}
test('mistake samples are actual answers, deduplicated and bounded; each round resets them',()=>{
 const f=fixture(),game=f.window.TraceGame;let result;
 game.start({onFinish:(score,review)=>result={score,review}});
 game._deck=Array.from({length:8},()=>({code:'x = 2',ask:'Чему равен x?',answer:'2',options:['2','3']}));game._idx=0;
 for(let i=0;i<5;i++)game.answer('3');game.finish();
 assert.equal(result.review.answers,5);assert.equal(result.review.mistakes.length,1);assert.equal(result.review.mistakes[0].chosen,'3');assert.equal(result.review.mistakes[0].expected,'2');
 game.start({onFinish:(score,review)=>result={score,review}});game.finish();assert.equal(result.review.answers,0);assert.equal(result.review.mistakes.length,0);
 game.start({onFinish:(score,review)=>result={score,review}});game._deck=Array.from({length:6},(_,i)=>({code:'x = '+i,ask:'Чему равен x?',answer:String(i)}));game._idx=0;
 for(let i=0;i<5;i++)game.answer('wrong');game.finish();assert.equal(result.review.mistakes.length,3);assert.equal(result.review.answers,5);
});
test('all five games pass their existing authored correct answer to the quiet review',()=>{
 const f=fixture();let review;
 const finish=game=>{game.finish();assert(review.mistakes.length>0);};
 const blitz=f.window.Blitz;blitz.start({onFinish:(_,r)=>review=r});const q=blitz._deck[0];blitz.answer(!q[1]);finish(blitz);assert.equal(review.mistakes[0].expected,q[1]?'Правда':'Ложь');
 const fill=f.window.FillGame;fill.start({onFinish:(_,r)=>review=r});const item=fill._deck[0];fill.answer('wrong');finish(fill);assert.equal(review.mistakes[0].expected,item.answer);
 const order=f.window.OrderGame;order.start({onFinish:(_,r)=>review=r});const expected=order._solution.join('\n');for(const line of [...order._solution].reverse())order.pick(line);finish(order);assert.equal(review.mistakes[0].expected,expected);
 const match=f.window.MatchGame;match.start({onFinish:(_,r)=>review=r});const left=match._left[0],right=match._right.find(c=>!match._pairs.some(p=>p[0]===left.value&&p[1]===c.value));match.pick('left',left.id);match.pick('right',right.id);finish(match);assert.equal(review.mistakes[0].expected,match._pairs.find(p=>p[0]===left.value)[1]);
});
test('late order callback cannot advance a later round',()=>{
 const f=fixture(),game=f.window.OrderGame;game.start({});for(const line of [...game._solution].reverse())game.pick(line);const late=f.timeouts.at(-1);game.finish();game.start({});const puzzle=game._puzzle;late();assert.equal(game._puzzle,puzzle);assert.equal(game._pi,0);
});
