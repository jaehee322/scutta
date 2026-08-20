import type { ApiErrorBody } from "../types";

const configuredBase = import.meta.env.VITE_API_URL?.trim().replace(/\/$/, "") ?? "";
const API_BASE = `${configuredBase}/api/v1`;
const REQUEST_TIMEOUT_MS = 20_000;
export const AUTH_EXPIRED_EVENT = "scutta:auth-expired";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function formatApiError(body: ApiErrorBody | null, fallback: string): string {
  if (typeof body?.detail === "string") return body.detail;
  if (Array.isArray(body?.detail) && body.detail.length > 0) {
    return body.detail.map((issue) => issue.msg ?? "입력값을 확인해 주세요.").join(" ");
  }
  return fallback;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const callerSignal = options.signal;
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: "include",
      signal: controller.signal,
    });
  } catch {
    if (timedOut) {
      throw new ApiError(0, "서버 응답이 늦어 요청을 중단했습니다. 다시 시도해 주세요.");
    }
    throw new ApiError(0, "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
  } finally {
    globalThis.clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }

  if (!response.ok) {
    if (
      response.status === 401 &&
      path !== "/auth/login" &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }

    let body: ApiErrorBody | null = null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Empty and non-JSON error responses use the generic message below.
    }
    const retryAfter = Number(response.headers.get("Retry-After"));
    throw new ApiError(
      response.status,
      formatApiError(body, "요청을 처리하지 못했습니다."),
      Number.isFinite(retryAfter) ? retryAfter : undefined,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const jsonBody = (value: unknown): string => JSON.stringify(value);
