/**
 * Port of legacy initLeavesFx (platform/static/app.js).
 * Requires `#skyFxLeaves` canvas inside `.sky-bg`.
 */
import { getLook } from "./lookPreferences";

type RGB = [number, number, number];
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  size: number;
  alpha: number;
  phase: number;
  mass: number;
  drag: number;
  glyph: string;
  color: RGB;
};

const GLYPHS = "*+x/\\<>~^.,'`%";
const PALETTES: Record<string, RGB[]> = {
  "": [
    [168, 190, 255],
    [120, 150, 230],
    [210, 222, 255],
    [140, 170, 240],
  ],
  sky_dawn: [
    [255, 176, 140],
    [240, 148, 118],
    [255, 210, 178],
    [220, 130, 110],
  ],
  sky_sunset: [
    [255, 140, 90],
    [220, 100, 100],
    [190, 90, 140],
    [255, 170, 120],
  ],
  sky_night: [
    [110, 130, 200],
    [80, 100, 170],
    [150, 165, 220],
    [90, 110, 180],
  ],
  sky_space: [
    [170, 150, 255],
    [110, 130, 220],
    [210, 190, 255],
    [140, 120, 220],
  ],
  sky_aurora: [
    [110, 240, 185],
    [130, 190, 255],
    [200, 145, 255],
    [150, 220, 210],
  ],
  sky_storm: [
    [150, 170, 200],
    [95, 115, 150],
    [190, 200, 220],
    [120, 140, 170],
  ],
};

const CURSOR_R = 150;
const REACTION = 1.35;
const REPULSION = 520;
const VORTEX = 200;
const WAKE = 280;

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
}

export function startLeavesFx(
  canvas: HTMLCanvasElement | null = typeof document !== "undefined"
    ? (document.getElementById("skyFxLeaves") as HTMLCanvasElement | null)
    : null,
): { stop: () => void } {
  if (!canvas || !canvas.getContext) return { stop: () => undefined };
  const el = canvas;
  const g = el.getContext("2d");
  if (!g) return { stop: () => undefined };
  const ctx = g;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let particles: Particle[] = [];
  let running = false;
  let rafId = 0;
  let lastTs = 0;
  let W = 0;
  let H = 0;
  let dpr = 1;
  const mouse = {
    x: -9999,
    y: -9999,
    px: -9999,
    py: -9999,
    vx: 0,
    vy: 0,
    svx: 0,
    svy: 0,
    ax: 0,
    ay: 0,
    activity: 0,
    wake: [] as Array<{ x: number; y: number; vx: number; vy: number; t: number }>,
  };

  function activePalette() {
    const sky = getLook("sky") || "";
    return PALETTES[sky] || PALETTES[""];
  }
  function symbolCount() {
    const w = window.innerWidth || 1000;
    const dens = Math.min(1.35, Math.max(0.9, +(getLook("fx_density") || "1")));
    let base = 24;
    if (w >= 1100) base = 44;
    else if (w >= 640) base = 35;
    return Math.round(base * dens);
  }
  function symbolScale() {
    return Math.min(1.35, Math.max(0.9, +(getLook("fx_scale") || "1.1")));
  }
  function spawn(fromTop: boolean): Particle {
    const pal = activePalette();
    const c = pal[(Math.random() * pal.length) | 0];
    const sc = symbolScale();
    return {
      x: Math.random() * W,
      y: fromTop ? -20 - Math.random() * 80 : Math.random() * H * 0.9,
      vx: (Math.random() - 0.5) * 28,
      vy: 14 + Math.random() * 36,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 2.2,
      size: (12 + Math.random() * 13) * sc,
      alpha: 0.28 + Math.random() * 0.32,
      phase: Math.random() * Math.PI * 2,
      mass: 0.75 + Math.random() * 0.5,
      drag: 0.8 + Math.random() * 0.5,
      glyph: GLYPHS[(Math.random() * GLYPHS.length) | 0],
      color: c,
    };
  }
  function recolor() {
    const pal = activePalette();
    particles.forEach((p) => {
      p.color = pal[(Math.random() * pal.length) | 0];
    });
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth || 1;
    H = window.innerHeight || 1;
    el.width = Math.floor(W * dpr);
    el.height = Math.floor(H * dpr);
    el.style.width = W + "px";
    el.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = symbolCount();
    if (particles.length !== n) {
      particles = Array.from({ length: n }, () => spawn(false));
    }
  }
  function updateMouse(dt: number) {
    const dx = mouse.x - mouse.px;
    const dy = mouse.y - mouse.py;
    const dist = Math.hypot(dx, dy);
    let ivx = dx / Math.max(dt, 1e-3);
    let ivy = dy / Math.max(dt, 1e-3);
    const spd = Math.hypot(ivx, ivy);
    if (spd > 4000) {
      ivx = (ivx / spd) * 4000;
      ivy = (ivy / spd) * 4000;
    }
    mouse.ax = (ivx - mouse.vx) / Math.max(dt, 1e-3);
    mouse.ay = (ivy - mouse.vy) / Math.max(dt, 1e-3);
    mouse.vx = ivx;
    mouse.vy = ivy;
    const k = 1 - Math.exp(-8 * dt);
    mouse.svx += (mouse.vx - mouse.svx) * k;
    mouse.svy += (mouse.vy - mouse.svy) * k;
    if (dist > 0.5) {
      const targetAct = Math.min(1, Math.hypot(mouse.svx, mouse.svy) / 900);
      mouse.activity += (targetAct - mouse.activity) * (1 - Math.exp(-10 * dt));
      mouse.wake.unshift({
        x: mouse.x,
        y: mouse.y,
        vx: mouse.svx,
        vy: mouse.svy,
        t: 0,
      });
      if (mouse.wake.length > 20) mouse.wake.length = 20;
    } else {
      mouse.activity *= Math.exp(-3.5 * dt);
      mouse.svx *= Math.exp(-4 * dt);
      mouse.svy *= Math.exp(-4 * dt);
    }
    for (const w of mouse.wake) w.t += dt;
    while (mouse.wake.length && mouse.wake[mouse.wake.length - 1]!.t > 0.35) {
      mouse.wake.pop();
    }
    mouse.px = mouse.x;
    mouse.py = mouse.y;
  }
  function sampleForce(px: number, py: number) {
    let fx = 0;
    let fy = 0;
    const dx = px - mouse.x;
    const dy = py - mouse.y;
    const dist = Math.hypot(dx, dy);
    if (dist < CURSOR_R * 2.5 && dist > 0.001) {
      const t = Math.min(1, dist / CURSOR_R);
      const falloff = 1 - smoothstep(0, 1, t);
      const inv = 1 / dist;
      const dirx = dx * inv;
      const diry = dy * inv;
      const tx = -diry;
      const ty = dirx;
      const speed = Math.hypot(mouse.svx, mouse.svy);
      const gust = Math.min(2.5, speed / 700);
      const nsp = speed > 1 ? 1 / speed : 0;
      fx += mouse.svx * nsp * (WAKE * 0.35 * gust * falloff * REACTION);
      fy += mouse.svy * nsp * (WAKE * 0.35 * gust * falloff * REACTION);
      const near = 1 - smoothstep(0, 0.55, t);
      fx += dirx * (REPULSION * near * REACTION);
      fy += diry * (REPULSION * near * REACTION);
      const vortexMask = smoothstep(0.15, 0.55, t) * (1 - smoothstep(0.55, 1, t));
      fx += tx * (VORTEX * vortexMask * (0.35 + gust) * REACTION);
      fy += ty * (VORTEX * vortexMask * (0.35 + gust) * REACTION);
      const accelMag = Math.min(1.5, Math.hypot(mouse.ax, mouse.ay) / 4000);
      fx += diry * (accelMag * 140 * falloff * REACTION);
      fy += -dirx * (accelMag * 140 * falloff * REACTION);
    }
    for (const w of mouse.wake) {
      const ddx = px - w.x;
      const ddy = py - w.y;
      const dLen = Math.hypot(ddx, ddy);
      const wakeR = CURSOR_R * 0.85;
      if (dLen >= wakeR || dLen < 0.001) continue;
      const age = Math.min(1, w.t / 0.35);
      const fall = (1 - smoothstep(0, 1, dLen / wakeR)) * (1 - age);
      const wsp = Math.hypot(w.vx, w.vy);
      if (wsp < 1) continue;
      fx += (w.vx / wsp) * (WAKE * fall * REACTION * 0.45);
      fy += (w.vy / wsp) * (WAKE * fall * REACTION * 0.45);
    }
    const act = 0.25 + 0.75 * mouse.activity;
    return { fx: fx * act, fy: fy * act };
  }
  function drawGlyph(p: Particle) {
    const [r, g, b] = p.color;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.font = `600 ${p.size}px ui-monospace, "Cascadia Code", Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(p.glyph, 0, 0);
    ctx.restore();
  }
  function symbolTick(ts: number) {
    if (!running) return;
    const dt = Math.min(0.05, (ts - (lastTs || ts)) / 1000);
    lastTs = ts;
    updateMouse(dt);
    ctx.clearRect(0, 0, W, H);
    const time = ts * 0.001;
    for (const p of particles) {
      const force = sampleForce(p.x, p.y);
      let ax = force.fx * p.mass;
      let ay = 55 * p.mass + force.fy * p.mass;
      ax += Math.sin(time * 1.7 + p.phase) * 10;
      ay += Math.cos(time * 1.1 + p.phase * 0.7) * 3;
      p.vx += ax * dt;
      p.vy += ay * dt;
      const drag = Math.exp(-1.35 * p.drag * dt);
      p.vx *= drag;
      p.vy *= drag;
      const spd = Math.hypot(p.vx, p.vy);
      if (spd > 520) {
        p.vx = (p.vx / spd) * 520;
        p.vy = (p.vy / spd) * 520;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.spin += Math.sin(time + p.phase) * 0.4 * dt;
      p.spin = Math.max(-3.5, Math.min(3.5, p.spin));
      p.rot += p.spin * dt;
      if (p.y > H + 40 || p.x < -80 || p.x > W + 80) {
        Object.assign(p, spawn(true));
      }
      drawGlyph(p);
    }
    rafId = requestAnimationFrame(symbolTick);
  }
  function start() {
    if (running || reduced.matches) return;
    running = true;
    resize();
    lastTs = 0;
    rafId = requestAnimationFrame(symbolTick);
  }
  function stopFx() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    ctx.clearRect(0, 0, W, H);
  }
  function sync(on: boolean) {
    if (on && !reduced.matches) start();
    else stopFx();
  }

  window.__leavesSync = sync;
  window.__leavesRecolor = recolor;
  window.__leavesRespawn = () => {
    if (running) {
      particles = [];
      resize();
    }
  };

  const onResize = () => {
    if (running) resize();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!running) return;
    if (mouse.x < -9000) {
      mouse.x = mouse.px = e.clientX;
      mouse.y = mouse.py = e.clientY;
      return;
    }
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  };
  const onPointerLeave = () => {
    mouse.activity *= 0.3;
  };
  const onVisibility = () => {
    if (document.hidden) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      lastTs = 0;
    } else if (running) {
      rafId = requestAnimationFrame(symbolTick);
    }
  };
  const onReduced = () => {
    sync(document.body.classList.contains("fx-leaves"));
  };

  window.addEventListener("resize", onResize);
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerleave", onPointerLeave, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  reduced.addEventListener("change", onReduced);
  sync(document.body.classList.contains("fx-leaves"));

  return {
    stop() {
      stopFx();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", onReduced);
      delete window.__leavesSync;
      delete window.__leavesRecolor;
      delete window.__leavesRespawn;
    },
  };
}
