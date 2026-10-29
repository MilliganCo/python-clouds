import { afterEach, describe, expect, it, vi } from "vitest";
import { createPythonRunnerForTests, pythonRunner } from "./pythonRunner";
import type { PythonRunner } from "../types/runner";

type Handler = ((ev: MessageEvent) => void) | null;

it("fails closed without creating a browser worker when server execution is unavailable", async () => {
  const worker = vi.fn(() => { throw new Error("Unexpected worker"); });
  vi.stubGlobal("Worker", worker);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "runtime unavailable" }) })));
  try {
    await pythonRunner.warmup();
    const handlers = { onOutput: vi.fn(), onInputRequest: vi.fn(), onStatus: vi.fn() };
    for (const code of ["print(4)", "import js; js.fetch('/api/me')", "exec('import os')", "while True: pass"]) {
      for (const result of [await pythonRunner.run(code), await pythonRunner.runInteractive(code, handlers)]) {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.kind).toBe("unsupported");
        }
      }
    }
    pythonRunner.cancelInteractive();
    expect(pythonRunner.isReady()).toBe(false);
    expect(worker).not.toHaveBeenCalled();
    expect(handlers.onOutput).not.toHaveBeenCalled();
    expect(handlers.onInputRequest).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

class FakeWorker {
  onmessage: Handler = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;
  posts: unknown[] = [];
  autoResult = true;
  hang = false;

  constructor() {
    queueMicrotask(() => {
      if (!this.terminated) this.emit({ type: "ready" });
    });
  }

  postMessage(data: unknown): void {
    this.posts.push(data);
    if (this.hang || this.terminated) return;
    const msg = data as { id: number; code?: string; interactive?: boolean };
    queueMicrotask(() => {
      if (this.terminated || this.hang) return;
      if (msg.interactive) {
        this.emit({ type: "done", id: msg.id, error: null });
        return;
      }
      if (this.autoResult) {
        this.emit({
          type: "result",
          id: msg.id,
          stdout: `out:${msg.code ?? ""}`,
          error: null,
        });
      }
    });
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitResult(id: number, stdout: string, error: string | null = null): void {
    this.emit({ type: "result", id, stdout, error });
  }
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error(`timeout waiting for ${label}`);
}

describe("pythonRunner single-flight", () => {
  let workers: FakeWorker[] = [];
  let runner: PythonRunner;

  afterEach(() => {
    runner?.cancelInteractive();
    workers = [];
  });

  function freshRunner(
    customize?: (w: FakeWorker) => void,
    opts?: { runTimeoutMs?: number },
  ): PythonRunner {
    workers = [];
    runner = createPythonRunnerForTests(() => {
      const w = new FakeWorker();
      customize?.(w);
      workers.push(w);
      return w as unknown as Worker;
    }, opts);
    return runner;
  }

  it("warmup creates at most one worker", async () => {
    const r = freshRunner();
    await r.warmup();
    await r.warmup();
    expect(workers).toHaveLength(1);
    expect(r.isReady()).toBe(true);
  });

  it("second run preempts the first (cancelled)", async () => {
    const r = freshRunner((w) => {
      w.hang = true;
      w.autoResult = false;
    });

    const first = r.run("print(1)");
    await waitFor(() => (workers[0]?.posts.length ?? 0) >= 1, "first postMessage");
    const second = r.run("print(2)");
    await expect(first).resolves.toEqual({ ok: false, error: { kind: "cancelled" } });

    await waitFor(() => workers.length >= 1 && workers[workers.length - 1].posts.length >= 1, "second post");
    const w = workers[workers.length - 1];
    w.hang = false;
    const lastPost = w.posts[w.posts.length - 1] as { id: number };
    w.emitResult(lastPost.id, "2");
    await expect(second).resolves.toEqual({ ok: true, stdout: "2" });
  });

  it("AbortSignal cancels owned run", async () => {
    const r = freshRunner((w) => {
      w.hang = true;
      w.autoResult = false;
    });
    const ac = new AbortController();
    const p = r.run("hang", { signal: ac.signal });
    await waitFor(() => (workers[0]?.posts.length ?? 0) >= 1, "hang postMessage");
    ac.abort();
    await expect(p).resolves.toEqual({ ok: false, error: { kind: "cancelled" } });
  });

  it("ignores stale result from old runId", async () => {
    const r = freshRunner((w) => {
      w.hang = true;
      w.autoResult = false;
    });
    const first = r.run("one");
    await waitFor(() => (workers[0]?.posts.length ?? 0) >= 1, "first post");
    const second = r.run("two");
    await first;
    await waitFor(() => workers[workers.length - 1].posts.length >= 1, "second post");
    const w = workers[workers.length - 1];
    w.emitResult(1, "stale");
    const last = w.posts[w.posts.length - 1] as { id: number };
    w.emitResult(last.id, "fresh");
    await expect(second).resolves.toEqual({ ok: true, stdout: "fresh" });
  });

  it("maps python error from worker", async () => {
    const r = freshRunner((w) => {
      w.autoResult = false;
      w.postMessage = (data: unknown) => {
        w.posts.push(data);
        const msg = data as { id: number };
        queueMicrotask(() => {
          w.emitResult(msg.id, "partial", "Traceback");
        });
      };
    });
    await expect(r.run("bad")).resolves.toEqual({
      ok: false,
      error: { kind: "python", traceback: "Traceback", stdout: "partial" },
    });
  });

  it("timeout returns structured timeout error", async () => {
    const r = freshRunner(
      (w) => {
        w.hang = true;
        w.autoResult = false;
      },
      { runTimeoutMs: 30 },
    );
    await expect(r.run("infinite")).resolves.toEqual({
      ok: false,
      error: { kind: "timeout", limitMs: 30, stdout: "" },
    });
  });
});
