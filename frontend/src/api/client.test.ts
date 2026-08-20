import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTH_EXPIRED_EVENT, apiRequest, formatApiError } from "./client";

afterEach(() => {
  vi.useRealTimers();
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

  it("stops a request that exceeds the response timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const expectation = expect(apiRequest("/rankings")).rejects.toMatchObject({
      status: 0,
      message: "서버 응답이 늦어 요청을 중단했습니다. 다시 시도해 주세요.",
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await expectation;
  });
});
