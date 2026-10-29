const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../static/editor-keys.js'),'utf8');
function fixture(mobile=true,reduced=false){
  const frames=new Map(),timers=new Map(),docListeners=new Map(),winListeners=new Map(),viewportListeners=new Map(),mediaListeners=new Map();let sequence=0,clock=0;
  let doc;
  class Node{
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.dataset={};this.handlers=new Map();this.hidden=false;this.isConnected=true;this.value='abc';this.selectionStart=this.selectionEnd=1;this.className='';
      const values=new Map();this.style={setProperty:(n,v)=>values.set(n,v),removeProperty:n=>values.delete(n),getPropertyValue:n=>values.get(n)};
      this.classList={contains:n=>this.className.split(/\s+/).includes(n),add:n=>{if(!this.classList.contains(n))this.className+=' '+n;},remove:n=>{this.className=this.className.split(/\s+/).filter(x=>x!==n).join(' ');},toggle:(n,on)=>{this.classList[on?'add':'remove'](n);}};
    }
    set readOnly(value){this.readonly=value;this.observer?.();}get readOnly(){return !!this.readonly;}
    setAttribute(n,v){this.attrs[n]=String(v);}getAttribute(n){return this.attrs[n];}
    appendChild(node){this.children.push(node);node.parent=this;return node;}
    replaceChildren(...nodes){for(const child of this.children)child.parent=null;this.children=[];for(const n of nodes)this.appendChild(n);}
    insertAdjacentElement(position,node){const a=this.parent.children;a.splice(a.indexOf(this)+(position==='afterend'?1:0),0,node);node.parent=this.parent;}
    contains(node){for(let n=node;n;n=n.parent)if(n===this)return true;return false;}
    closest(selector){for(let n=this;n;n=n.parent){if(selector.startsWith('[hidden]')&&(n.hidden||n.inert||n.attrs['aria-hidden']==='true'))return n;if(selector==='.sandbox-drawer.open'&&n.classList.contains('sandbox-drawer')&&n.classList.contains('open'))return n;}return null;}
    matches(){return ['TEXTAREA','INPUT'].includes(this.tagName)||this.attrs.contenteditable==='true';}
    addEventListener(n,f){const a=this.handlers.get(n)||[];a.push(f);this.handlers.set(n,a);}removeEventListener(n,f){this.handlers.set(n,(this.handlers.get(n)||[]).filter(x=>x!==f));}
    fire(type,fields={}){const e={type,target:this,prevented:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...fields};for(const f of this.handlers.get(type)||[])f(e);return e;}
    dispatchEvent(e){for(const f of this.handlers.get(e.type)||[])f(e);if(e.bubbles)emit(docListeners,e.type,{target:this});}
    focus(options){doc.activeElement=this;this.focusOptions=options;emit(docListeners,'focusin',{target:this});}
    click(){if(!this.disabled)this.fire('click');}
    setSelectionRange(a,b,direction){this.selectionStart=a;this.selectionEnd=b;this.selectionDirection=direction;}
    setRangeText(text,a,b){this.value=this.value.slice(0,a)+text+this.value.slice(b);this.setSelectionRange(a+text.length,a+text.length);}
    getBoundingClientRect(){if(this.classList.contains('editor-key-fab')){const shift=parseFloat(this.style.getPropertyValue('--editor-key-shift-y'))||0;return{top:window.fixedBottom-48+shift,bottom:window.fixedBottom+shift,width:48,height:48};}if(this.id==='sandboxFab')return{top:(window.mentorBottom??window.fixedBottom)-40,bottom:window.mentorBottom??window.fixedBottom,width:120,height:40};return{top:100,bottom:200};}scrollIntoView(){}
  }
  function listen(map){return(n,f)=>{const a=map.get(n)||[];a.push(f);map.set(n,a);};}
  function emit(map,n,e={}){for(const f of map.get(n)||[])f(e);return e;}
  const body=new Node('body'),html=new Node('html');html.appendChild(body);
  doc={body,documentElement:html,activeElement:body,createElement:tag=>new Node(tag),getElementById:id=>find(body,id),addEventListener:listen(docListeners)};
  const viewport={height:344,width:390,offsetTop:12,offsetLeft:7,scale:1,addEventListener:listen(viewportListeners)};
  const media={matches:mobile,addEventListener:listen(mediaListeners)};
  const window={innerHeight:844,innerWidth:390,fixedBottom:844,visualViewport:viewport,matchMedia:q=>q.includes('prefers-reduced-motion')?{matches:reduced}:media,addEventListener:listen(winListeners),requestAnimationFrame:f=>{frames.set(++sequence,f);return sequence;},cancelAnimationFrame:id=>frames.delete(id)};
  const context={window,document:doc,Event,Intl,setTimeout:(fn,ms)=>{timers.set(++sequence,{fn,at:clock+ms});return sequence;},clearTimeout:id=>timers.delete(id),MutationObserver:class{constructor(f){this.f=f;}observe(n){n.observer=this.f;}}};vm.createContext(context);vm.runInContext(source,context);
  const makeEditor=id=>{const n=body.appendChild(new Node('textarea'));n.id=id;n.className='editor';window.EditorKeys.bind(n);return n;};
  const editor=makeEditor('editor');const mentor=body.appendChild(new Node('button'));mentor.id='sandboxFab';mentor.className='sandbox-fab';
  const find=(node,id)=>node.id===id?node:node.children.map(n=>find(n,id)).find(Boolean);
  function flush(){for(let limit=0;frames.size;limit++){assert(limit<20);const current=[...frames.values()];frames.clear();current.forEach(f=>f());}}
  const ui=()=>find(body,'editorKeyFab'),keys=()=>find(body,'editorFloatingKeys'),toggle=()=>find(body,'editorKeysToggle');
  const visibleKey=(node,label)=>{if(node.hidden)return null;if(node.tagName==='BUTTON'&&node.textContent===label)return node;return node.children.map(n=>visibleKey(n,label)).find(Boolean);};
  const down=button=>{const fields={button:0,isPrimary:true,clientX:20,clientY:20,target:button};button.fire('pointerdown',fields);ui().fire('pointerdown',fields);return button;};
  return{window,doc,editor,media,viewport,makeEditor,ui,keys,toggle,flush,context,
    focus(n=editor){n.focus({preventScroll:true});flush();},
    open(){if(keys().hidden){ui().fire('keydown');toggle().click();}},press(label){const button=visibleKey(keys(),label);assert(button,label);ui().fire('keydown');button.click();return button;},
    down(label){return down(label==='⌨'?toggle():visibleKey(keys(),label));},
    up(button){ui().fire('pointerup');button.click();},
    tap(label){const button=down(visibleKey(keys(),label));ui().fire('pointerup');button.click();},
    tick(ms){clock+=ms;for(const[id,t]of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}},timers,
    more(){ui().fire('keydown');find(body,'editorKeysMore').click();},
    docEvent:(n,e)=>emit(docListeners,n,e),winEvent:n=>emit(winListeners,n),resize(){emit(viewportListeners,'resize');flush();},
    mediaChange(on){media.matches=on;emit(mediaListeners,'change');flush();},
    viewportScroll(){emit(viewportListeners,'scroll',{type:'scroll'});flush();},
    reinitialize(){vm.runInContext(source,context);},counts:()=>[docListeners.size,winListeners.size,viewportListeners.size],
  };
}
test('one lazily created body-level control; desktop and unfocused fields show none',()=>{
  const f=fixture(false);f.focus();assert.equal(f.ui(),undefined);assert.equal(f.editor.parent.children.filter(n=>n.className==='editor-touch-tools').length,0);
  f.mediaChange(true);assert.equal(f.ui().parent,f.doc.body);assert.equal(f.ui().hidden,false);assert.equal(f.keys().hidden,true);
  f.mediaChange(false);assert.equal(f.ui().hidden,true);
});
test('six primary keys plus second page; choosing inserts once and keeps palette/page/focus',()=>{
  const f=fixture();f.focus();let edits=0;f.editor.addEventListener('input',()=>edits++);f.open();
  assert.equal(f.toggle().getAttribute('aria-expanded'),'true');assert.equal(f.keys().children.filter(n=>!n.hidden).length,7);
  f.press(':');assert.equal(f.editor.value,'a:bc');assert.equal(edits,1);assert.equal(f.doc.activeElement,f.editor);assert.equal(f.keys().hidden,false);
  f.open();f.more();f.press('[]');assert.equal(f.editor.value,'a:[]bc');assert.equal(f.editor.selectionStart,3);assert.equal(f.keys().hidden,false);
  f.ui().fire('keydown');f.toggle().click();f.open();assert(f.keys().children.some(n=>n.textContent==='⇥'&&!n.hidden));
});
test('primary pointer keeps keyboard; secondary and non-primary pointers remain native',()=>{
  const f=fixture();f.focus();assert.equal(f.ui().fire('pointerdown',{button:0,isPrimary:true}).prevented,true);
  assert.equal(f.ui().fire('pointerdown',{button:2,isPrimary:true}).prevented,false);
  assert.equal(f.ui().fire('pointerdown',{button:0,isPrimary:false}).prevented,false);
});
test('mentor positioning class owns geometry; short windows only change menu layout and zoom hides controls',()=>{
  const f=fixture();f.focus();assert(f.ui().classList.contains('sandbox-fab'));assert.equal(f.ui().style.getPropertyValue('--fab-left'),undefined);assert.equal(f.ui().style.getPropertyValue('--fab-bottom'),undefined);
  f.viewport.height=180;f.resize();assert(f.ui().classList.contains('editor-key-compact'));assert.equal(f.ui().style.getPropertyValue('bottom'),undefined);
  f.viewport.height=100;f.resize();assert.equal(f.ui().style.getPropertyValue('top'),undefined);
  f.viewport.scale=2;f.resize();assert.equal(f.ui().hidden,true);assert.equal(f.viewport.scale,2);assert.equal(f.editor.value,'abc');
});

test('keyboard clipping is corrected from the measured box without repeated offset accumulation',()=>{
  const f=fixture();f.window.innerHeight=344;f.window.fixedBottom=844;f.viewport.height=344;f.viewport.offsetTop=0;f.focus();
  assert.equal(f.ui().getBoundingClientRect().bottom,332);
  for(let i=0;i<5;i++){f.resize();assert.equal(f.ui().getBoundingClientRect().bottom,332);}
  f.window.innerHeight=844;f.viewport.height=844;f.resize();assert.equal(f.ui().getBoundingClientRect().bottom,832);
});

test('late visual viewport events leave mentor native bottom anchoring unchanged',()=>{
  const f=fixture();f.viewport.offsetTop=0;f.viewport.height=844;f.window.innerHeight=344;f.window.fixedBottom=344;f.focus();
  assert.equal(f.ui().style.getPropertyValue('--fab-bottom'),undefined);
  f.viewport.height=344;f.resize();assert.equal(f.ui().style.getPropertyValue('--fab-bottom'),undefined);
  f.window.fixedBottom=844;f.resize();assert.equal(f.ui().style.getPropertyValue('--fab-bottom'),undefined);
});
test('blur, stdin, readonly and detached targets hide controls and cannot receive a stale action',()=>{
  const f=fixture();f.focus();f.open();const old=f.keys().children.find(n=>n.textContent===':');
  f.editor.readOnly=true;f.flush();old.click();assert.equal(f.ui().hidden,true);assert.equal(f.editor.value,'abc');
  f.editor.readOnly=false;f.focus();const stdin=f.doc.createElement('input');stdin.className='live-term-input';f.doc.body.appendChild(stdin);f.focus(stdin);assert.equal(f.ui().hidden,true);
  f.focus();f.editor.isConnected=false;f.resize();assert.equal(f.ui().hidden,true);old.click();assert.equal(f.editor.value,'abc');
});
test('Escape/outside/input preserve intent; route/page exit only suspend the palette',()=>{
  const f=fixture();f.focus();f.open();const escape={key:'Escape',preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};
  f.docEvent('keydown',escape);assert(escape.prevented&&escape.stopped);assert.equal(f.keys().hidden,false);
  f.open();f.docEvent('pointerdown',{target:f.doc.body});assert.equal(f.keys().hidden,false);
  f.open();f.docEvent('input',{target:f.editor});assert.equal(f.keys().hidden,false);
  f.open();const old=f.keys().children.find(n=>n.textContent===':');f.winEvent('hashchange');old.click();assert.equal(f.editor.value,'abc');assert.equal(f.ui().hidden,true);
  f.focus();assert.equal(f.keys().hidden,false);f.winEvent('pagehide');assert.equal(f.ui().hidden,true);
});
test('IME keeps the floating button visible but blocks edits until committed text is available',()=>{
  const f=fixture();f.focus();f.open();const button=f.keys().children.find(n=>n.textContent===':');
  f.editor.fire('compositionstart');f.flush();button.click();assert.equal(f.ui().hidden,false);assert.equal(f.toggle().disabled,false);assert.equal(button.disabled,true);assert.equal(f.keys().hidden,false);assert.equal(f.editor.value,'abc');
  f.editor.fire('compositionend');f.flush();assert.equal(f.ui().hidden,false);assert.equal(button.disabled,false);assert.equal(f.keys().hidden,false);
});
test('one owner/listener set survives repeated bind, module load and switching editor surfaces',()=>{
  const f=fixture();f.focus();const root=f.ui(),counts=f.counts();f.reinitialize();f.window.EditorKeys.bind(f.editor);f.open();
  const second=f.makeEditor('dailyEditor');f.focus(second);assert.equal(f.ui(),root);assert.equal(f.keys().hidden,false);
  f.open();f.press(':');assert.equal(f.editor.value,'abc');assert.equal(second.value,'a:bc');assert.deepEqual(f.counts(),counts);
});
test('layout viewport can be tall while keyboard clips code; explicit page reveal and inset reset work',()=>{
  const f=fixture();let top=319,bottom=459,scrolls=0;
  f.editor.getBoundingClientRect=()=>({top,bottom});
  f.window.scrollBy=(x,delta)=>{assert.equal(x,0);top-=delta;bottom-=delta;scrolls++;};
  f.focus();assert.equal(scrolls,1);assert(top>=f.viewport.offsetTop);assert(bottom<=f.viewport.offsetTop+f.viewport.height);
  assert.equal(f.doc.documentElement.style.getPropertyValue('--input-keyboard-inset'),'488px');
  assert(f.doc.body.classList.contains('editor-input-focus'));f.resize();assert.equal(scrolls,1);
  top=500;bottom=640;f.viewportScroll();assert.equal(scrolls,1,'Intentional page scrolling must not be pulled back to the editor');
  f.focus(f.doc.body);assert(!f.doc.body.classList.contains('editor-input-focus'));
  assert.equal(f.doc.documentElement.style.getPropertyValue('--input-keyboard-inset'),undefined);
});
test('short taps keep their action; long press shows variants and suppresses the release click',()=>{
  const f=fixture();f.focus();f.open();let edits=0;f.editor.addEventListener('input',()=>edits++);
  const short=f.down(':');f.tick(449);f.up(short);assert.equal(f.editor.value,'a:bc');assert.equal(edits,1);
  f.open();const held=f.down('()');f.tick(450);assert.equal(f.editor.value,'a:bc');assert.equal(f.keys().children.find(n=>n.id==='editorKeyAlternatives').hidden,false);
  assert(held.fire('touchend').prevented);assert(f.ui().fire('touchend').prevented);f.up(held);assert.equal(f.editor.value,'a:bc');assert.equal(f.keys().hidden,false);
  f.tap('[]');assert.equal(f.editor.value,'a:[]bc');assert.equal(edits,2);assert.equal(f.keys().hidden,false);
});
test('hold cancellation by move, pointercancel, IME, outside and route cannot insert or open a late menu',()=>{
  for(const kind of ['move','cancel','ime','outside','route']){
    const f=fixture();f.focus();f.open();f.down(':');
    if(kind==='move')f.ui().fire('pointermove',{clientX:40,clientY:20});
    if(kind==='cancel')f.ui().fire('pointercancel');
    if(kind==='ime')f.editor.fire('compositionstart');
    if(kind==='outside')f.docEvent('pointerdown',{target:f.doc.body});
    if(kind==='route')f.winEvent('hashchange');
    f.tick(1000);assert.equal(f.editor.value,'abc');assert.equal(f.timers.size,0);
    assert(f.keys().children.find(n=>n.id==='editorKeyAlternatives').hidden);
  }
});
test('keyboard context-menu exposes the same variants and back returns to ordinary keys',()=>{
  const f=fixture();f.focus();f.open();const key=f.keys().children.find(n=>n.textContent==='=');
  // This key is on the second page; keyboard context menus work once it is shown.
  f.more();assert(key.fire('contextmenu').prevented);assert.equal(f.editor.value,'abc');
  f.more();assert.equal(f.keys().children.find(n=>n.id==='editorKeyAlternatives').hidden,true);
  assert(f.keys().children.some(n=>n.textContent==='='&&!n.hidden));
});
test('holding the collapsed trigger offers quick inserts without a first unintended toggle/action',()=>{
  const f=fixture();f.focus();const held=f.down('⌨');f.tick(450);f.up(held);
  assert.equal(f.toggle().getAttribute('aria-expanded'),'true');assert.equal(f.editor.value,'abc');
  f.tap('print');assert.equal(f.editor.value,'aprint()bc');assert.equal(f.editor.selectionStart,7);
});
test('cancelled callbacks cannot replace another gesture or mutate another editor',()=>{
  const f=fixture();f.focus();f.open();f.down(':');const old=[...f.timers.values()][0].fn;
  const second=f.makeEditor('other');f.focus(second);f.open();f.down('()');old();assert.equal(f.timers.size,1);
  f.tick(450);assert.equal(second.value,'abc');assert.equal(f.editor.value,'abc');
});

test('touch release opens the palette before synthetic click; duplicate click cannot close it',()=>{
  const f=fixture();f.focus();const button=f.down('⌨');assert(button.classList.contains('is-pressed'));
  button.fire('pointerup',{pointerType:'touch'});assert.equal(f.toggle().getAttribute('aria-expanded'),'true');assert(!button.classList.contains('is-pressed'));
  button.fire('click');assert.equal(f.toggle().getAttribute('aria-expanded'),'true');
});

test('touch inserts once at pointer release, retains native focus and suppresses click-through',()=>{
  const f=fixture();f.focus();f.open();let edits=0;f.editor.addEventListener('input',()=>edits++);
  const button=f.down(':');button.fire('pointerup',{pointerType:'touch'});assert.equal(f.editor.value,'a:bc');assert.equal(edits,1);
  assert(f.ui().fire('touchend').prevented);button.fire('click');assert.equal(edits,1);assert.equal(f.doc.activeElement,f.editor);
});

test('moving a touch outside tap slop cancels press feedback and cannot insert on release/click',()=>{
  const f=fixture();f.focus();f.open();const button=f.down(':');f.ui().fire('pointermove',{clientX:40,clientY:20});
  assert(!button.classList.contains('is-pressed'));button.fire('pointerup',{pointerType:'touch'});button.fire('click');assert.equal(f.editor.value,'abc');
});
test('selection and native input keep the palette pinned until its close button is activated',()=>{
  const f=fixture();f.focus();f.open();f.press(':');assert.equal(f.keys().hidden,false);
  f.docEvent('input',{target:f.editor});f.docEvent('pointerdown',{target:f.doc.body});assert.equal(f.keys().hidden,false);
  const primary=f.keys().children.find(n=>n.textContent===':');f.more();primary.click();assert.equal(f.editor.value,'a:bc','A hidden key from the previous page cannot act');
  f.ui().fire('keydown');f.toggle().click();assert.equal(f.keys().hidden,true);
});
test('a valid tap has a short feedback class; reduced motion skips the pulse',()=>{
  for(const reduced of [false,true]){
    const f=fixture(true,reduced);f.focus();f.open();const key=f.keys().children.find(n=>n.textContent===':');f.press(':');
    assert.equal(key.classList.contains('is-tapped'),!reduced);
    key.fire('animationend');assert.equal(key.classList.contains('is-tapped'),false);
  }
});
