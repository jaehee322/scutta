import { ApiError } from "../api/client";

export type AuthCheckFailure =
  | { kind: "unauthenticated" }
  | { kind: "connection"; message: string };

export function classifyAuthCheckFailure(error: unknown): AuthCheckFailure {
  if (error instanceof ApiError && error.status === 401) {
    return { kind: "unauthenticated" };
  }

  return {
    kind: "connection",
    message:
      error instanceof Error
        ? error.message
        : "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  };
}
