import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiPost, ApiError, UnauthorizedError } from "./api";
import { parseMe, parseWallet, ContractError } from "./parse";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiGet", () => {
  it("throws UnauthorizedError on 401 without redirect", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet("/api/me", parseMe)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me",
      expect.objectContaining({ credentials: "same-origin", method: "GET" }),
    );
  });

  it("parses successful me payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ username: "example_student" }), { status: 200 }),
      ),
    );
    await expect(apiGet("/api/me", parseMe)).resolves.toEqual({ username: "example_student" });
  });

  it("throws ApiError on non-401 failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
      ),
    );
    await expect(apiGet("/api/me", parseMe)).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      endpoint: "/api/me",
      message: "boom",
    } satisfies Partial<ApiError>);
  });
});

describe("apiPost", () => {
  it("throws UnauthorizedError on 401 for protected posts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(
      apiPost("/api/progress", { task_id: "1.1", solved: true }, (v) => v),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("parsers", () => {
  it("parseWallet accepts wallet shape", () => {
    expect(
      parseWallet({ drops: 10, freezes: 1, owned: ["sky_dawn"], shop: {} }),
    ).toEqual({
      drops: 10,
      freezes: 1,
      owned: ["sky_dawn"],
      shop: {},
      set_items: {},
    });
  });

  it("parseMe rejects invalid payload", () => {
    expect(() => parseMe({})).toThrow(ContractError);
  });
});
