import { useEffect, useRef } from "react";

const DAY_MS = 24 * 60 * 60 * 1_000;
const KOREA_OFFSET_MS = 9 * 60 * 60 * 1_000;
const POLL_MS = 60_000;

function koreanDay(timestamp: number): number {
  return Math.floor((timestamp + KOREA_OFFSET_MS) / DAY_MS);
}

export function millisecondsUntilNextKoreanMidnight(now = Date.now()): number {
  return (koreanDay(now) + 1) * DAY_MS - KOREA_OFFSET_MS - now;
}

/** The caller loads initial data and preserves its current UI during background refreshes. */
export function useCompetitionRefresh(
  refresh: (signal: AbortSignal) => Promise<unknown>,
  { enabled = true }: { enabled?: boolean } = {},
): void {
  const refreshRef = useRef(refresh);
  const requestRef = useRef<AbortController | null>(null);
  const lastStartedRef = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let pollTimer: number | undefined;
    let midnightTimer: number | undefined;
    let resumeTimer: number | undefined;

    const requestRefresh = async () => {
      if (
        disposed || document.visibilityState !== "visible" || !navigator.onLine
        || document.body.classList.contains("modal-open")
        || (requestRef.current && !requestRef.current.signal.aborted)
      ) return;

      const now = Date.now();
      // Focus, pageshow and visibility events can describe the same app return.
      // A new Korean date must still refresh even if the last request was just before midnight.
      const elapsed = now - lastStartedRef.current;
      if (elapsed >= 0 && elapsed < 1_000 && koreanDay(now) === koreanDay(lastStartedRef.current)) return;

      const controller = new AbortController();
      requestRef.current = controller;
      lastStartedRef.current = now;
      try {
        await refreshRef.current(controller.signal);
      } catch {
        // A background failure keeps the existing screen; later polling/online retries it.
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
      }
    };

    const stopTimers = () => {
      window.clearInterval(pollTimer);
      window.clearTimeout(midnightTimer);
      window.clearTimeout(resumeTimer);
    };

    const pause = () => {
      stopTimers();
      requestRef.current?.abort();
      requestRef.current = null;
      lastStartedRef.current = Number.NEGATIVE_INFINITY;
    };

    const scheduleMidnight = () => {
      // Run just beyond the date boundary so the server observes the new day too.
      midnightTimer = window.setTimeout(() => {
        void requestRefresh();
        if (!disposed && document.visibilityState === "visible") scheduleMidnight();
      }, millisecondsUntilNextKoreanMidnight() + 250);
    };

    const startTimers = () => {
      stopTimers();
      if (disposed || document.visibilityState !== "visible") return;
      pollTimer = window.setInterval(() => { void requestRefresh(); }, POLL_MS);
      scheduleMidnight();
    };

    const handleResume = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) {
        pause();
        return;
      }
      startTimers();
      if (document.visibilityState === "visible") {
        resumeTimer = window.setTimeout(() => { void requestRefresh(); }, 100);
      }
    };

    startTimers();
    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("focus", handleResume);
    window.addEventListener("pageshow", handleResume);
    window.addEventListener("online", handleResume);
    window.addEventListener("offline", pause);

    return () => {
      disposed = true;
      pause();
      document.removeEventListener("visibilitychange", handleResume);
      window.removeEventListener("focus", handleResume);
      window.removeEventListener("pageshow", handleResume);
      window.removeEventListener("online", handleResume);
      window.removeEventListener("offline", pause);
    };
  }, [enabled]);
}
