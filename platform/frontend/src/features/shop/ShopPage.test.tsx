import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShopPage } from "./ShopPage";

describe("ShopPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/wallet") && (!init || init.method === "GET" || !init.method)) {
          return new Response(
            JSON.stringify({
              drops: 200,
              freezes: 1,
              owned: [],
              shop: {
                sky_dawn: {
                  price: 120,
                  title: "Небо: рассвет",
                  kind: "sky",
                },
                freeze: {
                  price: 60,
                  title: "Заморозка серии",
                  kind: "consumable",
                },
              },
              set_items: {},
            }),
            { status: 200 },
          );
        }
        if (url.includes("/api/shop/buy")) {
          return new Response(
            JSON.stringify({ ok: true, drops: 80, freezes: 1 }),
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

  it("renders shop hero and catalog item", async () => {
    render(
      <MemoryRouter initialEntries={["/shop"]}>
        <Routes>
          <Route path="/shop" element={<ShopPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /^Магазин$/i })).toBeTruthy();
    expect(screen.getByText("рассвет")).toBeTruthy();
    expect(screen.getByText(/Купить · 120/i)).toBeTruthy();
  });

  it("buys an item", async () => {
    render(
      <MemoryRouter initialEntries={["/shop"]}>
        <Routes>
          <Route path="/shop" element={<ShopPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: /^Магазин$/i });
    fireEvent.click(screen.getByText(/Купить · 120/i));
    await waitFor(() => {
      expect(String(vi.mocked(fetch).mock.calls.some((c) => String(c[0]).includes("/api/shop/buy")))).toBe(
        "true",
      );
    });
  });
});
