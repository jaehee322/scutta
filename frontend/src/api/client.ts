import {
  getAuthSessionVersion,
  invalidateAuthSession,
  subscribeAuthSessionChange,
} from "../auth/authSession";
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

interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...requestOptions } = options;
  const sessionVersion = getAuthSessionVersion();
  const headers = new Headers(requestOptions.headers);
  if (requestOptions.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const callerSignal = requestOptions.signal;
  let sessionChanged = false;
  const changesCredentials = ["/auth/login", "/auth/logout", "/auth/password"].includes(path);
  const unsubscribeSession = changesCredentials
    ? () => undefined
    : subscribeAuthSessionChange(() => {
        if (sessionVersion === getAuthSessionVersion()) return;
        sessionChanged = true;
        controller.abort(new DOMException("로그인 상태가 변경되어 요청을 취소했습니다.", "AbortError"));
      });
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let rejectAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(controller.signal.reason);
    if (controller.signal.aborted) rejectAbort();
    else controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });

  const readResponse = async (): Promise<T> => {
    controller.signal.throwIfAborted();
    const response = await fetch(`${API_BASE}${path}`, {
      ...requestOptions,
      headers,
      credentials: "include",
      signal: controller.signal,
    });
    controller.signal.throwIfAborted();

    if (!response.ok) {
      let body: ApiErrorBody | null = null;
      try {
        body = (await response.json()) as ApiErrorBody;
      } catch {
        // Malformed error bodies may use the fallback; cancellation must still
        // end the whole request rather than become an HTTP error.
        controller.signal.throwIfAborted();
      }
      controller.signal.throwIfAborted();

      if (
        response.status === 401 &&
        path !== "/auth/login" &&
        sessionVersion === getAuthSessionVersion()
      ) {
        unsubscribeSession();
        invalidateAuthSession();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        }
      }

      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfter = retryAfterHeader === null ? NaN : Number(retryAfterHeader);
      throw new ApiError(
        response.status,
        formatApiError(body, "요청을 처리하지 못했습니다."),
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }

    const body = response.status === 204 ? undefined : await response.json();
    controller.signal.throwIfAborted();
    if (path === "/auth/password" && sessionVersion === getAuthSessionVersion()) {
      invalidateAuthSession();
    }
    return body as T;
  };

  try {
    // Fetch resolves at the headers. Keep cancellation and the deadline active
    // until the body finishes, even when a body reader stalls.
    return await Promise.race([readResponse(), aborted]);
  } catch (error) {
    if (timedOut) {
      throw new ApiError(0, "서버 응답이 늦어 요청을 중단했습니다. 다시 시도해 주세요.");
    }
    if (callerSignal?.aborted) throw callerSignal.reason;
    if (sessionChanged) throw controller.signal.reason;
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
  } finally {
    globalThis.clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
    controller.signal.removeEventListener("abort", rejectAbort);
    unsubscribeSession();
  }
}

export const jsonBody = (value: unknown): string => JSON.stringify(value);
