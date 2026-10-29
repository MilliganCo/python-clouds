import { afterEach, describe, expect, it, vi } from "vitest";
import { ContractError } from "./parse";

describe("aiMentor API shapes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("askAi parses reply and wallet fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            reply: "Подсказка",
            engine: "opencode",
            cost: 0,
            free_left: 4,
            drops: 42,
          }),
          { status: 200 },
        ),
      ),
    );
    const { askAi } = await import("./aiMentor");
    const r = await askAi(
      { id: "0.1", type: "демо", prompt: "x" },
      "как?",
      { solved_count: 1, total: 10, topics_progress: [] },
    );
    expect(r.reply).toBe("Подсказка");
    expect(r.drops).toBe(42);
    expect(r.engine).toBe("opencode");
  });

  it("requestAiReview returns null when review absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ review: null }), { status: 200 }),
      ),
    );
    const { requestAiReview } = await import("./aiMentor");
    const r = await requestAiReview(
      { id: "1.1", type: "написать код", prompt: "p", answer: "a" },
      { ok: false, code: "print(1)" },
    );
    expect(r).toBeNull();
  });

  it("askAi throws on bad body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
    const { askAi } = await import("./aiMentor");
    await expect(
      askAi(
        { id: "0.1", type: "демо", prompt: "x" },
        "q",
        { solved_count: 0, total: 1, topics_progress: [] },
      ),
    ).rejects.toBeInstanceOf(ContractError);
  });
});
