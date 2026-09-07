import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTH_EXPIRED_EVENT, apiRequest, formatApiError } from "./client";
import { getAuthSessionVersion, invalidateAuthSession } from "../auth/authSession";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function pendingBody(status: number) {
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { streamController = controller; },
  });
  const response = new Response(stream, {
    status,
    headers: { "Content-Type": "application/json" },
  });
  const reading = vi.spyOn(response, "json");
  return {
    response,
    reading,
    finish: () => {
      streamController.enqueue(new TextEncoder().encode('{"detail":"late response"}'));
      streamController.close();
    },
  };
}

function watchAuthExpiry() {
  const browserWindow = new EventTarget();
  const listener = vi.fn();
  browserWindow.addEventListener(AUTH_EXPIRED_EVENT, listener);
  vi.stubGlobal("window", browserWindow);
  return listener;
}

describe("request lifetime", () => {
  it.each([200, 401, 503])("times out a stalled %i body after headers arrive", async (status) => {
    vi.useFakeTimers();
    const expired = watchAuthExpiry();
    const body = pendingBody(status);
    const fetchMock = vi.fn().mockResolvedValue(body.response);
    vi.stubGlobal("fetch", fetchMock);
    const expectation = expect(apiRequest("/matches", { method: "POST", body: "{}" }))
      .rejects.toMatchObject({ status: 0, message: expect.stringContaining("응답이 늦어") });

    await vi.advanceTimersByTimeAsync(0);
    expect(body.reading).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20_000);
    await expectation;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    body.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(expired).not.toHaveBeenCalled();
  });

  it.each([200, 401, 503])("preserves caller cancellation while reading a %i body", async (status) => {
    vi.useFakeTimers();
    const expired = watchAuthExpiry();
    const caller = new AbortController();
    const body = pendingBody(status);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(body.response));
    const expectation = expect(apiRequest("/rankings", { signal: caller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });

    await vi.advanceTimersByTimeAsync(0);
    expect(body.reading).toHaveBeenCalledOnce();
    caller.abort();
    await expectation;
    expect(vi.getTimerCount()).toBe(0);
    body.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(expired).not.toHaveBeenCalled();
  });

  it("does not send an already cancelled request", async () => {
    const caller = new AbortController();
    caller.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiRequest("/rankings", { signal: caller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("can give the initial auth read longer without retrying it", async () => {
    vi.useFakeTimers();
    const body = pendingBody(200);
    const fetchMock = vi.fn().mockResolvedValue(body.response);
    vi.stubGlobal("fetch", fetchMock);
    const settled = vi.fn();
    const request = apiRequest("/auth/me", { timeoutMs: 60_000 });
    void request.then(settled, settled);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(settled).not.toHaveBeenCalled();
    body.finish();
    await expect(request).resolves.toEqual({ detail: "late response" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("timeoutMs");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses an HTTP fallback for a malformed error body, without inventing Retry-After", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON", { status: 502 })));
    await expect(apiRequest("/rankings")).rejects.toMatchObject({
      status: 502,
      message: "요청을 처리하지 못했습니다.",
      retryAfter: undefined,
    });
  });
});

describe("authentication response generations", () => {
  it("cancels an old request whose 401 body arrives after a new login", async () => {
    const expired = watchAuthExpiry();
    const body = pendingBody(401);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(body.response));
    const expectation = expect(apiRequest("/rankings"))
      .rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    expect(body.reading).toHaveBeenCalledOnce();

    invalidateAuthSession();
    const loggedInVersion = getAuthSessionVersion();
    body.finish();
    await expectation;
    expect(expired).not.toHaveBeenCalled();
    expect(getAuthSessionVersion()).toBe(loggedInVersion);
  });

  it("keeps credential requests alive but ignores their old-generation 401", async () => {
    const expired = watchAuthExpiry();
    const body = pendingBody(401);
    const fetchMock = vi.fn().mockResolvedValue(body.response);
    vi.stubGlobal("fetch", fetchMock);
    const expectation = expect(apiRequest("/auth/password", { method: "PATCH" }))
      .rejects.toMatchObject({ status: 401 });
    invalidateAuthSession();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
    body.finish();
    await expectation;
    expect(expired).not.toHaveBeenCalled();
  });

  it("expires a session only once for concurrent 401 responses", async () => {
    const expired = watchAuthExpiry();
    const first = pendingBody(401);
    const second = pendingBody(401);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(second.response));
    const requests = Promise.allSettled([apiRequest("/rankings"), apiRequest("/matches")]);
    first.finish();
    second.finish();
    await requests;
    expect(expired).toHaveBeenCalledOnce();
  });

  it("does not expire a session for rejected login credentials", async () => {
    const expired = watchAuthExpiry();
    const version = getAuthSessionVersion();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(apiRequest("/auth/login", { method: "POST" }))
      .rejects.toMatchObject({ status: 401 });
    expect(expired).not.toHaveBeenCalled();
    expect(getAuthSessionVersion()).toBe(version);
  });

  it("protects the replacement session after a password change", async () => {
    const expired = watchAuthExpiry();
    const oldBody = pendingBody(401);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(oldBody.response)
      .mockResolvedValueOnce(new Response('{"message":"changed"}')));
    const oldRequest = expect(apiRequest("/rankings"))
      .rejects.toMatchObject({ name: "AbortError" });
    await apiRequest("/auth/password", { method: "PATCH" });
    oldBody.finish();
    await oldRequest;
    expect(expired).not.toHaveBeenCalled();
  });

  it("leaves a newly started request alive after cancelling a previous session", async () => {
    const oldBody = pendingBody(200);
    const newBody = pendingBody(200);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(oldBody.response)
      .mockResolvedValueOnce(newBody.response);
    vi.stubGlobal("fetch", fetchMock);
    const oldRequest = expect(apiRequest("/rankings"))
      .rejects.toMatchObject({ name: "AbortError" });
    invalidateAuthSession();
    const newRequest = apiRequest("/rankings");
    await oldRequest;
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false);
    oldBody.finish();
    newBody.finish();
    await expect(newRequest).resolves.toEqual({ detail: "late response" });
  });
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
