import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ContentRepository } from "../../content/ContentRepository";
import { parseContentBundle } from "../../content/parseContentBundle";
import type { TheoryArticleModel } from "../../types/content";
import { TheoryArticlePage } from "./TheoryArticlePage";

const theoryDir = path.dirname(fileURLToPath(import.meta.url));

function articleFixture(overrides: Partial<TheoryArticleModel> = {}): TheoryArticleModel {
  return {
    topicId: 0,
    topicTitle: "Основы",
    topicDescription: "Введение",
    title: "Основы Python",
    kind: "article",
    leadHtml: "<p>Лид</p>",
    sections: [],
    mistakes: [],
    applicationsHtml: [],
    summaryHtml: [],
    prevLabel: null,
    nextLabel: null,
    firstTaskId: "0.1",
    teaserHtml: "",
    exampleCode: null,
    ...overrides,
  };
}

function repoWithLookup(
  lookup: ReturnType<ContentRepository["getTheoryArticle"]>,
): ContentRepository {
  const repo = new ContentRepository({
    load: async () =>
      parseContentBundle({
        schema_version: 2,
        content_version: "aaaaaaaaaaaaaaaa",
        content_hash: "sha256:" + "a".repeat(64),
        python_runtime: "3.14.x",
        topics: [
          {
            id: 0,
            title: "Основы",
            level: "beginner",
            level_label: "начальный",
            description: "Введение",
            theory: {
              title: "Основы Python",
              lead: "Лид",
              text: "Текст",
              sections: [{ title: "S", text: "p", examples: [] }],
              mistakes: [],
              applications: [],
              summary: [],
            },
            tasks: [{ id: "0.1" }],
          },
        ],
      }),
  });
  const original = repo.getTheoryArticle.bind(repo);
  repo.getTheoryArticle = (topicId: number) => {
    if (lookup.status === "not_found") return lookup;
    if (lookup.status === "error") return lookup;
    if (topicId === lookup.article.topicId) return lookup;
    return original(topicId);
  };
  return repo;
}

describe("TheoryArticlePage", () => {
  it("shows not found for missing topic", async () => {
    const repo = repoWithLookup({ status: "not_found" });
    await repo.ensureLoaded();

    render(
      <MemoryRouter initialEntries={["/topic/999/theory"]}>
        <Routes>
          <Route
            path="/topic/:id/theory"
            element={<TheoryArticlePage repository={repo} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /не найден/i })).toBeTruthy();
  });

  it("renders article title and CTA to first task", async () => {
    const repo = repoWithLookup({
      status: "ok",
      article: articleFixture({ title: "Основы Python", firstTaskId: "0.1" }),
    });
    await repo.ensureLoaded();

    render(
      <MemoryRouter initialEntries={["/topic/0/theory"]}>
        <Routes>
          <Route
            path="/topic/:id/theory"
            element={<TheoryArticlePage repository={repo} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: /Основы/i }),
    ).toBeTruthy();
    const cta = screen.getByRole("link", { name: /К первому этапу/i });
    expect(cta.getAttribute("href")).toMatch(/0\.1/);
  });

  it("does not import python runner on theory page module graph", () => {
    const sources = [
      "TheoryArticlePage.tsx",
      "TheoryArticleBody.tsx",
      path.join("..", "..", "components", "CodeExample", "CodeExample.tsx"),
    ];
    for (const rel of sources) {
      const src = readFileSync(path.join(theoryDir, rel), "utf8");
      expect(src).not.toMatch(/pythonRunner/);
    }
  });
});
