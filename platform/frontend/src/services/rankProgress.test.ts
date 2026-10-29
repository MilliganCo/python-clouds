import { describe, expect, it } from "vitest";
import {
  computeRankProgress,
  pointsFor,
  type TaskXpMeta,
} from "./rankProgress";

describe("rankProgress", () => {
  it("pointsFor uses level and challenge multiplier", () => {
    expect(pointsFor({ level: "beginner" })).toBe(10);
    expect(pointsFor({ level: "beginner", challenge: true })).toBe(30);
    expect(pointsFor({ level: "expert" })).toBe(40);
  });

  it("computes Ученик rank and fill like legacy", () => {
    const index = new Map<string, TaskXpMeta>([
      ["0.1", { level: "beginner" }],
      ["0.2", { level: "beginner" }],
      ["0.3", { level: "beginner" }],
      ["0.4", { level: "beginner" }],
      ["0.5", { level: "beginner" }],
      ["0.6", { level: "beginner" }],
    ]);
    // 6 * 10 = 60 → Ученик, next Практик at 180 → frac = 0
    const p = computeRankProgress(
      ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6"],
      index,
    );
    expect(p.xp).toBe(60);
    expect(p.rankName).toBe("Ученик");
    expect(p.fillPercent).toBe(0);
    expect(p.nextRankName).toBe("Практик");
  });

  it("ignores unknown solved ids", () => {
    const index = new Map<string, TaskXpMeta>([["1.1", { level: "beginner" }]]);
    const p = computeRankProgress(["1.1", "ghost"], index);
    expect(p.xp).toBe(10);
    expect(p.rankName).toBe("Новичок");
  });
});
