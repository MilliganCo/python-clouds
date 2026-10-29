import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentRepository } from "../../content/ContentRepository";
import { parseContentBundle } from "../../content/parseContentBundle";
import { AiMentorShell } from "./AiMentorShell";

function fixture() {
  return parseContentBundle({
    schema_version: 2,
    content_version: "aaaaaaaaaaaaaaaa",
    content_hash: "sha256:" + "a".repeat(64),
    python_runtime: "3.14.x",
    topics: [
      {
        id: 0,
        title: "Основы",
        level: "beginner",
        level_label: "начальный",
        description: "D",
        theory: { text: "Teaser." },
        tasks: [
          {
            id: "0.1",
            type: "демо",
            title: "T",
            prompt: "Спросите про **это**.",
            code: "print(1)",
            code_language: "python",
            answer: "# демо — ok",
            answer_language: "python",
            explanation: "e",
            verified: "да",
            hint: null,
            intro: { goal: "g", text: "i" },
            check: null,
            wrong: null,
            questions: null,
          },
        ],
      },
    ],
  });
}

describe("AiMentorShell", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/ai/history")) {
          return new Response(JSON.stringify({ messages: [] }), {
            status: 200,
          });
        }
        if (url.includes("/api/fact")) {
          return new Response(
            JSON.stringify({ facts: ["Факт про Python."] }),
            { status: 200 },
          );
        }
        if (url.includes("/api/progress")) {
          return new Response(JSON.stringify({ solved: [] }), { status: 200 });
        }
        if (url.includes("/api/ai/ask")) {
          return new Response(
            JSON.stringify({
              reply: "Ответ наставника",
              engine: "offline",
              cost: 0,
              free_left: 5,
              drops: 10,
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({}), { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    try {
      localStorage.removeItem(
        "pycloud:ai-fact:" + new Date().toISOString().slice(0, 10),
      );
    } catch {
      /* ignore */
    }
  });

  it("shows mentor FAB on task route and opens drawer", async () => {
    const repo = new ContentRepository({ load: async () => fixture() });

    render(
      <MemoryRouter initialEntries={["/task/0.1"]}>
        <Routes>
          <Route
            path="/task/:id"
            element={<AiMentorShell repository={repo} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const fab = await screen.findByRole("button", {
      name: /Открыть наставника/i,
    });
    fireEvent.click(fab);

    expect(
      await screen.findByText(/Помощник · задание 0\.1/i),
    ).toBeTruthy();
    expect(await screen.findByText(/Факт про Python/i)).toBeTruthy();
  });

  it("hides on non-task routes", async () => {
    const repo = new ContentRepository({ load: async () => fixture() });
    const { container } = render(
      <MemoryRouter initialEntries={["/topics"]}>
        <Routes>
          <Route
            path="/topics"
            element={<AiMentorShell repository={repo} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(container.querySelector(".sandbox-fab")).toBeNull();
    });
  });
});
