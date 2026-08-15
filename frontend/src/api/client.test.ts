import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTH_EXPIRED_EVENT, apiRequest, formatApiError } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formatApiError", () => {
  it("uses domain messages", () => {
    expect(formatApiError({ detail: "이미 제출된 경기입니다." }, "fallback")).toBe(
      "이미 제출된 경기입니다.",
    );
  });

  it("joins validation messages", () => {
    expect(
      formatApiError({ detail: [{ msg: "이름이 필요합니다." }, { msg: "부수를 확인하세요." }] }, ""),
    ).toBe("이름이 필요합니다. 부수를 확인하세요.");
  });

  it("notifies the app when an authenticated session expires", async () => {
    const browserWindow = new EventTarget();
    const listener = vi.fn();
    browserWindow.addEventListener(AUTH_EXPIRED_EVENT, listener);
    vi.stubGlobal("window", browserWindow);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "로그인이 필요합니다." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/rankings")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/rankings",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(listener).toHaveBeenCalledOnce();
  });
});
