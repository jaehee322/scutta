import { RotateCcw, Trophy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ApiError, apiRequest, jsonBody } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageLoader } from "../components/Loading";
import { Notice } from "../components/Notice";
import type { CoinFlipResult, CoinFlipSnapshot, CoinSide } from "../types";
import { waitForCoinAnimationEvent } from "../utils/coinAnimation";
import {
  canEnterCoinFlipGame,
  millisecondsUntilNextKoreaDay,
  remainingCoinFlipAttempts,
} from "../utils/minigameAttempts";

const COIN_SPIN_FALLBACK_MS = 760;
const COIN_LANDING_FALLBACK_MS = 1_050;
const REDUCED_MOTION_PHASE_MS = 160;

const sideLabel: Record<CoinSide, string> = {
  heads: "앞면",
  tails: "뒷면",
};

function fetchCoinFlipSnapshot(signal?: AbortSignal) {
  return apiRequest<CoinFlipSnapshot>("/minigames/coin-flip", { signal });
}

function minigameErrorMessage(caught: unknown, fallback: string) {
  if (caught instanceof ApiError && caught.status === 429) {
    if (caught.retryAfter && caught.retryAfter > 60) return caught.message;
    const seconds = caught.retryAfter && caught.retryAfter > 0
      ? `${Math.ceil(caught.retryAfter)}초 후 `
      : "잠시 후 ";
    return `${seconds}다시 시도해 주세요.`;
  }
  return caught instanceof Error ? caught.message : fallback;
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}

export function MinigamePage() {
  const { user } = useAuth();
  const reducedMotion = usePrefersReducedMotion();
  const [data, setData] = useState<CoinFlipSnapshot | null>(null);
  const [choice, setChoice] = useState<CoinSide | null>(null);
  const [coinFace, setCoinFace] = useState<CoinSide>("heads");
  const [lastFlip, setLastFlip] = useState<
    Pick<CoinFlipResult, "result" | "correct" | "final_score"> | null
  >(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [tossId, setTossId] = useState(0);
  const [tossPhase, setTossPhase] = useState<"idle" | "launch" | "landing">("idle");
  const [landingFace, setLandingFace] = useState<CoinSide | null>(null);
  const [isGameView, setIsGameView] = useState(false);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [error, setError] = useState("");
  const startLock = useRef(false);
  const flipLock = useRef(false);
  const entryButtonRef = useRef<HTMLButtonElement>(null);
  const firstChoiceButtonRef = useRef<HTMLButtonElement>(null);
  const exitButtonRef = useRef<HTMLButtonElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const coinRef = useRef<HTMLDivElement>(null);
  const isFlippingRef = useRef(false);
  const snapshotVersionRef = useRef(0);
  const snapshotRequestRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++snapshotRequestRef.current;
    const requestedVersion = snapshotVersionRef.current;
    fetchCoinFlipSnapshot(controller.signal)
      .then((snapshot) => {
        if (
          requestId === snapshotRequestRef.current
          && requestedVersion === snapshotVersionRef.current
          && !startLock.current
          && !flipLock.current
        ) {
          setData(snapshot);
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted && requestId === snapshotRequestRef.current) {
          setError(caught instanceof Error ? caught.message : "미니게임을 불러오지 못했습니다.");
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let disposed = false;
    let resetTimer = 0;

    const refreshSnapshot = async () => {
      const requestId = ++snapshotRequestRef.current;
      const requestedVersion = snapshotVersionRef.current;
      try {
        const snapshot = await fetchCoinFlipSnapshot();
        if (
          !disposed
          && requestId === snapshotRequestRef.current
          && requestedVersion === snapshotVersionRef.current
          && !startLock.current
          && !flipLock.current
        ) {
          setData(snapshot);
          setError("");
        }
      } catch {
        // Keep the last confirmed state when a background refresh is unavailable.
      }
    };

    const scheduleKoreaMidnightRefresh = () => {
      resetTimer = window.setTimeout(async () => {
        await refreshSnapshot();
        if (!disposed) scheduleKoreaMidnightRefresh();
      }, millisecondsUntilNextKoreaDay() + 250);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshSnapshot();
    };

    scheduleKoreaMidnightRefresh();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      window.clearTimeout(resetTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = window.setTimeout(
      () => setRetrySeconds((seconds) => Math.max(0, seconds - 1)),
      1_000,
    );
    return () => window.clearTimeout(timer);
  }, [retrySeconds]);

  useEffect(() => {
    if (!isGameView) return;

    const alreadyHadFullscreenClass = document.body.classList.contains("minigame-fullscreen-open");
    if (!alreadyHadFullscreenClass) {
      document.body.classList.add("minigame-fullscreen-open");
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        fullscreenRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      if (!alreadyHadFullscreenClass) {
        document.body.classList.remove("minigame-fullscreen-open");
      }
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isGameView]);

  useEffect(() => {
    if (!isGameView || isFlipping) return;

    const frame = window.requestAnimationFrame(() => {
      if (isStarting) {
        fullscreenRef.current?.focus();
      } else if (data?.state.active) {
        firstChoiceButtonRef.current?.focus();
      } else {
        (exitButtonRef.current ?? fullscreenRef.current)?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data?.state.active, isFlipping, isGameView, isStarting]);

  const closeGameView = () => {
    if (isFlippingRef.current) return;
    setIsGameView(false);
    setChoice(null);
    window.requestAnimationFrame(() => entryButtonRef.current?.focus());
  };

  const startGame = async (closeOnError = true) => {
    if (startLock.current || !canEnterCoinFlipGame(data)) return;
    startLock.current = true;
    snapshotVersionRef.current += 1;
    setIsGameView(true);
    setIsStarting(true);
    setError("");
    setLastFlip(null);
    setChoice(null);
    try {
      const snapshot = await apiRequest<CoinFlipSnapshot>("/minigames/coin-flip/start", {
        method: "POST",
      });
      setData(snapshot);
    } catch (caught) {
      if (closeOnError) setIsGameView(false);
      try {
        setData(await fetchCoinFlipSnapshot());
      } catch {
        // Keep the last confirmed count when synchronization is unavailable.
      }
      setError(minigameErrorMessage(caught, "게임을 시작하지 못했습니다."));
    } finally {
      snapshotVersionRef.current += 1;
      startLock.current = false;
      setIsStarting(false);
    }
  };

  const enterGame = () => {
    if (!canEnterCoinFlipGame(data)) return;
    setError("");
    setLastFlip(null);
    setChoice(null);
    if (data?.state.active) {
      setIsGameView(true);
      return;
    }
    void startGame();
  };

  const flipCoin = async (selectedChoice: CoinSide) => {
    const activeState = data?.state;
    if (!activeState?.active || retrySeconds > 0 || flipLock.current) return;

    flipLock.current = true;
    isFlippingRef.current = true;
    snapshotVersionRef.current += 1;
    setChoice(selectedChoice);
    setIsFlipping(true);
    setTossId((current) => current + 1);
    setTossPhase("launch");
    setLandingFace(null);
    setError("");
    setLastFlip(null);
    try {
      const responsePromise = apiRequest<CoinFlipResult>("/minigames/coin-flip/flip", {
        method: "POST",
        body: jsonBody({
          choice: selectedChoice,
          run_id: activeState.run_id,
          round_no: activeState.current_streak + 1,
        }),
      });

      // Give React one frame to mount a fresh coin while the handled request runs in parallel.
      const [response] = await Promise.all([responsePromise, nextAnimationFrame()]);
      if (reducedMotion) {
        await delay(REDUCED_MOTION_PHASE_MS);
      } else {
        // Keep spinning while the network is pending, then land on an iteration boundary.
        await waitForCoinAnimationEvent(
          coinRef.current,
          "animationiteration",
          ["coin-air-spin"],
          COIN_SPIN_FALLBACK_MS,
        );
      }

      // Select the result animation without changing the resting face underneath it.
      // The matching static face is committed only after the landing has completed.
      setLandingFace(response.result);
      setTossPhase("landing");
      await nextAnimationFrame();
      if (reducedMotion) {
        await delay(REDUCED_MOTION_PHASE_MS);
      } else {
        await waitForCoinAnimationEvent(
          coinRef.current,
          "animationend",
          ["coin-land-heads", "coin-land-tails"],
          COIN_LANDING_FALLBACK_MS,
        );
      }

      setCoinFace(response.result);
      setData({ state: response.state, ranking: response.ranking });
      setLastFlip({
        result: response.result,
        correct: response.correct,
        final_score: response.final_score,
      });
      setChoice(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 429) {
        setRetrySeconds(Math.max(1, Math.ceil(caught.retryAfter ?? 1)));
      }
      try {
        setData(await fetchCoinFlipSnapshot());
        setChoice(null);
      } catch {
        // Keep the last confirmed state when synchronization is unavailable.
      }
      setError(
        caught instanceof ApiError && caught.status === 409
          ? "게임 상태를 최신으로 갱신했어요. 다시 선택해 주세요."
          : minigameErrorMessage(caught, "동전을 던지지 못했습니다."),
      );
    } finally {
      snapshotVersionRef.current += 1;
      flipLock.current = false;
      isFlippingRef.current = false;
      setIsFlipping(false);
      setTossPhase("idle");
      setLandingFace(null);
    }
  };

  if (!data && !error) return <PageLoader />;

  const state = data?.state;
  const remainingAttempts = remainingCoinFlipAttempts(data);
  const attemptsExhausted = remainingAttempts === 0;
  const statusMessage = isStarting
    ? "게임을 준비하고 있어요…"
    : isFlipping
    ? "동전을 던지는 중이에요…"
    : lastFlip
      ? lastFlip.correct
        ? `${sideLabel[lastFlip.result]}! 맞혔어요.`
        : `${sideLabel[lastFlip.result]}! 아쉽게 틀렸어요. 이번 기록은 ${lastFlip.final_score ?? 0}회예요.`
      : state?.active
        ? "앞면 또는 뒷면을 눌러 동전을 던지세요."
        : "";

  const gameCard = data && state && (
    <section
      className={`coin-game-card ${isGameView ? "coin-game-card--fullscreen" : ""}`}
      aria-labelledby="coin-game-title"
    >
      <h2 className="visually-hidden" id="coin-game-title">동전 던지기 게임</h2>

      {error && isGameView && <Notice>{error}</Notice>}

      <div className="coin-streaks" aria-label="내 게임 기록">
        <div>
          <span>현재 연속</span>
          <strong>{state.current_streak}<small>회</small></strong>
        </div>
        <div>
          <span>최고 기록</span>
          <strong>{state.best_streak}<small>회</small></strong>
        </div>
      </div>

      <div
        className={`coin-stage ${tossPhase === "launch" ? "is-tossing" : tossPhase === "landing" ? "is-tossing is-landing" : ""}`}
        data-landing-face={landingFace ?? undefined}
        aria-hidden="true"
      >
        <div className="coin-flight">
          <div className={`coin coin--${coinFace}`} key={tossId} ref={coinRef}>
            <div className="coin__face coin__face--heads">
              <span className="coin-mascot-mark" />
            </div>
            <div className="coin__face coin__face--tails">
              <span className="coin__wordmark">scutta</span>
            </div>
          </div>
        </div>
        <span className="coin-shadow" />
      </div>

      {isGameView ? (
        <p
          className={`coin-status ${lastFlip ? (lastFlip.correct ? "is-correct" : "is-wrong") : ""}`}
          aria-live="polite"
          aria-atomic="true"
        >
          {statusMessage}
        </p>
      ) : (
        <p
          className={`coin-attempt-status ${attemptsExhausted && !state.active ? "is-exhausted" : ""}`}
          role="status"
        >
          오늘 남은 시도 <strong>{remainingAttempts}회</strong>
        </p>
      )}

      {isGameView && state.active ? (
        <div className="coin-controls">
          <div
            className="coin-choice"
            role="group"
            aria-busy={isFlipping}
            aria-label="누르면 바로 던져지는 동전 면 선택"
          >
            {(["heads", "tails"] as const).map((side) => (
              <button
                type="button"
                key={side}
                className={choice === side ? "is-selected" : ""}
                aria-label={`${sideLabel[side]}을 선택하고 동전 던지기`}
                disabled={isFlipping || retrySeconds > 0}
                onClick={() => void flipCoin(side)}
                ref={side === "heads" ? firstChoiceButtonRef : undefined}
              >
                <span
                  className={`coin-choice__icon coin-choice__icon--${side}`}
                  aria-hidden="true"
                >
                  {side === "heads" ? (
                    <span className="coin-mascot-mark" />
                  ) : (
                    <span className="coin-choice__wordmark">scutta</span>
                  )}
                </span>
                <span>{sideLabel[side]}</span>
              </button>
            ))}
          </div>
          {retrySeconds > 0 && (
            <p className="coin-retry-message" role="status">
              {retrySeconds}초 후 다시 던질 수 있어요.
            </p>
          )}
        </div>
      ) : isGameView && !state.active && !isStarting ? (
        <div className="coin-game-over-actions">
          <button
            type="button"
            className="secondary-button coin-game-exit-button"
            ref={exitButtonRef}
            onClick={closeGameView}
          >
            나가기
          </button>
          <button
            type="button"
            className="primary-button coin-game-restart-button"
            disabled={isStarting || attemptsExhausted}
            onClick={() => void startGame(false)}
          >
            <RotateCcw size={19} aria-hidden="true" />
            {isStarting ? "준비하는 중…" : attemptsExhausted ? "오늘 시도 완료" : "다시 도전하기"}
          </button>
        </div>
      ) : isGameView ? null : (
        <button
          type="button"
          className="primary-button primary-button--large coin-start-button"
          disabled={isStarting || isFlipping || (!state.active && attemptsExhausted)}
          ref={entryButtonRef}
          onClick={enterGame}
        >
          {isStarting
            ? "준비하는 중…"
            : !state.active && attemptsExhausted
              ? "오늘 시도 완료"
              : "게임 시작"}
        </button>
      )}
    </section>
  );

  return (
    <div className="page minigame-page">
      <header className="page-heading minigame-heading">
        <h1>동전 던지기</h1>
        <p>앞면과 뒷면을 맞히고 연속 기록을 이어가세요.</p>
      </header>

      {error && !isGameView && <Notice>{error}</Notice>}

      {data && state && (
        <>
          {isGameView ? (
            <div
              className="coin-game-fullscreen"
              role="dialog"
              aria-label="동전 던지기 게임"
              aria-modal="true"
              ref={fullscreenRef}
              tabIndex={-1}
            >
              <header className="coin-game-fullscreen__header">
                <div>
                  <span>MINI GAME</span>
                  <strong>동전 던지기</strong>
                </div>
              </header>
              <div className="coin-game-fullscreen__content">{gameCard}</div>
            </div>
          ) : gameCard}

          <section className="coin-ranking-card" aria-labelledby="coin-ranking-title">
            <header>
              <div>
                <Trophy size={20} aria-hidden="true" />
                <h2 id="coin-ranking-title">최고 연속 랭킹</h2>
              </div>
              <span>최고 기록</span>
            </header>

            {data.ranking.length > 0 ? (
              <div className="coin-ranking-list">
                {data.ranking.map((entry) => {
                  const isMe = entry.user_id === user?.id;
                  return (
                    <div
                      className={`coin-ranking-row ${isMe ? "is-me" : ""}`}
                      key={entry.user_id}
                    >
                      <span className="coin-ranking-rank">{entry.rank}</span>
                      <strong>{entry.username}{isMe && <small>나</small>}</strong>
                      <span className="coin-ranking-score">
                        <strong>{entry.best_streak}</strong>회
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="coin-ranking-empty">아직 기록이 없어요. 첫 기록을 만들어 보세요.</p>
            )}
            <p className="coin-ranking-note">동점자는 같은 순위이며 다음 기록은 한 단계만 내려가요.</p>
          </section>
        </>
      )}
    </div>
  );
}
