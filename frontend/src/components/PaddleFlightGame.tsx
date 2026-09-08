import { Infinity as InfinityIcon, RotateCcw, Trophy, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { apiRequest } from "../api/client";
import { getAuthSessionVersion } from "../auth/authSession";
import type { PaddleFlightChestReward, PaddleFlightEquipped, PaddleFlightOverview } from "../types";
import { createPaddleFlightClaimId, paddleFlightCosmetics } from "../utils/paddleFlightCosmetics";
import { drawPaddleFlight, drawPaddleFlightEntryPreview } from "../utils/paddleFlightRender";
import { DEFAULT_PADDLE_FLIGHT_EQUIPPED, PADDLE_FLIGHT_SKINS } from "../utils/paddleFlightSkins";
import { createPaddleFlightTreasureState, stepPaddleFlightTreasure } from "../utils/paddleFlightTreasure";
import { paddleFlightScores } from "../utils/paddleFlightScores";
import { PaddleFlightSkinPicker, PaddleSkinThumbnail } from "./PaddleFlightSkinPicker";
import { Notice } from "./Notice";
import {
  type PaddleFlightState,
  createInitialPaddleFlightState,
  flapPaddleFlight,
  stepPaddleFlight,
} from "../utils/paddleFlight";

interface PaddleFlightGameProps {
  userId?: number;
}

function nextRunSeed(runNumber: number) {
  return (Date.now() + runNumber * 2_654_435_761) >>> 0;
}

export function PaddleFlightIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="5" cy="6" r="2" />
      <path d="M18.3 3.8c2.6 2.6 2.1 7.3-1 10.4-3.1 3.1-7.8 3.6-10.4 1s-2.1-7.3 1-10.4 7.8-3.6 10.4-1Z" />
      <path d="m8.2 15.9-4.5 4.5" />
      <path d="m5.5 18.6 1.9 1.9" />
    </svg>
  );
}

export function PaddleFlightGame({ userId }: PaddleFlightGameProps) {
  const [isGameView, setIsGameView] = useState(false);
  const [phase, setPhase] = useState<PaddleFlightState["status"]>("ready");
  const [score, setScore] = useState(0);
  const [overview, setOverview] = useState<PaddleFlightOverview | null>(null);
  const [loadError, setLoadError] = useState("");
  const saveState = useSyncExternalStore(paddleFlightScores.subscribe, paddleFlightScores.getSnapshot);
  const cosmetics = useSyncExternalStore(paddleFlightCosmetics.subscribe, paddleFlightCosmetics.getSnapshot);
  const equipped = cosmetics.inventory?.equipped ?? DEFAULT_PADDLE_FLIGHT_EQUIPPED;
  const [rewardNotice, setRewardNotice] = useState<PaddleFlightChestReward | null>(null);
  const [runChestCount, setRunChestCount] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewBallCanvasRef = useRef<HTMLCanvasElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const entryButtonRef = useRef<HTMLButtonElement>(null);
  const restartButtonRef = useRef<HTMLButtonElement>(null);
  const gameStateRef = useRef(createInitialPaddleFlightState({ seed: nextRunSeed(0) }));
  const treasureStateRef = useRef(createPaddleFlightTreasureState());
  const equippedRef = useRef<PaddleFlightEquipped>(equipped);
  const runEquippedRef = useRef<PaddleFlightEquipped>(equipped);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const runNumberRef = useRef(0);
  const bestScoreRef = useRef(0);
  const runBestScoreRef = useRef(0);
  const submittedRunRef = useRef<number | null>(null);
  const confirmedBestScoreRef = useRef(0);
  const pendingScoresRef = useRef(new Map<number, number>());
  const isMountedRef = useRef(true);
  const bestScore = overview?.best_score ?? 0;
  const rewardName = rewardNotice ? PADDLE_FLIGHT_SKINS.find((skin) => skin.id === rewardNotice.skin_id)?.name ?? "스킨" : "";
  const rewardMessage = rewardNotice ? `${rewardName} · ${rewardNotice.duplicate ? "이미 보유한 스킨이에요" : "새 스킨 획득!"}` : "";

  useEffect(() => {
    equippedRef.current = equipped;
    if (isGameView) return;
    const ballCanvas = previewBallCanvasRef.current;
    let active = true;
    let inView = true;
    const updateAnimation = () => {
      if (!active) return;
      if (ballCanvas) ballCanvas.style.animationPlayState = inView && document.visibilityState === "visible" ? "running" : "paused";
    };
    const drawPreview = () => {
      if (previewCanvasRef.current) drawPaddleFlightEntryPreview(previewCanvasRef.current, equipped, ballCanvas ?? undefined);
    };
    drawPreview();
    updateAnimation();
    const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? false;
      updateAnimation();
    }) : null;
    if (previewCanvasRef.current) observer?.observe(previewCanvasRef.current);
    window.addEventListener("resize", drawPreview);
    document.addEventListener("visibilitychange", updateAnimation);
    return () => {
      active = false;
      window.removeEventListener("resize", drawPreview);
      document.removeEventListener("visibilitychange", updateAnimation);
      observer?.disconnect();
      if (ballCanvas) ballCanvas.style.animationPlayState = "paused";
    };
  }, [equipped, isGameView]);

  useEffect(() => {
    if (userId !== undefined) void paddleFlightCosmetics.load(userId);
  }, [userId]);

  useEffect(() => {
    if (!cosmetics.lastReward) return;
    setRewardNotice(cosmetics.lastReward);
    const timer = window.setTimeout(() => setRewardNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [cosmetics.lastReward]);

  const drawCurrentFrame = useCallback((state: PaddleFlightState) => {
    if (canvasRef.current) drawPaddleFlight(canvasRef.current, state, runEquippedRef.current, treasureStateRef.current.chests);
  }, []);

  const advanceTreasure = useCallback((previous: PaddleFlightState, next: PaddleFlightState) => {
    const treasure = stepPaddleFlightTreasure(treasureStateRef.current, previous, next);
    treasureStateRef.current = treasure;
    if (treasure.collected.length) {
      setRunChestCount((count) => count + treasure.collected.length);
      for (const _id of treasure.collected) paddleFlightCosmetics.collect(createPaddleFlightClaimId());
    }
  }, []);

  const stopAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    lastFrameTimeRef.current = null;
  }, []);

  const synchronizeEffectiveBestScore = useCallback((excludedRun?: number) => {
    let effectiveBest = confirmedBestScoreRef.current;
    for (const [pendingRun, pendingScore] of pendingScoresRef.current) {
      if (pendingRun !== excludedRun) {
        effectiveBest = Math.max(effectiveBest, pendingScore);
      }
    }
    if (excludedRun === undefined) bestScoreRef.current = effectiveBest;
    return effectiveBest;
  }, []);

  const submitScore = useCallback((finalScore: number, runNumber: number) => {
    if (submittedRunRef.current === runNumber) return;
    submittedRunRef.current = runNumber;
    pendingScoresRef.current.set(runNumber, finalScore);
    bestScoreRef.current = Math.max(bestScoreRef.current, finalScore);
    const sessionVersion = getAuthSessionVersion();

    void paddleFlightScores.enqueue(finalScore).then((result) => {
      pendingScoresRef.current.delete(runNumber);
      if (!isMountedRef.current || sessionVersion !== getAuthSessionVersion()) return;

      if (result.status === "saved") {
        const response = result.overview;
        confirmedBestScoreRef.current = response.best_score;
        synchronizeEffectiveBestScore();
        setOverview(response);
        setLoadError("");

        if (runNumberRef.current === runNumber) {
          setIsNewBest(
            finalScore > runBestScoreRef.current
              && response.best_score === finalScore,
          );
        } else {
          const activeRunBaseline = synchronizeEffectiveBestScore(
            runNumberRef.current,
          );
          runBestScoreRef.current = activeRunBaseline;
          setIsNewBest(gameStateRef.current.score > activeRunBaseline);
        }
      } else {
        synchronizeEffectiveBestScore();
        if (runNumberRef.current !== runNumber) {
          const activeRunBaseline = synchronizeEffectiveBestScore(
            runNumberRef.current,
          );
          runBestScoreRef.current = activeRunBaseline;
          setIsNewBest(gameStateRef.current.score > activeRunBaseline);
        }
      }
    });
  }, [synchronizeEffectiveBestScore]);

  const finishRun = useCallback((finalState: PaddleFlightState) => {
    stopAnimation();
    setScore(finalState.score);
    setPhase("gameOver");
    void submitScore(finalState.score, runNumberRef.current);
  }, [stopAnimation, submitScore]);

  const recordScore = useCallback((nextScore: number) => {
    setScore(nextScore);
    if (nextScore > runBestScoreRef.current) setIsNewBest(true);
  }, []);

  const animate = useCallback(function animateFrame(timestamp: number) {
    const currentState = gameStateRef.current;
    if (currentState.status !== "playing") {
      animationFrameRef.current = null;
      return;
    }

    const previousTimestamp = lastFrameTimeRef.current;
    // A pointer event can run after this frame's timestamp but before its callback.
    // Never rewind the simulation clock and count that time a second time.
    const frameTimestamp = Math.max(timestamp, previousTimestamp ?? timestamp);
    lastFrameTimeRef.current = frameTimestamp;
    if (previousTimestamp !== null) {
      const nextState = stepPaddleFlight(
        currentState,
        (frameTimestamp - previousTimestamp) / 1_000,
      );
      gameStateRef.current = nextState;
      advanceTreasure(currentState, nextState);
      if (nextState.score !== currentState.score) recordScore(nextState.score);
      drawCurrentFrame(nextState);

      if (nextState.status === "gameOver") {
        finishRun(nextState);
        return;
      }
    }

    animationFrameRef.current = window.requestAnimationFrame(animateFrame);
  }, [advanceTreasure, drawCurrentFrame, finishRun, recordScore]);

  const beginOrFlap = useCallback(() => {
    let currentState = gameStateRef.current;
    if (currentState.status === "gameOver") return;

    const inputTimestamp = window.performance.now();
    const previousTimestamp = lastFrameTimeRef.current;
    if (currentState.status === "playing" && previousTimestamp !== null) {
      const advancedState = stepPaddleFlight(
        currentState,
        (inputTimestamp - previousTimestamp) / 1_000,
      );
      gameStateRef.current = advancedState;
      advanceTreasure(currentState, advancedState);
      if (advancedState.score !== currentState.score) recordScore(advancedState.score);
      if (advancedState.status === "gameOver") {
        drawCurrentFrame(advancedState);
        finishRun(advancedState);
        return;
      }
      currentState = advancedState;
    }

    const nextState = flapPaddleFlight(currentState);
    gameStateRef.current = nextState;
    if (nextState.status !== currentState.status) setPhase(nextState.status);
    // Apply the flap on press, but paint only in the animation frame. Painting
    // here as well duplicates the full canvas work during touch handling.
    if (nextState.status === "playing") {
      lastFrameTimeRef.current = inputTimestamp;
      if (animationFrameRef.current === null) {
        animationFrameRef.current = window.requestAnimationFrame(animate);
      }
    }
  }, [advanceTreasure, animate, drawCurrentFrame, finishRun, recordScore]);

  const prepareRun = useCallback(() => {
    stopAnimation();
    runNumberRef.current += 1;
    const seed = nextRunSeed(runNumberRef.current);
    const nextState = createInitialPaddleFlightState({ seed });
    treasureStateRef.current = createPaddleFlightTreasureState(seed ^ 0x74726561);
    runEquippedRef.current = { ...equippedRef.current };
    gameStateRef.current = nextState;
    runBestScoreRef.current = bestScoreRef.current;
    setPhase("ready");
    setScore(0);
    setIsNewBest(false);
    setRunChestCount(0);
    setRewardNotice(null);
    drawCurrentFrame(nextState);
  }, [drawCurrentFrame, stopAnimation]);

  const enterGame = () => {
    prepareRun();
    setIsGameView(true);
  };

  const closeGame = useCallback(() => {
    stopAnimation();
    setIsGameView(false);
    setPhase("ready");
    window.requestAnimationFrame(() => entryButtonRef.current?.focus());
  }, [stopAnimation]);

  const restartGame = () => {
    prepareRun();
    window.requestAnimationFrame(() => canvasRef.current?.focus({ preventScroll: true }));
  };

  const handlePlayfieldPointerDown = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true });
    beginOrFlap();
  };

  const handlePlayfieldClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    // Physical input is handled on pointerdown, including a held or cancelled tap.
    // Keep click-only activation for keyboard and assistive technology.
    if (
      event.detail > 0
      || ("pointerType" in event.nativeEvent && event.nativeEvent.pointerType)
    ) return;
    if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true });
    beginOrFlap();
  };

  const handlePlayfieldKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (!["Space", "ArrowUp", "Enter"].includes(event.code)) return;
    event.preventDefault();
    if (event.repeat) return;
    beginOrFlap();
  };

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const sessionVersion = getAuthSessionVersion();
    const responseVersion = paddleFlightScores.getResponseVersion();
    bestScoreRef.current = 0;
    confirmedBestScoreRef.current = 0;
    pendingScoresRef.current.clear();
    setOverview(null);
    setLoadError("");
    setIsNewBest(false);

    apiRequest<PaddleFlightOverview>("/minigames/paddle-flight", {
      signal: controller.signal,
    })
      .then((response) => {
        if (!active || sessionVersion !== getAuthSessionVersion()) return;
        if (responseVersion === paddleFlightScores.getResponseVersion()) {
          paddleFlightScores.acceptOverview(response);
        }
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "계정 기록을 불러오지 못했습니다.",
        );
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [userId]);

  useEffect(() => {
    if (!saveState.overview) return;
    confirmedBestScoreRef.current = saveState.overview.best_score;
    bestScoreRef.current = Math.max(saveState.overview.best_score, saveState.pendingBestScore);
    setOverview(saveState.overview);
    setLoadError("");
  }, [saveState.overview, saveState.pendingBestScore]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => () => stopAnimation(), [stopAnimation]);

  useEffect(() => {
    if (!isGameView || phase !== "gameOver") return;
    const focusFrame = window.requestAnimationFrame(() => restartButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [isGameView, phase]);

  useEffect(() => {
    if (!isGameView) return;

    const canvas = canvasRef.current;
    drawCurrentFrame(gameStateRef.current);
    const focusFrame = window.requestAnimationFrame(() => canvas?.focus({ preventScroll: true }));
    const handleViewportChange = () => {
      if (document.visibilityState === "visible") lastFrameTimeRef.current = null;
      drawCurrentFrame(gameStateRef.current);
    };
    window.addEventListener("resize", handleViewportChange);
    document.addEventListener("visibilitychange", handleViewportChange);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("resize", handleViewportChange);
      document.removeEventListener("visibilitychange", handleViewportChange);
    };
  }, [drawCurrentFrame, isGameView]);

  useEffect(() => {
    if (!isGameView) return;

    const alreadyHadFullscreenClass = document.body.classList.contains("minigame-fullscreen-open");
    if (!alreadyHadFullscreenClass) document.body.classList.add("minigame-fullscreen-open");

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeGame();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        fullscreenRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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
      if (!alreadyHadFullscreenClass) document.body.classList.remove("minigame-fullscreen-open");
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeGame, isGameView]);

  return (
    <>
      {(loadError || (!isGameView && saveState.error)) && (
        <Notice>{saveState.error || loadError}</Notice>
      )}
      {!isGameView && saveState.pendingCount > 0 && <Notice tone="info">점수를 저장하고 있어요.</Notice>}
      {!isGameView && cosmetics.error && <Notice>{cosmetics.error}</Notice>}
      {!isGameView && rewardNotice && <Notice tone="success">{rewardMessage}</Notice>}
      {!isGameView && cosmetics.pendingCount > 0 && (
        <div className="paddle-treasure-pending">
          <Notice tone="info">{`보물상자 ${cosmetics.pendingCount}개의 보상을 저장${cosmetics.processingCount ? "하고 있어요." : "하지 못했어요. 연결 후 다시 저장해 주세요."}`}</Notice>
          {!cosmetics.processingCount && <button type="button" className="secondary-button" onClick={() => paddleFlightCosmetics.retryClaims()}>상자 보상 다시 저장</button>}
        </div>
      )}

      <section className="paddle-flight-card" aria-labelledby="paddle-flight-card-title">
        <h2 className="visually-hidden" id="paddle-flight-card-title">탁구공 날리기 게임</h2>

        <div className="paddle-flight-stats" aria-label="탁구공 날리기 기록">
          <div>
            <span>내 최고 점수</span>
            <strong>{bestScore}<small>점</small></strong>
          </div>
          <div>
            <span>플레이 제한</span>
            <strong className="paddle-flight-unlimited">
              <InfinityIcon size={23} aria-label="무제한" />
            </strong>
          </div>
        </div>

        <div className="paddle-flight-preview paddle-flight-preview--skinned" aria-label="선택한 스킨 미리보기">
          <canvas ref={previewCanvasRef} className="paddle-flight-preview__canvas" role="img" aria-label="현재 선택한 배경, 탁구채와 탁구공" draggable={false} onContextMenu={(event) => event.preventDefault()} />
          <canvas ref={previewBallCanvasRef} className="paddle-flight-preview__ball-canvas" aria-hidden="true" draggable={false} onContextMenu={(event) => event.preventDefault()} />
        </div>

        <p className="paddle-flight-entry-copy">화면을 누르면 탁구공이 위로 튀어 올라요.</p>
        <p className="paddle-flight-limit-copy">횟수 제한 없이 계속 도전할 수 있어요.</p>

        <button
          type="button"
          className="primary-button primary-button--large paddle-flight-start-button"
          ref={entryButtonRef}
          onClick={enterGame}
          disabled={!overview && !loadError}
        >
          {!overview && !loadError ? "기록 불러오는 중..." : "게임 시작"}
        </button>
        <PaddleFlightSkinPicker
          inventory={cosmetics.inventory}
          loading={cosmetics.loading}
          saving={cosmetics.savingEquipment}
          onEquip={(selection) => paddleFlightCosmetics.equip(selection)}
          onReload={() => { if (userId !== undefined) void paddleFlightCosmetics.load(userId); }}
        />
      </section>

      <section className="coin-ranking-card" aria-labelledby="paddle-flight-ranking-title">
        <header>
          <div>
            <Trophy size={20} aria-hidden="true" />
            <h2 id="paddle-flight-ranking-title">탁구공 최고 점수 랭킹</h2>
          </div>
          <span>최고 점수</span>
        </header>

        {overview && overview.ranking.length > 0 ? (
          <div className="coin-ranking-list">
            {overview.ranking.map((entry) => {
              const isMe = entry.user_id === userId;
              return (
                <div
                  className={`coin-ranking-row ${isMe ? "is-me" : ""}`}
                  key={entry.user_id}
                >
                  <span className="coin-ranking-rank">{entry.rank}</span>
                  <strong>{entry.username}{isMe && <small>나</small>}</strong>
                  <span className="coin-ranking-score">
                    <strong>{entry.best_score}</strong>점
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="coin-ranking-empty">
            {!overview && !loadError
              ? "랭킹을 불러오는 중이에요."
              : "아직 기록이 없어요. 첫 기록을 만들어 보세요."}
          </p>
        )}
        <p className="coin-ranking-note">
          동점이면 최고 기록을 먼저 달성한 순서대로 순위가 정해져요.
        </p>
      </section>

      {isGameView && (
        <div
          className="paddle-flight-fullscreen"
          role="dialog"
          aria-label="탁구공 날리기 게임"
          aria-modal="true"
          ref={fullscreenRef}
          tabIndex={-1}
          onContextMenu={(event) => event.preventDefault()}
          onDragStart={(event) => event.preventDefault()}
        >
          <header className="paddle-flight-fullscreen__header">
            <div>
              <span>MINI GAME</span>
              <strong>탁구공 날리기</strong>
            </div>
            <button type="button" onClick={closeGame} aria-label="게임 나가기">
              <X size={22} aria-hidden="true" />
            </button>
          </header>

          <div className="paddle-flight-fullscreen__content">
            <div className="paddle-flight-board">
              <canvas
                ref={canvasRef}
                className="paddle-flight-canvas"
                draggable={false}
                role={phase === "gameOver" ? "img" : "button"}
                tabIndex={phase === "gameOver" ? -1 : 0}
                aria-label={
                  phase === "ready"
                    ? "탁구공 날리기 시작. 화면을 누르세요."
                    : phase === "playing"
                      ? `탁구공 날리기 진행 중. 현재 ${score}점. 누르면 공이 올라갑니다.`
                      : `게임 종료. 최종 ${score}점.`
                }
                aria-describedby="paddle-flight-controls-help"
                onPointerDown={handlePlayfieldPointerDown}
                onClick={handlePlayfieldClick}
                onKeyDown={handlePlayfieldKeyDown}
              >
                탁구채 손잡이 사이로 탁구공을 날리는 게임입니다.
              </canvas>

              <div className="paddle-flight-hud" aria-hidden="true">
                <div>
                  <span>점수</span>
                  <strong>{score}</strong>
                </div>
                <div>
                  <span>최고</span>
                  <strong>{Math.max(bestScore, score)}</strong>
                </div>
              </div>

              {phase === "ready" && (
                <div className="paddle-flight-ready-overlay" aria-hidden="true">
                  {runEquippedRef.current.ball === "ball_classic"
                    ? <span className="paddle-flight-ready-ball" />
                    : <PaddleSkinThumbnail skinId={runEquippedRef.current.ball} />}
                  <strong>탭해서 날기</strong>
                  <span>화면을 눌러 탁구공을 띄우세요</span>
                </div>
              )}

              {phase === "gameOver" && (
                <div
                  className="paddle-flight-game-over"
                  role="status"
                  aria-live="assertive"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <span>GAME OVER</span>
                  <strong>{score}<small>점</small></strong>
                  {runChestCount > 0 && <small className="paddle-treasure-run-count">{`이번 게임 보물상자 ${runChestCount}개${cosmetics.pendingCount ? " · 보상 저장 대기 중" : ""}`}</small>}
                  <p>
                    {saveState.error
                      ? saveState.error
                      : saveState.pendingCount > 0
                        ? "점수를 저장하고 있어요…"
                        : isNewBest
                        ? "새로운 최고 기록이에요!"
                        : "손잡이를 피해 다시 날아볼까요?"}
                  </p>
                  <div className="paddle-flight-game-over__actions">
                    <button type="button" className="secondary-button" onClick={closeGame}>
                      나가기
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      ref={restartButtonRef}
                      onClick={restartGame}
                    >
                      <RotateCcw size={18} aria-hidden="true" />
                      다시 도전
                    </button>
                  </div>
                </div>
              )}
            </div>

            <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
              현재 점수 {score}점
            </p>
            <p id="paddle-flight-controls-help" className="paddle-flight-controls-help">
              {rewardNotice ? <span role="status" aria-live="polite">{rewardMessage}</span> : "화면을 누르면 공이 바로 올라가요."}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
