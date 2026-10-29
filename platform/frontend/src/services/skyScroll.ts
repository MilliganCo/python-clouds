/**
 * Port of legacy `initSkyScrollDarken` (platform/static/app.js).
 * Drives `.sky-bg` CSS vars `--scroll-p` / `--scroll-ease` via rAF (no scroll listener).
 */

export function computeSkyScrollEase(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): { p: number; ease: number } {
  const rawMax = scrollHeight - clientHeight;
  const minScroll = Math.max(160, Math.round(clientHeight * 0.28));
  let p = 0;
  let ease = 0;
  if (rawMax >= minScroll) {
    p = Math.min(1, Math.max(0, scrollTop / rawMax));
    // full black around 75% scroll — same formula as legacy
    ease = Math.min(1, Math.pow(Math.min(1, p / 0.75), 1.05));
  }
  return { p, ease };
}

export type SkyScrollHandle = {
  stop: () => void;
  /** Force recomputation (call after programmatic scrollTo / route change). */
  invalidate: () => void;
};

let activeHandle: SkyScrollHandle | null = null;

/** Invalidate the active sky scroll pump (route change / scroll reset). */
export function invalidateSkyScroll() {
  activeHandle?.invalidate();
}

export function startSkyScrollDarken(
  sky: HTMLElement | null = typeof document !== "undefined"
    ? document.querySelector(".sky-bg")
    : null,
): SkyScrollHandle {
  if (!sky) {
    const noop = { stop: () => undefined, invalidate: () => undefined };
    return noop;
  }
  const skyEl = sky;

  let lastEase = -1;
  let rafId = 0;
  let running = true;

  function updateSkyScroll() {
    const root = document.scrollingElement || document.documentElement;
    const { p, ease } = computeSkyScrollEase(
      root.scrollTop,
      root.scrollHeight,
      root.clientHeight,
    );
    if (Math.abs(ease - lastEase) < 0.0015) return;
    lastEase = ease;
    skyEl.style.setProperty("--scroll-p", p.toFixed(4));
    skyEl.style.setProperty("--scroll-ease", ease.toFixed(4));
  }

  function invalidate() {
    lastEase = -1;
    updateSkyScroll();
  }

  function pump() {
    if (!running) return;
    updateSkyScroll();
    rafId = requestAnimationFrame(pump);
  }

  window.addEventListener("resize", invalidate);
  window.addEventListener("hashchange", invalidate);
  rafId = requestAnimationFrame(pump);

  const handle: SkyScrollHandle = {
    invalidate,
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("hashchange", invalidate);
      if (activeHandle === handle) activeHandle = null;
    },
  };
  activeHandle = handle;
  return handle;
}
