import { describe, it, expect } from "vitest";
import { normalizeTheoryArticle } from "./normalizeTheoryArticle";
import type { RawTopic } from "../types/content";

const baseTopic = (theory: RawTopic["theory"]): RawTopic => ({
  id: 0,
  title: "Основы синтаксиса Python",
  level: "beginner",
  level_label: "начальный",
  description: "Описание темы",
  theory,
  tasks: [{ id: "0.1" } as RawTopic["tasks"][number]],
});

describe("normalizeTheoryArticle", () => {
  it("builds article kind with sanitized paragraphs and code untouched", () => {
    const model = normalizeTheoryArticle(
      baseTopic({
        text: "fallback",
        title: "Основы синтаксиса",
        lead: "Lead with <code>print</code> and <b>bold</b>",
        sections: [
          {
            title: "S1",
            text: "P1 with <code>x</code>\n\nP2",
            examples: [
              { code: 'print(1)\n<script>alert(1)</script>', explanation: "See <code>1</code>" },
            ],
          },
        ],
        mistakes: [{ title: "M", text: "Use <code>()</code>" }],
        applications: ["App <code>a</code>"],
        summary: ["Sum"],
        prev: null,
        next: "Next →",
      }),
    );
    expect(model.kind).toBe("article");
    expect(model.firstTaskId).toBe("0.1");
    expect(model.sections[0].paragraphsHtml).toHaveLength(2);
    expect(model.sections[0].paragraphsHtml[0]).toContain("<code>");
    expect(model.sections[0].examples[0].code).toContain("<script>"); // raw code text preserved
    expect(model.leadHtml).not.toMatch(/<script/i);
  });

  it("falls back to teaser when no sections", () => {
    const model = normalizeTheoryArticle(
      baseTopic({ text: "Teaser <b>x</b>", example: "print(1)" }),
    );
    expect(model.kind).toBe("teaser");
    expect(model.exampleCode).toBe("print(1)");
    expect(model.teaserHtml).toContain("Teaser");
  });
});
