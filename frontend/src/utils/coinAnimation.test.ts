import { describe, expect, it, vi } from "vitest";

import { waitForCoinAnimationEvent } from "./coinAnimation";

function animationEvent(type: string, animationName: string) {
  const event = new Event(type);
  Object.defineProperty(event, "animationName", { value: animationName });
  return event;
}

describe("waitForCoinAnimationEvent", () => {
  it("waits for the requested animation on the coin itself", async () => {
    const coin = new EventTarget() as HTMLElement;
    let resolved = false;
    const waiting = waitForCoinAnimationEvent(
      coin,
      "animationiteration",
      ["coin-air-spin"],
      1_000,
    ).then(() => {
      resolved = true;
    });

    coin.dispatchEvent(animationEvent("animationiteration", "unrelated-animation"));
    await Promise.resolve();
    expect(resolved).toBe(false);

    coin.dispatchEvent(animationEvent("animationiteration", "coin-air-spin"));
    await waiting;
    expect(resolved).toBe(true);
  });

  it("uses the fallback when the browser omits an animation event", async () => {
    vi.useFakeTimers();
    try {
      const waiting = waitForCoinAnimationEvent(
        new EventTarget() as HTMLElement,
        "animationend",
        ["coin-land-heads", "coin-land-tails"],
        900,
      );

      await vi.advanceTimersByTimeAsync(899);
      let resolved = false;
      void waiting.then(() => {
        resolved = true;
      });
      await Promise.resolve();
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await waiting;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
