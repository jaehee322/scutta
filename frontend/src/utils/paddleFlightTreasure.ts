import {
  PADDLE_FLIGHT_PHYSICS,
  PADDLE_FLIGHT_WORLD,
  type PaddleFlightState,
} from "./paddleFlight";

export const PADDLE_FLIGHT_TREASURE = {
  width: 32,
  height: 28,
  minimumY: 70,
  maximumY: 470,
  // A spawn blocks the next two obstacle ids. The long-run mean interval is
  // 2 + 1 / probability = 30 obstacles, rather than a guaranteed 30-point timer.
  spawnProbability: 1 / 28,
  minimumObstacleInterval: 3,
  maximumChests: 2,
} as const;

export interface PaddleFlightTreasureChest {
  readonly id: number;
  /** Center coordinates in the same world as the ball and obstacles. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PaddleFlightTreasureState {
  readonly chests: readonly PaddleFlightTreasureChest[];
  /** Newly collected ids for this step only, never a cumulative reward list. */
  readonly collected: readonly number[];
  readonly rngState: number;
  readonly lastObservedObstacleId: number;
  readonly lastSpawnObstacleId: number;
}

export interface StepPaddleFlightTreasureOptions {
  /** Optional deterministic source for simulations; never touches obstacle RNG. */
  readonly random?: () => number;
}

const DEFAULT_SEED = 0x7ea5_0123;

export function createPaddleFlightTreasureState(seed?: number): PaddleFlightTreasureState {
  return {
    chests: [],
    collected: [],
    rngState: seed !== undefined && Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : DEFAULT_SEED,
    // The initial three obstacles never create a treasure chest.
    lastObservedObstacleId: PADDLE_FLIGHT_PHYSICS.obstacleCount - 1,
    lastSpawnObstacleId: -PADDLE_FLIGHT_TREASURE.minimumObstacleInterval,
  };
}

function takeRandom(state: number, random?: () => number) {
  const rngState = (Math.imul(state, 22_695_477) + 1) >>> 0;
  const value = random ? random() : rngState / 0x1_0000_0000;
  return {
    rngState,
    value: Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : 0.5,
  };
}

function scrollDelta(previous: PaddleFlightState, next: PaddleFlightState) {
  for (const obstacle of previous.obstacles) {
    const moved = next.obstacles.find((candidate) => candidate.id === obstacle.id);
    if (moved) return moved.x - obstacle.x;
  }
  // Normal core steps retain at least two obstacle ids. Do not estimate speed
  // from frame time if a caller supplies unrelated game snapshots.
  return 0;
}

function pointSegmentDistanceSquared(
  x: number, y: number, startX: number, startY: number, endX: number, endY: number,
) {
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((x - startX) * dx + (y - startY) * dy) / lengthSquared,
  ));
  return (x - startX - t * dx) ** 2 + (y - startY - t * dy) ** 2;
}

/** Exact swept circle/rectangle test, including rounded expanded corners. */
function sweptBallHitsChest(
  previous: PaddleFlightState,
  next: PaddleFlightState,
  chest: PaddleFlightTreasureChest,
  deltaX: number,
) {
  const x0 = previous.ball.x - chest.x;
  const y0 = previous.ball.y - chest.y;
  const x1 = next.ball.x - chest.x - deltaX;
  const y1 = next.ball.y - chest.y;
  const halfWidth = chest.width / 2;
  const halfHeight = chest.height / 2;
  const radiusSquared = next.ball.radius ** 2;
  const distanceToBox = (x: number, y: number) =>
    Math.max(Math.abs(x) - halfWidth, 0) ** 2
    + Math.max(Math.abs(y) - halfHeight, 0) ** 2;
  if (Math.min(distanceToBox(x0, y0), distanceToBox(x1, y1)) <= radiusSquared) return true;

  let entry = 0;
  let exit = 1;
  for (const [start, end, halfSize] of [[x0, x1, halfWidth], [y0, y1, halfHeight]]) {
    const movement = end! - start!;
    if (movement === 0) {
      if (Math.abs(start!) > halfSize!) { entry = 2; break; }
    } else {
      const first = (-halfSize! - start!) / movement;
      const second = (halfSize! - start!) / movement;
      entry = Math.max(entry, Math.min(first, second));
      exit = Math.min(exit, Math.max(first, second));
    }
  }
  if (entry <= exit) return true;

  return [-halfWidth, halfWidth].some((x) => [-halfHeight, halfHeight].some((y) =>
    pointSegmentDistanceSquared(x, y, x0, y0, x1, y1) <= radiusSquared,
  ));
}

export function stepPaddleFlightTreasure(
  state: PaddleFlightTreasureState,
  previous: PaddleFlightState,
  next: PaddleFlightState,
  options: StepPaddleFlightTreasureOptions = {},
): PaddleFlightTreasureState {
  const withoutEvents = () => state.collected.length ? { ...state, collected: [] } : state;
  if (previous.status !== "playing" || next.status === "ready"
    || next.elapsedSeconds <= previous.elapsedSeconds) return withoutEvents();

  const deltaX = scrollDelta(previous, next);
  const collected: number[] = [];
  const chests: PaddleFlightTreasureChest[] = [];
  for (const chest of state.chests) {
    // The core reports only the terminal snapshot, not the precise collision
    // time. Give death priority for the whole terminal step: no posthumous loot.
    if (next.status === "playing" && sweptBallHitsChest(previous, next, chest, deltaX)) {
      collected.push(chest.id);
    } else if (chest.x + deltaX + chest.width / 2 >= 0) {
      chests.push({ ...chest, x: chest.x + deltaX });
    }
  }
  if (next.status !== "playing") return { ...state, chests, collected };

  let rngState = state.rngState;
  let lastObservedObstacleId = state.lastObservedObstacleId;
  let lastSpawnObstacleId = state.lastSpawnObstacleId;
  const candidates = next.obstacles
    .filter((obstacle) => obstacle.id > lastObservedObstacleId)
    .sort((a, b) => a.id - b.id);
  for (const obstacle of candidates) {
    lastObservedObstacleId = obstacle.id;
    const chance = takeRandom(rngState, options.random);
    rngState = chance.rngState;
    if (chance.value >= PADDLE_FLIGHT_TREASURE.spawnProbability
      || obstacle.id - lastSpawnObstacleId < PADDLE_FLIGHT_TREASURE.minimumObstacleInterval
      || chests.length >= PADDLE_FLIGHT_TREASURE.maximumChests) continue;

    const previousColumn = next.obstacles
      .filter((candidate) => candidate.x < obstacle.x)
      .reduce<(typeof next.obstacles)[number] | undefined>((closest, candidate) =>
        !closest || candidate.x > closest.x ? candidate : closest, undefined);
    if (!previousColumn) continue;
    const left = previousColumn.x + previousColumn.width;
    const right = obstacle.x;
    if (right - left < PADDLE_FLIGHT_TREASURE.width) continue;
    const x = (left + right) / 2;
    if (next.obstacles.some((column) => x + PADDLE_FLIGHT_TREASURE.width / 2 > column.x
      && x - PADDLE_FLIGHT_TREASURE.width / 2 < column.x + column.width)) continue;

    const vertical = takeRandom(rngState, options.random);
    rngState = vertical.rngState;
    const minimumY = Math.max(PADDLE_FLIGHT_TREASURE.minimumY, PADDLE_FLIGHT_TREASURE.height / 2);
    const maximumY = Math.min(PADDLE_FLIGHT_TREASURE.maximumY, PADDLE_FLIGHT_WORLD.height - PADDLE_FLIGHT_TREASURE.height / 2);
    chests.push({
      id: obstacle.id,
      x,
      y: minimumY + (maximumY - minimumY) * vertical.value,
      width: PADDLE_FLIGHT_TREASURE.width,
      height: PADDLE_FLIGHT_TREASURE.height,
    });
    lastSpawnObstacleId = obstacle.id;
  }
  return { chests, collected, rngState, lastObservedObstacleId, lastSpawnObstacleId };
}
