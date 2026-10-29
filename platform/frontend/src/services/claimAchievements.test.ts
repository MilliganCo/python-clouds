import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeAchievementKeys } from "../content/achievementsMeta";
import {
  claimDeservedAchievements,
  gameBestState,
  parseAchievementClaim,
} from "./claimAchievements";

describe("claimAchievements", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("gameBestState reads localStorage keys", () => {
    localStorage.setItem("pycloud:blitzbest", "20");
    localStorage.setItem("pycloud:orderbest", "12");
    localStorage.setItem("pycloud:matchbest", "11");
    expect(gameBestState()).toEqual({
      blitzBest: 20,
      orderBest: 12,
      matchBest: 11,
    });
  });

  it("computeAchievementKeys includes game thresholds", () => {
    const keys = computeAchievementKeys({
      solved: new Set(),
      streak: 0,
      byLevelDone: {},
      functionSolved: false,
      challengeSolved: false,
      blitzBest: 15,
      orderBest: 10,
      matchBest: 10,
    });
    expect(keys).toContain("blitz_15");
    expect(keys).toContain("order_10");
    expect(keys).toContain("match_10");
  });

  it("claimDeservedAchievements posts blitz_15 when best high enough", async () => {
    const posts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/achievements/claim")) {
          const body = JSON.parse(String(init?.body || "{}")) as { key: string };
          posts.push(body.key);
          return new Response(
            JSON.stringify({
              ok: true,
              new: true,
              bonus: 20,
              sets_unlocked: [],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/api/wallet")) {
          return new Response(
            JSON.stringify({
              drops: 120,
              freezes: 0,
              owned: [],
              shop: {},
              set_items: {},
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );

    localStorage.setItem("pycloud:blitzbest", "20");
    const earned = await claimDeservedAchievements(
      {
        solved: new Set(),
        streak: 0,
        byLevelDone: {},
        functionSolved: false,
        challengeSolved: false,
        ...gameBestState(),
      },
      {},
      { toast: false, fly: false },
    );

    expect(posts).toContain("blitz_15");
    expect(earned.blitz_15).toBeTruthy();
  });

  it("parseAchievementClaim accepts sets_unlocked", () => {
    const r = parseAchievementClaim({
      ok: true,
      new: true,
      bonus: 20,
      sets_unlocked: [
        { set: "Набор", item: "title_x", item_title: "Титул: X" },
      ],
    });
    expect(r.sets_unlocked[0]?.item).toBe("title_x");
  });
});
