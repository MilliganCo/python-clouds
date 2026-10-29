import { apiGet, apiPost } from "./api";
import { ContractError } from "./parse";
import type { StageCheckSpec } from "./projectCheck";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ProjectSnapshot = {
  id: number;
  version: number;
  kind: string;
  code?: string;
  template_version?: number;
  created_at: string;
};

export type ProjectStage = {
  id: string;
  title: string;
  summary: string;
  task: string;
  new_knowledge?: string;
  requirements?: { topics?: number[] };
  required_topic_titles: string[];
  desired_topics?: number[];
  hints: string[];
  check: StageCheckSpec;
  return_message?: string;
  completion_message?: string;
  status: string;
  status_label: string;
  template_version?: number;
  completed_at?: string | null;
  updated_at?: string | null;
  current_code?: string;
  starter_code?: string;
  snapshots: ProjectSnapshot[];
};

export type ProjectCourse = {
  id: string;
  title: string;
  short_title: string;
  quest_label: string;
  emblem: string;
  accent: string;
  track_order: number;
  track_total: number;
  unlock_topics?: number[];
  unlock_topic_titles: string[];
  description: string;
  final_result: string;
  intro?: string;
  skills?: string[];
  status: string;
  status_label: string;
  completed_stages: number;
  total_stages: number;
  progress_percent: number;
  next_stage: ProjectStage | null;
  started_at?: string | null;
  completed_at?: string | null;
  stages?: ProjectStage[];
};

export type ProjectPrompt = {
  course_id: string;
  course_title: string;
  short_title: string;
  quest_label: string;
  emblem: string;
  accent: string;
  stage_id: string;
  stage_title: string;
  kind: string;
  message: string;
  href: string;
};

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function parseSnapshot(value: unknown): ProjectSnapshot {
  if (!isObject(value) || typeof value.id !== "number") {
    throw new ContractError("Invalid project snapshot");
  }
  return {
    id: value.id,
    version: num(value.version),
    kind: str(value.kind),
    code: typeof value.code === "string" ? value.code : undefined,
    template_version:
      typeof value.template_version === "number"
        ? value.template_version
        : undefined,
    created_at: str(value.created_at),
  };
}

function parseCheck(value: unknown): StageCheckSpec {
  if (!isObject(value)) return {};
  return {
    forbid: Array.isArray(value.forbid)
      ? value.forbid.filter((x): x is string => typeof x === "string")
      : undefined,
    expect_contains: Array.isArray(value.expect_contains)
      ? value.expect_contains.filter((x): x is string => typeof x === "string")
      : undefined,
    append: typeof value.append === "string" ? value.append : undefined,
    expect: typeof value.expect === "string" ? value.expect : undefined,
  };
}

function parseStage(value: unknown): ProjectStage {
  if (!isObject(value) || typeof value.id !== "string") {
    throw new ContractError("Invalid project stage");
  }
  return {
    id: value.id,
    title: str(value.title),
    summary: str(value.summary),
    task: str(value.task),
    new_knowledge:
      typeof value.new_knowledge === "string" ? value.new_knowledge : undefined,
    required_topic_titles: Array.isArray(value.required_topic_titles)
      ? value.required_topic_titles.filter(
          (x): x is string => typeof x === "string",
        )
      : [],
    hints: Array.isArray(value.hints)
      ? value.hints.filter((x): x is string => typeof x === "string")
      : [],
    check: parseCheck(value.check),
    completion_message:
      typeof value.completion_message === "string"
        ? value.completion_message
        : undefined,
    status: str(value.status, "unknown"),
    status_label: str(value.status_label),
    current_code:
      typeof value.current_code === "string" ? value.current_code : undefined,
    starter_code:
      typeof value.starter_code === "string" ? value.starter_code : undefined,
    snapshots: Array.isArray(value.snapshots)
      ? value.snapshots.map(parseSnapshot)
      : [],
  };
}

function parseCourse(value: unknown): ProjectCourse {
  if (!isObject(value) || typeof value.id !== "string") {
    throw new ContractError("Invalid project course");
  }
  const next =
    value.next_stage && isObject(value.next_stage)
      ? parseStage(value.next_stage)
      : null;
  return {
    id: value.id,
    title: str(value.title),
    short_title: str(value.short_title, str(value.title)),
    quest_label: str(value.quest_label, "Проектный квест"),
    emblem: str(value.emblem, "bot"),
    accent: str(value.accent, "cyan"),
    track_order: num(value.track_order),
    track_total: num(value.track_total, 5),
    unlock_topic_titles: Array.isArray(value.unlock_topic_titles)
      ? value.unlock_topic_titles.filter(
          (x): x is string => typeof x === "string",
        )
      : [],
    description: str(value.description),
    final_result: str(value.final_result),
    intro: typeof value.intro === "string" ? value.intro : undefined,
    status: str(value.status, "unknown"),
    status_label: str(value.status_label),
    completed_stages: num(value.completed_stages),
    total_stages: num(value.total_stages),
    progress_percent: num(value.progress_percent),
    next_stage: next,
    stages: Array.isArray(value.stages)
      ? value.stages.map(parseStage)
      : undefined,
  };
}

export function parseProjectCoursesList(value: unknown): {
  courses: ProjectCourse[];
} {
  if (!isObject(value) || !Array.isArray(value.courses)) {
    throw new ContractError("Invalid GET /api/project-courses");
  }
  return { courses: value.courses.map(parseCourse) };
}

export function parseProjectCourseDetail(value: unknown): {
  course: ProjectCourse;
} {
  if (!isObject(value) || !isObject(value.course)) {
    throw new ContractError("Invalid GET /api/project-courses/:id");
  }
  return { course: parseCourse(value.course) };
}

export function parseProjectStart(value: unknown): {
  course: ProjectCourse;
} {
  return parseProjectCourseDetail(value);
}

export function parseProjectSave(value: unknown): {
  stage: ProjectStage;
} {
  if (!isObject(value) || !isObject(value.stage)) {
    throw new ContractError("Invalid project save");
  }
  return { stage: parseStage(value.stage) };
}

export function parseProjectComplete(value: unknown): {
  stage: ProjectStage;
  course: ProjectCourse;
} {
  if (
    !isObject(value) ||
    !isObject(value.stage) ||
    !isObject(value.course)
  ) {
    throw new ContractError("Invalid project complete");
  }
  return {
    stage: parseStage(value.stage),
    course: parseCourse(value.course),
  };
}

export function parseProjectRestore(value: unknown): {
  stage: ProjectStage;
} {
  return parseProjectSave(value);
}

export function parseProjectPrompts(value: unknown): {
  prompts: ProjectPrompt[];
} {
  if (!isObject(value) || !Array.isArray(value.prompts)) {
    throw new ContractError("Invalid GET /api/project-courses/prompts");
  }
  return {
    prompts: value.prompts.map((p) => {
      if (!isObject(p)) throw new ContractError("Invalid prompt");
      return {
        course_id: str(p.course_id),
        course_title: str(p.course_title),
        short_title: str(p.short_title),
        quest_label: str(p.quest_label, "Вернуться к квесту"),
        emblem: str(p.emblem, "bot"),
        accent: str(p.accent, "cyan"),
        stage_id: str(p.stage_id),
        stage_title: str(p.stage_title),
        kind: str(p.kind),
        message: str(p.message),
        href: str(p.href),
      };
    }),
  };
}

export function fetchProjectCourses() {
  return apiGet("/api/project-courses", parseProjectCoursesList);
}

export function fetchProjectCourse(courseId: string) {
  return apiGet(
    `/api/project-courses/${courseId}`,
    parseProjectCourseDetail,
  );
}

export function startProjectCourse(courseId: string) {
  return apiPost(
    `/api/project-courses/${courseId}/start`,
    {},
    parseProjectStart,
  );
}

export function saveProjectStage(
  courseId: string,
  stageId: string,
  code: string,
  snapshot: boolean,
) {
  return apiPost(
    `/api/project-courses/${courseId}/stages/${stageId}/save`,
    { code, snapshot },
    parseProjectSave,
  );
}

export function completeProjectStage(
  courseId: string,
  stageId: string,
  code: string,
  check: ProjectCheckResultLike,
) {
  return apiPost(
    `/api/project-courses/${courseId}/stages/${stageId}/complete`,
    { code, check },
    parseProjectComplete,
  );
}

export function restoreProjectStage(
  courseId: string,
  stageId: string,
  snapshotId: number,
) {
  return apiPost(
    `/api/project-courses/${courseId}/stages/${stageId}/restore`,
    { snapshot_id: snapshotId },
    parseProjectRestore,
  );
}

export function fetchProjectPrompts() {
  return apiGet("/api/project-courses/prompts", parseProjectPrompts);
}

export function dismissProjectPrompt(courseId: string, stageId: string) {
  return apiPost(
    "/api/project-courses/prompts/dismiss",
    { course_id: courseId, stage_id: stageId },
    (v) => {
      if (!isObject(v) || v.ok !== true) {
        throw new ContractError("Invalid prompt dismiss");
      }
      return { ok: true as const };
    },
  );
}

type ProjectCheckResultLike = {
  ok: boolean;
  message?: string;
  stdout?: string;
  error?: string;
  expected?: string;
  kind?: string;
};
