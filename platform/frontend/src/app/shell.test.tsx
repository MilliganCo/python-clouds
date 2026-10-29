import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotMigratedPage } from "../features/shell/NotMigratedPage";
import { AuthScreen } from "../features/shell/AuthScreen";
import { OnboardingQuiz } from "../features/shell/OnboardingQuiz";
import { UnauthorizedError } from "../services/api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NotMigratedPage", () => {
  it("shows Russian not-migrated message", () => {
    const router = createMemoryRouter(
      [{ path: "/", element: <NotMigratedPage pathLabel="#/topics" /> }],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    expect(
      screen.getByRole("heading", { name: /ещё не перенесён/i }),
    ).toBeTruthy();
    expect(screen.getByText(/#\/topics/)).toBeTruthy();
  });
});

describe("AuthScreen", () => {
  it("shows form error on login 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "Неверное имя или пароль" }), {
          status: 401,
        }),
      ),
    );
    const onAuthenticated = vi.fn();
    render(<AuthScreen onAuthenticated={onAuthenticated} />);
    fireEvent.change(screen.getByLabelText(/^Имя$/i), {
      target: { value: "u" },
    });
    fireEvent.change(screen.getByLabelText(/^Пароль$/i), {
      target: { value: "badpass" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Войти$/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/Неверное/i);
    });
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("registers via tab and reports isNew", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ username: "newbie" }), { status: 200 }),
      ),
    );
    const onAuthenticated = vi.fn();
    render(<AuthScreen onAuthenticated={onAuthenticated} />);

    fireEvent.click(screen.getByRole("tab", { name: /Регистрация/i }));
    expect(screen.getByRole("button", { name: /Создать аккаунт/i })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Имя$/i), {
      target: { value: "newbie" },
    });
    fireEvent.change(screen.getByLabelText(/^Пароль$/i), {
      target: { value: "secret1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Создать аккаунт/i }));

    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledWith({
        username: "newbie",
        isNew: true,
      });
    });
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain(
      "/api/register",
    );
  });
});

describe("OnboardingQuiz", () => {
  it("posts survey on Готово", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    render(<OnboardingQuiz open onClose={onClose} />);

    fireEvent.click(
      screen.getByRole("button", { name: /Знаю основы/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Готово$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
    const first = fetchMock.mock.calls[0] as unknown as
      | [unknown, RequestInit?]
      | undefined;
    const body = JSON.parse(String(first?.[1]?.body ?? "{}"));
    expect(body.answers.experience).toBe("Знаю основы");
  });

  it("skips without posting", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    render(<OnboardingQuiz open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Пропустить/i }));
    expect(onClose).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("session UnauthorizedError type", () => {
  it("is distinguishable for session boundary", () => {
    const err = new UnauthorizedError("/api/me");
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.status).toBe(401);
  });
});
