import { describe, expect, it } from "vitest";

import type { CoinFlipSnapshot } from "../types";
import {
  canEnterCoinFlipGame,
  millisecondsUntilNextKoreaDay,
  remainingCoinFlipAttempts,
} from "./minigameAttempts";

function snapshot(active: boolean, remainingAttempts: number): CoinFlipSnapshot {
  return {
    state: {
      active,
      run_id: active ? 1 : 0,
      current_streak: 0,
      best_streak: 0,
      remaining_attempts: remainingAttempts,
    },
    ranking: [],
  };
}

describe("coin flip daily attempts", () => {
  it("allows an active game to be entered after all daily starts are used", () => {
    expect(canEnterCoinFlipGame(snapshot(true, 0))).toBe(true);
  });

  it("blocks a new game when no daily starts remain", () => {
    expect(canEnterCoinFlipGame(snapshot(false, 0))).toBe(false);
  });

  it("allows a new game while a daily start remains", () => {
    expect(canEnterCoinFlipGame(snapshot(false, 1))).toBe(true);
  });

  it("never presents a negative remaining count", () => {
    expect(remainingCoinFlipAttempts(snapshot(false, -1))).toBe(0);
  });

  it("refreshes the quota at the next Korea midnight", () => {
    expect(millisecondsUntilNextKoreaDay(Date.parse("2026-09-02T14:59:00Z"))).toBe(60_000);
    expect(millisecondsUntilNextKoreaDay(Date.parse("2026-09-02T15:00:00Z"))).toBe(86_400_000);
  });
});
