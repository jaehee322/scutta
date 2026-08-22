const DEFAULT_UPDATE_RELOAD_DELAY_MS = 3_000;

interface PwaUpdateLifecycle {
  activate: () => Promise<void> | void;
  reload: () => void;
  subscribeToControllerChange: (listener: () => void) => () => void;
  subscribeToWaitingStateChange?: (listener: () => void) => () => void;
  waitingState?: () => string;
  fallbackDelayMs?: number;
}

export function applyPwaUpdateLifecycle({
  activate,
  reload,
  subscribeToControllerChange,
  subscribeToWaitingStateChange,
  waitingState,
  fallbackDelayMs = DEFAULT_UPDATE_RELOAD_DELAY_MS,
}: PwaUpdateLifecycle): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribeController: () => void = () => undefined;
    let unsubscribeWaiting: () => void = () => undefined;

    const cleanup = () => {
      if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
      unsubscribeController();
      unsubscribeWaiting();
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const reloadOnce = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        reload();
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    try {
      unsubscribeController = subscribeToControllerChange(reloadOnce);
      if (subscribeToWaitingStateChange) {
        unsubscribeWaiting = subscribeToWaitingStateChange(() => {
          if (waitingState?.() === "activated") reloadOnce();
        });
      }
      fallbackTimer = setTimeout(reloadOnce, fallbackDelayMs);
    } catch (error) {
      fail(error);
      return;
    }

    Promise.resolve()
      .then(activate)
      .then(() => {
        if (waitingState?.() === "activated") reloadOnce();
      })
      .catch(fail);
  });
}
