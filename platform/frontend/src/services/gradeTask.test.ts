import { describe, expect, it, vi } from "vitest";
import { gradeTask } from "./gradeTask";

describe("gradeTask", () => {
  it("does not offer self grading when the isolated runtime is unavailable", async () => {
    const result = await gradeTask(
      { id: "3.1", type: "исправить ошибку", code: "print(3)", answer: "print(4)", check: null },
      { code: "print(4)" },
      { runPython: async () => ({ stdout: "", error: "unavailable", blocked: true }) },
    );
    expect(result).toEqual({ kind: "blocked", error: "unavailable" });
  });
  it("marks demo as auto ok", async () => {
    const r = await gradeTask(
      { id: "0.1", type: "демо", code: null, answer: "x", check: null },
      { code: "print(1)" },
    );
    expect(r).toEqual({ kind: "auto", ok: true });
  });

  it("compares prediction text with outputsEqual", async () => {
    const ok = await gradeTask(
      {
        id: "1.1",
        type: "определить вывод",
        code: "print(1)",
        answer: "1",
        check: null,
      },
      { text: "1" },
    );
    expect(ok).toEqual({ kind: "auto", ok: true });

    const bad = await gradeTask(
      {
        id: "1.1",
        type: "определить вывод",
        code: "print(1)",
        answer: "1",
        check: null,
      },
      { text: "2" },
    );
    expect(bad).toEqual({ kind: "auto", ok: false });
  });

  it("returns self for объяснить поведение", async () => {
    const r = await gradeTask(
      {
        id: "2.1",
        type: "объяснить поведение",
        code: null,
        answer: "потому что",
        check: null,
      },
      { text: "любой текст" },
    );
    expect(r).toEqual({ kind: "self" });
  });

  it("runs check.append and compares expect", async () => {
    const runPython = vi.fn(async (code: string) => {
      if (code.includes("assert")) return { stdout: "OK" };
      return { stdout: "" };
    });
    const r = await gradeTask(
      {
        id: "3.5",
        type: "написать функцию",
        code: "def reverse(s): return s[::-1]",
        answer: "def reverse(s): return s[::-1]",
        check: {
          append: 'assert reverse("ab")=="ba"\nprint("OK")',
          expect: "OK",
        },
      },
      { code: "def reverse(s): return s[::-1]" },
      { runPython },
    );
    expect(r).toEqual({
      kind: "auto",
      ok: true,
      got: "OK",
      expected: "OK",
    });
    expect(runPython).toHaveBeenCalledOnce();
  });
});
