import { apiGet, apiPost } from "./api";
import { ContractError } from "./parse";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export type ShowcaseFile = { name: string; code: string };

export type ShowcaseCard = {
  id: number;
  owner_name: string;
  title: string;
  description: string;
  cover: string;
  files: ShowcaseFile[];
  file_count: number;
  is_multi_file: boolean;
  score: number;
  my_vote: number | null;
  is_demo?: boolean;
};

export type ShowcaseBoard = {
  cards: ShowcaseCard[];
  leaderboard: ShowcaseCard[];
  can_multi_file: boolean;
  covers: string[];
  vote_min: number;
  vote_max: number;
};

function parseFile(value: unknown): ShowcaseFile {
  if (!isObject(value)) throw new ContractError("Invalid showcase file");
  return { name: str(value.name, "main.py"), code: str(value.code) };
}

function parseCard(value: unknown): ShowcaseCard {
  if (!isObject(value) || typeof value.id !== "number") {
    throw new ContractError("Invalid showcase card");
  }
  return {
    id: value.id,
    owner_name: str(value.owner_name),
    title: str(value.title),
    description: str(value.description),
    cover: str(value.cover, "aurora"),
    files: Array.isArray(value.files) ? value.files.map(parseFile) : [],
    file_count: num(value.file_count, 1),
    is_multi_file: !!value.is_multi_file,
    score: num(value.score),
    my_vote: typeof value.my_vote === "number" ? value.my_vote : null,
    is_demo: !!value.is_demo,
  };
}

export function parseShowcaseBoard(value: unknown): ShowcaseBoard {
  if (!isObject(value) || !Array.isArray(value.cards)) {
    throw new ContractError("Invalid GET /api/showcase");
  }
  return {
    cards: value.cards.map(parseCard),
    leaderboard: Array.isArray(value.leaderboard)
      ? value.leaderboard.map(parseCard)
      : [],
    can_multi_file: !!value.can_multi_file,
    covers: Array.isArray(value.covers)
      ? value.covers.filter((x): x is string => typeof x === "string")
      : ["aurora", "cosmos", "sunrise", "storm", "terminal"],
    vote_min: num(value.vote_min, -3),
    vote_max: num(value.vote_max, 3),
  };
}

export function parseShowcaseCardDetail(value: unknown): {
  card: ShowcaseCard;
  can_multi_file: boolean;
} {
  if (!isObject(value) || !isObject(value.card)) {
    throw new ContractError("Invalid GET /api/showcase/cards/:id");
  }
  return {
    card: parseCard(value.card),
    can_multi_file: !!value.can_multi_file,
  };
}

export function parseShowcaseCreate(value: unknown): { card: ShowcaseCard } {
  if (!isObject(value) || !isObject(value.card)) {
    throw new ContractError("Invalid POST /api/showcase/cards");
  }
  return { card: parseCard(value.card) };
}

export function parseShowcaseVote(value: unknown): {
  card: ShowcaseCard;
  leaderboard: ShowcaseCard[];
} {
  if (!isObject(value) || !isObject(value.card)) {
    throw new ContractError("Invalid showcase vote");
  }
  return {
    card: parseCard(value.card),
    leaderboard: Array.isArray(value.leaderboard)
      ? value.leaderboard.map(parseCard)
      : [],
  };
}

export function fetchShowcaseBoard() {
  return apiGet("/api/showcase", parseShowcaseBoard);
}

export function fetchShowcaseCard(id: number) {
  return apiGet(`/api/showcase/cards/${id}`, parseShowcaseCardDetail);
}

export function createShowcaseCard(body: {
  title: string;
  description: string;
  cover: string;
  files: ShowcaseFile[];
}) {
  return apiPost("/api/showcase/cards", body, parseShowcaseCreate);
}

export function voteShowcaseCard(id: number, value: number) {
  return apiPost(
    `/api/showcase/cards/${id}/vote`,
    { value },
    parseShowcaseVote,
  );
}

/** Compose multi-file showcase into one runnable string (write helpers then main). */
export function showcaseRunCode(files: ShowcaseFile[]): string {
  const list = Array.isArray(files) ? files : [];
  const main = list.find((f) => f.name === "main.py") || list[0] || { code: "" };
  const setup = list
    .filter((f) => f.name !== main.name)
    .map(
      (f) =>
        `open(${JSON.stringify(f.name)}, "w", encoding="utf-8").write(${JSON.stringify(f.code || "")})`,
    )
    .join("\n");
  return `${setup}${setup ? "\n" : ""}${main.code || ""}`;
}
