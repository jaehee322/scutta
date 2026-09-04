import { Infinity as InfinityIcon, RotateCcw, Trophy, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { apiRequest, jsonBody } from "../api/client";
import type { PaddleFlightOverview } from "../types";
import { Notice } from "./Notice";
import {
  PADDLE_FLIGHT_WORLD,
  type PaddleFlightObstacle,
  type PaddleFlightState,
  createInitialPaddleFlightState,
  flapPaddleFlight,
  getPaddleFlightPaddleGeometry,
  stepPaddleFlight,
} from "../utils/paddleFlight";

interface PaddleFlightGameProps {
  userId?: number;
}

interface PaddleFlightSaveError {
  readonly runNumber: number;
  readonly message: string;
}

function roundedRectangle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  context.beginPath();
  context.roundRect(x, y, width, height, safeRadius);
}

function drawPaddleHandle(
  context: CanvasRenderingContext2D,
  obstacle: PaddleFlightObstacle,
  fromTop: boolean,
) {
  const paddle = getPaddleFlightPaddleGeometry(obstacle, fromTop);
  const [neckLeft, neckRight, buttRight] = paddle.handleBody;
  if (!neckLeft || !neckRight || !buttRight) return;
  const direction = fromTop ? 1 : -1;
  const handleGradient = context.createLinearGradient(
    paddle.handleButt.x - paddle.handleButt.radius,
    0,
    paddle.handleButt.x + paddle.handleButt.radius,
    0,
  );
  handleGradient.addColorStop(0, "#65351f");
  handleGradient.addColorStop(0.16, "#a85e35");
  handleGradient.addColorStop(0.43, "#e1a069");
  handleGradient.addColorStop(0.62, "#f0bd82");
  handleGradient.addColorStop(0.84, "#a95d34");
  handleGradient.addColorStop(1, "#5f311d");

  context.save();
  context.beginPath();
  context.moveTo(neckLeft.x, neckLeft.y);
  context.lineTo(neckRight.x, neckRight.y);
  context.lineTo(buttRight.x, buttRight.y);
  context.arc(
    paddle.handleButt.x,
    paddle.handleButt.y,
    paddle.handleButt.radius,
    0,
    fromTop ? Math.PI : -Math.PI,
    !fromTop,
  );
  context.closePath();
  context.fillStyle = handleGradient;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = "#5d321f";
  context.stroke();

  context.save();
  context.clip();
  const neckY = neckLeft.y;
  const buttY = paddle.handleButt.y;
  const middleY = (neckY + buttY) / 2;
  context.globalAlpha = 0.34;
  context.strokeStyle = "#fff0cf";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(paddle.handleButt.x - 4, neckY + direction * 5);
  context.quadraticCurveTo(
    paddle.handleButt.x - 6,
    middleY,
    paddle.handleButt.x - 5,
    buttY + direction * (paddle.handleButt.radius - 3),
  );
  context.stroke();

  context.globalAlpha = 0.3;
  context.strokeStyle = "#67351f";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(paddle.handleButt.x + 4, neckY + direction * 8);
  context.quadraticCurveTo(
    paddle.handleButt.x + 6,
    middleY,
    paddle.handleButt.x + 7,
    buttY + direction * (paddle.handleButt.radius - 5),
  );
  context.stroke();
  context.restore();
  context.restore();
}

function drawPaddleHead(
  context: CanvasRenderingContext2D,
  obstacle: PaddleFlightObstacle,
  fromTop: boolean,
) {
  const { head } = getPaddleFlightPaddleGeometry(obstacle, fromTop);
  const rimGradient = context.createLinearGradient(
    head.x - head.radius,
    head.y,
    head.x + head.radius,
    head.y,
  );
  rimGradient.addColorStop(0, "#6a351e");
  rimGradient.addColorStop(0.3, "#d68e54");
  rimGradient.addColorStop(0.52, "#f1bf7e");
  rimGradient.addColorStop(0.78, "#b56538");
  rimGradient.addColorStop(1, "#5d2e1b");
  const faceGradient = context.createRadialGradient(
    head.x - 12,
    head.y - 12,
    4,
    head.x,
    head.y,
    head.radius,
  );
  if (fromTop) {
    faceGradient.addColorStop(0, "#ff747a");
    faceGradient.addColorStop(0.56, "#d93442");
    faceGradient.addColorStop(1, "#921b28");
  } else {
    faceGradient.addColorStop(0, "#555b63");
    faceGradient.addColorStop(0.5, "#1d2025");
    faceGradient.addColorStop(1, "#050607");
  }

  context.save();
  context.beginPath();
  context.arc(head.x, head.y, head.radius, 0, Math.PI * 2);
  context.fillStyle = rimGradient;
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = "#552c1c";
  context.stroke();

  context.beginPath();
  context.arc(head.x, head.y, head.radius - 4.5, 0, Math.PI * 2);
  context.fillStyle = faceGradient;
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = fromTop ? "#781722" : "#020304";
  context.stroke();

  context.beginPath();
  context.arc(
    head.x,
    head.y,
    head.radius - 10,
    Math.PI * 1.08,
    Math.PI * 1.68,
  );
  context.strokeStyle = fromTop ? "#ffffff45" : "#ffffff30";
  context.lineWidth = 2;
  context.stroke();

  context.beginPath();
  context.arc(head.x + 13, head.y + 19, 2.1, 0, Math.PI * 2);
  context.fillStyle = fromTop ? "#ffd7d84f" : "#ffffff35";
  context.fill();
  context.restore();
}

function drawBall(context: CanvasRenderingContext2D, state: PaddleFlightState) {
  const { ball } = state;
  const velocityRatio = Math.max(-0.55, Math.min(0.85, ball.velocityY / 520));

  if (state.status === "playing") {
    context.save();
    for (let index = 3; index >= 1; index -= 1) {
      context.beginPath();
      context.arc(
        ball.x - index * 8,
        ball.y - velocityRatio * index * 5,
        Math.max(2, ball.radius - index * 2.7),
        0,
        Math.PI * 2,
      );
      context.globalAlpha = 0.08 * (4 - index);
      context.fillStyle = "#69809b";
      context.fill();
    }
    context.restore();
  }

  context.save();
  context.translate(ball.x, ball.y);
  context.rotate(velocityRatio * 0.42);

  context.beginPath();
  context.arc(2, 3, ball.radius + 1, 0, Math.PI * 2);
  context.fillStyle = "#17202c24";
  context.filter = "blur(3px)";
  context.fill();
  context.filter = "none";

  const ballGradient = context.createRadialGradient(
    -ball.radius * 0.42,
    -ball.radius * 0.48,
    1,
    0,
    0,
    ball.radius * 1.25,
  );
  ballGradient.addColorStop(0, "#ffffff");
  ballGradient.addColorStop(0.62, "#f8f7f1");
  ballGradient.addColorStop(1, "#d8d8d2");
  context.beginPath();
  context.arc(0, 0, ball.radius, 0, Math.PI * 2);
  context.fillStyle = ballGradient;
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = "#aeb4ba";
  context.stroke();

  context.beginPath();
  context.arc(-2, 1, ball.radius * 0.36, -0.65, 0.92);
  context.strokeStyle = "#e66c45";
  context.lineWidth = 1.3;
  context.stroke();
  context.beginPath();
  context.arc(3.8, -3.2, 1.25, 0, Math.PI * 2);
  context.fillStyle = "#e66c45";
  context.fill();
  context.restore();
}

function drawPaddleFlight(canvas: HTMLCanvasElement, state: PaddleFlightState) {
  const context = canvas.getContext("2d");
  if (!context) return;

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const { width, height } = PADDLE_FLIGHT_WORLD;
  const backingWidth = Math.round(width * pixelRatio);
  const backingHeight = Math.round(height * pixelRatio);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const background = context.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#e8f7ff");
  background.addColorStop(0.58, "#f5fbff");
  background.addColorStop(1, "#eef8f5");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.save();
  context.globalAlpha = 0.34;
  context.strokeStyle = "#9fc9df";
  context.lineWidth = 1;
  const drift = (state.elapsedSeconds * 26) % 56;
  for (let x = -56 - drift; x < width + 56; x += 56) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + 90, height);
    context.stroke();
  }
  context.globalAlpha = 0.22;
  context.strokeStyle = "#5cbca4";
  context.setLineDash([8, 12]);
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  context.restore();

  for (const obstacle of state.obstacles) {
    drawPaddleHandle(context, obstacle, true);
    drawPaddleHandle(context, obstacle, false);
    drawPaddleHead(context, obstacle, true);
    drawPaddleHead(context, obstacle, false);
  }

  drawBall(context, state);

  context.save();
  context.strokeStyle = "#ffffffb8";
  context.lineWidth = 2;
  roundedRectangle(context, 1, 1, width - 2, height - 2, 20);
  context.stroke();
  context.restore();
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
  const [saveError, setSaveError] = useState<PaddleFlightSaveError | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const entryButtonRef = useRef<HTMLButtonElement>(null);
  const restartButtonRef = useRef<HTMLButtonElement>(null);
  const gameStateRef = useRef(createInitialPaddleFlightState({ seed: nextRunSeed(0) }));
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const runNumberRef = useRef(0);
  const bestScoreRef = useRef(0);
  const runBestScoreRef = useRef(0);
  const submittedRunRef = useRef<number | null>(null);
  const confirmedBestScoreRef = useRef(0);
  const pendingScoresRef = useRef(new Map<number, number>());
  const submissionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const isMountedRef = useRef(true);
  const accountGenerationRef = useRef(0);
  const suppressNextClickRef = useRef(false);
  const bestScore = overview?.best_score ?? 0;

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
    setSaveError(null);
    const accountGeneration = accountGenerationRef.current;

    submissionQueueRef.current = submissionQueueRef.current.then(async () => {
      if (
        !isMountedRef.current
        || accountGenerationRef.current !== accountGeneration
      ) {
        pendingScoresRef.current.delete(runNumber);
        synchronizeEffectiveBestScore();
        return;
      }

      try {
        const response = await apiRequest<PaddleFlightOverview>(
          "/minigames/paddle-flight/score",
          {
            method: "POST",
            body: jsonBody({ score: finalScore }),
          },
        );
        if (
          !isMountedRef.current
          || accountGenerationRef.current !== accountGeneration
        ) {
          pendingScoresRef.current.delete(runNumber);
          synchronizeEffectiveBestScore();
          return;
        }

        confirmedBestScoreRef.current = response.best_score;
        pendingScoresRef.current.delete(runNumber);
        synchronizeEffectiveBestScore();
        if (!isMountedRef.current) return;

        // Requests are serialized, so each response is the latest authoritative
        // account snapshot even when a semester reset lowered the saved score.
        setOverview(response);
        setLoadError("");
        setSaveError((current) => (
          current?.runNumber === runNumber ? null : current
        ));

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
      } catch (error) {
        pendingScoresRef.current.delete(runNumber);
        synchronizeEffectiveBestScore();
        if (
          !isMountedRef.current
          || accountGenerationRef.current !== accountGeneration
        ) return;

        if (runNumberRef.current === runNumber) {
          setSaveError({
            runNumber,
            message: error instanceof Error
              ? error.message
              : "점수를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
          });
        } else {
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
    lastFrameTimeRef.current = timestamp;
    if (previousTimestamp !== null) {
      const nextState = stepPaddleFlight(
        currentState,
        (timestamp - previousTimestamp) / 1_000,
      );
      gameStateRef.current = nextState;
      if (nextState.score !== currentState.score) recordScore(nextState.score);
      if (canvasRef.current) drawPaddleFlight(canvasRef.current, nextState);

      if (nextState.status === "gameOver") {
        finishRun(nextState);
        return;
      }
    }

    animationFrameRef.current = window.requestAnimationFrame(animateFrame);
  }, [finishRun, recordScore]);

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
      if (advancedState.score !== currentState.score) recordScore(advancedState.score);
      if (canvasRef.current) drawPaddleFlight(canvasRef.current, advancedState);
      if (advancedState.status === "gameOver") {
        finishRun(advancedState);
        return;
      }
      currentState = advancedState;
    }

    const nextState = flapPaddleFlight(currentState);
    gameStateRef.current = nextState;
    setPhase(nextState.status);
    if (canvasRef.current) drawPaddleFlight(canvasRef.current, nextState);
    if (nextState.status === "playing") {
      lastFrameTimeRef.current = inputTimestamp;
      if (animationFrameRef.current === null) {
        animationFrameRef.current = window.requestAnimationFrame(animate);
      }
    }
  }, [animate, finishRun, recordScore]);

  const prepareRun = useCallback(() => {
    stopAnimation();
    runNumberRef.current += 1;
    const nextState = createInitialPaddleFlightState({
      seed: nextRunSeed(runNumberRef.current),
    });
    gameStateRef.current = nextState;
    runBestScoreRef.current = bestScoreRef.current;
    setPhase("ready");
    setScore(0);
    setIsNewBest(false);
    setSaveError(null);
    if (canvasRef.current) drawPaddleFlight(canvasRef.current, nextState);
  }, [stopAnimation]);

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
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    suppressNextClickRef.current = true;
    event.currentTarget.focus({ preventScroll: true });
    beginOrFlap();
  };

  const handlePlayfieldPointerCancel = () => {
    suppressNextClickRef.current = false;
  };

  const handlePlayfieldClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (event.detail > 0 && suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    event.currentTarget.focus({ preventScroll: true });
    beginOrFlap();
  };

  const handlePlayfieldKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (event.repeat || !["Space", "ArrowUp", "Enter"].includes(event.code)) return;
    event.preventDefault();
    beginOrFlap();
  };

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const accountGeneration = accountGenerationRef.current + 1;
    accountGenerationRef.current = accountGeneration;
    bestScoreRef.current = 0;
    confirmedBestScoreRef.current = 0;
    pendingScoresRef.current.clear();
    setOverview(null);
    setLoadError("");
    setSaveError(null);
    setIsNewBest(false);

    apiRequest<PaddleFlightOverview>("/minigames/paddle-flight", {
      signal: controller.signal,
    })
      .then((response) => {
        if (!active) return;
        confirmedBestScoreRef.current = response.best_score;
        bestScoreRef.current = response.best_score;
        setOverview(response);
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
      if (accountGenerationRef.current === accountGeneration) {
        accountGenerationRef.current += 1;
      }
    };
  }, [userId]);

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
    if (canvas) drawPaddleFlight(canvas, gameStateRef.current);
    const focusFrame = window.requestAnimationFrame(() => canvas?.focus({ preventScroll: true }));
    const handleViewportChange = () => {
      if (document.visibilityState === "visible") lastFrameTimeRef.current = null;
      if (canvasRef.current) drawPaddleFlight(canvasRef.current, gameStateRef.current);
    };
    window.addEventListener("resize", handleViewportChange);
    document.addEventListener("visibilitychange", handleViewportChange);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("resize", handleViewportChange);
      document.removeEventListener("visibilitychange", handleViewportChange);
    };
  }, [isGameView]);

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
      {(loadError || (!isGameView && saveError)) && (
        <Notice>{saveError?.message || loadError}</Notice>
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

        <div className="paddle-flight-preview" aria-hidden="true">
          <span className="paddle-flight-preview__speed-line paddle-flight-preview__speed-line--one" />
          <span className="paddle-flight-preview__speed-line paddle-flight-preview__speed-line--two" />
          <span className="paddle-flight-preview__handle paddle-flight-preview__handle--top" />
          <span className="paddle-flight-preview__handle paddle-flight-preview__handle--bottom" />
          <span className="paddle-flight-preview__ball" />
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
                onPointerCancel={handlePlayfieldPointerCancel}
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
                  <span className="paddle-flight-ready-ball" />
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
                  <p>
                    {saveError
                      ? saveError.message
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
              화면을 누르면 공이 바로 올라가요.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
