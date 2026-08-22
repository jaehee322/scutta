import { afterEach, describe, expect, it, vi } from "vitest";

import { applyPwaUpdateLifecycle } from "./pwaUpdate";

afterEach(() => {
  vi.useRealTimers();
});

describe("applyPwaUpdateLifecycle", () => {
  it("reloads exactly once when the new worker takes control", async () => {
    let controllerChange: () => void = () => undefined;
    const activate = vi.fn();
    const reload = vi.fn();
    const update = applyPwaUpdateLifecycle({
      activate,
      reload,
      subscribeToControllerChange: (listener) => {
        controllerChange = listener;
        return () => undefined;
      },
      fallbackDelayMs: 60_000,
    });

    await Promise.resolve();
    expect(activate).toHaveBeenCalledOnce();
    controllerChange();
    controllerChange();
    await update;

    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads when the waiting worker reaches the activated state", async () => {
    let waitingState = "waiting";
    let stateChange: () => void = () => undefined;
    const reload = vi.fn();
    const update = applyPwaUpdateLifecycle({
      activate: () => undefined,
      reload,
      subscribeToControllerChange: () => () => undefined,
      subscribeToWaitingStateChange: (listener) => {
        stateChange = listener;
        return () => undefined;
      },
      waitingState: () => waitingState,
      fallbackDelayMs: 60_000,
    });

    waitingState = "activated";
    stateChange();
    await update;

    expect(reload).toHaveBeenCalledOnce();
  });

  it("uses a fallback reload when lifecycle events are not delivered", async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const update = applyPwaUpdateLifecycle({
      activate: () => undefined,
      reload,
      subscribeToControllerChange: () => () => undefined,
      fallbackDelayMs: 3_000,
    });

    await vi.advanceTimersByTimeAsync(3_000);
    await update;

    expect(reload).toHaveBeenCalledOnce();
  });

  it("cleans up and surfaces activation failures", async () => {
    const unsubscribe = vi.fn();
    const reload = vi.fn();
    const failure = new Error("activation failed");

    await expect(
      applyPwaUpdateLifecycle({
        activate: () => {
          throw failure;
        },
        reload,
        subscribeToControllerChange: () => unsubscribe,
        fallbackDelayMs: 60_000,
      }),
    ).rejects.toBe(failure);

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });
});
