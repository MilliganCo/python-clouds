export type DiagnosticEvent =
  | "react_error_boundary"
  | "chunk_load_failure"
  | "worker_init_failure"
  | "runner_timeout"
  | "cross_origin_isolation_failure"
  | "session_invalidated";

export type DiagnosticMeta = {
  routeCategory?: string;
  errorCategory?: string;
  ui?: "react" | "legacy";
  frontendBuild?: string;
  capabilities?: { crossOriginIsolated?: boolean };
};

function diagnosticsEnabled(): boolean {
  // Build-time / runtime: disabled when explicitly off via meta tag or global.
  const flag = (globalThis as { __PYCLOUD_CLIENT_DIAGNOSTICS__?: string })
    .__PYCLOUD_CLIENT_DIAGNOSTICS__;
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return true;
}

/** Best-effort privacy-safe client diagnostics. Never sends code/PII. */
export function reportDiagnostic(event: DiagnosticEvent, meta?: DiagnosticMeta): void {
  if (!diagnosticsEnabled()) return;
  const payload = {
    event,
    ui: meta?.ui,
    frontendBuild: meta?.frontendBuild,
    routeCategory: meta?.routeCategory,
    errorCategory: meta?.errorCategory,
    capabilities: meta?.capabilities
      ? { crossOriginIsolated: !!meta.capabilities.crossOriginIsolated }
      : undefined,
  };
  try {
    void fetch("/api/client-diagnostics", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {
      /* ignore network errors */
    });
  } catch {
    /* ignore */
  }
}
