/** Client-side XP / rank — same formula as legacy app.js */

export const POINTS = {
  beginner: 10,
  intermediate: 20,
  advanced: 30,
  expert: 40,
} as const;

export type LevelKey = keyof typeof POINTS;

export const RANKS = [
  { name: "Новичок", min: 0 },
  { name: "Ученик", min: 60 },
  { name: "Практик", min: 180 },
  { name: "Разработчик", min: 380 },
  { name: "Инженер", min: 680 },
  { name: "Архитектор", min: 1100 },
  { name: "Мастер", min: 1700 },
] as const;

export type TaskXpMeta = {
  level: string;
  challenge?: boolean;
};

export type RankProgress = {
  xp: number;
  rankName: string;
  nextRankName: string | null;
  /** 0–100 for xp-fill width */
  fillPercent: number;
  solvedCount: number;
  totalTasks: number;
  statsLabel: string;
};

export function pointsFor(meta: TaskXpMeta): number {
  const base = POINTS[meta.level as LevelKey] ?? 10;
  return base * (meta.challenge ? 3 : 1);
}

export function computeXp(
  solvedIds: Iterable<string>,
  index: Map<string, TaskXpMeta>,
): number {
  let xp = 0;
  for (const id of solvedIds) {
    const meta = index.get(id);
    if (meta) xp += pointsFor(meta);
  }
  return xp;
}

export function computeRankProgress(
  solvedIds: string[],
  index: Map<string, TaskXpMeta>,
): RankProgress {
  const xp = computeXp(solvedIds, index);
  let rank: (typeof RANKS)[number] = RANKS[0]!;
  let next: (typeof RANKS)[number] | null = null;
  for (let i = 0; i < RANKS.length; i++) {
    if (xp >= RANKS[i]!.min) {
      rank = RANKS[i]!;
      next = RANKS[i + 1] ?? null;
    }
  }
  const fillPercent = next
    ? Math.min(1, (xp - rank.min) / (next.min - rank.min)) * 100
    : 100;
  const solvedCount = solvedIds.filter((id) => index.has(id)).length;
  const totalTasks = index.size;
  const statsLabel = next
    ? `решено ${solvedCount} / ${totalTasks} · до ранга «${next.name}»: ${next.min - xp} XP`
    : `решено ${solvedCount} / ${totalTasks} · максимальный ранг`;

  return {
    xp,
    rankName: rank.name,
    nextRankName: next?.name ?? null,
    fillPercent,
    solvedCount,
    totalTasks,
    statsLabel,
  };
}
