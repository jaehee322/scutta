import { describe, expect, it, vi } from "vitest";

import {
  createInitialPaddleFlightState,
  flapPaddleFlight,
  PADDLE_FLIGHT_PHYSICS,
  stepPaddleFlight,
  type PaddleFlightObstacle,
  type PaddleFlightState,
} from "./paddleFlight";
import {
  createPaddleFlightTreasureState,
  PADDLE_FLIGHT_TREASURE,
  stepPaddleFlightTreasure,
  type PaddleFlightTreasureChest,
  type PaddleFlightTreasureState,
} from "./paddleFlightTreasure";

function game(overrides: Partial<PaddleFlightState> = {}): PaddleFlightState {
  const initial = createInitialPaddleFlightState({ seed: 17 });
  return { ...initial, status: "playing", ball: { ...initial.ball, y: 520 }, ...overrides };
}
function column(id: number, x: number, width = 78): PaddleFlightObstacle {
  return { id, x, width, gapTop: 180, gapBottom: 270, scored: false };
}
function chest(overrides: Partial<PaddleFlightTreasureChest> = {}): PaddleFlightTreasureChest {
  return { id: 3, x: 150, y: 270, width: 32, height: 28, ...overrides };
}
function advance(previous: PaddleFlightState, overrides: Partial<PaddleFlightState> = {}): PaddleFlightState {
  return { ...previous, elapsedSeconds: previous.elapsedSeconds + 0.1, ...overrides };
}
function newColumn(id = 3, overrides: Partial<PaddleFlightState> = {}) {
  const previous = game({ obstacles: [column(id - 2, 93), column(id - 1, 264)] });
  const next = advance(previous, { obstacles: [column(id - 2, 92), column(id - 1, 263), column(id, 434)], ...overrides });
  return { previous, next };
}
function withChest(value: PaddleFlightTreasureChest): PaddleFlightTreasureState {
  return { ...createPaddleFlightTreasureState(5), chests: [value] };
}

describe("paddle flight treasure spawning", () => {
  it("leaves ready games and the first three obstacles empty", () => {
    const initial = createInitialPaddleFlightState();
    const state = createPaddleFlightTreasureState(1);
    const random = vi.fn(() => 0);
    expect(stepPaddleFlightTreasure(state, initial, initial, { random })).toBe(state);
    const previous = game();
    expect(stepPaddleFlightTreasure(state, previous, advance(previous), { random }).chests).toEqual([]);
    expect(random).not.toHaveBeenCalled();
    expect(initial.ball).toMatchObject({ x: 78, y: 270, radius: 12, velocityY: 0 });
  });

  it("spawns centered between complete obstacle envelopes and inside vertical bounds", () => {
    const { previous, next } = newColumn();
    for (const vertical of [0, 1]) {
      const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(vertical);
      const result = stepPaddleFlightTreasure(createPaddleFlightTreasureState(), previous, next, { random });
      expect(result.chests).toHaveLength(1);
      const value = result.chests[0]!;
      expect(value).toMatchObject({ id: 3, x: (263 + 78 + 434) / 2, width: 32, height: 28 });
      expect(value.y).toBeGreaterThanOrEqual(70);
      expect(value.y).toBeLessThanOrEqual(470);
      expect(value.y - value.height / 2).toBeGreaterThan(0);
      expect(value.y + value.height / 2).toBeLessThan(540);
      expect(next.obstacles.every((obstacle) => value.x + 16 <= obstacle.x || value.x - 16 >= obstacle.x + obstacle.width)).toBe(true);
      expect(value.width * value.height / (Math.PI * 12 ** 2)).toBeCloseTo(1.98, 2);
    }
  });

  it("uses a strict 1/28 chance and considers each new obstacle only once", () => {
    const { previous, next } = newColumn();
    expect(stepPaddleFlightTreasure(createPaddleFlightTreasureState(), previous, next, { random: () => 1 / 28 }).chests).toEqual([]);
    const random = vi.fn(() => 1 / 28 - Number.EPSILON);
    const first = stepPaddleFlightTreasure(createPaddleFlightTreasureState(), previous, next, { random });
    const second = stepPaddleFlightTreasure(first, next, advance(next), { random });
    expect(first.chests).toHaveLength(1);
    expect(second.chests).toHaveLength(1);
    expect(random).toHaveBeenCalledTimes(2);
  });

  it("targets a mean 30-obstacle interval including the two blocked opportunities", () => {
    const blockedOpportunities = PADDLE_FLIGHT_TREASURE.minimumObstacleInterval - 1;
    expect(blockedOpportunities).toBe(2);
    expect(blockedOpportunities + 1 / PADDLE_FLIGHT_TREASURE.spawnProbability).toBe(30);
  });

  it("keeps at least three obstacle ids between spawns and never tracks more than two chests", () => {
    let state = createPaddleFlightTreasureState();
    for (const id of [3, 4, 5, 6, 9]) {
      const { previous, next } = newColumn(id);
      state = stepPaddleFlightTreasure(state, previous, next, { random: () => 0 });
      expect(state.chests.length).toBeLessThanOrEqual(2);
    }
    expect(state.chests.map((value) => value.id)).toEqual([3, 6]);
  });

  it("does not wedge a chest into a narrow gap or an extra obstacle", () => {
    const { previous, next } = newColumn();
    const narrow = { ...next, obstacles: [column(2, 340), column(3, 434)] };
    expect(stepPaddleFlightTreasure(createPaddleFlightTreasureState(), previous, narrow, { random: () => 0 }).chests).toEqual([]);
    const blocked = { ...next, obstacles: [...next.obstacles, column(1, 200, 250)] };
    expect(stepPaddleFlightTreasure(createPaddleFlightTreasureState(), previous, blocked, { random: () => 0 }).chests).toEqual([]);
  });

  it("ignores frame count and uses deterministic independent random snapshots", () => {
    function simulate(distancePerStep: number, seed: number) {
      let previous = game();
      let state = createPaddleFlightTreasureState(seed);
      const spawned: Array<{ id: number; y: number }> = [];
      for (let travelled = 0; travelled < 10_000; travelled += distancePerStep) {
        let nextId = previous.nextObstacleId;
        let obstacles = previous.obstacles.map((value) => ({ ...value, x: value.x - distancePerStep }));
        let furthest = Math.max(...obstacles.map((value) => value.x));
        obstacles = obstacles.map((value) => {
          if (value.x + value.width >= 0) return value;
          furthest += PADDLE_FLIGHT_PHYSICS.obstacleSpacing;
          return column(nextId++, furthest);
        });
        const next = advance(previous, { obstacles, nextObstacleId: nextId });
        const oldIds = new Set(state.chests.map((value) => value.id));
        state = stepPaddleFlightTreasure(state, previous, next);
        spawned.push(...state.chests.filter((value) => !oldIds.has(value.id)).map(({ id, y }) => ({ id, y })));
        previous = next;
      }
      return { state, spawned };
    }
    const first = simulate(1, 40);
    expect(first.spawned.length).toBeGreaterThan(2);
    expect(first).toEqual(simulate(20, 40));
    expect(first).toEqual(simulate(1, 40));
    expect(first.spawned).not.toEqual(simulate(20, 41).spawned);
  });
});

describe("paddle flight treasure movement and collection", () => {
  it("uses the surviving obstacle's exact displacement even when array order changes", () => {
    const previous = game({ obstacles: [column(0, -77), column(1, 94), column(2, 265)] });
    const next = advance(previous, { obstacles: [column(3, 421), column(2, 250), column(1, 79)] });
    const state = stepPaddleFlightTreasure(withChest(chest({ x: 200 })), previous, next, { random: () => 1 });
    expect(state.chests[0]!.x).toBe(185);
  });

  it("collects a moving chest swept across the ball, exactly once", () => {
    const previous = game({ ball: { ...game().ball, y: 270 }, obstacles: [column(0, 300)] });
    const next = advance(previous, { obstacles: [column(0, 100)] });
    const state = stepPaddleFlightTreasure(withChest(chest({ x: 180 })), previous, next);
    expect(state.collected).toEqual([3]);
    expect(state.chests).toEqual([]);
    const following = stepPaddleFlightTreasure(state, next, advance(next));
    expect(following.collected).toEqual([]);
    expect(following.chests).toEqual([]);
  });

  it("sweeps the ball's vertical path at low FPS instead of only its endpoint", () => {
    const previous = game({ ball: { ...game().ball, y: 180 } });
    const next = advance(previous, { ball: { ...previous.ball, y: 340 } });
    expect(stepPaddleFlightTreasure(withChest(chest({ x: 78 })), previous, next).collected).toEqual([3]);
  });

  it("does not collect a rectangular-expanded corner that the ball never touches", () => {
    const value = chest({ x: 100, y: 270 });
    const previous = game({ ball: { ...game().ball, x: 74, y: 246 } });
    // Ten pixels outside each edge: inside a radius-expanded AABB, but outside
    // the actual 12px round corner (sqrt(10^2 + 10^2) > 12).
    expect(stepPaddleFlightTreasure(withChest(value), previous, advance(previous)).collected).toEqual([]);
    const touching = { ...previous, ball: { ...previous.ball, x: 76, y: 248 } };
    expect(stepPaddleFlightTreasure(withChest(value), touching, advance(touching)).collected).toEqual([3]);
  });

  it("removes missed offscreen chests", () => {
    const previous = game({ obstacles: [column(0, 300)] });
    const next = advance(previous, { obstacles: [column(0, 250)] });
    expect(stepPaddleFlightTreasure(withChest(chest({ x: 20 })), previous, next).chests).toEqual([]);
  });

  it("gives death priority across the terminal frame and never awards afterward", () => {
    const previous = game({ ball: { ...game().ball, y: 180 } });
    const next = advance(previous, { status: "gameOver", ball: { ...previous.ball, y: 340 } });
    const random = vi.fn(() => 0);
    const state = stepPaddleFlightTreasure(withChest(chest({ x: 78 })), previous, next, { random });
    expect(state.collected).toEqual([]);
    expect(state.chests).toHaveLength(1);
    expect(stepPaddleFlightTreasure(state, next, advance(next)).collected).toEqual([]);
    expect(random).not.toHaveBeenCalled();
  });

  it("clears per-step events on ready, zero-duration, and game-over calls", () => {
    const state = { ...createPaddleFlightTreasureState(), collected: [3] };
    for (const status of ["ready", "playing", "gameOver"] as const) {
      const previous = game({ status });
      expect(stepPaddleFlightTreasure(state, previous, previous).collected).toEqual([]);
    }
  });

  it("cannot mutate game snapshots, ball geometry, score, obstacle randomness, or input state", () => {
    const previous = flapPaddleFlight(createInitialPaddleFlightState({ seed: 8 }));
    const next = stepPaddleFlight(previous, 0.1);
    const treasure = withChest(chest());
    const before = structuredClone({ previous, next, treasure });
    Object.freeze(previous.ball);
    Object.freeze(next.ball);
    previous.obstacles.forEach(Object.freeze);
    next.obstacles.forEach(Object.freeze);
    Object.freeze(previous.obstacles);
    Object.freeze(next.obstacles);
    Object.freeze(previous);
    Object.freeze(next);
    treasure.chests.forEach(Object.freeze);
    Object.freeze(treasure.chests);
    Object.freeze(treasure);
    stepPaddleFlightTreasure(treasure, previous, next);
    expect({ previous, next, treasure }).toEqual(before);
    expect(stepPaddleFlight(next, 0.01)).toEqual(stepPaddleFlight(before.next, 0.01));
    expect(next.ball.radius).toBe(12);
    expect(PADDLE_FLIGHT_TREASURE).toMatchObject({ width: 32, height: 28 });
  });
});
