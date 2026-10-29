/** Shared look preferences — same localStorage keys as legacy app.js */

export const SKY_SKINS = [
  "sky_dawn",
  "sky_sunset",
  "sky_night",
  "sky_space",
  "sky_aurora",
  "sky_storm",
] as const;

export const FX_OVERLAYS = ["fx_leaves"] as const;

export const TERM_THEMES = [
  "term_phosphor",
  "term_amber",
  "term_ice",
  "term_lilac",
] as const;

export type LookKind =
  | "sky"
  | "term"
  | "fx"
  | "title"
  | "fx_scale"
  | "fx_density";

let lookUser = "";

export function setLookUser(username: string) {
  lookUser = username;
}

function lookStorageKey(kind: LookKind): string | null {
  return lookUser ? `pycloud:u:${lookUser}:${kind}` : null;
}

export function getLook(kind: LookKind): string | null {
  const k = lookStorageKey(kind);
  return k ? localStorage.getItem(k) : null;
}

export function setLook(kind: LookKind, value: string) {
  const k = lookStorageKey(kind);
  if (!k) return;
  if (value) localStorage.setItem(k, value);
  else localStorage.removeItem(k);
}

export function applySkin(key: string) {
  for (const k of SKY_SKINS) document.body.classList.remove("skin-" + k);
  if (key && (SKY_SKINS as readonly string[]).includes(key)) {
    document.body.classList.add("skin-" + key);
  }
  window.__leavesRecolor?.();
}

export function applyFx(key: string) {
  document.body.classList.toggle("fx-leaves", key === "fx_leaves");
  window.__leavesSync?.(key === "fx_leaves");
}

export function applyTermTheme(key: string) {
  for (const k of TERM_THEMES) document.body.classList.remove("theme-" + k);
  if (key && (TERM_THEMES as readonly string[]).includes(key)) {
    document.body.classList.add("theme-" + key);
  }
}

/** Apply stored sky / term / fx for the current look user. */
export function applyStoredLooks() {
  applySkin(getLook("sky") || "");
  applyTermTheme(getLook("term") || "");
  applyFx(getLook("fx") || "");
}

/**
 * Legacy syncLooksFromOwnership — drop applied looks the wallet no longer owns,
 * then re-apply remaining stored prefs.
 */
export function syncLooksFromOwnership(owned: readonly string[]) {
  const ownedSet = new Set(owned);
  for (const kind of ["sky", "term", "fx", "title"] as const) {
    const cur = getLook(kind);
    if (cur && !ownedSet.has(cur)) setLook(kind, "");
  }
  applyStoredLooks();
}

/** Strip shop catalog prefixes for display (legacy shopDisplayName). */
export function shopDisplayName(title: string, kind: string): string {
  const prefixes: Record<string, RegExp> = {
    sky: /^Небо:\s*/i,
    term: /^Терминал:\s*/i,
    title: /^Титул:\s*/i,
    premium: /^Премиум-профиль:\s*/i,
    fx: /^Эффект:\s*/i,
  };
  const re = prefixes[kind];
  return re ? String(title || "").replace(re, "") : String(title || "");
}

/** Active title label from look prefs + catalog title strings. */
export function activeTitleLabel(
  titles: Record<string, string>,
): string | null {
  const key = getLook("title");
  if (!key) return null;
  const raw = titles[key];
  if (!raw) return key;
  return shopDisplayName(raw, "title");
}

declare global {
  interface Window {
    __leavesSync?: (on: boolean) => void;
    __leavesRecolor?: () => void;
    __leavesRespawn?: () => void;
  }
}
