/* Purchased skies: one transparent Canvas2D scene, no user data or application state. */
(function (root) {
  "use strict";
  if (root.SkyScenes) return;
  const skins = new Set(["sky_dawn", "sky_sunset", "sky_night", "sky_space", "sky_aurora", "sky_storm", "sky_lagoon", "sky_moon", "sky_forest", "sky_sakura", "sky_snow", "sky_desert", "sky_rain"]);
  const effects = new Set(['fx_fireflies','fx_snow','fx_meteors','fx_petals','fx_embers','fx_constellations']);
  const motion = root.matchMedia?.("(prefers-reduced-motion: reduce)");
  let canvas = null, ctx = null, skin = "", effect = "", paused = false, points = [], width = 1, height = 1, mobile = false;
  let frame = 0, lastTick = null, lastPaint = null, elapsed = 0, disposed = false;
  const tau = Math.PI * 2;

  function seeded(key) {
    let value = 2166136261;
    for (const char of key) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    return () => {
      value += 0x6D2B79F5;
      let n = Math.imul(value ^ value >>> 15, 1 | value);
      n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
      return ((n ^ n >>> 14) >>> 0) / 4294967296;
    };
  }
  function buildPoints() {
    const random = seeded(skin), density = Math.min(190, Math.max(mobile ? 62 : 110, Math.round(width * height / 8500)));
    const factor = effect ? .65 : ({ sky_space: 1, sky_night: .65, sky_aurora: .48, sky_moon: .4, sky_forest: .38, sky_storm: .42, sky_snow:.65, sky_rain:.7, sky_sakura:.4 }[skin] || .3);
    points = Array.from({ length: Math.round(density * factor) }, (_, index) => ({
      x: random(), y: random(), phase: random() * tau, speed: .6 + random() * .8,
      radius: [1, 1.5, 2][index % 3], bright: index % 13 === 0,
    }));
  }
  function ensureCanvas() {
    if (canvas) return true;
    const host = document.querySelector(".sky-bg");
    if (!host) return false;
    const node = document.createElement("canvas");
    const context = node.getContext?.("2d", { alpha: true });
    if (!context) return false;
    canvas = node; ctx = context;
    canvas.id = "skyThemeCanvas"; canvas.className = "sky-theme-canvas";
    canvas.setAttribute("aria-hidden", "true"); canvas.hidden = true;
    host.appendChild(canvas);
    return true;
  }
  function resize() {
    if (!canvas || (!skin && !effect) || disposed) return;
    const nextWidth = Math.max(1, root.innerWidth || 1), nextHeight = Math.max(1, root.innerHeight || 1);
    const ratio = Math.min(2, root.devicePixelRatio || 1, 4096 / nextWidth, 2160 / nextHeight, Math.sqrt(6000000 / (nextWidth * nextHeight)));
    const bufferWidth = Math.max(1, Math.round(nextWidth * ratio)), bufferHeight = Math.max(1, Math.round(nextHeight * ratio));
    if (width === nextWidth && height === nextHeight && canvas.width === bufferWidth && canvas.height === bufferHeight) return;
    width = nextWidth; height = nextHeight; mobile = width < 680;
    canvas.width = bufferWidth; canvas.height = bufferHeight;
    ctx.setTransform(bufferWidth / width, 0, 0, bufferHeight / height, 0, 0);
    buildPoints();
    if (!document.hidden) paint();
  }
  function disk(x, y, radius, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, radius, 0, tau); ctx.fill();
  }
  function glow(x, y, rx, ry, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, color); gradient.addColorStop(1, "rgba(0,0,0,0)");
    disk(0, 0, 1, gradient); ctx.restore();
  }
  function stars(time, strength = 1) {
    points.forEach((point, index) => {
      const x = point.x * width + Math.sin(time * .045 + point.phase) * 3;
      const y = point.y * height;
      const alpha = (.5 + .12 * Math.sin(time * .16 + point.phase)) * strength;
      if (point.bright) glow(x, y, 7, 7, `rgba(174,203,255,${alpha * .2})`);
      disk(x, y, point.radius, `rgba(${index % 5 === 0 ? "255,223,190" : "216,232,255"},${alpha})`);

    });
  }
  // Broad light and mist provide depth without turning the sky into an illustration.
  function mist(time, layers) {
    layers.forEach(([x, y, rx, ry, color], index) => {
      const drift = Math.sin(time * .035 + index * 1.7);
      glow(width * (x + drift * .018), height * (y + Math.cos(time * .022 + index) * .012),
        width * rx, height * ry, color);
    });
  }
  function space(time) {
    mist(time, [
      [.18, .2, .48, .5, "rgba(105,103,160,.13)"],
      [.86, .56, .4, .55, "rgba(74,111,132,.1)"],
    ]);
    stars(time, .75);
    // A distant orbit occasionally enters the edge of the view; no permanent rings.
    const presence = Math.pow(Math.max(0, Math.sin((time - 12) * Math.PI / 48)), 6);
    if (presence > .01) {
      const x = width * .94, y = height * .76, rx = width * .57, ry = height * .5;
      ctx.strokeStyle = `rgba(174,193,216,${presence * .1})`; ctx.lineWidth = .65;
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, -.22, Math.PI * .94, Math.PI * 1.62); ctx.stroke();
      const angle = Math.PI * 1.2 + time * .002;
      const dx = Math.cos(angle) * rx, dy = Math.sin(angle) * ry;
      disk(x + dx * Math.cos(-.22) - dy * Math.sin(-.22),
        y + dx * Math.sin(-.22) + dy * Math.cos(-.22), 1.5, `rgba(207,221,237,${presence * .5})`);
    }
  }
  function dawn(time) {
    mist(time, [
      [.06, .13, .55, .62, "rgba(255,229,190,.24)"],
      [.74, .42, .56, .32, "rgba(226,195,192,.14)"],
      [.35, .78, .6, .18, "rgba(222,218,231,.1)"],
    ]);
  }
  function sunset(time) {
    mist(time, [
      [.91, .32, .62, .57, "rgba(230,172,139,.2)"],
      [.18, .65, .6, .28, "rgba(179,155,183,.13)"],
    ]);
  }
  function aurora(time) {
    mist(time, [
      [.26, .13, .6, .4, "rgba(133,205,177,.19)"],
      [.76, .25, .48, .53, "rgba(137,160,197,.13)"],
    ]);
    stars(time, .3);
  }
  function storm(time) {
    mist(time, [
      [.17, .22, .65, .28, "rgba(22,36,50,.25)"],
      [.79, .48, .61, .25, "rgba(20,29,44,.3)"],
      [.42, .75, .72, .18, "rgba(171,186,199,.09)"],
    ]);
  }
  function lagoon(time) {
    mist(time, [
      [.14, .26, .57, .53, "rgba(189,228,216,.17)"],
      [.85, .7, .53, .4, "rgba(106,179,181,.14)"],
      [.44, .9, .65, .15, "rgba(185,221,217,.09)"],
    ]);
  }
  function silverMoon(time) {
    mist(time, [
      [.96, .12, .44, .6, "rgba(220,227,240,.19)"],
      [.31, .76, .65, .21, "rgba(174,190,211,.1)"],
    ]);
    stars(time, .28);
  }
  function forest(time) {
    for (let i = 0; i < 4; i++) glow(width * (.15 + i * .25) + Math.sin(time * .045 + i) * 20, height * (.45 + i * .12), width * .42, height * .15, "rgba(178,221,193,.17)");
    points.forEach((point, index) => {
      const x = point.x * width + Math.sin(time * .35 + point.phase) * 12;
      const y = height * .18 + point.y * height * .78 + Math.sin(time * .24 + point.phase) * 16;
      const alpha = .55 + .22 * Math.sin(time * .5 + point.phase), color = index % 3 === 0 ? "255,229,137" : "183,248,174";
      glow(x, y, 15, 15, `rgba(${color},${alpha * .3})`); disk(x, y, point.radius, `rgba(${color},${alpha})`);
    });
  }
  function particles(time, kind) {
    const colors = { snow:'223,239,255', rain:'172,200,224', petals:'255,202,216', dust:'255,217,145', fireflies:'206,244,160', lagoon:'157,237,228' };
    points.forEach((point,index)=>{
      const speed = kind==='rain' ? .11 : kind==='snow' ? .018 : kind==='fireflies' ? -.004 : .006;
      const y=((point.y+time*speed*point.speed)%1+1)%1*height;
      const x=((point.x+Math.sin(time*.12+point.phase)*(kind==='fireflies'?.035:.014)+1)%1)*width;
      const color=colors[kind] || colors.dust;
      if(kind==='rain'){
        ctx.strokeStyle=`rgba(${color},.23)`;ctx.lineWidth=.8;
        ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-3,y+10+point.radius*3);ctx.stroke();
      }else if(kind==='petals'){
        ctx.save();ctx.translate(x,y);ctx.rotate(point.phase+time*.12);
        const size=2+point.radius*1.5;
        ctx.fillStyle=`rgba(${index%3===0?'255,225,228':color},.65)`;
        ctx.beginPath();ctx.moveTo(-size,0);ctx.bezierCurveTo(-size,-size,size,-size,size,0);
        ctx.bezierCurveTo(size*.3,size,-size*.4,size*.5,-size,0);ctx.fill();ctx.restore();
      }else{
        const pulse=.35+.16*Math.sin(time*.5+point.phase);
        if(kind==='fireflies')glow(x,y,12+point.radius*4,12+point.radius*4,`rgba(${color},${pulse*.45})`);
        if(kind==='snow'&&index%7===0){
          ctx.save();ctx.translate(x,y);ctx.rotate(time*.06+point.phase);
          ctx.strokeStyle=`rgba(${color},.55)`;ctx.lineWidth=.8;ctx.beginPath();
          for(let arm=0;arm<3;arm++){const angle=arm*Math.PI/3,r=point.radius+2;ctx.moveTo(-Math.cos(angle)*r,-Math.sin(angle)*r);ctx.lineTo(Math.cos(angle)*r,Math.sin(angle)*r);}
          ctx.stroke();ctx.restore();
        } else disk(x,y,point.radius*(kind==='snow'?1.2:kind==='fireflies'?1:.8),`rgba(${color},${pulse})`);
      }
    });
  }
  function meteors(time) {
    points.slice(0,12).forEach(point=>disk(point.x*width,point.y*height,1,'rgba(210,231,255,.35)'));
    points.slice(0,4).forEach((point,index)=>{
      const phase=((time+index*6+point.phase)/26)%1;
      if(phase>.07)return;
      const progress=phase/.07,x=(point.x*.65+progress*.3)*width,y=(point.y*.4+progress*.18)*height;
      const length=mobile?54:95,alpha=Math.sin(progress*Math.PI)*.65;
      const trail=ctx.createLinearGradient(x-length,y-length*.5,x,y);
      trail.addColorStop(0,'rgba(147,190,249,0)');trail.addColorStop(1,`rgba(224,240,255,${alpha})`);
      ctx.strokeStyle=trail;ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(x-length,y-length*.5);ctx.lineTo(x,y);ctx.stroke();
      glow(x,y,7,7,`rgba(196,225,255,${alpha*.4})`);
    });
  }
  function auroraRibbons(time) {
    // Filled translucent curtains, folded across the sky; the lower hem carries
    // light and the upper fibres dissolve. The same scene is used by shop previews.
    const segments=mobile?180:280;
    for(let layer=0;layer<2;layer++){
      const hem=x=>height*(.55+layer*.17-x*.24+.13*Math.sin(x*5.7+layer*1.9+time*.045)
        +.055*Math.sin(x*13-layer+time*.08));
      for(let part=0;part<segments;part++){
        const u=part/segments,v=(part+1)/segments,x=u*width,y=hem(u),next=hem(v);
        const rise=height*(.38+.16*Math.sin(u*7+layer+time*.035));
        const intensity=.28+.12*Math.sin(u*9+layer*2+time*.13)+.09*Math.sin(u*190+layer+time*.06)**6;
        const light=ctx.createLinearGradient(x,y-rise,x,y+height*.025);
        light.addColorStop(0,'rgba(115,215,193,0)');
        light.addColorStop(.24,`rgba(190,150,221,${intensity*.25})`);
        light.addColorStop(.66,`rgba(65,211,167,${intensity*.9})`);
        light.addColorStop(.88,`rgba(159,255,205,${intensity*.8})`);
        light.addColorStop(1,'rgba(100,235,185,0)');
        ctx.fillStyle=light;ctx.beginPath();ctx.moveTo(x,y-rise);
        ctx.lineTo(v*width,next-rise);ctx.lineTo(v*width,next+height*.025);
        ctx.lineTo(x,y+height*.025);ctx.closePath();ctx.fill();
      }
    }
  }
  function contours(time,kind){
    const desert=kind==='dunes';
    for(let layer=0;layer<4;layer++){
      const y=height*(.61+layer*.1),bend=Math.sin(time*.016+layer)*height*.025;
      const fill=ctx.createLinearGradient(0,y,0,height);
      fill.addColorStop(0,desert?`rgba(${layer%2?'209,151,99':'241,193,134'},${.14+layer*.045})`:`rgba(130,226,218,${.08+layer*.035})`);
      fill.addColorStop(1,'rgba(12,31,49,0)');ctx.fillStyle=fill;
      ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(width*.3,y-height*.16+bend,width*.65,y+height*.18,width,y-height*.04);
      ctx.lineTo(width,height);ctx.lineTo(0,height);ctx.closePath();ctx.fill();
    }
  }
  function embers(time){
    points.slice(0,mobile?22:45).forEach((point,index)=>{
      const y=(1-((point.y+time*.015*point.speed)%1))*height;
      const x=point.x*width+Math.sin(time*.3+point.phase)*22;
      const alpha=.25+.25*Math.sin(point.phase+time*.4)**2;
      if(index%3===0)glow(x,y,11,15,`rgba(255,169,84,${alpha*.4})`);
      disk(x,y,point.radius,`rgba(255,${180+index%50},124,${alpha})`);
    });
  }
  function constellations(time){
    for(let cluster=0;cluster<(mobile?3:6);cluster++){
      const members=points.slice(cluster*4,cluster*4+4),anchor=members[0];if(!anchor)continue;
      const x=anchor.x*width,y=anchor.y*height;
      ctx.strokeStyle='rgba(174,218,240,.19)';ctx.lineWidth=.7;ctx.beginPath();
      members.forEach((point,index)=>{
        const px=x+Math.sin(point.phase+time*.018)*65,py=y+Math.cos(point.phase)*40;
        if(index)ctx.lineTo(px,py);else ctx.moveTo(px,py);
      });ctx.stroke();
      members.forEach(point=>disk(x+Math.sin(point.phase+time*.018)*65,y+Math.cos(point.phase)*40,point.radius,'rgba(210,237,255,.65)'));
    }
  }
  function paint() {
    if (!ctx || (!skin && !effect) || document.hidden || disposed) return;
    ctx.clearRect(0, 0, width, height);
    if (skin === "sky_space") space(elapsed);
    else if (skin === "sky_night") { mist(elapsed, [[.92, .12, .43, .55, "rgba(171,189,223,.11)"]]); stars(elapsed, .5); }
    else if (skin === "sky_dawn") dawn(elapsed);
    else if (skin === "sky_sunset") sunset(elapsed);
    else if (skin === "sky_aurora") aurora(elapsed);
    else if (skin === "sky_storm") storm(elapsed);
    else if (skin === "sky_lagoon") lagoon(elapsed);
    else if (skin === "sky_moon") silverMoon(elapsed);
    else if (skin === "sky_forest") forest(elapsed);
    else if (skin === "sky_sakura") { dawn(elapsed); particles(elapsed,'petals'); }
    else if (skin === "sky_snow") { silverMoon(elapsed); particles(elapsed,'snow'); }
    else if (skin === "sky_desert") { sunset(elapsed); contours(elapsed,'dunes');particles(elapsed,'dust'); }
    else if (skin === "sky_rain") { storm(elapsed); particles(elapsed,'rain'); }
    if(skin==='sky_dawn'||skin==='sky_sunset')particles(elapsed,'dust');
    else if(skin==='sky_storm')particles(elapsed,'rain');
    else if(skin==='sky_lagoon'){contours(elapsed,'water');particles(elapsed,'lagoon');}
    else if(skin==='sky_aurora')auroraRibbons(elapsed);
    else if(skin==='sky_moon'||skin==='sky_space')meteors(elapsed);
    if(effect==='fx_fireflies')particles(elapsed,'fireflies');
    else if(effect==='fx_snow')particles(elapsed,'snow');
    else if(effect==='fx_meteors')meteors(elapsed);
    else if(effect==='fx_petals')particles(elapsed,'petals');
    else if(effect==='fx_embers')embers(elapsed);
    else if(effect==='fx_constellations')constellations(elapsed);
  }
  function stop() {
    if (frame) root.cancelAnimationFrame(frame);
    frame = 0; lastTick = null; lastPaint = null;
  }
  function tick(time) {
    frame = 0;
    if ((!skin && !effect) || document.hidden || motion?.matches || paused || disposed) return;
    if (lastTick !== null) elapsed += Math.min(100, Math.max(0, time - lastTick)) / 1000;
    lastTick = time;
    if (lastPaint === null || time - lastPaint >= 1000 / 30 - .01) { paint(); lastPaint = time; }
    frame = root.requestAnimationFrame(tick);
  }
  function resume() {
    stop();
    if (!canvas) return;
    const active = !!(skin || effect) && !document.hidden && !disposed;
    canvas.hidden = !active;
    if (!active) { ctx.clearRect(0, 0, width, height); return; }
    paint();
    if (!motion?.matches && !paused) frame = root.requestAnimationFrame(tick);
  }
  function setSkin(key) {
    if (disposed) return;
    const next = typeof key === "string" && skins.has(key) ? key : "";
    if (next === skin && (!next || canvas)) return;
    skin = next;
    if (skin && ensureCanvas()) {
      canvas.dataset.scene = skin;
      resize(); buildPoints();
    }
    resume();
  }
  function setEffect(key) {
    if(disposed)return;
    const next=effects.has(key)?key:'';
    if(next===effect)return;
    effect=next;
    if((skin||effect)&&ensureCanvas()){canvas.dataset.effect=effect;resize();buildPoints();}
    resume();
  }
  function setPaused(value) { paused=!!value; resume(); }
  function preview(node,key){
    const cover={'banner_aurora':'sky_aurora','banner_valley':'sky_desert','banner_nebula':'sky_space'}[key];
    if(disposed||!node?.getContext||(!skins.has(key)&&!effects.has(key)&&!cover))return;
    const context=node.getContext('2d');if(!context)return;
    const saved={ctx,skin,effect,points,width,height,mobile,elapsed};
    try{
      ctx=context;width=cover?1200:480;height=cover?400:240;mobile=!cover;node.width=width;node.height=height;
      skin=cover||(skins.has(key)?key:'');effect=effects.has(key)?key:'';elapsed=2.4;buildPoints();paint();
      if(key==='banner_nebula')mist(elapsed,[[.8,.4,.32,.7,'rgba(223,139,93,.42)'],[.6,.65,.2,.45,'rgba(73,181,190,.35)'],[.91,.14,.22,.4,'rgba(248,199,139,.3)']]);
    }finally{({ctx,skin,effect,points,width,height,mobile,elapsed}=saved);}
  }
  function destroy() {
    stop(); disposed = true; skin = ""; effect = ""; points = [];
    root.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", resume);
    if (motion?.removeEventListener) motion.removeEventListener("change", resume);
    else motion?.removeListener?.(resume);
    canvas?.remove(); canvas = null; ctx = null;
  }
  root.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", resume);
  if (motion?.addEventListener) motion.addEventListener("change", resume);
  else motion?.addListener?.(resume);
  root.SkyScenes = Object.freeze({ setSkin, setEffect, setPaused, preview, destroy });
})(window);
