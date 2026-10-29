/** Port of platform/static/app.js grading helpers (no DOM). */

const SET_RE = /\{[^{}]*\}/g;

export function collapse(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

export function looseLineEq(exp: string, got: string): boolean {
  const eSets = exp.match(SET_RE) || [];
  const gSets = got.match(SET_RE) || [];
  if (!eSets.length || eSets.length !== gSets.length) {
    return collapse(exp) === collapse(got);
  }
  if (collapse(exp.replace(SET_RE, "\u0000")) !== collapse(got.replace(SET_RE, "\u0000"))) {
    return false;
  }
  const items = (s: string) =>
    s
      .slice(1, -1)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .sort();
  return eSets.every((es, i) => {
    const a = items(es);
    const b = items(gSets[i]);
    return a.length === b.length && a.every((v, j) => v === b[j]);
  });
}

export function splitLines(s: string): string[] {
  const arr = String(s ?? "")
    .replace(/\r/g, "")
    .split("\n");
  while (arr.length && !arr[arr.length - 1].trim()) arr.pop();
  while (arr.length && !arr[0].trim()) arr.shift();
  return arr;
}

export function outputsEqual(expected: string, got: string): boolean {
  const e = splitLines(expected);
  const g = splitLines(got);
  return e.length === g.length && e.every((line, i) => looseLineEq(line, g[i]));
}
