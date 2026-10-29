import type {
  InteractiveHandlers,
  PythonRunner,
  RunResult,
  RunnerError,
  WorkerFactory,
} from "../types/runner";
import "../../../static/python-execution.js";

type RemoteResult = { stdout: string; error: string | null; blocked?: boolean; cancelled?: boolean };
declare global {
  interface Window {
    PythonExecutionClient: {
      run(code: string, onStatus?: (text: string) => void, check?: string, onTest?: unknown, signal?: AbortSignal): Promise<RemoteResult>;
      runInteractive(code: string, handlers: InteractiveHandlers): Promise<RemoteResult>;
      cancelInteractive(): void;
      ready(): boolean;
      warmup(): void;
    };
  }
}

const RUN_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 10_000;
const MAX_INPUT_BYTES = 8192;

type PendingNormal = {
  resolve: (result: RunResult) => void;
  timer: ReturnType<typeof setTimeout>;
  onStatus?: (status: string) => void;
};

type PendingInteractive = {
  resolve: (result: RunResult) => void;
  handlers: InteractiveHandlers;
  control: Int32Array;
  dataBuf: Uint8Array;
  timer: ReturnType<typeof setTimeout> | null;
  resetIdle: () => void;
};

/**
 * Module worker from /public. Pyodide 314+ requires module workers
 * (classic + importScripts throws "Classic web workers are not supported").
 * Pyodide assets come from same-origin `/pyodide/*` (Vite proxy).
 */
function createDefaultWorker(): Worker {
  const base = import.meta.env.BASE_URL || "/";
  const path = base.endsWith("/")
    ? `${base}runner-worker.js`
    : `${base}/runner-worker.js`;
  return new Worker(path, { type: "module" });
}

function createRunner(
  createWorker: WorkerFactory = createDefaultWorker,
  options?: { runTimeoutMs?: number; idleTimeoutMs?: number },
): PythonRunner {
  const runTimeoutMs = options?.runTimeoutMs ?? RUN_TIMEOUT_MS;
  const idleTimeoutMs = options?.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  let worker: Worker | null = null;
  let workerReady: Promise<void> | null = null;
  let seq = 0;
  let activeRunId: number | null = null;
  const pending = new Map<number, PendingNormal>();
  const interactivePending = new Map<number, PendingInteractive>();
  let statusCb: ((status: string) => void) | null = null;

  function killWorker(): void {
    try {
      worker?.terminate();
    } catch {
      /* already dead */
    }
    worker = null;
    workerReady = null;
  }

  function finishCancelled(runId: number): void {
    const p = pending.get(runId);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(runId);
      p.resolve({ ok: false, error: { kind: "cancelled" } });
    }
    const ip = interactivePending.get(runId);
    if (ip) {
      if (ip.timer) clearTimeout(ip.timer);
      interactivePending.delete(runId);
      ip.resolve({ ok: false, error: { kind: "cancelled" } });
    }
  }

  /** Cancel current owned run (preempt / abort / unmount). */
  function cancelActive(reason: "preempt" | "abort" | "explicit" = "explicit"): void {
    void reason;
    if (activeRunId == null && !interactivePending.size && !pending.size) {
      return;
    }
    const id = activeRunId;
    activeRunId = null;
    if (id != null) finishCancelled(id);
    for (const runId of [...pending.keys()]) finishCancelled(runId);
    for (const runId of [...interactivePending.keys()]) finishCancelled(runId);
    killWorker();
  }

  function ensureWorker(): Promise<void> {
    if (worker && workerReady) return workerReady;

    workerReady = (async () => {
      let settle!: (value: void | PromiseLike<void>) => void;
      let reject!: (reason?: unknown) => void;
      const ready = new Promise<void>((res, rej) => {
        settle = res;
        reject = rej;
      });

      try {
        const created = createWorker();
        worker =
          created instanceof Promise ? await created : created;
      } catch (err) {
        workerReady = null;
        throw {
          kind: "worker-init",
          message: err instanceof Error ? err.message : String(err),
        } satisfies RunnerError;
      }

      worker.onerror = () => {
        reject(new Error("worker-crash"));
        killWorker();
      };

      worker.onmessage = (e: MessageEvent) => {
        const d = e.data as {
          type: string;
          text?: string;
          id?: number;
          stdout?: string;
          error?: string | null;
          chunk?: string;
        };

        if (d.type === "status") {
          statusCb?.(d.text ?? "");
          return;
        }
        if (d.type === "ready") {
          settle();
          return;
        }

        if (d.type === "result" && typeof d.id === "number") {
          if (activeRunId !== null && d.id !== activeRunId) return; // stale
          const p = pending.get(d.id);
          if (!p) return;
          pending.delete(d.id);
          clearTimeout(p.timer);
          if (activeRunId === d.id) activeRunId = null;
          if (d.error) {
            p.resolve({
              ok: false,
              error: {
                kind: "python",
                traceback: String(d.error),
                stdout: d.stdout ?? "",
              },
            });
          } else {
            p.resolve({ ok: true, stdout: d.stdout ?? "" });
          }
          return;
        }

        const ip =
          typeof d.id === "number" ? interactivePending.get(d.id) : undefined;
        if (!ip) return;
        if (activeRunId !== null && d.id !== activeRunId) return;

        if (d.type === "output") {
          ip.resetIdle();
          ip.handlers.onOutput?.(d.chunk ?? "");
        } else if (d.type === "input_request") {
          if (ip.timer) clearTimeout(ip.timer);
          Promise.resolve(
            ip.handlers.onInputRequest ? ip.handlers.onInputRequest() : "",
          )
            .then((answer) => {
              if (!interactivePending.has(d.id!)) return;
              const bytes = new TextEncoder()
                .encode(String(answer ?? ""))
                .slice(0, MAX_INPUT_BYTES);
              ip.dataBuf.set(bytes);
              Atomics.store(ip.control, 1, bytes.length);
              Atomics.store(ip.control, 0, 2);
              Atomics.notify(ip.control, 0);
              ip.resetIdle();
            })
            .catch(() => {
              /* input handler failed — leave wait; idle timeout will cancel */
            });
        } else if (d.type === "done") {
          interactivePending.delete(d.id!);
          if (ip.timer) clearTimeout(ip.timer);
          if (activeRunId === d.id) activeRunId = null;
          if (d.error) {
            ip.resolve({
              ok: false,
              error: {
                kind: "python",
                traceback: String(d.error),
                stdout: "",
              },
            });
          } else {
            ip.resolve({ ok: true, stdout: "" });
          }
        }
      };

      await ready;
    })().catch((err) => {
      killWorker();
      throw err;
    });

    return workerReady;
  }

  async function warmup(): Promise<void> {
    try {
      await ensureWorker();
    } catch {
      /* warmup is best-effort */
    }
  }

  async function run(
    code: string,
    options?: { onStatus?: (status: string) => void; signal?: AbortSignal },
  ): Promise<RunResult> {
    if (options?.signal?.aborted) {
      return { ok: false, error: { kind: "cancelled" } };
    }

    // Single-flight policy: preempt previous run.
    cancelActive("preempt");

    statusCb = options?.onStatus ?? null;
    try {
      await ensureWorker();
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: "worker-init",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }

    const runId = ++seq;
    activeRunId = runId;

    return new Promise<RunResult>((resolve) => {
      const onAbort = () => {
        if (activeRunId === runId) cancelActive("abort");
      };
      options?.signal?.addEventListener("abort", onAbort, { once: true });

      const timer = setTimeout(() => {
        if (!pending.has(runId)) return;
        pending.delete(runId);
        if (activeRunId === runId) activeRunId = null;
        killWorker();
        statusCb?.("");
        options?.signal?.removeEventListener("abort", onAbort);
        resolve({
          ok: false,
          error: { kind: "timeout", limitMs: runTimeoutMs, stdout: "" },
        });
      }, runTimeoutMs);

      pending.set(runId, {
        resolve: (result) => {
          options?.signal?.removeEventListener("abort", onAbort);
          resolve(result);
        },
        timer,
        onStatus: options?.onStatus,
      });

      try {
        worker!.postMessage({ id: runId, code });
      } catch (err) {
        pending.delete(runId);
        clearTimeout(timer);
        if (activeRunId === runId) activeRunId = null;
        options?.signal?.removeEventListener("abort", onAbort);
        resolve({
          ok: false,
          error: {
            kind: "worker-crash",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    });
  }

  async function runInteractive(
    code: string,
    handlers: InteractiveHandlers,
  ): Promise<RunResult> {
    cancelActive("preempt");
    statusCb = handlers.onStatus ?? null;

    if (typeof SharedArrayBuffer === "undefined") {
      return {
        ok: false,
        error: {
          kind: "unsupported",
          reason: "SharedArrayBuffer unavailable (cross-origin isolation required)",
        },
      };
    }

    try {
      await ensureWorker();
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: "worker-init",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }

    const runId = ++seq;
    activeRunId = runId;

    return new Promise<RunResult>((resolve) => {
      const control = new Int32Array(new SharedArrayBuffer(8));
      const dataBuf = new Uint8Array(new SharedArrayBuffer(MAX_INPUT_BYTES));
      const entry: PendingInteractive = {
        resolve,
        handlers,
        control,
        dataBuf,
        timer: null,
        resetIdle() {
          if (entry.timer) clearTimeout(entry.timer);
          entry.timer = setTimeout(() => {
            interactivePending.delete(runId);
            if (activeRunId === runId) activeRunId = null;
            killWorker();
            statusCb?.("");
            resolve({
              ok: false,
              error: { kind: "timeout", limitMs: idleTimeoutMs, stdout: "" },
            });
          }, idleTimeoutMs);
        },
      };
      interactivePending.set(runId, entry);
      entry.resetIdle();
      worker!.postMessage({
        id: runId,
        code,
        interactive: true,
        sab: { control: control.buffer, data: dataBuf.buffer },
      });
    });
  }

  function cancelInteractive(): void {
    cancelActive("explicit");
  }

  return {
    warmup,
    run,
    runInteractive,
    cancelInteractive,
    isReady: () => !!worker,
  };
}

/** App singleton. Tests should use `createPythonRunnerForTests`. */
function remoteResult(result: RemoteResult): RunResult {
  if (result.cancelled) return { ok: false, error: { kind: "cancelled" } };
  if (result.blocked) return { ok: false, error: { kind: "unsupported", reason: result.error || "Изолированный Python недоступен." } };
  if (result.error) return { ok: false, error: { kind: "python", traceback: result.error, stdout: result.stdout } };
  return { ok: true, stdout: result.stdout };
}
export const pythonRunner: PythonRunner = Object.freeze<PythonRunner>({
  warmup: async () => window.PythonExecutionClient.warmup(),
  run: async (code, options) => remoteResult(await window.PythonExecutionClient.run(code, options?.onStatus, undefined, undefined, options?.signal)),
  runInteractive: async (code, handlers) => remoteResult(await window.PythonExecutionClient.runInteractive(code, handlers)),
  cancelInteractive: () => window.PythonExecutionClient.cancelInteractive(),
  isReady: () => window.PythonExecutionClient.ready(),
});

export function createPythonRunnerForTests(
  createWorker: WorkerFactory,
  options?: { runTimeoutMs?: number; idleTimeoutMs?: number },
): PythonRunner {
  return createRunner(createWorker, options);
}
