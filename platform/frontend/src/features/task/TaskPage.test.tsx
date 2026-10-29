import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentRepository } from "../../content/ContentRepository";
import { parseContentBundle } from "../../content/parseContentBundle";
import { TaskPage } from "./TaskPage";

function demoFixture() {
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
            title: "Сверху вниз",
            prompt: "Нажмите **Запустить**.",
            code: "print(1)",
            code_language: "python",
            answer: "# демо — ok",
            answer_language: "python",
            explanation: "Порядок сверху вниз.",
            verified: "да",
            hint: null,
            intro: { goal: "Разобрать порядок строк.", text: "i" },
            check: null,
            wrong: null,
            questions: null,
          },
          {
            id: "0.2",
            type: "демо",
            title: "Ещё",
            prompt: "p",
            code: "print(2)",
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

describe("TaskPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method || "GET").toUpperCase();
        if (url.includes("/api/progress") && method === "GET") {
          return new Response(JSON.stringify({ solved: ["0.1"] }), {
            status: 200,
          });
        }
        if (url.includes("/api/progress") && method === "POST") {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.includes("/api/notes")) {
          if (method === "POST") {
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          }
          return new Response(JSON.stringify({ text: "" }), { status: 200 });
        }
        if (url.includes("/api/hints")) {
          return new Response(
            JSON.stringify({ unlocked: [], prices: { 2: 5, 3: 15 } }),
            { status: 200 },
          );
        }
        if (url.includes("/api/ai/review")) {
          return new Response(JSON.stringify({ review: null }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders demo task with run and next buttons", async () => {
    const repo = new ContentRepository({
      load: async () => demoFixture(),
    });

    render(
      <MemoryRouter initialEntries={["/task/0.1"]}>
        <Routes>
          <Route path="/task/:id" element={<TaskPage repository={repo} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: /Этап 0\.1/i }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Запустить/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Далее/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Теория темы/i })).toBeTruthy();
  });

  it("shows success modal after demo Далее", async () => {
    const repo = new ContentRepository({
      load: async () => demoFixture(),
    });

    render(
      <MemoryRouter initialEntries={["/task/0.1"]}>
        <Routes>
          <Route path="/task/:id" element={<TaskPage repository={repo} />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: /Этап 0\.1/i });
    fireEvent.click(screen.getByRole("button", { name: /Далее/i }));

    const dialog = await screen.findByRole("dialog", {
      name: /Задание решено/i,
    });
    expect(dialog).toBeTruthy();
    expect(dialog.querySelector("#successXp")?.textContent).toBe("+10 XP");
    expect(
      screen.getByRole("button", { name: /Следующий этап/i }),
    ).toBeTruthy();
  });

  it("shows not found for unknown id", async () => {
    const repo = new ContentRepository({
      load: async () => demoFixture(),
    });

    render(
      <MemoryRouter initialEntries={["/task/99.9"]}>
        <Routes>
          <Route path="/task/:id" element={<TaskPage repository={repo} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Задание не найдено/i)).toBeTruthy();
  });
});
