import { findRawTopic, parseContentBundle } from "./parseContentBundle";
import { normalizeTheoryArticle } from "./normalizeTheoryArticle";
import { normalizeTask } from "./normalizeTask";
import { CHALLENGE_XP_META, findChallenge } from "./challengesMeta";
import { HINT_BY_TYPE, TYPE_STAGE } from "./stageLessons";
import type { TaskXpMeta } from "../services/rankProgress";
import type {
  CatalogChallengeModel,
  CatalogTaskModel,
  CatalogTopicModel,
  RawContentBundle,
  RawTask,
  RawTopic,
  TaskPageModel,
  TheoryArticleModel,
} from "../types/content";

export type TheoryLookupResult =
  | { status: "ok"; article: TheoryArticleModel }
  | { status: "not_found" }
  | { status: "error"; message: string };

export type TaskLookupResult =
  | { status: "ok"; task: TaskPageModel }
  | { status: "not_found" }
  | { status: "error"; message: string };

type ContentRepositoryOptions = {
  load?: () => Promise<RawContentBundle>;
};

async function defaultLoad(): Promise<RawContentBundle> {
  const mod = await import("@content-bundle");
  const data = (mod as { default: unknown }).default ?? mod;
  return parseContentBundle(data);
}

/** Legacy theoryTeaser: first sentence of THEORY.text without HTML tags. */
function theoryTeaserPlain(topic: RawTopic): string {
  const text = String(topic.theory?.text ?? "");
  const plain = text.replace(/<[^>]+>/g, "");
  const m = plain.match(/^.*?[.!?](?=\s|$)/);
  return m ? m[0] : plain.slice(0, 120);
}

function stageTitle(task: CatalogTaskModel, limit = 56): string {
  const named = String(task.title || "").replace(/\s+/g, " ").trim();
  const prompt = String(task.prompt || "").replace(/\s+/g, " ").trim();
  const raw = named || (prompt.length <= limit ? prompt : prompt.slice(0, limit - 1).trimEnd() + "…");
  if (raw.length <= limit) return raw;
  return raw.slice(0, limit - 1).trimEnd() + "…";
}

function asCatalogTask(task: RawTask, level: string): CatalogTaskModel {
  return {
    id: task.id,
    type: typeof task.type === "string" ? task.type : "",
    title: typeof task.title === "string" ? task.title : "",
    prompt: typeof task.prompt === "string" ? task.prompt : "",
    code: typeof task.code === "string" ? task.code : null,
    challenge: task.challenge === true,
    level,
  };
}

export function catalogStageTitle(task: CatalogTaskModel, limit = 56): string {
  return stageTitle(task, limit);
}

export function firstUnsolvedTask(
  tasks: CatalogTaskModel[],
  solved: ReadonlySet<string>,
): CatalogTaskModel | null {
  return tasks.find((t) => !solved.has(t.id)) ?? null;
}

export class ContentRepository {
  private bundle: RawContentBundle | null = null;
  private loadPromise: Promise<void> | null = null;
  private readonly loadFn: () => Promise<RawContentBundle>;

  constructor(options: ContentRepositoryOptions = {}) {
    this.loadFn = options.load ?? defaultLoad;
  }

  async ensureLoaded(): Promise<void> {
    if (this.bundle !== null) {
      return;
    }
    if (this.loadPromise !== null) {
      return this.loadPromise;
    }
    this.loadPromise = this.loadFn()
      .then((bundle) => {
        this.bundle = bundle;
      })
      .catch((err) => {
        this.loadPromise = null;
        throw err;
      });
    return this.loadPromise;
  }

  getTheoryArticle(topicId: number): TheoryLookupResult {
    if (this.bundle === null) {
      return { status: "error", message: "Content bundle not loaded" };
    }
    const topic = findRawTopic(this.bundle, topicId);
    if (topic === null) {
      return { status: "not_found" };
    }
    return { status: "ok", article: normalizeTheoryArticle(topic) };
  }

  /**
   * Find task by id across topics, or challenge content from challengesMeta.
   */
  getTask(id: string): TaskLookupResult {
    if (this.bundle === null) {
      return { status: "error", message: "Content bundle not loaded" };
    }
    for (const topic of this.bundle.topics) {
      const raw = topic.tasks.find((t) => t.id === id);
      if (raw) {
        return { status: "ok", task: normalizeTask(raw, topic) };
      }
    }
    const ch = findChallenge(id);
    if (ch) {
      const topic = findRawTopic(this.bundle, ch.topicId);
      if (!topic) return { status: "not_found" };
      return {
        status: "ok",
        task: {
          id: ch.id,
          type: "написать функцию",
          title: ch.title,
          prompt: ch.prompt,
          code: null,
          answer: ch.answer,
          explanation: ch.explanation,
          hint: null,
          wrong: null,
          questions: null,
          check: ch.check,
          challenge: true,
          level: topic.level,
          topicId: topic.id,
          topicTitle: topic.title,
          topicLevel: topic.level,
          topicLevelLabel: topic.level_label,
          intro: {
            goal: HINT_BY_TYPE["написать функцию"] || "",
            text: HINT_BY_TYPE["написать функцию"] || "",
            concepts: [],
            explanation: TYPE_STAGE["написать функцию"] || "",
            example: null,
            application: "",
            html: false,
          },
        },
      };
    }
    return { status: "not_found" };
  }

  /** Topic task ids in order (for stage intro route dots). */
  getTopicTaskIds(topicId: number): string[] {
    if (this.bundle === null) return [];
    const topic = findRawTopic(this.bundle, topicId);
    return topic ? topic.tasks.map((t) => t.id) : [];
  }

  /** Previous catalog topics (up to 3) for stage intro sidebar. */
  getPrevTopics(topicId: number): Array<{
    id: number;
    title: string;
    taskIds: string[];
  }> {
    if (this.bundle === null) return [];
    return this.bundle.topics
      .filter((t) => t.id < topicId)
      .slice(-3)
      .map((t) => ({
        id: t.id,
        title: t.title,
        taskIds: t.tasks.map((x) => x.id),
      }));
  }

  /** Next task id in course order, or null if last / unknown. */
  getNextTaskId(id: string): string | null {
    if (this.bundle === null) return null;
    const ids: string[] = [];
    for (const topic of this.bundle.topics) {
      for (const task of topic.tasks) {
        ids.push(task.id);
      }
    }
    const idx = ids.indexOf(id);
    if (idx < 0 || idx >= ids.length - 1) return null;
    return ids[idx + 1] ?? null;
  }

  /**
   * Catalog topics for `#/topics` — bundle topics + challenge row meta
   * when CHALLENGE_XP_META.topicId matches.
   */
  getCatalogTopics(): CatalogTopicModel[] {
    if (this.bundle === null) {
      return [];
    }
    const challengeByTopic = new Map(
      CHALLENGE_XP_META.map((ch) => [ch.topicId, ch] as const),
    );

    return this.bundle.topics.map((topic) => {
      const article = normalizeTheoryArticle(topic);
      const tasks = topic.tasks.map((t) => asCatalogTask(t, topic.level));
      const chMeta = challengeByTopic.get(topic.id);
      let challenge: CatalogChallengeModel | null = null;
      if (chMeta) {
        challenge = {
          id: chMeta.id,
          title: chMeta.title,
          topicId: chMeta.topicId,
          level: topic.level,
        };
      }
      return {
        id: topic.id,
        title: topic.title,
        level: topic.level,
        level_label: topic.level_label,
        description: topic.description,
        teaserPlain: theoryTeaserPlain(topic),
        teaserHtml: article.teaserHtml,
        tasks,
        challenge,
      };
    });
  }

  /** taskId → level/challenge for client-side XP (same as legacy TOPIC_OF + CHALLENGES). */
  getTaskXpIndex(): Map<string, TaskXpMeta> {
    const index = new Map<string, TaskXpMeta>();
    if (this.bundle === null) return index;
    for (const topic of this.bundle.topics) {
      for (const task of topic.tasks) {
        index.set(task.id, {
          level: topic.level,
          challenge: task.challenge === true,
        });
      }
    }
    for (const ch of CHALLENGE_XP_META) {
      const topic = findRawTopic(this.bundle, ch.topicId);
      if (!topic) continue;
      index.set(ch.id, { level: topic.level, challenge: true });
    }
    return index;
  }
}

export const contentRepository = new ContentRepository();
