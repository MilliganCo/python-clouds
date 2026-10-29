export type ChangelogEntry = {
  date: string;
  title: string;
  items: string[];
};

/**
 * Parse legacy `window.CHANGELOG = [...]` source (static/changelog.js).
 */
export function parseChangelogSource(source: string): ChangelogEntry[] {
  const marker = "window.CHANGELOG";
  const idx = source.indexOf(marker);
  if (idx < 0) throw new Error("CHANGELOG marker missing");
  const eq = source.indexOf("=", idx);
  if (eq < 0) throw new Error("CHANGELOG assignment missing");
  let i = eq + 1;
  while (i < source.length && /\s/.test(source[i]!)) i += 1;
  if (source[i] !== "[") throw new Error("CHANGELOG must start with [");

  let depth = 0;
  let inStr: '"' | "'" | "`" | null = null;
  let escaped = false;
  for (let k = i; k < source.length; k++) {
    const c = source[k]!;
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "[" || c === "{") depth += 1;
    else if (c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) {
        const jsonish = source.slice(i, k + 1);
        // changelog uses JS trailing-friendly array; JSON.parse after light cleanup
        const data = Function(`"use strict"; return (${jsonish});`)() as unknown;
        if (!Array.isArray(data)) throw new Error("CHANGELOG not an array");
        return data.map((row) => {
          if (
            typeof row !== "object" ||
            row === null ||
            typeof (row as { date?: unknown }).date !== "string" ||
            typeof (row as { title?: unknown }).title !== "string" ||
            !Array.isArray((row as { items?: unknown }).items)
          ) {
            throw new Error("Invalid CHANGELOG entry");
          }
          const items = (row as { items: unknown[] }).items;
          if (!items.every((x) => typeof x === "string")) {
            throw new Error("Invalid CHANGELOG items");
          }
          return {
            date: (row as { date: string }).date,
            title: (row as { title: string }).title,
            items: items as string[],
          };
        });
      }
    }
  }
  throw new Error("CHANGELOG array not closed");
}
