import { describe, expect, it } from "vitest";

import { ApiError } from "../api/client";
import { classifyAuthCheckFailure } from "./authFailure";

describe("authentication check failures", () => {
  it("treats only a 401 response as a logged-out session", () => {
    expect(classifyAuthCheckFailure(new ApiError(401, "로그인이 필요합니다."))).toEqual({
      kind: "unauthenticated",
    });
  });

  it.each([0, 403, 500])("keeps status %i as a retryable connection error", (status) => {
    expect(classifyAuthCheckFailure(new ApiError(status, "다시 시도해 주세요."))).toEqual({
      kind: "connection",
      message: "다시 시도해 주세요.",
    });
  });
});
