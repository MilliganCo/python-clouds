/** Client-side project stage checks — port of project-courses.js#checkStage */

import { pythonRunner } from "./pythonRunner";

export type StageCheckSpec = {
  forbid?: string[];
  expect_contains?: string[];
  append?: string;
  expect?: string;
};

export type ProjectCheckResult = {
  ok: boolean;
  message?: string;
  stdout?: string;
  error?: string;
  expected?: string;
  kind?: string;
};

export async function checkProjectStage(
  check: StageCheckSpec | null | undefined,
  code: string,
  onStatus?: (status: string) => void,
): Promise<ProjectCheckResult> {
  const spec = check || {};
  const forbidden = (spec.forbid || []).find((needle) => code.includes(needle));
  if (forbidden) {
    return {
      ok: false,
      message: `В этом этапе пока не используйте ${forbidden}.`,
      stdout: "",
    };
  }
  const missing = (spec.expect_contains || []).filter(
    (needle) => !code.includes(needle),
  );
  if (missing.length) {
    return {
      ok: false,
      message: `Не хватает обязательных элементов: ${missing.join(", ")}.`,
      stdout: "",
    };
  }
  if (/\binput\s*\(/.test(code) && !spec.expect) {
    return {
      ok: true,
      stdout:
        "Структура этапа проверена без запуска интерактивного input().",
      kind: "project",
    };
  }

  async function runOnce(runCode: string): Promise<ProjectCheckResult> {
    const result = await pythonRunner.run(runCode, { onStatus });
    if (!result.ok) {
      const err = result.error;
      const stdout =
        err.kind === "python" || err.kind === "timeout" ? err.stdout : "";
      const message =
        err.kind === "python"
          ? err.traceback || "Код завершился ошибкой."
          : "Код завершился ошибкой.";
      return {
        ok: false,
        error: message,
        stdout,
        message: "Код завершился ошибкой.",
      };
    }
    return { ok: true, stdout: result.stdout || "", kind: "project" };
  }

  if (spec.append || spec.expect) {
    const runCode = code + "\n" + (spec.append || "");
    const result = await runOnce(runCode);
    if (!result.ok) return result;
    const stdout = result.stdout || "";
    if (
      spec.expect &&
      !stdout.trim().endsWith(String(spec.expect).trim())
    ) {
      return {
        ok: false,
        stdout,
        expected: spec.expect,
        message: "Тесты запустились, но итоговый вывод не совпал.",
      };
    }
    return {
      ok: true,
      stdout,
      expected: spec.expect || "",
      kind: "project",
    };
  }

  return runOnce(code);
}
