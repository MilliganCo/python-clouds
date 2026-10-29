export type TheoryExampleModel = {
  code: string;
  explanationHtml: string | null;
};

export type TheorySectionModel = {
  title: string;
  paragraphsHtml: string[];
  examples: TheoryExampleModel[];
};

export type TheoryArticleModel = {
  topicId: number;
  topicTitle: string;
  topicDescription: string;
  title: string;
  kind: "article" | "teaser";
  leadHtml: string;
  sections: TheorySectionModel[];
  mistakes: Array<{ title: string; textHtml: string }>;
  applicationsHtml: string[];
  summaryHtml: string[];
  prevLabel: string | null;
  nextLabel: string | null;
  firstTaskId: string | null;
  teaserHtml: string;
  exampleCode: string | null;
};

export class ContentParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentParseError";
  }
}

export type RawTheoryExample = {
  code?: string;
  explanation?: string | null;
  [key: string]: unknown;
};

export type RawTheorySection = {
  title?: string;
  text?: string;
  examples?: RawTheoryExample[];
  [key: string]: unknown;
};

export type RawTheoryBlock = {
  text: string;
  lead?: string;
  sections?: RawTheorySection[];
  mistakes?: unknown[];
  applications?: string[];
  summary?: string[];
  title?: string;
  prev?: string | null;
  next?: string | null;
  example?: string | null | { code?: string; [key: string]: unknown };
  goal?: string;
  concepts?: string[];
  explanation?: string;
  application?: string;
  id?: number;
  [key: string]: unknown;
};

export type RawTask = {
  id: string;
  challenge?: boolean;
  [key: string]: unknown;
};

export type RawTopic = {
  id: number;
  title: string;
  level: string;
  level_label: string;
  description: string;
  theory: RawTheoryBlock;
  tasks: RawTask[];
};

export type RawContentBundle = {
  schema_version: 2;
  content_version: string;
  content_hash: string;
  python_runtime: string;
  topics: RawTopic[];
};

/** Catalog row for a regular task (mirrors topicHtml task-row). */
export type CatalogTaskModel = {
  id: string;
  type: string;
  title: string;
  prompt: string;
  code: string | null;
  challenge: boolean;
  level: string;
};

/** Boss challenge attached to a topic (from CHALLENGE_XP_META). */
export type CatalogChallengeModel = {
  id: string;
  title: string;
  topicId: number;
  level: string;
};

/** Topic card model for `#/topics` catalog. */
export type CatalogTopicModel = {
  id: number;
  title: string;
  level: string;
  level_label: string;
  description: string;
  /** First sentence plain teaser for topic-desc (legacy theoryTeaser). */
  teaserPlain: string;
  /** Sanitized HTML for topic-theory-text (legacy normalizeTheory.teaserHtml). */
  teaserHtml: string;
  tasks: CatalogTaskModel[];
  challenge: CatalogChallengeModel | null;
};

/** Auto-check override from content-bundle `check` (legacy window.CHECKS). */
export type TaskCheckModel = {
  append?: string;
  expect?: string;
} | null;

export type TaskQuestionModel = {
  prompt: string;
  answer: string;
  wrong: string[] | null;
  explanation: string;
};

/** Intro summary for task page / stage intro. */
export type TaskIntroSummary = {
  goal: string;
  text: string;
  concepts: string[];
  explanation: string;
  example: string | null;
  application: string;
  html: boolean;
};

/** Full task model for `#/task/:id`. */
export type TaskPageModel = {
  id: string;
  type: string;
  title: string;
  prompt: string;
  code: string | null;
  answer: string;
  explanation: string;
  hint: string | null;
  wrong: string[] | null;
  questions: TaskQuestionModel[] | null;
  check: TaskCheckModel;
  challenge: boolean;
  level: string;
  topicId: number;
  topicTitle: string;
  topicLevel: string;
  topicLevelLabel: string;
  intro: TaskIntroSummary;
};
