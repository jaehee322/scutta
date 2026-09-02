import type { CoinFlipSnapshot } from "../types";

const KOREA_UTC_OFFSET_MS = 9 * 60 * 60 * 1_000;

export function remainingCoinFlipAttempts(snapshot: CoinFlipSnapshot | null) {
  return Math.max(0, snapshot?.state.remaining_attempts ?? 0);
}

export function canEnterCoinFlipGame(snapshot: CoinFlipSnapshot | null) {
  return Boolean(
    snapshot
    && (snapshot.state.active || remainingCoinFlipAttempts(snapshot) > 0),
  );
}

export function millisecondsUntilNextKoreaDay(now = Date.now()) {
  const koreaNow = new Date(now + KOREA_UTC_OFFSET_MS);
  const nextMidnight = Date.UTC(
    koreaNow.getUTCFullYear(),
    koreaNow.getUTCMonth(),
    koreaNow.getUTCDate() + 1,
  );
  return Math.max(0, nextMidnight - koreaNow.getTime());
}
