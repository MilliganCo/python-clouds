import { describe, expect, it } from "vitest";
import {
  LEVEL_ORDER,
  LEVEL_SUB,
  LEVEL_TITLE,
  TOPIC_SYMBOL,
  topicSymbol,
} from "./topicCatalogMeta";

describe("topicCatalogMeta", () => {
  it("has TOPIC_SYMBOL for ids 0..51", () => {
    for (let i = 0; i <= 51; i++) {
      expect(TOPIC_SYMBOL[i], `missing symbol for ${i}`).toBeTruthy();
    }
    expect(Object.keys(TOPIC_SYMBOL)).toHaveLength(52);
  });

  it("falls back to middle dot for unknown ids", () => {
    expect(topicSymbol(999)).toBe("·");
    expect(topicSymbol(0)).toBe("()");
  });

  it("LEVEL_ORDER matches LEVEL_TITLE and LEVEL_SUB keys", () => {
    expect([...LEVEL_ORDER]).toEqual([
      "beginner",
      "intermediate",
      "advanced",
      "expert",
    ]);
    for (const lv of LEVEL_ORDER) {
      expect(LEVEL_TITLE[lv]).toBeTruthy();
      expect(LEVEL_SUB[lv]).toBeTruthy();
    }
  });
});
