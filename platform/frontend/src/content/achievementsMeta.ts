/**
 * Achievement catalog — hand-port from static/achievements.js.
 * Earned keys come from GET /api/achievements; claim via POST.
 */
export type AchievementDef = {
  key: string;
  icon: string;
  title: string;
  desc: string;
};

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { key: "first_solve", icon: ">>", title: "Первый шаг", desc: "Решите первое задание" },
  { key: "ten_solved", icon: "x10", title: "Десятка", desc: "Решите 10 заданий" },
  { key: "fifty_solved", icon: "x50", title: "Полсотни", desc: "Решите 50 заданий" },
  { key: "hundred_solved", icon: "x100", title: "Сотня", desc: "Решите 100 заданий" },
  {
    key: "first_function",
    icon: "def",
    title: "Первая функция",
    desc: "Решите задание «написать функцию»",
  },
  {
    key: "beginner_done",
    icon: "[I]",
    title: "Фундамент",
    desc: "Закройте весь начальный уровень",
  },
  {
    key: "intermediate_done",
    icon: "[II]",
    title: "Уверенный рост",
    desc: "Закройте весь средний уровень",
  },
  {
    key: "advanced_done",
    icon: "[III]",
    title: "Верхние облака",
    desc: "Закройте весь продвинутый уровень",
  },
  {
    key: "expert_done",
    icon: "[IV]",
    title: "Эксперт облаков",
    desc: "Закройте весь экспертный уровень",
  },
  { key: "streak_3", icon: "d3", title: "Три дня подряд", desc: "Занимайтесь три дня подряд" },
  { key: "streak_7", icon: "d7", title: "Неделя в облаках", desc: "Серия из семи дней" },
  {
    key: "first_challenge",
    icon: "[!]",
    title: "Босс повержен",
    desc: "Пройдите первый челлендж темы",
  },
  { key: "blitz_15", icon: "15+", title: "Молниеносно", desc: "Наберите 15 очков в «Молнии»" },
  { key: "order_10", icon: "1-2", title: "Архитектор", desc: "Наберите 10 очков в «Порядке»" },
  { key: "match_10", icon: "<->", title: "Сапёр пар", desc: "Наберите 10 очков в «Парах»" },
  {
    key: "first_purchase",
    icon: "$0",
    title: "Первая покупка",
    desc: "Купите что-нибудь в магазине",
  },
  {
    key: "chest_5",
    icon: "[=]",
    title: "Кладоискатель",
    desc: "Откройте 5 ежедневных сундуков",
  },
];

export type AchievementState = {
  solved: ReadonlySet<string>;
  streak: number;
  byLevelDone: Record<string, boolean>;
  functionSolved: boolean;
  challengeSolved: boolean;
  blitzBest?: number;
  orderBest?: number;
  matchBest?: number;
};

/** Port of window.computeAchievements — excludes server-only keys. */
export function computeAchievementKeys(state: AchievementState): string[] {
  const n = state.solved.size;
  const out: string[] = [];
  if (n >= 1) out.push("first_solve");
  if (n >= 10) out.push("ten_solved");
  if (n >= 50) out.push("fifty_solved");
  if (n >= 100) out.push("hundred_solved");
  if (state.functionSolved) out.push("first_function");
  if (state.byLevelDone.beginner) out.push("beginner_done");
  if (state.byLevelDone.intermediate) out.push("intermediate_done");
  if (state.byLevelDone.advanced) out.push("advanced_done");
  if (state.byLevelDone.expert) out.push("expert_done");
  if (state.streak >= 3) out.push("streak_3");
  if (state.streak >= 7) out.push("streak_7");
  if (state.challengeSolved) out.push("first_challenge");
  if ((state.blitzBest ?? 0) >= 15) out.push("blitz_15");
  if ((state.orderBest ?? 0) >= 10) out.push("order_10");
  if ((state.matchBest ?? 0) >= 10) out.push("match_10");
  return out;
}
