/* Real scene module with a recording Canvas2D/RAF; no browser, network or storage. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/sky-scenes.js'), 'utf8');
const keys = ['sky_dawn', 'sky_sunset', 'sky_night', 'sky_space', 'sky_aurora', 'sky_storm', 'sky_lagoon', 'sky_moon', 'sky_forest','sky_sakura','sky_snow','sky_desert','sky_rain'];
function events(target = {}) {
  const listeners = new Map();
  return Object.assign(target, {
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    emit(name) { for (const callback of [...(listeners.get(name) || [])]) callback({ type: name }); },
    listenerCount() { return [...listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); },
  });
}
function createScene({ width = 1440, height = 900, reduced = false, contextAvailable = true, hostAvailable = true, legacyMotion = false } = {}) {
  const operations = [], queue = new Map(), host = { children: [], appendChild(node) { this.children.push(node); } };
  const gradient = (...args) => {
    args.forEach(value => assert(Number.isFinite(value), 'Gradient coordinates must be finite'));
    const value = { stops: [], addColorStop(offset, color) { this.stops.push([offset, color]); } };
    operations.push(['gradient', ...args, value]); return value;
  };
  const context = {};
  for (const name of ['save', 'restore', 'translate', 'scale', 'setTransform', 'clearRect', 'beginPath', 'closePath', 'arc', 'ellipse', 'fill', 'stroke', 'moveTo', 'lineTo', 'bezierCurveTo', 'clip', 'rotate']) {
    context[name] = (...args) => { for (const value of args) if (typeof value === 'number') assert(Number.isFinite(value), name + ': finite geometry'); operations.push([name, ...args]); };
  }
  context.createRadialGradient = context.createLinearGradient = gradient;
  const draw = new Proxy(context, { set(object, key, value) { operations.push([key, value]); object[key] = value; return true; } });
  let created = 0, nextFrame = 0;
  const document = events({ hidden: false,
    querySelector: selector => selector === '.sky-bg' && hostAvailable ? host : null,
    createElement(tag) {
      assert.equal(tag, 'canvas'); created++;
      return { width: 300, height: 150, hidden: false, dataset: {}, attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; }, getContext: () => contextAvailable ? draw : null,
        remove() { const index = host.children.indexOf(this); if (index >= 0) host.children.splice(index, 1); } };
    },
  });
  const motion = events({ matches: reduced });
  if (legacyMotion) {
    motion.addListener = callback => motion._add('change', callback);
    motion.removeListener = callback => motion._remove('change', callback);
    motion._add = motion.addEventListener; motion._remove = motion.removeEventListener;
    delete motion.addEventListener; delete motion.removeEventListener;
  }
  const window = events({ innerWidth: width, innerHeight: height, devicePixelRatio: 3, matchMedia: () => motion,
    requestAnimationFrame(callback) { const id = ++nextFrame; queue.set(id, callback); assert(queue.size <= 1, 'Only one scene RAF may be queued'); return id; },
    cancelAnimationFrame(id) { queue.delete(id); },
  });
  const sandbox = vm.createContext({ window, document, console,
    fetch() { throw new Error('No scene network access'); },
    localStorage: new Proxy({}, { get() { throw new Error('No scene storage'); } }),
  });
  vm.runInContext(source, sandbox);
  return { window, document, motion, host, operations, queue, sandbox, get created() { return created; },
    step(time) { const entry = queue.entries().next().value; assert(entry, 'Expected one scheduled frame'); queue.delete(entry[0]); entry[1](time); },
    clearOperations() { operations.length = 0; }, signature() { return JSON.stringify(operations); },
  };
}
const scene = createScene(), api = scene.window.SkyScenes;
assert(Object.isFrozen(api)); assert.deepEqual(Object.keys(api).sort(), ['destroy', 'preview', 'setEffect', 'setPaused', 'setSkin']);
assert.equal(scene.created, 0); assert.equal(scene.queue.size, 0);
for (const key of ['', null, undefined, '__proto__', 'sky_unknown', 'term_ice', {}]) api.setSkin(key);
assert.equal(scene.created, 0, 'Default/unknown choices do not allocate a canvas');
api.setSkin('sky_space');
assert.equal(scene.created, 1); assert.equal(scene.host.children.length, 1);
const canvas = scene.host.children[0];
assert.equal(canvas.id, 'skyThemeCanvas'); assert.equal(canvas.attributes['aria-hidden'], 'true');
assert.equal(canvas.hidden, false); assert.equal(canvas.dataset.scene, 'sky_space');
assert(canvas.width <= 1440 * 2 && canvas.height <= 900 * 2);
const starDisks = scene.operations.filter(op => op[0] === 'arc' && (op[1] !== 0 || op[2] !== 0) && op[3] <= 2);
assert(starDisks.length >= 110 && starDisks.length <= 380, 'Space has a visible, bounded star field');
for (const radius of [1, 1.5, 2]) assert(starDisks.some(op => op[3] === radius), 'Stars have 2/3/4 CSS pixel diameters');
assert(!scene.operations.some(op => op[0] === 'arc' && op[3] > 2), 'Space has no large hard celestial disks');
assert(!scene.operations.some(op => op[0] === 'lineTo'), 'Stars have no cross-shaped spikes');
const count = scene.operations.length; api.setSkin('sky_space');
assert.equal(scene.operations.length, count, 'Repeated application/navigation preserves scene state'); assert.equal(scene.queue.size, 1);
vm.runInContext(source, scene.sandbox); assert.equal(scene.window.SkyScenes, api, 'Repeated asset loading cannot add a second owner');
scene.clearOperations();
for (const time of [0, 16, 34, 50, 68]) scene.step(time);
assert.equal(scene.operations.filter(op => op[0] === 'clearRect').length, 3, 'Drawing is capped near 30 fps');
scene.clearOperations(); scene.step(102); const beforeHide = scene.signature();
scene.document.hidden = true; scene.document.emit('visibilitychange');
assert.equal(scene.queue.size, 0); assert.equal(canvas.hidden, true);
assert.equal(scene.operations.at(-1)[0], 'clearRect');
scene.clearOperations(); scene.document.hidden = false; scene.document.emit('visibilitychange');
assert.equal(scene.signature(), beforeHide, 'Visibility resume repaints the same phase without accumulated-time jump');
scene.clearOperations(); scene.step(50000);
assert.equal(scene.signature(), beforeHide, 'The first RAF after a long background interval cannot advance time');
scene.motion.matches = true; scene.motion.emit('change');
assert.equal(scene.queue.size, 0, 'Reduced motion has a static frame and no RAF');
const staticCount = scene.operations.length; api.setSkin('sky_space'); assert.equal(scene.operations.length, staticCount);
scene.window.innerWidth = 390; scene.window.innerHeight = 844; scene.clearOperations(); scene.window.emit('resize');
assert(canvas.width <= 780 && canvas.height <= 1688); assert.equal(scene.queue.size, 0);
const mobileStars = scene.operations.filter(op => op[0] === 'arc' && (op[1] !== 0 || op[2] !== 0) && op[3] <= 2);
assert(mobileStars.length < starDisks.length / 2, 'Small screens use fewer decorations');
scene.window.innerWidth = 12000; scene.window.innerHeight = 5000; scene.window.emit('resize');
assert(canvas.width <= 4096 && canvas.height <= 2160 && canvas.width * canvas.height <= 6010000, 'Large displays have bounded raster memory');
scene.motion.matches = false; scene.motion.emit('change'); assert.equal(scene.queue.size, 1);
api.setSkin('sky_invalid'); assert.equal(scene.queue.size, 0); assert.equal(canvas.hidden, true);
api.setSkin('sky_forest'); assert.equal(scene.created, 1, 'All skies reuse the same canvas');
api.destroy(); assert.equal(scene.host.children.length, 0); assert.equal(scene.queue.size, 0);
assert.equal(scene.window.listenerCount() + scene.document.listenerCount() + scene.motion.listenerCount(), 0);
api.setSkin('sky_space'); assert.equal(scene.created, 1, 'Destroy is terminal and cannot restart detached listeners');

const signatures = new Set();
for (const key of keys) {
  const first = createScene({ reduced: true }), second = createScene({ reduced: true });
  first.window.SkyScenes.setSkin(key); second.window.SkyScenes.setSkin(key);
  assert.equal(first.signature(), second.signature(), key + ': decoration is seeded and reproducible');
  signatures.add(first.signature()); assert.equal(first.queue.size, 0);
  if (key !== 'sky_forest') {
    assert(!first.operations.some(op => op[0] === 'arc' && op[3] > 3), key + ': no hard sun/moon/planet disks');
    const paints=first.operations.filter(op=>op[0]==='clearRect').length;
    assert(first.operations.length/paints<10000,key+': each authored frame stays bounded');
    if(key==='sky_aurora')assert(first.operations.filter(op=>op[0]==='fill').length>150,'Aurora is a filled layered curtain, not a few line strokes');
    if(key!=='sky_sakura')assert(!first.operations.some(op => op[0] === 'ellipse'), key + ': the static view has no permanent rings');
    assert(first.operations.some(op => op[0] === 'gradient' && op.at(-1).stops.some(([offset, color]) => offset === 1 && /rgba\([^)]*,\s*0\s*\)/.test(color))), key + ': soft glows fade to a transparent edge');
  }
  first.window.SkyScenes.destroy(); second.window.SkyScenes.destroy();
}
assert.equal(signatures.size, keys.length, 'Every sky keeps a distinct palette and atmosphere');
const orbitScene = createScene(); orbitScene.window.SkyScenes.setSkin('sky_space');
let orbitFrames = 0;
for (let frame = 0; frame <= 960; frame++) {
  orbitScene.clearOperations(); orbitScene.step(frame * 100);
  const ellipses = orbitScene.operations.filter(op => op[0] === 'ellipse');
  assert(ellipses.length <= 1, 'Space may show only one distant orbit per frame');
  assert(!orbitScene.operations.some(op => op[0] === 'arc' && op[3] > 2), 'Animation cannot introduce hard planets');
  assert(orbitScene.operations.filter(op=>op[0]==='lineTo').length<=4,'Only a bounded number of meteor trails');
  if (ellipses.length) {
    orbitFrames++;
    const [, x, y] = ellipses[0];
    assert(x <= 1440 * .25 || x >= 1440 * .75 || y <= 900 * .25 || y >= 900 * .75, 'The occasional orbit stays near an edge');
    const stroke = orbitScene.operations.find(op => op[0] === 'strokeStyle');
    const alpha = stroke?.[1].match(/,\s*([\d.]+)\)$/)?.[1];
    assert(alpha !== undefined && Number(alpha) <= .12, 'The occasional orbit remains faint');
  }
}
assert(orbitFrames < 960 / 2, 'The optional orbit stays absent for most of the cycle');
orbitScene.window.SkyScenes.destroy();
for (const options of [{ contextAvailable: false }, { hostAvailable: false }]) {
  const missing = createScene(options); missing.window.SkyScenes.setSkin('sky_space');
  assert.equal(missing.host.children.length, 0); assert.equal(missing.queue.size, 0); missing.window.SkyScenes.destroy();
}
const legacy = createScene({ legacyMotion: true }); legacy.window.SkyScenes.setSkin('sky_night');
legacy.motion.matches = true; legacy.motion.emit('change'); assert.equal(legacy.queue.size, 0); legacy.window.SkyScenes.destroy();
assert.equal(legacy.motion.listenerCount(), 0);
const overlay=createScene();
for(const effect of ['fx_fireflies','fx_snow','fx_meteors','fx_petals','fx_embers','fx_constellations']){
 overlay.window.SkyScenes.setEffect(effect);assert.equal(overlay.created,1);assert.equal(overlay.queue.size,1);
 overlay.window.SkyScenes.setPaused(true);assert.equal(overlay.queue.size,0,'User pause stops RAF');
 overlay.window.SkyScenes.setPaused(false);assert.equal(overlay.queue.size,1);
}
overlay.window.SkyScenes.setEffect('');assert.equal(overlay.queue.size,0);assert(overlay.host.children[0].hidden);
overlay.window.SkyScenes.destroy();assert.equal(overlay.queue.size,0);
const sample=createScene();sample.window.SkyScenes.setSkin('sky_space');
sample.clearOperations();sample.step(0);const unchanged=sample.signature();
const previewOps=[];const previewContext=new Proxy({}, {get:(_,name)=>name.startsWith('create')?()=>({addColorStop(){}}):()=>{},set:()=>true});
sample.window.SkyScenes.preview({getContext:()=>previewContext},'sky_aurora');
assert.equal(sample.created,1);assert.equal(sample.queue.size,1,'Thumbnail drawing cannot create an animation loop');
sample.clearOperations();sample.document.hidden=true;sample.document.emit('visibilitychange');sample.clearOperations();sample.document.hidden=false;sample.document.emit('visibilitychange');
assert.equal(sample.signature(),unchanged,'Thumbnail drawing preserves the live scene exactly');sample.window.SkyScenes.destroy();
console.log('PASS sky scenes: thirteen skies, six overlays, rich aurora, bounded geometry/raster/RAF, pure static previews, pause, reduced motion, resume, teardown and Canvas fallback');
