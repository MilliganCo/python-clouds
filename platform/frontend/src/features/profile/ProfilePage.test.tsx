import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentRepository } from "../../content/ContentRepository";
import { parseContentBundle } from "../../content/parseContentBundle";
import type { ShellOutletContext } from "../shell/ShellLayout";
import { ProfilePage } from "./ProfilePage";

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
            title: "Старт",
            prompt: "p",
            code: "print(1)",
            code_language: "python",
            answer: "a",
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

describe("ProfilePage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/stats")) {
          return new Response(
            JSON.stringify({
              streak: 2,
              solved: [
                {
                  task_id: "0.1",
                  solved_at: "2026-07-20T12:00:00",
                },
              ],
              notes_count: 1,
              member_since: "2026-07-01T00:00:00",
            }),
            { status: 200 },
          );
        }
        if (url.includes("/api/wallet")) {
          return new Response(
            JSON.stringify({
              drops: 50,
              freezes: 0,
              owned: [],
              shop: {},
              set_items: {},
            }),
            { status: 200 },
          );
        }
        if (url.includes("/api/achievements")) {
          return new Response(
            JSON.stringify({ earned: { first_solve: "2026-07-20" } }),
            { status: 200 },
          );
        }
        if (url.includes("/api/survey")) {
          return new Response(JSON.stringify({ answers: null }), {
            status: 200,
          });
        }
        if (url.includes("/api/achievements/claim")) {
          return new Response(JSON.stringify({ ok: true, new: false }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({}), { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders hero with username and streak", async () => {
    const repo = new ContentRepository({ load: async () => fixture() });
    render(
      <MemoryRouter initialEntries={["/profile"]}>
        <Routes>
          <Route
            element={<Outlet context={{ username: "example_student" } satisfies ShellOutletContext} />}
          >
            <Route
              path="/profile"
              element={<ProfilePage repository={repo} />}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /example_student/i })).toBeTruthy();
    });
    expect(screen.getByText(/серия: 2/i)).toBeTruthy();
    expect(screen.getByText(/Что нового на платформе/i, { selector: "summary" })).toBeTruthy();
  });
});
