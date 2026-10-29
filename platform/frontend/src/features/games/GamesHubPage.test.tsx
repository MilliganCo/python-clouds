import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GamesHubPage } from "./GamesHubPage";
import { GamePlayPage } from "./GamePlayPage";
import { RiddlePage } from "./RiddlePage";

describe("GamesHubPage", () => {
  it("lists scored games and riddle", () => {
    render(
      <MemoryRouter>
        <GamesHubPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /Молния/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Загадки/i })).toBeTruthy();
    expect(screen.getByText(/до 15 капель в день/i)).toBeTruthy();
  });
});

describe("GamePlayPage", () => {
  it("shows intro for blitz", () => {
    render(
      <MemoryRouter initialEntries={["/game/blitz"]}>
        <Routes>
          <Route path="/game/:name" element={<GamePlayPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /Молния/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Начать раунд/i })).toBeTruthy();
    expect(screen.getByText(/60 секунд/i)).toBeTruthy();
  });

  it("redirects unknown game to hub", () => {
    render(
      <MemoryRouter initialEntries={["/game/nope"]}>
        <Routes>
          <Route path="/game/:name" element={<GamePlayPage />} />
          <Route path="/game" element={<GamesHubPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /Молния/i })).toBeTruthy();
  });
});

describe("RiddlePage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/riddle/status")) {
          return new Response(
            JSON.stringify({
              history: [],
              left: 5,
              asked: 0,
              limit: 5,
              finished: false,
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
  });

  it("loads status and start button", async () => {
    render(
      <MemoryRouter>
        <RiddlePage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText(/осталось слотов:\s*5/i),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Начать раунд/i }),
    ).toBeTruthy();
  });
});
