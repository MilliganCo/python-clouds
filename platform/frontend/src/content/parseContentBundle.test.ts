import { describe, it, expect } from "vitest";
import { parseContentBundle, findRawTopic } from "./parseContentBundle";
import { ContentParseError } from "../types/content";

describe("parseContentBundle", () => {
  it("rejects non-object", () => {
    expect(() => parseContentBundle(null)).toThrow(ContentParseError);
  });

  it("requires schema_version 2 and topics array", () => {
    expect(() =>
      parseContentBundle({ schema_version: 1, topics: [] }),
    ).toThrow(/schema_version/);
  });

  it("parses minimal topic with theory text", () => {
    const bundle = parseContentBundle({
      schema_version: 2,
      content_version: "aaaaaaaaaaaaaaaa",
      content_hash: "sha256:" + "a".repeat(64),
      python_runtime: "3.14.x",
      topics: [
        {
          id: 0,
          title: "T",
          level: "beginner",
          level_label: "начальный",
          description: "D",
          theory: { text: "Hello <code>x</code>" },
          tasks: [
            {
              id: "0.1",
              type: "демо",
              title: "",
              prompt: "p",
              code: null,
              code_language: "python",
              answer: "a",
              answer_language: "text",
              explanation: "e",
              verified: "manual",
              hint: null,
              intro: { text: "i" },
              check: null,
              wrong: null,
              questions: null,
            },
          ],
        },
      ],
    });
    expect(findRawTopic(bundle, 0)?.theory.text).toContain("Hello");
    expect(findRawTopic(bundle, 99)).toBeNull();
  });
});
