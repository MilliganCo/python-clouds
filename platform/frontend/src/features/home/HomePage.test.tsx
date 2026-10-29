import { render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentRepository } from "../../content/ContentRepository";
import { parseContentBundle } from "../../content/parseContentBundle";
import type { ShellOutletContext } from "../shell/ShellLayout";
import { HomePage } from "./HomePage";

function homeFixture() {
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
            title: "Старт",
            prompt: "p",
            code: "print(1)",
            code_language: "python",
            answer: "a",
            answer_language: "python",
            explanation: "e",
            verified: "да",
            hint: null,
            intro: { text: "i" },
            check: null,
            wrong: null,
            questions: null,
          },
        ],
      },
    ],
  });
}

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/progress")) {
      return new Response(JSON.stringify({ solved: [] }), { status: 200 });
    }
    if (url.includes("/api/wallet")) {
      return new Response(
        JSON.stringify({ drops: 12, freezes: 0, owned: [] }),
        { status: 200 },
      );
    }
    if (url.includes("/api/stats")) {
      return new Response(
        JSON.stringify({ streak: 2, solved: [], notes_count: 0 }),
        { status: 200 },
      );
    }
    if (url.includes("/api/chest")) {
      return new Response(JSON.stringify({ ready: true, amount: 5 }), {
        status: 200,
      });
    }
    if (url.includes("/api/fact")) {
      return new Response(JSON.stringify({ facts: ["Факт про Python."] }), {
        status: 200,
      });
    }
    if (url.includes("/api/daily-ai")) {
      return new Response(
        JSON.stringify({
          day: "2026-07-21",
          tasks: {
            intermediate: { title: "Среднее задание" },
            advanced: { title: "Сложное" },
            expert: { title: "Эксперт" },
          },
          solved: [],
          drops: { intermediate: 10, advanced: 15, expert: 20 },
          pending: false,
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 404 });
  });
}

function ShellStub() {
  return <Outlet context={{ username: "example_student" } satisfies ShellOutletContext} />;
}

describe("HomePage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
    localStorage.removeItem("pycloud:onboarded");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders dashboard hello, continue, and nav cards", async () => {
    const repo = new ContentRepository({
      load: async () => homeFixture(),
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<ShellStub />}>
            <Route index element={<HomePage repository={repo} />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/example_student/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Продолжить →/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Открыть темы/i })).toBeTruthy();
    expect(screen.getByText(/Факт про Python/)).toBeTruthy();
    expect(await screen.findByText(/Среднее задание/)).toBeTruthy();
    expect(screen.getByText(/у вас/)).toBeTruthy();
    expect(screen.getByLabelText(/Ежедневный сундук/)).toBeTruthy();
  });
});
