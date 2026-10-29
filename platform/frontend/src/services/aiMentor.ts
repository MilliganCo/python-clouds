import { apiGet, apiPost } from "./api";
import { ContractError } from "./parse";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type AiAskTask = {
  id: string;
  type: string;
  prompt: string;
  answer?: string;
  project_context?: {
    course_title: string;
    stage_title: string;
    previous_stage_summary?: string;
    learned_topics?: string[];
  };
};

export type AiAskContext = {
  solved_count: number;
  total: number;
  topics_progress: string[];
};

export type AiAskResult = {
  reply: string;
  engine: string;
  cost: number;
  free_left?: number;
  drops?: number;
};

export type AiHistoryMessage = {
  role: string;
  text: string;
};

export type AiReviewAttempt = {
  ok: boolean;
  code?: string;
  text?: string;
  error?: string;
  got?: string;
};

function parseAsk(value: unknown): AiAskResult {
  if (!isObject(value) || typeof value.reply !== "string") {
    throw new ContractError("Invalid /api/ai/ask response");
  }
  return {
    reply: value.reply,
    engine: typeof value.engine === "string" ? value.engine : "offline",
    cost: typeof value.cost === "number" ? value.cost : 0,
    free_left:
      typeof value.free_left === "number" ? value.free_left : undefined,
    drops: typeof value.drops === "number" ? value.drops : undefined,
  };
}

function parseHistory(value: unknown): AiHistoryMessage[] {
  if (!isObject(value) || !Array.isArray(value.messages)) {
    throw new ContractError("Invalid /api/ai/history response");
  }
  return value.messages.map((m) => {
    if (!isObject(m) || typeof m.role !== "string" || typeof m.text !== "string") {
      throw new ContractError("Invalid /api/ai/history message");
    }
    return { role: m.role, text: m.text };
  });
}

function parseReview(value: unknown): string | null {
  if (!isObject(value)) {
    throw new ContractError("Invalid /api/ai/review response");
  }
  if (value.review == null) return null;
  if (typeof value.review !== "string") {
    throw new ContractError("Invalid /api/ai/review response");
  }
  let text = value.review;
  if (/^\s*\{/.test(text)) {
    try {
      const parsed = JSON.parse(text) as { review?: unknown };
      if (typeof parsed.review === "string") text = parsed.review;
    } catch {
      /* keep raw */
    }
  }
  return text || null;
}

export async function fetchAiHistory(
  taskId: string,
): Promise<AiHistoryMessage[]> {
  return apiGet(
    `/api/ai/history?task_id=${encodeURIComponent(taskId)}`,
    parseHistory,
  );
}

export async function askAi(
  task: AiAskTask,
  question: string,
  context: AiAskContext,
): Promise<AiAskResult> {
  return apiPost(
    "/api/ai/ask",
    { task, question, context },
    parseAsk,
  );
}

export async function requestAiReview(
  task: Pick<
    AiAskTask,
    "id" | "type" | "prompt" | "answer" | "project_context"
  >,
  attempt: AiReviewAttempt,
): Promise<string | null> {
  return apiPost(
    "/api/ai/review",
    { task, attempt },
    parseReview,
  );
}
