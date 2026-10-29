export type RunnerError =
  | { kind: "python"; traceback: string; stdout: string }
  | { kind: "timeout"; limitMs: number; stdout: string }
  | { kind: "worker-init"; message: string }
  | { kind: "worker-crash"; message: string }
  | { kind: "cancelled" }
  | { kind: "busy" }
  | { kind: "unsupported"; reason: string };

export type RunResult =
  | { ok: true; stdout: string }
  | { ok: false; error: RunnerError };

export type InteractiveHandlers = {
  onOutput?: (chunk: string) => void;
  onInputRequest?: () => Promise<string> | string;
  onStatus?: (status: string) => void;
};

/** Policy: preempt — starting a new run cancels the previous owned run. */
export interface PythonRunner {
  warmup(): Promise<void>;
  run(
    code: string,
    options?: { onStatus?: (status: string) => void; signal?: AbortSignal },
  ): Promise<RunResult>;
  runInteractive(code: string, handlers: InteractiveHandlers): Promise<RunResult>;
  cancelInteractive(): void;
  isReady(): boolean;
}

export type WorkerFactory = () => Worker | Promise<Worker>;
