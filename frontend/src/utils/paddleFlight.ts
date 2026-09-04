export const PADDLE_FLIGHT_WORLD = {
  width: 360,
  height: 540,
} as const;

export const PADDLE_FLIGHT_PHYSICS = {
  ballX: 78,
  ballStartY: PADDLE_FLIGHT_WORLD.height / 2,
  ballRadius: 12,
  gravity: 980,
  flapVelocity: -330,
  maxFallVelocity: 560,
  maxFrameDeltaSeconds: 0.1,
  simulationStepSeconds: 1 / 120,
  obstacleSpeed: 120,
  maximumObstacleSpeed: 230,
  obstacleSpeedIncreasePerPoint: 5,
  /** Widest horizontal silhouette: the circular rubber face. */
  obstacleWidth: 78,
  obstacleGap: 90,
  minimumObstacleGap: 84,
  obstacleGapDecreasePerPoint: 0.12,
  obstacleSpacing: 171,
  firstObstacleX: PADDLE_FLIGHT_WORLD.width + 70,
  obstacleCount: 3,
  paddleHeadRadius: 39,
  paddleHeadCenterInset: 22,
  paddleHandleStartInset: 52,
  paddleHandleNeckWidth: 17,
  paddleHandleButtWidth: 28,
  minimumHandleLength: 104,
} as const;

const DEFAULT_RANDOM_SEED = 0x50add1e;
const UINT32_RANGE = 0x1_0000_0000;

export type PaddleFlightStatus = "ready" | "playing" | "gameOver";
export type PaddleFlightRandom = () => number;

export interface PaddleFlightBall {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly velocityY: number;
}

/**
 * One pair of paddles. `x` and `width` describe the widest rubber-face
 * envelope, and the open space is the range from `gapTop` through
 * `gapBottom`.
 */
export interface PaddleFlightObstacle {
  readonly id: number;
  readonly x: number;
  readonly width: number;
  readonly gapTop: number;
  readonly gapBottom: number;
  readonly scored: boolean;
}

export interface PaddleFlightState {
  readonly status: PaddleFlightStatus;
  readonly ball: PaddleFlightBall;
  readonly obstacles: readonly PaddleFlightObstacle[];
  readonly score: number;
  readonly elapsedSeconds: number;
  /** Internal deterministic RNG state, kept in the snapshot for pure updates. */
  readonly rngState: number;
  readonly nextObstacleId: number;
}

export interface CreatePaddleFlightOptions {
  /** Identical seeds produce identical obstacle layouts. */
  readonly seed?: number;
  /** Optional source used instead of the built-in seeded random values. */
  readonly random?: PaddleFlightRandom;
}

export interface StepPaddleFlightOptions {
  /** Supply the same source on subsequent steps to control recycled layouts. */
  readonly random?: PaddleFlightRandom;
}

interface RandomSample {
  readonly value: number;
  readonly nextState: number;
}

export interface PaddleFlightRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PaddleFlightPoint {
  readonly x: number;
  readonly y: number;
}

export interface PaddleFlightCircle {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface PaddleFlightPaddleGeometry {
  readonly head: PaddleFlightCircle;
  readonly handleBody: readonly PaddleFlightPoint[];
  readonly handleButt: PaddleFlightCircle;
}

export interface PaddleFlightDifficulty {
  readonly obstacleSpeed: number;
  readonly obstacleGap: number;
}

/** Difficulty rises gradually with score and settles at a fair upper bound. */
export function getPaddleFlightDifficulty(score: number): PaddleFlightDifficulty {
  const normalizedScore = Number.isFinite(score)
    ? Math.max(0, Math.trunc(score))
    : 0;

  return {
    obstacleSpeed: Math.min(
      PADDLE_FLIGHT_PHYSICS.maximumObstacleSpeed,
      PADDLE_FLIGHT_PHYSICS.obstacleSpeed
        + normalizedScore * PADDLE_FLIGHT_PHYSICS.obstacleSpeedIncreasePerPoint,
    ),
    obstacleGap: Math.max(
      PADDLE_FLIGHT_PHYSICS.minimumObstacleGap,
      PADDLE_FLIGHT_PHYSICS.obstacleGap
        - normalizedScore * PADDLE_FLIGHT_PHYSICS.obstacleGapDecreasePerPoint,
    ),
  };
}

function normalizeSeed(seed: number | undefined) {
  if (seed === undefined || !Number.isFinite(seed)) return DEFAULT_RANDOM_SEED;
  return Math.trunc(seed) >>> 0;
}

function normalizeRandomValue(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1 - Number.EPSILON, Math.max(0, value));
}

function takeRandom(rngState: number, random?: PaddleFlightRandom): RandomSample {
  const nextState = (Math.imul(rngState, 1_664_525) + 1_013_904_223) >>> 0;
  return {
    value: normalizeRandomValue(random ? random() : nextState / UINT32_RANGE),
    nextState,
  };
}

function createObstacle(
  id: number,
  x: number,
  rngState: number,
  obstacleGap: number,
  random?: PaddleFlightRandom,
) {
  const sample = takeRandom(rngState, random);
  const availableGapTravel =
    PADDLE_FLIGHT_WORLD.height
    - obstacleGap
    - PADDLE_FLIGHT_PHYSICS.minimumHandleLength * 2;
  const gapTop =
    PADDLE_FLIGHT_PHYSICS.minimumHandleLength
    + availableGapTravel * sample.value;

  return {
    obstacle: {
      id,
      x,
      width: PADDLE_FLIGHT_PHYSICS.obstacleWidth,
      gapTop,
      gapBottom: gapTop + obstacleGap,
      scored: false,
    } satisfies PaddleFlightObstacle,
    nextRngState: sample.nextState,
  };
}

export function createInitialPaddleFlightState(
  options: CreatePaddleFlightOptions = {},
): PaddleFlightState {
  let rngState = normalizeSeed(options.seed);
  const obstacles: PaddleFlightObstacle[] = [];

  for (let index = 0; index < PADDLE_FLIGHT_PHYSICS.obstacleCount; index += 1) {
    const created = createObstacle(
      index,
      PADDLE_FLIGHT_PHYSICS.firstObstacleX
        + PADDLE_FLIGHT_PHYSICS.obstacleSpacing * index,
      rngState,
      PADDLE_FLIGHT_PHYSICS.obstacleGap,
      options.random,
    );
    obstacles.push(created.obstacle);
    rngState = created.nextRngState;
  }

  return {
    status: "ready",
    ball: {
      x: PADDLE_FLIGHT_PHYSICS.ballX,
      y: PADDLE_FLIGHT_PHYSICS.ballStartY,
      radius: PADDLE_FLIGHT_PHYSICS.ballRadius,
      velocityY: 0,
    },
    obstacles,
    score: 0,
    elapsedSeconds: 0,
    rngState,
    nextObstacleId: obstacles.length,
  };
}

/** A flap also starts a ready game, which keeps pointer/keyboard handling simple. */
export function flapPaddleFlight(state: PaddleFlightState): PaddleFlightState {
  if (state.status === "gameOver") return state;

  return {
    ...state,
    status: "playing",
    ball: {
      ...state.ball,
      velocityY: PADDLE_FLIGHT_PHYSICS.flapVelocity,
    },
  };
}

function integrateBall(ball: PaddleFlightBall, deltaSeconds: number): PaddleFlightBall {
  const { gravity, maxFallVelocity } = PADDLE_FLIGHT_PHYSICS;
  const unconstrainedVelocity = ball.velocityY + gravity * deltaSeconds;
  const velocityY = Math.min(maxFallVelocity, unconstrainedVelocity);
  let distanceY: number;

  if (ball.velocityY >= maxFallVelocity) {
    distanceY = maxFallVelocity * deltaSeconds;
  } else if (unconstrainedVelocity <= maxFallVelocity) {
    distanceY =
      ball.velocityY * deltaSeconds
      + 0.5 * gravity * deltaSeconds * deltaSeconds;
  } else {
    const acceleratingSeconds = (maxFallVelocity - ball.velocityY) / gravity;
    distanceY =
      ball.velocityY * acceleratingSeconds
      + 0.5 * gravity * acceleratingSeconds * acceleratingSeconds
      + maxFallVelocity * (deltaSeconds - acceleratingSeconds);
  }

  return {
    ...ball,
    y: ball.y + distanceY,
    velocityY,
  };
}

export function circleIntersectsRectangle(
  circle: Pick<PaddleFlightBall, "x" | "y" | "radius">,
  rectangle: PaddleFlightRectangle,
) {
  const nearestX = Math.max(
    rectangle.x,
    Math.min(circle.x, rectangle.x + rectangle.width),
  );
  const nearestY = Math.max(
    rectangle.y,
    Math.min(circle.y, rectangle.y + rectangle.height),
  );
  const distanceX = circle.x - nearestX;
  const distanceY = circle.y - nearestY;
  return distanceX * distanceX + distanceY * distanceY <= circle.radius * circle.radius;
}

export function circleIntersectsRoundedRectangle(
  circle: Pick<PaddleFlightBall, "x" | "y" | "radius">,
  rectangle: PaddleFlightRectangle,
  cornerRadius: number,
) {
  const halfWidth = rectangle.width / 2;
  const halfHeight = rectangle.height / 2;
  const radius = Math.max(0, Math.min(cornerRadius, halfWidth, halfHeight));
  const centerX = rectangle.x + halfWidth;
  const centerY = rectangle.y + halfHeight;
  const outsideX = Math.max(
    Math.abs(circle.x - centerX) - (halfWidth - radius),
    0,
  );
  const outsideY = Math.max(
    Math.abs(circle.y - centerY) - (halfHeight - radius),
    0,
  );
  const combinedRadius = radius + circle.radius;
  return outsideX * outsideX + outsideY * outsideY <= combinedRadius * combinedRadius;
}

export function circleIntersectsCircle(
  first: Pick<PaddleFlightCircle, "x" | "y" | "radius">,
  second: Pick<PaddleFlightCircle, "x" | "y" | "radius">,
) {
  const distanceX = first.x - second.x;
  const distanceY = first.y - second.y;
  const combinedRadius = first.radius + second.radius;
  return distanceX * distanceX + distanceY * distanceY
    <= combinedRadius * combinedRadius;
}

function squaredDistanceToSegment(
  point: PaddleFlightPoint,
  segmentStart: PaddleFlightPoint,
  segmentEnd: PaddleFlightPoint,
) {
  const segmentX = segmentEnd.x - segmentStart.x;
  const segmentY = segmentEnd.y - segmentStart.y;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (segmentLengthSquared === 0) {
    const distanceX = point.x - segmentStart.x;
    const distanceY = point.y - segmentStart.y;
    return distanceX * distanceX + distanceY * distanceY;
  }

  const projection = Math.max(0, Math.min(1,
    ((point.x - segmentStart.x) * segmentX
      + (point.y - segmentStart.y) * segmentY) / segmentLengthSquared,
  ));
  const nearestX = segmentStart.x + projection * segmentX;
  const nearestY = segmentStart.y + projection * segmentY;
  const distanceX = point.x - nearestX;
  const distanceY = point.y - nearestY;
  return distanceX * distanceX + distanceY * distanceY;
}

export function circleIntersectsPolygon(
  circle: Pick<PaddleFlightCircle, "x" | "y" | "radius">,
  polygon: readonly PaddleFlightPoint[],
) {
  if (polygon.length < 3) return false;

  let isInside = false;
  for (let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1) {
    const start = polygon[previous]!;
    const end = polygon[index]!;
    if (squaredDistanceToSegment(circle, start, end)
      <= circle.radius * circle.radius) {
      return true;
    }

    const crossesRay = (start.y > circle.y) !== (end.y > circle.y)
      && circle.x < (end.x - start.x) * (circle.y - start.y)
        / (end.y - start.y) + start.x;
    if (crossesRay) isInside = !isInside;
  }
  return isInside;
}

/** Shared silhouette used by both canvas rendering and collision detection. */
export function getPaddleFlightPaddleGeometry(
  obstacle: PaddleFlightObstacle,
  fromTop: boolean,
): PaddleFlightPaddleGeometry {
  const {
    paddleHeadRadius,
    paddleHeadCenterInset,
    paddleHandleStartInset,
    paddleHandleNeckWidth,
    paddleHandleButtWidth,
  } = PADDLE_FLIGHT_PHYSICS;
  const centerX = obstacle.x + obstacle.width / 2;
  const neckHalfWidth = paddleHandleNeckWidth / 2;
  const buttRadius = paddleHandleButtWidth / 2;
  const localTip = fromTop
    ? obstacle.gapTop
    : PADDLE_FLIGHT_WORLD.height - obstacle.gapBottom;
  const localButtCenter = localTip - buttRadius;
  const toWorldY = (localY: number) => fromTop
    ? localY
    : PADDLE_FLIGHT_WORLD.height - localY;

  return {
    head: {
      x: centerX,
      y: toWorldY(paddleHeadCenterInset),
      radius: paddleHeadRadius,
    },
    handleBody: [
      { x: centerX - neckHalfWidth, y: toWorldY(paddleHandleStartInset) },
      { x: centerX + neckHalfWidth, y: toWorldY(paddleHandleStartInset) },
      { x: centerX + buttRadius, y: toWorldY(localButtCenter) },
      { x: centerX - buttRadius, y: toWorldY(localButtCenter) },
    ],
    handleButt: {
      x: centerX,
      y: toWorldY(localButtCenter),
      radius: buttRadius,
    },
  };
}

function ballHitsObstacle(ball: PaddleFlightBall, obstacle: PaddleFlightObstacle) {
  return [true, false].some((fromTop) => {
    const paddle = getPaddleFlightPaddleGeometry(obstacle, fromTop);
    return circleIntersectsCircle(ball, paddle.head)
      || circleIntersectsPolygon(ball, paddle.handleBody)
      || circleIntersectsCircle(ball, paddle.handleButt);
  });
}

function ballIsOutsideWorld(ball: PaddleFlightBall) {
  return (
    ball.x - ball.radius <= 0
    || ball.x + ball.radius >= PADDLE_FLIGHT_WORLD.width
    || ball.y - ball.radius <= 0
    || ball.y + ball.radius >= PADDLE_FLIGHT_WORLD.height
  );
}

function recycleOffscreenObstacles(
  obstacles: readonly PaddleFlightObstacle[],
  rngState: number,
  nextObstacleId: number,
  score: number,
  random?: PaddleFlightRandom,
) {
  let furthestX = Math.max(...obstacles.map((obstacle) => obstacle.x));
  let updatedRngState = rngState;
  let updatedNextObstacleId = nextObstacleId;

  const recycled = obstacles.map((obstacle) => {
    if (obstacle.x + obstacle.width >= 0) return obstacle;

    furthestX += PADDLE_FLIGHT_PHYSICS.obstacleSpacing;
    const created = createObstacle(
      updatedNextObstacleId,
      furthestX,
      updatedRngState,
      getPaddleFlightDifficulty(score).obstacleGap,
      random,
    );
    updatedRngState = created.nextRngState;
    updatedNextObstacleId += 1;
    return created.obstacle;
  });

  return {
    obstacles: recycled,
    rngState: updatedRngState,
    nextObstacleId: updatedNextObstacleId,
  };
}

function advancePaddleFlight(
  state: PaddleFlightState,
  deltaSeconds: number,
  options: StepPaddleFlightOptions,
): PaddleFlightState {
  const ball = integrateBall(state.ball, deltaSeconds);
  const difficulty = getPaddleFlightDifficulty(state.score);
  let earnedPoints = 0;
  const movedObstacles = state.obstacles.map((obstacle) => {
    const moved = {
      ...obstacle,
      x: obstacle.x - difficulty.obstacleSpeed * deltaSeconds,
    };
    if (!moved.scored && moved.x + moved.width < ball.x - ball.radius) {
      earnedPoints += 1;
      return { ...moved, scored: true };
    }
    return moved;
  });

  const collided =
    ballIsOutsideWorld(ball)
    || movedObstacles.some((obstacle) => ballHitsObstacle(ball, obstacle));
  const commonState = {
    ...state,
    ball,
    obstacles: movedObstacles,
    score: state.score + earnedPoints,
    elapsedSeconds: state.elapsedSeconds + deltaSeconds,
  };

  if (collided) {
    return {
      ...commonState,
      status: "gameOver",
    };
  }

  const recycled = recycleOffscreenObstacles(
    movedObstacles,
    state.rngState,
    state.nextObstacleId,
    commonState.score,
    options.random,
  );
  return {
    ...commonState,
    obstacles: recycled.obstacles,
    rngState: recycled.rngState,
    nextObstacleId: recycled.nextObstacleId,
  };
}

export function stepPaddleFlight(
  state: PaddleFlightState,
  deltaSeconds: number,
  options: StepPaddleFlightOptions = {},
): PaddleFlightState {
  if (state.status !== "playing") return state;

  const clampedDelta = Number.isFinite(deltaSeconds)
    ? Math.min(
        PADDLE_FLIGHT_PHYSICS.maxFrameDeltaSeconds,
        Math.max(0, deltaSeconds),
      )
    : 0;
  if (clampedDelta === 0) return state;

  let nextState = state;
  let remainingSeconds = clampedDelta;
  while (remainingSeconds > Number.EPSILON && nextState.status === "playing") {
    const stepSeconds = Math.min(
      PADDLE_FLIGHT_PHYSICS.simulationStepSeconds,
      remainingSeconds,
    );
    nextState = advancePaddleFlight(nextState, stepSeconds, options);
    remainingSeconds -= stepSeconds;
  }
  return nextState;
}
