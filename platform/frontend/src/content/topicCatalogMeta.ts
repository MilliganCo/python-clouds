/**
 * Catalog chrome metadata — hand-port from static/app.js
 * (TOPIC_SYMBOL / LEVEL_ORDER / LEVEL_TITLE / LEVEL_SUB).
 * Keep in sync via npm run check:legacy-drift.
 */

/** ASCII topic glyphs — no emoji, monospace-friendly */
export const TOPIC_SYMBOL: Readonly<Record<number, string>> = {
  0: "()",
  1: "x =",
  2: "7//2",
  3: "def",
  4: "'ab'",
  5: "T|F",
  6: "if:",
  7: "for",
  8: "[..]",
  9: "(..)",
  10: "{k:v}",
  11: "{ }",
  12: ">>>",
  13: "ret",
  14: "L>G",
  15: "*arg",
  16: "def=",
  17: "open",
  18: "try:",
  19: "[for]",
  20: "{for}",
  21: "sort",
  22: "λ x:",
  23: "math",
  24: "date",
  25: "f(f)",
  26: '"{}"',
  27: "next",
  28: "yld",
  29: "@dec",
  30: "f()f",
  31: "with",
  32: "class",
  33: "A(B)",
  34: "__x__",
  35: "@prop",
  36: "@data",
  37: ":int",
  38: "copy",
  39: "raise",
  40: "O(n)",
  41: "[a:b]",
  42: "zip",
  43: "{:f}",
  44: "cnt",
  45: "pep",
  46: "path",
  47: "rnd",
  48: "re",
  49: "csv",
  50: "cli",
  51: "sql",
};

export const LEVEL_ORDER = [
  "beginner",
  "intermediate",
  "advanced",
  "expert",
] as const;

export type CatalogLevel = (typeof LEVEL_ORDER)[number];

export const LEVEL_TITLE: Readonly<Record<CatalogLevel, string>> = {
  beginner: "Начальный уровень",
  intermediate: "Средний уровень",
  advanced: "Продвинутый уровень",
  expert: "Экспертный уровень",
};

export const LEVEL_SUB: Readonly<Record<CatalogLevel, string>> = {
  beginner: "Синтаксис с нуля, типы данных, первые программы",
  intermediate: "Функции глубже, файлы, включения, модули",
  advanced: "ООП, свойства, аннотации, устройство языка",
  expert: "Итераторы, генераторы, декораторы, магия и сложность",
};

export function topicSymbol(topicId: number): string {
  return TOPIC_SYMBOL[topicId] ?? "·";
}

export function isCatalogLevel(value: string): value is CatalogLevel {
  return (LEVEL_ORDER as readonly string[]).includes(value);
}
