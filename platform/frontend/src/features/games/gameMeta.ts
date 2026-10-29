/** Game catalog + local best scores — same keys as legacy app.js */

export type ScoredGameId = "blitz" | "order" | "match" | "trace" | "fill";
export type GameId = ScoredGameId | "riddle";

export type GameMeta = {
  id: GameId;
  title: string;
  icon: string;
  sub: string;
  rules: string[];
  free?: boolean;
  bestKey?: string;
};

export const GAME_META: readonly GameMeta[] = [
  {
    id: "blitz",
    title: "Молния",
    icon: "?!",
    sub: "Правда или ложь об утверждениях Python",
    rules: [
      "Верный ответ +1 очко, ошибка −1.",
      "Очки превращаются в капли (до 15 в день).",
    ],
    bestKey: "pycloud:blitzbest",
  },
  {
    id: "order",
    title: "Порядок",
    icon: "1-2",
    sub: "Соберите программу из перемешанных строк",
    rules: [
      "Кликайте строки в правильном порядке.",
      "Собранная программа +3 очка.",
      "Очки — капли (до 15 в день).",
    ],
    bestKey: "pycloud:orderbest",
  },
  {
    id: "match",
    title: "Пары",
    icon: "<->",
    sub: "Соедините выражение с его результатом",
    rules: [
      "Кликните выражение, затем его значение.",
      "Пара +1 очко, промах −1.",
      "Очки — капли (до 15 в день).",
    ],
    bestKey: "pycloud:matchbest",
  },
  {
    id: "trace",
    title: "След",
    icon: "x=",
    sub: "Проследите переменную по коротким шагам кода",
    rules: [
      "Выберите итоговое значение.",
      "Верный ответ +1, ошибка −1.",
      "Очки — капли (до 15 в день).",
    ],
    bestKey: "pycloud:tracebest",
  },
  {
    id: "fill",
    title: "Пробел",
    icon: "_?",
    sub: "Выберите нужный оператор или встроенную функцию",
    rules: [
      "Один правильный вариант из четырёх.",
      "Верный ответ +1, ошибка −1.",
      "Очки — капли (до 15 в день).",
    ],
    bestKey: "pycloud:fillbest",
  },
  {
    id: "riddle",
    title: "Загадки",
    icon: "AI?",
    sub: "Переписка с ИИ: до 5 загадок в день, без капель",
    rules: [
      "ИИ загадывает до 5 загадок про Python в день.",
      "Отвечайте буквой A–D или короткой фразой.",
      "Награда не начисляется — только тренировка.",
      "Есть офлайн-запас загадок, если ИИ недоступен.",
    ],
    free: true,
  },
];

export function getGameMeta(id: string): GameMeta | null {
  return GAME_META.find((g) => g.id === id) ?? null;
}

export function readBest(key: string | undefined): number {
  if (!key) return 0;
  try {
    return +(localStorage.getItem(key) || 0) || 0;
  } catch {
    return 0;
  }
}

export function writeBest(key: string | undefined, value: number): void {
  if (!key) return;
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

export function isScoredGame(id: string): id is ScoredGameId {
  return id === "blitz" || id === "order" || id === "match" || id === "trace" || id === "fill";
}
