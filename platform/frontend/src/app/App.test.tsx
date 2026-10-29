import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("App scaffold", () => {
  it("shows auth screen when /api/me returns 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/me")) {
          return new Response("{}", { status: 401 });
        }
        return new Response("{}", { status: 200 });
      }),
    );
    render(<App />);
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Python\s+в облаках/i }),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Войти$/i })).toBeTruthy();
    });
  });
});
