import { describe, it, expect } from "vitest";
import { ContentRepository } from "./ContentRepository";
import { parseContentBundle } from "./parseContentBundle";

function minimalFixture() {
  return {
    schema_version: 2,
    content_version: "aaaaaaaaaaaaaaaa",
    content_hash: "sha256:" + "a".repeat(64),
    python_runtime: "3.14.x",
    topics: [
      {
        id: 0,
        title: "T",
        level: "beginner",
        level_label: "начальный",
        description: "D",
        theory: { text: "Hello <code>x</code>" },
        tasks: [
          {
            id: "0.1",
            type: "демо",
            title: "",
            prompt: "p",
            code: null,
            code_language: "python",
            answer: "a",
            answer_language: "text",
            explanation: "e",
            verified: "manual",
            hint: null,
            intro: { text: "i" },
            check: null,
            wrong: null,
            questions: null,
          },
        ],
      },
    ],
  };
}

describe("ContentRepository", () => {
  it("returns error before load", () => {
    const repo = new ContentRepository({
      load: async () => parseContentBundle(minimalFixture()),
    });
    expect(repo.getTheoryArticle(0)).toEqual({
      status: "error",
      message: "Content bundle not loaded",
    });
  });

  it("returns not_found for unknown topic after load", async () => {
    const repo = new ContentRepository({
      load: async () => parseContentBundle(minimalFixture()),
    });
    await repo.ensureLoaded();
    expect(repo.getTheoryArticle(999)).toEqual({ status: "not_found" });
    expect(repo.getTheoryArticle(0).status).toBe("ok");
  });

  it("ensureLoaded is idempotent", async () => {
    let calls = 0;
    const repo = new ContentRepository({
      load: async () => {
        calls += 1;
        return parseContentBundle(minimalFixture());
      },
    });
    await Promise.all([repo.ensureLoaded(), repo.ensureLoaded()]);
    expect(calls).toBe(1);
  });

  it("getCatalogTopics maps theory teaser and challenge meta", async () => {
    const fixture = minimalFixture();
    fixture.topics.push({
      id: 4,
      title: "Строки",
      level: "beginner",
      level_label: "начальный",
      description: "D3",
      theory: { text: "Первое предложение. Второе." },
      tasks: [
        {
          id: "4.1",
          type: "демо",
          title: "T",
          prompt: "p",
          code: null,
          code_language: "python",
          answer: "a",
          answer_language: "text",
          explanation: "e",
          verified: "manual",
          hint: null,
          intro: { text: "i" },
          check: null,
          wrong: null,
          questions: null,
        },
      ],
    });
    const repo = new ContentRepository({
      load: async () => parseContentBundle(fixture),
    });
    await repo.ensureLoaded();
    const catalog = repo.getCatalogTopics();
    expect(catalog).toHaveLength(2);
    expect(catalog[0]!.teaserPlain).toMatch(/Hello/);
    const withCh = catalog.find((t) => t.id === 4)!;
    expect(withCh.challenge?.id).toBe("C4.1");
    expect(withCh.challenge?.title).toMatch(/имя/);
    expect(withCh.teaserPlain).toBe("Первое предложение.");
  });

  it("getTask returns normalized demo and challenge content", async () => {
    const repo = new ContentRepository({
      load: async () =>
        parseContentBundle({
          ...minimalFixture(),
          topics: [
            ...minimalFixture().topics,
            {
              id: 4,
              title: "Строки",
              level: "beginner",
              level_label: "начальный",
              description: "D",
              theory: { text: "T" },
              tasks: [
                {
                  id: "4.1",
                  type: "демо",
                  title: "t",
                  prompt: "p",
                  code: null,
                  code_language: "python",
                  answer: "a",
                  answer_language: "text",
                  explanation: "e",
                  verified: "manual",
                  hint: null,
                  intro: null,
                  check: null,
                  wrong: null,
                  questions: null,
                },
              ],
            },
          ],
        }),
    });
    await repo.ensureLoaded();
    const ok = repo.getTask("0.1");
    expect(ok.status).toBe("ok");
    if (ok.status === "ok") {
      expect(ok.task.type).toBe("демо");
      expect(ok.task.topicId).toBe(0);
    }
    const ch = repo.getTask("C4.1");
    expect(ch.status).toBe("ok");
    if (ch.status === "ok") {
      expect(ch.task.challenge).toBe(true);
      expect(ch.task.check?.expect).toBe("OK");
    }
    expect(repo.getNextTaskId("0.1")).toBe("4.1");
    expect(repo.getNextTaskId("4.1")).toBeNull();
  });
});
