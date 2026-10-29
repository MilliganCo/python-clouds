import { describe, expect, it } from "vitest";
import { outputsEqual, looseLineEq } from "./outputsEqual";
import { referenceProgram } from "./referenceProgram";

describe("outputsEqual", () => {
  it("ignores trailing blank lines", () => {
    expect(outputsEqual("1\n2\n", "1\n2")).toBe(true);
  });

  it("treats trailing spaces as equal via collapse rules", () => {
    expect(outputsEqual("hi ", "hi")).toBe(true);
  });

  it("rejects different line counts", () => {
    expect(outputsEqual("a\nb", "a")).toBe(false);
  });

  it("compares set literals without order", () => {
    expect(looseLineEq("{1, 2}", "{2, 1}")).toBe(true);
    expect(outputsEqual("{1, 2}\n", "{2, 1}")).toBe(true);
  });
});

describe("referenceProgram", () => {
  it("fills TODO placeholder for дописать код", () => {
    const code = "x = 1\n    # TODO: допишите код здесь\ny = 2\n";
    const got = referenceProgram({
      type: "дописать код",
      code,
      answer: "print(x)",
    });
    expect(got).toBe("x = 1\n    print(x)\ny = 2\n");
  });

  it("returns answer for исправить ошибку", () => {
    expect(
      referenceProgram({
        type: "исправить ошибку",
        code: "prnt(1)",
        answer: "print(1)",
      }),
    ).toBe("print(1)");
  });

  it("returns null for quiz-like types", () => {
    expect(
      referenceProgram({
        type: "квиз",
        answer: "A",
      }),
    ).toBeNull();
  });
});
