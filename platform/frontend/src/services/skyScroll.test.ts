import { describe, expect, it } from "vitest";
import { computeSkyScrollEase } from "./skyScroll";

describe("computeSkyScrollEase", () => {
  it("stays day on short pages (below minScroll threshold)", () => {
    // clientHeight 800 → minScroll = max(160, 224) = 224; rawMax 100 < 224
    const { p, ease } = computeSkyScrollEase(50, 900, 800);
    expect(p).toBe(0);
    expect(ease).toBe(0);
  });

  it("reaches near-full night by ~75% scroll", () => {
    const clientHeight = 800;
    const scrollHeight = 800 + 2000; // rawMax 2000 >= minScroll
    const at75 = computeSkyScrollEase(0.75 * 2000, scrollHeight, clientHeight);
    expect(at75.p).toBeCloseTo(0.75, 3);
    expect(at75.ease).toBeCloseTo(1, 2);

    const atTop = computeSkyScrollEase(0, scrollHeight, clientHeight);
    expect(atTop.ease).toBe(0);
  });
});
