export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMe(value: unknown): { username: string } {
  if (!isObject(value) || typeof value.username !== "string" || !value.username) {
    throw new ContractError("Invalid /api/me response");
  }
  return { username: value.username };
}

export function parseProgress(value: unknown): { solved: string[] } {
  if (!isObject(value) || !Array.isArray(value.solved)) {
    throw new ContractError("Invalid /api/progress response");
  }
  if (!value.solved.every((id) => typeof id === "string")) {
    throw new ContractError("Invalid /api/progress solved ids");
  }
  return { solved: value.solved as string[] };
}

/** POST /api/progress → `{ ok: true, drops_awarded?, drops? }`. */
export function parseProgressPost(value: unknown): {
  ok: true;
  drops_awarded: number;
  drops?: number;
} {
  if (!isObject(value) || value.ok !== true) {
    throw new ContractError("Invalid POST /api/progress response");
  }
  return {
    ok: true,
    drops_awarded:
      typeof value.drops_awarded === "number" ? value.drops_awarded : 0,
    drops: typeof value.drops === "number" ? value.drops : undefined,
  };
}

export type ShopItem = {
  price: number;
  title: string;
  kind: string;
  note?: string;
};

export type WalletPayload = {
  drops: number;
  freezes: number;
  owned: string[];
  shop: Record<string, ShopItem>;
  set_items: Record<string, string>;
};

export function parseWallet(value: unknown): WalletPayload {
  if (
    !isObject(value) ||
    typeof value.drops !== "number" ||
    typeof value.freezes !== "number" ||
    !Array.isArray(value.owned)
  ) {
    throw new ContractError("Invalid /api/wallet response");
  }
  if (!value.owned.every((item) => typeof item === "string")) {
    throw new ContractError("Invalid /api/wallet owned items");
  }
  const shop: Record<string, ShopItem> = {};
  if (isObject(value.shop)) {
    for (const [key, item] of Object.entries(value.shop)) {
      if (
        !isObject(item) ||
        typeof item.price !== "number" ||
        typeof item.title !== "string"
      ) {
        throw new ContractError(`Invalid /api/wallet shop.${key}`);
      }
      shop[key] = {
        price: item.price,
        title: item.title,
        kind: typeof item.kind === "string" ? item.kind : "",
        note: typeof item.note === "string" ? item.note : undefined,
      };
    }
  }
  const set_items: Record<string, string> = {};
  if (isObject(value.set_items)) {
    for (const [key, title] of Object.entries(value.set_items)) {
      if (typeof title !== "string") {
        throw new ContractError(`Invalid /api/wallet set_items.${key}`);
      }
      set_items[key] = title;
    }
  }
  return {
    drops: value.drops,
    freezes: value.freezes,
    owned: value.owned as string[],
    shop,
    set_items,
  };
}

/** POST /api/shop/buy */
export function parseShopBuy(value: unknown): {
  ok: true;
  drops: number;
  freezes: number;
  sets_unlocked: Array<{ set: string; item: string; item_title: string }>;
} {
  if (
    !isObject(value) ||
    value.ok !== true ||
    typeof value.drops !== "number" ||
    typeof value.freezes !== "number"
  ) {
    throw new ContractError("Invalid POST /api/shop/buy response");
  }
  const sets: Array<{ set: string; item: string; item_title: string }> = [];
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
      sets.push({
        set: row.set,
        item: row.item,
        item_title: row.item_title,
      });
    }
  }
  return {
    ok: true,
    drops: value.drops,
    freezes: value.freezes,
    sets_unlocked: sets,
  };
}

export function parseAchievements(value: unknown): { earned: Record<string, string> } {
  if (!isObject(value) || !isObject(value.earned)) {
    throw new ContractError("Invalid /api/achievements response");
  }
  const earned: Record<string, string> = {};
  for (const [key, at] of Object.entries(value.earned)) {
    if (typeof at !== "string") {
      throw new ContractError("Invalid /api/achievements earned entry");
    }
    earned[key] = at;
  }
  return { earned };
}

/** GET /api/chest → `{ ready, amount }`. */
export function parseChestStatus(value: unknown): { ready: boolean; amount: number } {
  if (
    !isObject(value) ||
    typeof value.ready !== "boolean" ||
    typeof value.amount !== "number"
  ) {
    throw new ContractError("Invalid /api/chest response");
  }
  return { ready: value.ready, amount: value.amount };
}

/** POST /api/chest/claim → `{ ok: true, amount, drops, sets_unlocked? }`. */
export function parseChestClaim(value: unknown): {
  ok: true;
  amount: number;
  drops: number;
  sets_unlocked: Array<{ set: string; item: string; item_title: string }>;
} {
  if (
    !isObject(value) ||
    value.ok !== true ||
    typeof value.amount !== "number" ||
    typeof value.drops !== "number"
  ) {
    throw new ContractError("Invalid POST /api/chest/claim response");
  }
  const sets: Array<{ set: string; item: string; item_title: string }> = [];
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
      sets.push({
        set: row.set,
        item: row.item,
        item_title: row.item_title,
      });
    }
  }
  return {
    ok: true,
    amount: value.amount,
    drops: value.drops,
    sets_unlocked: sets,
  };
}

/**
 * GET /api/fact → prefer `facts: string[]`; fall back to single `fact`.
 */
export function parseFact(value: unknown): { facts: string[] } {
  if (!isObject(value)) {
    throw new ContractError("Invalid /api/fact response");
  }
  if (Array.isArray(value.facts) && value.facts.length > 0) {
    if (!value.facts.every((f) => typeof f === "string")) {
      throw new ContractError("Invalid /api/fact facts");
    }
    return { facts: value.facts as string[] };
  }
  if (typeof value.fact === "string" && value.fact) {
    return { facts: [value.fact] };
  }
  throw new ContractError("Invalid /api/fact response");
}

export type DailyAiTask = {
  title: string;
  prompt?: string;
  func_name?: string;
  starter?: string;
  /** Appended after user code for Pyodide check; must print OK. */
  tests?: string;
};

export type DailyAiPayload = {
  day: string;
  tasks: Record<string, DailyAiTask>;
  solved: string[];
  drops: Record<string, number>;
  pending?: boolean;
};

/** GET /api/daily-ai */
export function parseDailyAi(value: unknown): DailyAiPayload {
  if (
    !isObject(value) ||
    typeof value.day !== "string" ||
    !isObject(value.tasks) ||
    !Array.isArray(value.solved) ||
    !isObject(value.drops)
  ) {
    throw new ContractError("Invalid /api/daily-ai response");
  }
  if (!value.solved.every((id) => typeof id === "string")) {
    throw new ContractError("Invalid /api/daily-ai solved");
  }
  const tasks: Record<string, DailyAiTask> = {};
  for (const [diff, raw] of Object.entries(value.tasks)) {
    if (!isObject(raw) || typeof raw.title !== "string") {
      throw new ContractError(`Invalid /api/daily-ai tasks.${diff}`);
    }
    tasks[diff] = {
      title: raw.title,
      prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
      func_name: typeof raw.func_name === "string" ? raw.func_name : undefined,
      starter: typeof raw.starter === "string" ? raw.starter : undefined,
      tests: typeof raw.tests === "string" ? raw.tests : undefined,
    };
  }
  const drops: Record<string, number> = {};
  for (const [diff, n] of Object.entries(value.drops)) {
    if (typeof n !== "number") {
      throw new ContractError(`Invalid /api/daily-ai drops.${diff}`);
    }
    drops[diff] = n;
  }
  const pending =
    typeof value.pending === "boolean" ? value.pending : undefined;
  return {
    day: value.day,
    tasks,
    solved: value.solved as string[],
    drops,
    pending,
  };
}

/** POST /api/daily-ai/solve */
export function parseDailyAiSolve(value: unknown): {
  ok: true;
  awarded: number;
  drops: number;
} {
  if (
    !isObject(value) ||
    value.ok !== true ||
    typeof value.awarded !== "number" ||
    typeof value.drops !== "number"
  ) {
    throw new ContractError("Invalid POST /api/daily-ai/solve response");
  }
  return { ok: true, awarded: value.awarded, drops: value.drops };
}

/** POST /api/game/result */
export function parseGameResult(value: unknown): {
  ok: true;
  awarded: number;
  best: number;
  cap_left?: number;
} {
  if (
    !isObject(value) ||
    value.ok !== true ||
    typeof value.awarded !== "number"
  ) {
    throw new ContractError("Invalid POST /api/game/result response");
  }
  return {
    ok: true,
    awarded: value.awarded,
    best: typeof value.best === "number" ? value.best : 0,
    cap_left:
      typeof value.cap_left === "number" ? value.cap_left : undefined,
  };
}

export type StatsPayload = {
  streak: number;
  solved: Array<{ task_id: string; solved_at: string }>;
  notes_count?: number;
  member_since?: string | null;
};

/** GET /api/stats → streak + solve dates for week goal. */
export function parseStats(value: unknown): StatsPayload {
  if (
    !isObject(value) ||
    typeof value.streak !== "number" ||
    !Array.isArray(value.solved)
  ) {
    throw new ContractError("Invalid /api/stats response");
  }
  const solved: Array<{ task_id: string; solved_at: string }> = [];
  for (const row of value.solved) {
    if (
      !isObject(row) ||
      typeof row.task_id !== "string" ||
      typeof row.solved_at !== "string"
    ) {
      throw new ContractError("Invalid /api/stats solved entry");
    }
    solved.push({ task_id: row.task_id, solved_at: row.solved_at });
  }
  return {
    streak: value.streak,
    solved,
    notes_count:
      typeof value.notes_count === "number" ? value.notes_count : undefined,
    member_since:
      typeof value.member_since === "string" || value.member_since === null
        ? (value.member_since as string | null)
        : undefined,
  };
}
