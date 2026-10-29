import { describe, expect, it } from "vitest";
import { parseChangelogSource } from "./parseChangelog";

describe("parseChangelogSource", () => {
  it("extracts entries from window.CHANGELOG assignment", () => {
    const src = `window.CHANGELOG = [
  { date: "2026-07-21", title: "A", items: ["one", "two"] },
];`;
    const entries = parseChangelogSource(src);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe("A");
    expect(entries[0]?.items).toEqual(["one", "two"]);
  });
});
