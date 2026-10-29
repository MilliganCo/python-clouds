export class ApiError extends Error {
  readonly status: number;
  readonly endpoint: string;

  constructor(status: number, endpoint: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

export class UnauthorizedError extends ApiError {
  constructor(endpoint: string, message = "Unauthorized") {
    super(401, endpoint, message);
    this.name = "UnauthorizedError";
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === "string" && err) return err;
  }
  return fallback;
}

/**
 * Relative /api fetch. Throws UnauthorizedError on 401 without navigation.
 * Session boundary / application layer decides logout vs form error.
 */
export async function apiGet<T>(
  path: string,
  parse: (value: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    method: "GET",
    credentials: "same-origin",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body = await readBody(response);

  if (response.status === 401) {
    throw new UnauthorizedError(path, errorMessage(body, "Unauthorized"));
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      path,
      errorMessage(body, `HTTP ${response.status}`),
    );
  }

  return parse(body);
}

export async function apiPost<T>(
  path: string,
  payload: unknown,
  parse: (value: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(payload ?? {}),
  });

  const body = await readBody(response);

  if (response.status === 401) {
    throw new UnauthorizedError(path, errorMessage(body, "Unauthorized"));
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      path,
      errorMessage(body, `HTTP ${response.status}`),
    );
  }

  return parse(body);
}
