import { afterEach, describe, expect, it, vi } from "vitest";
import { reportDiagnostic } from "./clientDiagnostics";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as { __PYCLOUD_CLIENT_DIAGNOSTICS__?: string }).__PYCLOUD_CLIENT_DIAGNOSTICS__;
});

describe("reportDiagnostic", () => {
  it("posts allowlisted payload without code fields", () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    reportDiagnostic("runner_timeout", {
      ui: "react",
      frontendBuild: "dev",
      routeCategory: "task",
      errorCategory: "timeout",
      capabilities: { crossOriginIsolated: true },
    });
    expect(fetchMock).toHaveBeenCalled();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1].body));
    expect(body.event).toBe("runner_timeout");
    expect(body.code).toBeUndefined();
    expect(body.username).toBeUndefined();
  });

  it("noops when diagnostics disabled", () => {
    (globalThis as { __PYCLOUD_CLIENT_DIAGNOSTICS__?: string }).__PYCLOUD_CLIENT_DIAGNOSTICS__ = "0";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    reportDiagnostic("chunk_load_failure");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
