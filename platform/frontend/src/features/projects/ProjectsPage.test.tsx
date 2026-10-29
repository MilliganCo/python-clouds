import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsPage } from "./ProjectsPage";
import { ProjectCoursePage } from "./ProjectCoursePage";
import { checkProjectStage } from "../../services/projectCheck";

const course = {
  id: "chatbot_to_telegram",
  title: "Бот в телеграм",
  short_title: "Бот",
  quest_label: "Квест связи",
  emblem: "bot",
  accent: "cyan",
  track_order: 1,
  track_total: 5,
  unlock_topic_titles: ["Переменные"],
  description: "Соберите бота",
  final_result: "Рабочий бот",
  intro: "Начните с приветствия",
  status: "available",
  status_label: "Можно начать",
  completed_stages: 0,
  total_stages: 5,
  progress_percent: 0,
  next_stage: null,
  stages: [
    {
      id: "hello",
      title: "Приветствие",
      summary: "Первый шаг",
      task: "Напишите print",
      status: "available",
      status_label: "Доступен",
      required_topic_titles: ["Переменные"],
      hints: ["Используйте print"],
      check: { expect_contains: ["print"] },
      snapshots: [],
    },
  ],
};

describe("checkProjectStage", () => {
  it("rejects forbidden tokens", async () => {
    const r = await checkProjectStage(
      { forbid: ["import"] },
      "import os\nprint(1)",
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/import/);
  });

  it("requires expect_contains", async () => {
    const r = await checkProjectStage(
      { expect_contains: ["def greet"] },
      "print(1)",
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/def greet/);
  });
});

describe("ProjectsPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ courses: [course] }), { status: 200 }),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders epic quest title", async () => {
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: /Бот в телеграм/i }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Начать квест/i })).toBeTruthy();
  });
});

describe("ProjectCoursePage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ course }), { status: 200 }),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists stages", async () => {
    render(
      <MemoryRouter initialEntries={["/project/chatbot_to_telegram"]}>
        <Routes>
          <Route path="/project/:course" element={<ProjectCoursePage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Главы квеста/i)).toBeTruthy();
    expect(screen.getByText(/Приветствие/i)).toBeTruthy();
  });
});
