import { describe, expect, it, vi } from "vitest";

import {
  PADDLE_FLIGHT_PHYSICS,
  PADDLE_FLIGHT_WORLD,
  circleIntersectsCircle,
  circleIntersectsPolygon,
  circleIntersectsRectangle,
  circleIntersectsRoundedRectangle,
  createInitialPaddleFlightState,
  flapPaddleFlight,
  getPaddleFlightDifficulty,
  getPaddleFlightPaddleGeometry,
  stepPaddleFlight,
  type PaddleFlightObstacle,
  type PaddleFlightState,
} from "./paddleFlight";

function playingState(
  overrides: Partial<PaddleFlightState> = {},
): PaddleFlightState {
  return {
    ...createInitialPaddleFlightState({ seed: 1 }),
    status: "playing",
    ...overrides,
  };
}

function obstacle(
  overrides: Partial<PaddleFlightObstacle> = {},
): PaddleFlightObstacle {
  return {
    id: 0,
    x: 400,
    width: PADDLE_FLIGHT_PHYSICS.obstacleWidth,
    gapTop: 180,
    gapBottom: 330,
    scored: false,
    ...overrides,
  };
}

describe("paddle flight initialization", () => {
  it("uses a fixed 360 by 540 world and supports deterministic seeds", () => {
    expect(PADDLE_FLIGHT_WORLD).toEqual({ width: 360, height: 540 });

    const first = createInitialPaddleFlightState({ seed: 42 });
    const second = createInitialPaddleFlightState({ seed: 42 });
    const different = createInitialPaddleFlightState({ seed: 43 });

    expect(first).toEqual(second);
    expect(first.obstacles.map(({ gapTop }) => gapTop)).not.toEqual(
      different.obstacles.map(({ gapTop }) => gapTop),
    );
    expect(first.ball.x).toBe(PADDLE_FLIGHT_PHYSICS.ballX);
    expect(first.ball.y).toBe(PADDLE_FLIGHT_WORLD.height / 2);
  });

  it("accepts an injected random source for obstacle gaps", () => {
    const random = vi.fn(() => 0);
    const state = createInitialPaddleFlightState({ random });

    expect(random).toHaveBeenCalledTimes(PADDLE_FLIGHT_PHYSICS.obstacleCount);
    expect(state.obstacles.every(
      ({ gapTop }) => gapTop === PADDLE_FLIGHT_PHYSICS.minimumHandleLength,
    )).toBe(true);
  });
});

describe("paddle flight physics", () => {
  it("applies gravitational acceleration to velocity and position", () => {
    const initial = playingState({
      ball: {
        x: PADDLE_FLIGHT_PHYSICS.ballX,
        y: 270,
        radius: PADDLE_FLIGHT_PHYSICS.ballRadius,
        velocityY: 0,
      },
    });
    const next = stepPaddleFlight(initial, 0.02);

    expect(next.ball.velocityY).toBeCloseTo(19.6);
    expect(next.ball.y).toBeCloseTo(270.196);
  });

  it("starts on the first flap and resets vertical speed on later flaps", () => {
    const ready = createInitialPaddleFlightState();
    const started = flapPaddleFlight(ready);

    expect(started.status).toBe("playing");
    expect(started.ball.velocityY).toBe(PADDLE_FLIGHT_PHYSICS.flapVelocity);

    const falling = playingState({
      ball: { ...started.ball, velocityY: 240 },
    });
    expect(flapPaddleFlight(falling).ball.velocityY).toBe(
      PADDLE_FLIGHT_PHYSICS.flapVelocity,
    );
  });

  it("clamps long frame deltas before advancing the simulation", () => {
    const initial = playingState({
      ball: {
        x: PADDLE_FLIGHT_PHYSICS.ballX,
        y: 270,
        radius: PADDLE_FLIGHT_PHYSICS.ballRadius,
        velocityY: 0,
      },
    });
    const next = stepPaddleFlight(initial, 10);
    const clamped = PADDLE_FLIGHT_PHYSICS.maxFrameDeltaSeconds;

    expect(next.elapsedSeconds).toBeCloseTo(clamped);
    expect(next.ball.velocityY).toBeCloseTo(
      PADDLE_FLIGHT_PHYSICS.gravity * clamped,
    );
    expect(next.obstacles[0]?.x).toBeCloseTo(
      initial.obstacles[0]!.x - PADDLE_FLIGHT_PHYSICS.obstacleSpeed * clamped,
    );
  });
});

describe("paddle flight scoring and obstacles", () => {
  it("increases speed and narrows new gaps gradually with a safe cap", () => {
    expect(getPaddleFlightDifficulty(0)).toEqual({
      obstacleSpeed: PADDLE_FLIGHT_PHYSICS.obstacleSpeed,
      obstacleGap: PADDLE_FLIGHT_PHYSICS.obstacleGap,
    });

    const progressed = getPaddleFlightDifficulty(20);
    expect(progressed.obstacleSpeed).toBeGreaterThan(
      PADDLE_FLIGHT_PHYSICS.obstacleSpeed,
    );
    expect(progressed.obstacleSpeed).toBeLessThan(
      PADDLE_FLIGHT_PHYSICS.maximumObstacleSpeed,
    );
    expect(progressed.obstacleGap).toBeLessThan(
      PADDLE_FLIGHT_PHYSICS.obstacleGap,
    );
    expect(progressed.obstacleGap).toBeGreaterThan(
      PADDLE_FLIGHT_PHYSICS.minimumObstacleGap,
    );

    expect(getPaddleFlightDifficulty(10_000)).toEqual({
      obstacleSpeed: PADDLE_FLIGHT_PHYSICS.maximumObstacleSpeed,
      obstacleGap: PADDLE_FLIGHT_PHYSICS.minimumObstacleGap,
    });
  });

  it("uses the current score to move paddles faster", () => {
    const initial = playingState({
      score: 20,
      obstacles: [obstacle({ x: 400 })],
    });
    const next = stepPaddleFlight(initial, 0.01);

    expect(next.obstacles[0]?.x).toBeCloseTo(
      400 - getPaddleFlightDifficulty(20).obstacleSpeed * 0.01,
    );
  });

  it("moves paddles right-to-left and scores each passed pair only once", () => {
    const passingX = PADDLE_FLIGHT_PHYSICS.ballX
      - PADDLE_FLIGHT_PHYSICS.ballRadius
      - PADDLE_FLIGHT_PHYSICS.obstacleWidth;
    const passing = obstacle({ x: passingX });
    const initial = playingState({ obstacles: [passing] });

    const afterPass = stepPaddleFlight(initial, 0.01);
    expect(afterPass.obstacles[0]?.x).toBeCloseTo(
      passingX - PADDLE_FLIGHT_PHYSICS.obstacleSpeed * 0.01,
    );
    expect(afterPass.obstacles[0]?.scored).toBe(true);
    expect(afterPass.score).toBe(1);

    const anotherFrame = stepPaddleFlight(afterPass, 0.01);
    expect(anotherFrame.score).toBe(1);
  });

  it("waits until the whole ball clears the widest rubber face before scoring", () => {
    const touchingBallEdge = obstacle({
      x: PADDLE_FLIGHT_PHYSICS.ballX
        - PADDLE_FLIGHT_PHYSICS.ballRadius
        - PADDLE_FLIGHT_PHYSICS.obstacleWidth
        + 0.2,
    });
    const initial = playingState({ obstacles: [touchingBallEdge] });

    const next = stepPaddleFlight(initial, 0.001);

    expect(next.status).toBe("playing");
    expect(next.score).toBe(0);
    expect(next.obstacles[0]?.scored).toBe(false);
  });

  it("recycles an offscreen pair after the furthest pair with a fresh gap", () => {
    const random = vi.fn(() => 1);
    const initial = playingState({
      obstacles: [
        obstacle({
          id: 0,
          x: -PADDLE_FLIGHT_PHYSICS.obstacleWidth + 0.5,
          scored: true,
        }),
        obstacle({ id: 1, x: 120 }),
        obstacle({ id: 2, x: 310 }),
      ],
      nextObstacleId: 3,
    });

    const next = stepPaddleFlight(initial, 0.05, { random });
    const recycled = next.obstacles.find(({ id }) => id === 3);
    const movedFurthestX = 310 - PADDLE_FLIGHT_PHYSICS.obstacleSpeed * 0.05;

    expect(random).toHaveBeenCalledOnce();
    expect(recycled?.x).toBeCloseTo(
      movedFurthestX + PADDLE_FLIGHT_PHYSICS.obstacleSpacing,
    );
    expect(recycled?.gapBottom).toBeLessThanOrEqual(
      PADDLE_FLIGHT_WORLD.height - PADDLE_FLIGHT_PHYSICS.minimumHandleLength,
    );
    expect(recycled?.scored).toBe(false);
    expect(next.nextObstacleId).toBe(4);
  });

  it("keeps a pair until its entire rubber face is offscreen", () => {
    const almostGone = obstacle({
      id: 0,
      x: -PADDLE_FLIGHT_PHYSICS.obstacleWidth + 0.5,
      scored: true,
    });
    const initial = playingState({
      obstacles: [
        almostGone,
        obstacle({ id: 1, x: 120 }),
        obstacle({ id: 2, x: 310 }),
      ],
      nextObstacleId: 3,
    });

    const next = stepPaddleFlight(initial, 0.001);

    expect(next.obstacles[0]?.id).toBe(0);
    expect(next.nextObstacleId).toBe(3);
  });

  it("applies the progressed gap only when a new pair is recycled", () => {
    const score = 30;
    const initial = playingState({
      score,
      obstacles: [
        obstacle({
          id: 0,
          x: -PADDLE_FLIGHT_PHYSICS.obstacleWidth + 0.5,
          scored: true,
        }),
        obstacle({ id: 1, x: 120 }),
        obstacle({ id: 2, x: 310 }),
      ],
      nextObstacleId: 3,
    });

    const next = stepPaddleFlight(initial, 0.05, { random: () => 0.5 });
    const recycled = next.obstacles.find(({ id }) => id === 3);

    expect(recycled!.gapBottom - recycled!.gapTop).toBeCloseTo(
      getPaddleFlightDifficulty(score).obstacleGap,
    );
    expect(next.obstacles.find(({ id }) => id === 1)!.gapBottom
      - next.obstacles.find(({ id }) => id === 1)!.gapTop).toBe(
      PADDLE_FLIGHT_PHYSICS.obstacleGap,
    );
  });
});

describe("paddle flight collisions", () => {
  it("uses circle-to-rectangle collision, including edge contact", () => {
    expect(circleIntersectsRectangle(
      { x: 10, y: 10, radius: 5 },
      { x: 15, y: 5, width: 10, height: 10 },
    )).toBe(true);
    expect(circleIntersectsRectangle(
      { x: 9, y: 0, radius: 5 },
      { x: 15, y: 5, width: 10, height: 10 },
    )).toBe(false);
  });

  it("matches the rounded handle tips instead of transparent corners", () => {
    const handle = { x: 90, y: 0, width: 28, height: 180 };

    expect(circleIntersectsRectangle(
      { x: 78, y: 180, radius: 12 },
      handle,
    )).toBe(true);
    expect(circleIntersectsRoundedRectangle(
      { x: 78, y: 180, radius: 12 },
      handle,
      14,
    )).toBe(false);
  });

  it("uses one shared silhouette for the rubber face and flared handle", () => {
    const pair = obstacle({ x: 100, gapTop: 180, gapBottom: 330 });
    const top = getPaddleFlightPaddleGeometry(pair, true);
    const bottom = getPaddleFlightPaddleGeometry(pair, false);
    const centerX = pair.x + pair.width / 2;

    expect(top.head).toEqual({
      x: centerX,
      y: PADDLE_FLIGHT_PHYSICS.paddleHeadCenterInset,
      radius: PADDLE_FLIGHT_PHYSICS.paddleHeadRadius,
    });
    expect(top.handleButt.y + top.handleButt.radius).toBe(pair.gapTop);
    expect(bottom.handleButt.y - bottom.handleButt.radius).toBe(pair.gapBottom);
    expect(top.handleBody[0]!.x).toBeGreaterThan(pair.x);
    expect(top.handleBody[1]!.x).toBeLessThan(pair.x + pair.width);
  });

  it("hits the round rubber edge without filling its transparent corners", () => {
    const head = getPaddleFlightPaddleGeometry(obstacle({ x: 100 }), true).head;

    expect(circleIntersectsCircle(
      { x: head.x + head.radius + 4, y: head.y, radius: 4 },
      head,
    )).toBe(true);
    expect(circleIntersectsCircle(
      { x: head.x + head.radius, y: head.y + head.radius, radius: 1 },
      head,
    )).toBe(false);
  });

  it("does not fill the transparent corners beside the tapered grip", () => {
    const handle = getPaddleFlightPaddleGeometry(
      obstacle({ x: 100, gapTop: 180 }),
      true,
    ).handleBody;
    const centerX = 100 + PADDLE_FLIGHT_PHYSICS.obstacleWidth / 2;

    expect(circleIntersectsPolygon(
      { x: centerX + 13, y: 75, radius: 1.5 },
      handle,
    )).toBe(false);
    expect(circleIntersectsPolygon(
      { x: centerX + 8, y: 75, radius: 1.5 },
      handle,
    )).toBe(true);
  });

  it("ends the game when the ball touches the flared wooden grip", () => {
    const initial = playingState({
      ball: {
        x: PADDLE_FLIGHT_PHYSICS.ballX,
        y: 100,
        radius: PADDLE_FLIGHT_PHYSICS.ballRadius,
        velocityY: 0,
      },
      obstacles: [obstacle({
        x: PADDLE_FLIGHT_PHYSICS.ballX
          - PADDLE_FLIGHT_PHYSICS.obstacleWidth / 2,
        gapTop: 180,
      })],
    });

    expect(stepPaddleFlight(initial, 0.001).status).toBe("gameOver");
  });

  it("keeps playing just beyond the rounded grip inside the gap", () => {
    const initial = playingState({
      ball: {
        x: PADDLE_FLIGHT_PHYSICS.ballX,
        y: 192.5,
        radius: PADDLE_FLIGHT_PHYSICS.ballRadius,
        velocityY: 0,
      },
      obstacles: [obstacle({
        x: PADDLE_FLIGHT_PHYSICS.ballX
          - PADDLE_FLIGHT_PHYSICS.obstacleWidth / 2,
        gapTop: 180,
      })],
    });

    expect(
      stepPaddleFlight(initial, PADDLE_FLIGHT_PHYSICS.simulationStepSeconds).status,
    ).toBe("playing");
  });

  it("ends the game at the top and bottom world boundaries", () => {
    const nearTop = playingState({
      ball: {
        x: PADDLE_FLIGHT_PHYSICS.ballX,
        y: PADDLE_FLIGHT_PHYSICS.ballRadius + 0.1,
        radius: PADDLE_FLIGHT_PHYSICS.ballRadius,
        velocityY: -100,
      },
    });
    const nearBottom = playingState({
      ball: {
        x: PADDLE_FLIGHT_PHYSICS.ballX,
        y: PADDLE_FLIGHT_WORLD.height - PADDLE_FLIGHT_PHYSICS.ballRadius - 0.1,
        radius: PADDLE_FLIGHT_PHYSICS.ballRadius,
        velocityY: 100,
      },
    });

    expect(stepPaddleFlight(nearTop, 0.01).status).toBe("gameOver");
    expect(stepPaddleFlight(nearBottom, 0.01).status).toBe("gameOver");
  });
});
