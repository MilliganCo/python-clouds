import {
  ACHIEVEMENTS,
  computeAchievementKeys,
  type AchievementState,
} from "../content/achievementsMeta";
import {
  contentRepository,
  type ContentRepository,
} from "../content/ContentRepository";
import { LEVEL_ORDER } from "../content/topicCatalogMeta";
import { apiGet, apiPost } from "./api";
import { flyDrops } from "./flyDrops";
import {
  parseAchievements,
  parseStats,
  parseWallet,
  ContractError,
} from "./parse";
import { emitDrops } from "./walletEvents";
import {
  showAchievementToast,
  showSetUnlockedToast,
} from "./toast";

function readBestKey(key: string): number {
  try {
    return +(localStorage.getItem(key) || 0) || 0;
  } catch {
    return 0;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type SetUnlocked = {
  set: string;
  item: string;
  item_title: string;
};

export type AchievementClaimResult = {
  ok: true;
  new: boolean;
  bonus: number;
  sets_unlocked: SetUnlocked[];
};

export function parseAchievementClaim(value: unknown): AchievementClaimResult {
  if (!isObject(value) || value.ok !== true) {
    throw new ContractError("Invalid POST /api/achievements/claim");
  }
  const sets: SetUnlocked[] = [];
  if (Array.isArray(value.sets_unlocked)) {
    for (const row of value.sets_unlocked) {
      if (
        !isObject(row) ||
        typeof row.set !== "string" ||
        typeof row.item !== "string" ||
        typeof row.item_title !== "string"
      ) {
        continue;
      }
      sets.push({ set: row.set, item: row.item, item_title: row.item_title });
    }
  }
  return {
    ok: true,
    new: value.new === true,
    bonus: typeof value.bonus === "number" ? value.bonus : 0,
    sets_unlocked: sets,
  };
}

export function notifySetsUnlocked(list: SetUnlocked[] | undefined): void {
  for (const s of list || []) {
    showSetUnlockedToast(s.set, s.item_title);
  }
}

/** Current localStorage game bests used by achievement thresholds. */
export function gameBestState(): Pick<
  AchievementState,
  "blitzBest" | "orderBest" | "matchBest"
> {
  return {
    blitzBest: readBestKey("pycloud:blitzbest"),
    orderBest: readBestKey("pycloud:orderbest"),
    matchBest: readBestKey("pycloud:matchbest"),
  };
}

/**
 * Legacy checkAchievements — claim undeserved keys, toast + flyDrops on new.
 * Bonus also refreshes the topbar wallet pill via emitDrops (absolute balance).
 */
export async function claimDeservedAchievements(
  state: AchievementState,
  earned: Record<string, string>,
  options?: { toast?: boolean; fly?: boolean },
): Promise<Record<string, string>> {
  const toastOn = options?.toast !== false;
  const flyOn = options?.fly !== false;
  const deserved = computeAchievementKeys(state);
  let next = { ...earned };
  let bonusTotal = 0;

  for (const key of deserved) {
    if (next[key]) continue;
    try {
      const r = await apiPost(
        "/api/achievements/claim",
        { key },
        parseAchievementClaim,
      );
      next = { ...next, [key]: new Date().toISOString() };
      if (r.new) {
        const def = ACHIEVEMENTS.find((a) => a.key === key);
        if (flyOn && r.bonus > 0) flyDrops(r.bonus);
        if (r.bonus > 0) bonusTotal += r.bonus;
        if (toastOn) {
          showAchievementToast(
            def?.icon || "*",
            def?.title || key,
            r.bonus,
          );
        }
        notifySetsUnlocked(r.sets_unlocked);
      }
    } catch {
      /* non-fatal */
    }
  }

  if (bonusTotal > 0) {
    try {
      const w = await apiGet("/api/wallet", parseWallet);
      emitDrops(w.drops);
    } catch {
      /* non-fatal */
    }
  }

  return next;
}

/** Build AchievementState from solved ids + catalog (profile / post-solve). */
export function achievementStateFromSolved(
  solvedIds: Iterable<string>,
  streak: number,
  repository: ContentRepository = contentRepository,
): AchievementState {
  const solvedSet = new Set(solvedIds);
  const catalog = repository.getCatalogTopics();
  const allTasks = catalog.flatMap((t) => t.tasks);
  const byLevelDone: Record<string, boolean> = {};
  for (const lv of LEVEL_ORDER) {
    const tasks = allTasks.filter((t) => t.level === lv);
    byLevelDone[lv] =
      tasks.length > 0 && tasks.every((t) => solvedSet.has(t.id));
  }
  const functionSolved = allTasks.some(
    (t) =>
      solvedSet.has(t.id) &&
      (t.type.includes("функци") || t.type.includes("написать")),
  );
  const challengeSolved =
    [...solvedSet].some((id) => id.startsWith("C")) ||
    catalog.some((t) => t.challenge != null && solvedSet.has(t.challenge.id));

  return {
    solved: solvedSet,
    streak,
    byLevelDone,
    functionSolved,
    challengeSolved,
    ...gameBestState(),
  };
}

/**
 * Legacy checkAchievements after /api/progress — toast + wallet + fly drops.
 */
export async function claimAchievementsAfterSolve(
  solvedIds: Iterable<string>,
  repository: ContentRepository = contentRepository,
): Promise<Record<string, string>> {
  await repository.ensureLoaded();
  let streak = 0;
  try {
    const st = await apiGet("/api/stats", parseStats);
    streak = st.streak;
  } catch {
    /* keep 0 */
  }
  let earned: Record<string, string> = {};
  try {
    const ach = await apiGet("/api/achievements", parseAchievements);
    earned = ach.earned;
  } catch {
    earned = {};
  }
  return claimDeservedAchievements(
    achievementStateFromSolved(solvedIds, streak, repository),
    earned,
  );
}

/** After a scored minigame — claim blitz/order/match achievements. */
export async function claimGameAchievements(
  earned?: Record<string, string>,
): Promise<Record<string, string>> {
  let map = earned;
  if (!map) {
    try {
      const ach = await apiGet("/api/achievements", parseAchievements);
      map = ach.earned;
    } catch {
      map = {};
    }
  }
  return claimDeservedAchievements(
    {
      solved: new Set(),
      streak: 0,
      byLevelDone: {},
      functionSolved: false,
      challengeSolved: false,
      ...gameBestState(),
    },
    map,
  );
}
