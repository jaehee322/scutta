import { describe, expect, it, vi } from "vitest";

import type { PaddleFlightOverview } from "../types";
import { createPaddleFlightScoreQueue } from "./paddleFlightScores";

const overview = (best_score: number): PaddleFlightOverview => ({ best_score, ranking: [] });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("paddle flight score queue", () => {
  it("saves completed runs in order even after the game view unsubscribes", async () => {
    const first = deferred<PaddleFlightOverview>();
    const submit = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(overview(7));
    const queue = createPaddleFlightScoreQueue({ submit, getSessionVersion: () => 1 });
    const unsubscribe = queue.subscribe(vi.fn());

    const firstRun = queue.enqueue(2);
    const secondRun = queue.enqueue(7);
    await Promise.resolve();
    expect(submit).toHaveBeenCalledOnce();
    expect(queue.getSnapshot().pendingCount).toBe(2);
    unsubscribe();
    first.resolve(overview(2));
    await Promise.all([firstRun, secondRun]);

    expect(submit.mock.calls.map(([score]) => score)).toEqual([2, 7]);
    expect(queue.getSnapshot()).toMatchObject({
      pendingCount: 0,
      overview: overview(7),
      error: "",
    });
  });

  it("aborts the previous session and never posts its queued score for a new account", async () => {
    let session = 1;
    const oldResponse = deferred<PaddleFlightOverview>();
    const submit = vi.fn()
      .mockReturnValueOnce(oldResponse.promise)
      .mockResolvedValueOnce(overview(1));
    const queue = createPaddleFlightScoreQueue({ submit, getSessionVersion: () => session });
    const firstRun = queue.enqueue(3);
    const waitingRun = queue.enqueue(9);
    await Promise.resolve();
    const oldSignal = submit.mock.calls[0][1] as AbortSignal;

    session += 1;
    queue.invalidate();
    expect(oldSignal.aborted).toBe(true);
    expect(queue.getSnapshot()).toMatchObject({ pendingCount: 0, overview: null });
    const currentRun = queue.enqueue(1);
    oldResponse.resolve(overview(3));
    await Promise.all([firstRun, waitingRun, currentRun]);

    expect(submit.mock.calls.map(([score]) => score)).toEqual([3, 1]);
    expect(queue.getSnapshot().overview).toEqual(overview(1));
    await expect(waitingRun).resolves.toEqual({ status: "cancelled" });
  });

  it("keeps an unsaved higher score visible after a later lower score succeeds", async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error("연결이 끊겼습니다."))
      .mockResolvedValueOnce(overview(2))
      .mockResolvedValueOnce(overview(10));
    const queue = createPaddleFlightScoreQueue({ submit, getSessionVersion: () => 1 });

    await queue.enqueue(8);
    expect(queue.getSnapshot().error).toContain("8점 기록을 저장하지 못했습니다");
    await queue.enqueue(2);
    expect(queue.getSnapshot().error).toContain("8점 기록을 저장하지 못했습니다");
    await queue.enqueue(10);
    expect(queue.getSnapshot().error).toBe("");
    expect(submit.mock.calls.map(([score]) => score)).toEqual([8, 2, 10]);
  });

  it("does not automatically replay failed scores when listeners return or state is refreshed", async () => {
    const submit = vi.fn().mockRejectedValue(new Error("서버에 연결할 수 없습니다."));
    const queue = createPaddleFlightScoreQueue({ submit, getSessionVersion: () => 1 });
    await queue.enqueue(12);

    queue.subscribe(vi.fn())();
    queue.acceptOverview(overview(0));
    await Promise.resolve();

    expect(submit).toHaveBeenCalledOnce();
    expect(queue.getSnapshot().pendingCount).toBe(0);
    expect(queue.getSnapshot().overview?.best_score).toBe(0);
    expect(queue.getSnapshot().error).toContain("12점");
  });

  it("explicitly retries the highest failed score once, including after a lower score succeeds", async () => {
    const retry = deferred<PaddleFlightOverview>();
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error("연결이 끊겼습니다."))
      .mockResolvedValueOnce(overview(2))
      .mockReturnValueOnce(retry.promise);
    const queue = createPaddleFlightScoreQueue({ submit, getSessionVersion: () => 1 });

    await queue.enqueue(8);
    await queue.enqueue(2);
    expect(queue.getSnapshot().failedScore).toBe(8);
    const retryRequest = queue.retryFailedScore();
    expect(queue.retryFailedScore()).toBeUndefined();
    expect(queue.getSnapshot()).toMatchObject({ failedScore: 8, pendingCount: 1 });
    await Promise.resolve();
    expect(submit.mock.calls.map(([score]) => score)).toEqual([8, 2, 8]);

    retry.resolve(overview(8));
    await expect(retryRequest).resolves.toMatchObject({ status: "saved" });
    expect(queue.getSnapshot()).toMatchObject({ failedScore: null, pendingCount: 0, error: "" });
    expect(queue.retryFailedScore()).toBeUndefined();
  });

  it("retains a failed retry and prevents retrying while another completed run is saving", async () => {
    const laterRun = deferred<PaddleFlightOverview>();
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("still offline"))
      .mockReturnValueOnce(laterRun.promise);
    const queue = createPaddleFlightScoreQueue({ submit, getSessionVersion: () => 1 });

    await queue.enqueue(8);
    await expect(queue.retryFailedScore()).resolves.toEqual({ status: "failed" });
    expect(queue.getSnapshot()).toMatchObject({ failedScore: 8, pendingCount: 0 });
    const savingRun = queue.enqueue(10);
    expect(queue.retryFailedScore()).toBeUndefined();
    laterRun.resolve(overview(10));
    await savingRun;
    expect(queue.getSnapshot().failedScore).toBeNull();
    expect(queue.retryFailedScore()).toBeUndefined();
    expect(submit.mock.calls.map(([score]) => score)).toEqual([8, 8, 10]);
  });

  it("does not retry a previous account's failure after session changes", async () => {
    let session = 1;
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(overview(2));
    const queue = createPaddleFlightScoreQueue({ submit, getSessionVersion: () => session });

    await queue.enqueue(12);
    session += 1;
    expect(queue.retryFailedScore()).toBeUndefined();
    queue.invalidate();
    expect(queue.getSnapshot()).toMatchObject({ failedScore: null, error: "" });
    expect(queue.retryFailedScore()).toBeUndefined();
    await queue.enqueue(2);
    expect(submit.mock.calls.map(([score]) => score)).toEqual([12, 2]);
  });

  it("aborts an in-flight retry at logout and ignores its late response", async () => {
    let session = 1;
    const retry = deferred<PaddleFlightOverview>();
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(retry.promise);
    const queue = createPaddleFlightScoreQueue({ submit, getSessionVersion: () => session });
    await queue.enqueue(12);
    const retryRequest = queue.retryFailedScore();
    await Promise.resolve();
    const signal = submit.mock.calls[1][1] as AbortSignal;

    session += 1;
    queue.invalidate();
    expect(signal.aborted).toBe(true);
    retry.resolve(overview(12));
    await expect(retryRequest).resolves.toEqual({ status: "cancelled" });
    expect(queue.getSnapshot()).toMatchObject({ failedScore: null, pendingCount: 0, overview: null, error: "" });
  });

  it("allows a zero-point failed run to be retried and clears it if a refresh confirms the save", async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(overview(0))
      .mockRejectedValueOnce(new Error("response lost"));
    const queue = createPaddleFlightScoreQueue({ submit, getSessionVersion: () => 1 });
    await queue.enqueue(0);
    await expect(queue.retryFailedScore()).resolves.toMatchObject({ status: "saved" });
    await queue.enqueue(8);
    queue.acceptOverview(overview(8));
    expect(queue.retryFailedScore()).toBeUndefined();
    expect(queue.getSnapshot()).toMatchObject({ failedScore: null, error: "" });
    expect(submit.mock.calls.map(([score]) => score)).toEqual([0, 0, 8]);
  });

  it("distinguishes refreshed server state from a previous read snapshot", async () => {
    const queue = createPaddleFlightScoreQueue({
      submit: async () => overview(3),
      getSessionVersion: () => 1,
    });
    const beforeSubmission = queue.getResponseVersion();
    await queue.enqueue(3);
    expect(queue.getResponseVersion()).toBeGreaterThan(beforeSubmission);

    queue.acceptOverview(overview(0));
    expect(queue.getSnapshot().overview?.best_score).toBe(0);
  });
});
