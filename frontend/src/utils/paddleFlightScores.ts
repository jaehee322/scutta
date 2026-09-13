import { apiRequest, jsonBody } from "../api/client";
import { getAuthSessionVersion, subscribeAuthSessionChange } from "../auth/authSession";
import type { PaddleFlightOverview } from "../types";

interface ScoreSnapshot {
  readonly pendingCount: number;
  readonly pendingBestScore: number;
  readonly failedScore: number | null;
  readonly overview: PaddleFlightOverview | null;
  readonly error: string;
}

type ScoreResult =
  | { status: "saved"; overview: PaddleFlightOverview }
  | { status: "failed" }
  | { status: "cancelled" };

interface ScoreQueueOptions {
  submit: (score: number, signal: AbortSignal) => Promise<PaddleFlightOverview>;
  getSessionVersion: () => number;
}

// Only completed runs are queued, for the lifetime of this app instance.
// Failed scores stay in memory for an explicit retry by the same account.
// There is no automatic retry or persistent/offline replay.
export function createPaddleFlightScoreQueue({ submit, getSessionVersion }: ScoreQueueOptions) {
  let snapshot: ScoreSnapshot = { pendingCount: 0, pendingBestScore: 0, failedScore: null, overview: null, error: "" };
  let queue = Promise.resolve();
  let generation = 0;
  let responseVersion = 0;
  let nextId = 0;
  let failedScore: number | null = null;
  let failedSessionVersion: number | null = null;
  let activeController: AbortController | null = null;
  const pending = new Map<number, number>();
  const listeners = new Set<() => void>();

  const publish = (changes: Partial<ScoreSnapshot> = {}) => {
    snapshot = {
      ...snapshot,
      ...changes,
      pendingCount: pending.size,
      pendingBestScore: Math.max(0, ...pending.values()),
      failedScore,
    };
    for (const listener of listeners) listener();
  };

  const acceptOverview = (overview: PaddleFlightOverview) => {
    responseVersion += 1;
    if (failedScore !== null && overview.best_score >= failedScore) {
      failedScore = null;
      failedSessionVersion = null;
      publish({ overview, error: "" });
    } else {
      publish({ overview });
    }
  };

  const store = {
    getSnapshot: () => snapshot,
    getResponseVersion: () => responseVersion,
    acceptOverview,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    invalidate() {
      generation += 1;
      responseVersion += 1;
      activeController?.abort();
      activeController = null;
      pending.clear();
      failedScore = null;
      failedSessionVersion = null;
      queue = Promise.resolve();
      publish({ overview: null, error: "" });
    },
    enqueue(score: number): Promise<ScoreResult> {
      const id = ++nextId;
      const requestedGeneration = generation;
      const sessionVersion = getSessionVersion();
      const isCurrent = () => requestedGeneration === generation
        && sessionVersion === getSessionVersion();
      pending.set(id, score);
      publish();

      const result = queue.then(async (): Promise<ScoreResult> => {
        if (!isCurrent()) return { status: "cancelled" };
        const controller = new AbortController();
        activeController = controller;
        try {
          const overview = await submit(score, controller.signal);
          if (!isCurrent()) return { status: "cancelled" };
          pending.delete(id);
          acceptOverview(overview);
          return { status: "saved", overview };
        } catch (error) {
          if (!isCurrent()) return { status: "cancelled" };
          pending.delete(id);
          if (failedScore === null || score >= failedScore) {
            failedScore = score;
            failedSessionVersion = sessionVersion;
            const message = error instanceof Error ? error.message : "연결을 확인해 주세요.";
            publish({ error: `${score}점 기록을 저장하지 못했습니다. ${message}` });
          } else {
            publish();
          }
          return { status: "failed" };
        } finally {
          if (activeController === controller) activeController = null;
        }
      });
      queue = result.then(() => undefined);
      return result;
    },
    retryFailedScore(): Promise<ScoreResult> | undefined {
      if (failedScore === null || pending.size > 0 || failedSessionVersion !== getSessionVersion()) return;
      return store.enqueue(failedScore);
    },
  };
  return store;
}

export const paddleFlightScores = createPaddleFlightScoreQueue({
  getSessionVersion: getAuthSessionVersion,
  submit: (score, signal) => apiRequest<PaddleFlightOverview>("/minigames/paddle-flight/score", {
    method: "POST",
    body: jsonBody({ score }),
    signal,
  }),
});

subscribeAuthSessionChange(() => paddleFlightScores.invalidate());
