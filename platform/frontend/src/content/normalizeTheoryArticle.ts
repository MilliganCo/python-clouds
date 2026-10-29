import { sanitizeCourseHtml } from "../services/legacyContent";
import type {
  RawTheoryExample,
  RawTheorySection,
  RawTopic,
  TheoryArticleModel,
  TheoryExampleModel,
  TheorySectionModel,
} from "../types/content";

function asMistake(value: unknown): { title: string; text: string } {
  if (value && typeof value === "object") {
    const record = value as { title?: unknown; text?: unknown };
    return {
      title: typeof record.title === "string" ? record.title : "",
      text: typeof record.text === "string" ? record.text : "",
    };
  }
  return { title: "", text: "" };
}

function normalizeExamples(examples: RawTheoryExample[] | undefined): TheoryExampleModel[] {
  return (examples ?? []).map((example) => ({
    code: typeof example.code === "string" ? example.code : "",
    explanationHtml:
      typeof example.explanation === "string"
        ? sanitizeCourseHtml(example.explanation)
        : null,
  }));
}

function normalizeSection(section: RawTheorySection): TheorySectionModel {
  const paragraphsHtml = String(section.text ?? "")
    .split(/\n\n+/)
    .map((chunk) => sanitizeCourseHtml(`<p>${chunk}</p>`));

  return {
    title: typeof section.title === "string" ? section.title : "",
    paragraphsHtml,
    examples: normalizeExamples(section.examples),
  };
}

function resolveExampleCode(raw: RawTopic["theory"]): string | null {
  if (typeof raw.example === "string") {
    return raw.example;
  }
  const firstCode = raw.sections?.[0]?.examples?.[0]?.code;
  return typeof firstCode === "string" ? firstCode : null;
}

export function normalizeTheoryArticle(topic: RawTopic): TheoryArticleModel {
  const raw = topic.theory;
  const kind =
    Array.isArray(raw.sections) && raw.sections.length > 0 ? "article" : "teaser";
  const title = raw.title || topic.title;
  const leadSource = raw.lead || raw.text || topic.description;

  return {
    topicId: topic.id,
    topicTitle: topic.title,
    topicDescription: topic.description,
    title,
    kind,
    leadHtml: sanitizeCourseHtml(raw.lead || ""),
    sections: (raw.sections ?? []).map(normalizeSection),
    mistakes: (raw.mistakes ?? []).map((mistake) => {
      const { title: mistakeTitle, text } = asMistake(mistake);
      return {
        title: mistakeTitle,
        textHtml: sanitizeCourseHtml(text),
      };
    }),
    applicationsHtml: (raw.applications ?? []).map((item) => sanitizeCourseHtml(item)),
    summaryHtml: (raw.summary ?? []).map((item) => sanitizeCourseHtml(item)),
    prevLabel: typeof raw.prev === "string" ? raw.prev : null,
    nextLabel: typeof raw.next === "string" ? raw.next : null,
    firstTaskId: topic.tasks[0]?.id ?? null,
    teaserHtml: sanitizeCourseHtml(raw.text || leadSource),
    exampleCode: resolveExampleCode(raw),
  };
}
