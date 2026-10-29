import { outputsEqual, referenceProgram } from "@shared/tasks";
import { pythonRunner } from "./pythonRunner";
import type { TaskPageModel } from "../types/content";

export type GradePayload = { text: string } | { code: string };

export type GradeResult =
  | { kind: "auto"; ok: boolean; got?: string; expected?: string; error?: string }
  | { kind: "self" }
  | { kind: "blocked"; error: string };

export type RunPython = (
  code: string,
  onStatus?: (status: string) => void,
) => Promise<{ stdout: string; error?: string; blocked?: boolean }>;

function normText(s: string): string {
  return String(s ?? "").trim();
}

async function defaultRunPython(
  code: string,
  onStatus?: (status: string) => void,
): Promise<{ stdout: string; error?: string; blocked?: boolean }> {
  const r = await pythonRunner.run(code, { onStatus });
  if (r.ok) return { stdout: r.stdout };
  const err = r.error;
  if (err.kind === "python") {
    return { stdout: err.stdout || "", error: err.traceback };
  }
  if (err.kind === "timeout") {
    return {
      stdout: err.stdout || "",
      error: "Превышено время выполнения (10 секунд).",
    };
  }
  if (err.kind === "cancelled") {
    return { stdout: "", error: "Запуск отменён", blocked: true };
  }
  if (err.kind === "unsupported") {
    return { stdout: "", error: err.reason, blocked: true };
  }
  return {
    stdout: "",
    error: "message" in err ? err.message : "Ошибка запуска",
    blocked: true,
  };
}

type Gradeable = Pick<
  TaskPageModel,
  "id" | "type" | "code" | "answer" | "check"
>;

/**
 * Port of app.js grade(). Inject `runPython` for unit tests.
 * Uses task.check from content-bundle (legacy window.CHECKS).
 */
export async function gradeTask(
  task: Gradeable,
  payload: GradePayload,
  options?: {
    onStatus?: (status: string) => void;
    runPython?: RunPython;
    refCache?: Record<string, string | null>;
  },
): Promise<GradeResult> {
  const runPython = options?.runPython ?? defaultRunPython;
  const onStatus = options?.onStatus;
  const refCache = options?.refCache ?? {};

  if (task.type === "определить вывод" || task.type === "квиз") {
    const text = "text" in payload ? payload.text : "";
    return { kind: "auto", ok: outputsEqual(task.answer, text) };
  }
  if (task.type === "объяснить поведение") return { kind: "self" };
  if (task.type === "демо") return { kind: "auto", ok: true };

  const chk = task.check || {};
  let expected: string | null | undefined = chk.expect ?? null;
  if (expected == null) {
    if (!(task.id in refCache)) {
      const ref = referenceProgram({
        type: task.type,
        code: task.code ?? undefined,
        answer: task.answer,
      });
      if (!ref) {
        refCache[task.id] = null;
      } else {
        const r = await runPython(ref, onStatus);
        if (r.blocked) return { kind: "blocked", error: r.error || "Python недоступен." };
        refCache[task.id] =
          r.error || !normText(r.stdout) ? null : r.stdout;
      }
    }
    expected = refCache[task.id];
    if (expected == null) return { kind: "self" };
  }

  const code = "code" in payload ? payload.code : "";
  const userCode = code + (chk.append ? "\n\n" + chk.append : "");
  const u = await runPython(userCode, onStatus);
  if (u.blocked) return { kind: "blocked", error: u.error || "Python недоступен." };
  if (u.error) {
    return { kind: "auto", ok: false, error: u.error, got: u.stdout };
  }
  return {
    kind: "auto",
    ok: outputsEqual(expected, u.stdout),
    got: u.stdout,
    expected,
  };
}
