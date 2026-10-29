import type {
  RawTask,
  RawTopic,
  TaskCheckModel,
  TaskIntroSummary,
  TaskPageModel,
  TaskQuestionModel,
} from "../types/content";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asWrong(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map((w) => String(w).trim()).filter(Boolean);
  return items.length ? items : null;
}

function asQuestions(value: unknown): TaskQuestionModel[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map((q) => {
    const row = q && typeof q === "object" ? (q as Record<string, unknown>) : {};
    return {
      prompt: asString(row.prompt),
      answer: asString(row.answer),
      wrong: asWrong(row.wrong),
      explanation: asString(row.explanation),
    };
  });
}

function asCheck(value: unknown): TaskCheckModel {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const append =
    typeof row.append === "string" ? row.append : undefined;
  const expect =
    typeof row.expect === "string" ? row.expect : undefined;
  if (append === undefined && expect === undefined) return null;
  return { append, expect };
}

function asIntro(task: RawTask): TaskIntroSummary {
  const intro =
    task.intro && typeof task.intro === "object" && !Array.isArray(task.intro)
      ? (task.intro as Record<string, unknown>)
      : null;
  if (!intro) {
    return {
      goal: "",
      text: "",
      concepts: [],
      explanation: "",
      example: null,
      application: "",
      html: false,
    };
  }
  const goal = asString(intro.goal);
  const explanation =
    asString(intro.explanation) || asString(intro.text) || goal;
  const text = asString(intro.text) || explanation || goal;
  const concepts = Array.isArray(intro.concepts)
    ? intro.concepts.map((c) => String(c)).filter(Boolean)
    : [];
  let example: string | null = null;
  if (typeof intro.example === "string") example = intro.example;
  else if (
    intro.example &&
    typeof intro.example === "object" &&
    !Array.isArray(intro.example)
  ) {
    const ex = intro.example as Record<string, unknown>;
    if (typeof ex.code === "string") example = ex.code;
  }
  return {
    goal,
    text,
    concepts,
    explanation,
    example,
    application: asString(intro.application),
    html: true,
  };
}

export function normalizeTask(task: RawTask, topic: RawTopic): TaskPageModel {
  return {
    id: asString(task.id),
    type: asString(task.type),
    title: asString(task.title),
    prompt: asString(task.prompt),
    code: asStringOrNull(task.code),
    answer: asString(task.answer),
    explanation: asString(task.explanation),
    hint: asStringOrNull(task.hint),
    wrong: asWrong(task.wrong),
    questions: asQuestions(task.questions),
    check: asCheck(task.check),
    challenge: task.challenge === true,
    level: topic.level,
    topicId: topic.id,
    topicTitle: topic.title,
    topicLevel: topic.level,
    topicLevelLabel: topic.level_label,
    intro: asIntro(task),
  };
}
