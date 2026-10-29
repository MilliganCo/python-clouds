import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyPage } from "./DailyPage";

const payload = {
  day: "2026-07-21",
  pending: false,
  solved: [] as string[],
  drops: { intermediate: 15, advanced: 25, expert: 40 },
  tasks: {
    intermediate: {
      title: "Сумма двух",
      prompt: "Напишите функцию **add**.",
      func_name: "add",
      starter: "def add(a, b):\n    pass\n",
      tests: "assert add(1, 2) == 3\nprint('OK')\n",
    },
  },
};

describe("DailyPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/daily-ai") && !url.includes("solve")) {
          return new Response(JSON.stringify(payload), { status: 200 });
        }
        if (url.includes("/api/daily-ai/solve")) {
          return new Response(
            JSON.stringify({ ok: true, awarded: 15, drops: 115 }),
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
      localStorage.removeItem("pycloud:daily:2026-07-21:intermediate");
    } catch {
      /* ignore */
    }
  });

  it("renders daily challenge for intermediate", async () => {
    render(
      <MemoryRouter initialEntries={["/daily/intermediate"]}>
        <Routes>
          <Route path="/daily/:diff" element={<DailyPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /Сумма двух/i })).toBeTruthy();
    expect(screen.getByText(/средний/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Запустить/i })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Отправить на проверку/i }),
    ).toBeTruthy();
  });

  it("shows pending when difficulty missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ...payload,
            tasks: {},
            pending: true,
          }),
          { status: 200 },
        ),
      ),
    );

    render(
      <MemoryRouter initialEntries={["/daily/advanced"]}>
        <Routes>
          <Route path="/daily/:diff" element={<DailyPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/ещё придумывает задание/i),
    ).toBeTruthy();
  });

  it("resets editor to starter", async () => {
    render(
      <MemoryRouter initialEntries={["/daily/intermediate"]}>
        <Routes>
          <Route path="/daily/:diff" element={<DailyPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: /Сумма двух/i });
    const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "x = 1\n" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Сбросить код к исходному/i }),
    );
    await waitFor(() => {
      expect(editor.value).toContain("def add");
    });
  });
});
