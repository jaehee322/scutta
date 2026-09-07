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
