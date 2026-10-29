import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentRepository } from "../../content/ContentRepository";
import { parseContentBundle } from "../../content/parseContentBundle";
import { TopicsCatalogPage } from "./TopicsCatalogPage";

function catalogFixture() {
  return parseContentBundle({
    schema_version: 2,
    content_version: "aaaaaaaaaaaaaaaa",
    content_hash: "sha256:" + "a".repeat(64),
    python_runtime: "3.14.x",
    topics: [
      {
        id: 0,
        title: "Основы синтаксиса",
        level: "beginner",
        level_label: "начальный",
        description: "Введение в Python",
        theory: { text: "Первая фраза теории. Вторая фраза." },
        tasks: [
          {
            id: "0.1",
            type: "демо",
            title: "Сверху вниз",
            prompt: "Порядок строк",
            code: "print(1)",
            challenge: false,
          },
          {
            id: "0.2",
            type: "квиз",
            title: "Квиз",
            prompt: "Что такое print",
            code: null,
            challenge: false,
          },
        ],
      },
      {
        id: 4,
        title: "Строки",
        level: "beginner",
        level_label: "начальный",
        description: "Работа со строками",
        theory: { text: "Строки — текст." },
        tasks: [
          {
            id: "4.1",
            type: "написать функцию",
            title: "Strip",
            prompt: "Убрать пробелы",
            code: null,
            challenge: false,
          },
        ],
      },
      {
        id: 12,
        title: "Функции",
        level: "intermediate",
        level_label: "средний",
        description: "Функции глубже",
        theory: { text: "def создаёт функцию." },
        tasks: [
          {
            id: "12.1",
            type: "написать функцию",
            title: "Fizz",
            prompt: "FizzBuzz lite",
            code: null,
            challenge: false,
          },
        ],
      },
    ],
  });
}

describe("TopicsCatalogPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ solved: ["0.1"] }), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderPage(repo: ContentRepository) {
    return render(
      <MemoryRouter initialEntries={["/topics"]}>
        <Routes>
          <Route
            path="/topics"
            element={<TopicsCatalogPage repository={repo} />}
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("renders hero stats and topic cards from repository", async () => {
    const repo = new ContentRepository({
      load: async () => catalogFixture(),
    });

    const { container } = renderPage(repo);

    expect(await screen.findByRole("heading", { name: /Темы и задания/i })).toBeTruthy();
    const heroStats = container.querySelector(".topics-hero-stats");
    expect(heroStats?.textContent?.replace(/\s+/g, " ")).toMatch(/1 \/ 4 заданий/);
    expect(screen.getByText("Основы синтаксиса")).toBeTruthy();
    expect(screen.getByRole("link", { name: /На главную/i })).toBeTruthy();
  });

  it("filters by level tab", async () => {
    const repo = new ContentRepository({
      load: async () => catalogFixture(),
    });

    const { container } = renderPage(repo);

    await screen.findByText("Основы синтаксиса");
    fireEvent.click(container.querySelector('[data-level="intermediate"]')!);

    await waitFor(() => {
      expect(screen.queryByText("Основы синтаксиса")).toBeNull();
    });
    expect(screen.getByText("Функции")).toBeTruthy();
  });

  it("toggles accordion on topic-head click", async () => {
    const repo = new ContentRepository({
      load: async () => catalogFixture(),
    });

    const { container } = renderPage(repo);

    await screen.findByText("Основы синтаксиса");
    const section = container.querySelector('[data-topic="0"]');
    expect(section).toBeTruthy();
    expect(section!.classList.contains("open")).toBe(false);

    fireEvent.click(section!.querySelector(".topic-head")!);
    expect(section!.classList.contains("open")).toBe(true);
  });

  it("shows challenge row for matching topicId", async () => {
    const repo = new ContentRepository({
      load: async () => catalogFixture(),
    });

    const { container } = renderPage(repo);

    await screen.findByText("Строки");
    const row = container.querySelector(".challenge-row");
    expect(row?.textContent).toMatch(/Челлендж/);
    expect(row?.textContent).toMatch(/Приведи имя в порядок/);
  });
});
