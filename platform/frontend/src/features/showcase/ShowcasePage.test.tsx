import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShowcasePage } from "./ShowcasePage";
import { ShowcaseCardPage } from "./ShowcaseCardPage";
import { ShowcaseCreatePage } from "./ShowcaseCreatePage";

const card = {
  id: 1,
  owner_name: "demo",
  title: "Бюджет",
  description: "Отчёт по расходам на неделю",
  cover: "aurora",
  files: [{ name: "main.py", code: "print(1)" }],
  file_count: 1,
  is_multi_file: false,
  score: 12,
  my_vote: null,
};

const board = {
  cards: [card],
  leaderboard: [card],
  can_multi_file: false,
  covers: ["aurora", "cosmos"],
  vote_min: -3,
  vote_max: 3,
};

describe("ShowcasePage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(board), { status: 200 }),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders feed and leaderboard", async () => {
    render(
      <MemoryRouter>
        <ShowcasePage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: /Программы учеников/i }),
    ).toBeTruthy();
    expect(screen.getAllByText(/Бюджет/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("heading", { name: /Лидерборд/i })).toBeTruthy();
  });
});

describe("ShowcaseCardPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/showcase/cards/1")) {
          return new Response(
            JSON.stringify({ card, can_multi_file: false }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows code and vote buttons", async () => {
    render(
      <MemoryRouter initialEntries={["/showcase/1"]}>
        <Routes>
          <Route path="/showcase/:id" element={<ShowcaseCardPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: /Бюджет/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Запустить/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+1" })).toBeTruthy();
  });
});

describe("ShowcaseCreatePage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(board), { status: 200 }),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders publish form", async () => {
    render(
      <MemoryRouter>
        <ShowcaseCreatePage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: /Создать свой проект/i }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Опубликовать/i })).toBeTruthy();
  });
});
