export const PWA_UPDATE_CHECK_INTERVAL_MS = 60_000;
const MIN_UPDATE_CHECK_GAP_MS = 10_000;

interface PwaUpdateCheckCallbacks {
  onWaiting: () => void;
  onResume: () => void;
}

export function startPwaUpdateChecks(
  registration: ServiceWorkerRegistration,
  { onWaiting, onResume }: PwaUpdateCheckCallbacks,
): () => void {
  let stopped = false;
  let checking = false;
  let lastCheckAt = -Infinity;

  const syncWaitingUpdate = () => {
    if (!registration.waiting) return false;
    // First installation should not be presented as an update.
    if (registration.active) onWaiting();
    return true;
  };

  const checkForUpdate = async () => {
    if (stopped || document.visibilityState !== "visible") return;
    // A ready update can be offered offline, without reopening a dismissed notice.
    if (syncWaitingUpdate()) return;
    const elapsed = Date.now() - lastCheckAt;
    if (
      !navigator.onLine
      || registration.installing
      || checking
      || (elapsed >= 0 && elapsed < MIN_UPDATE_CHECK_GAP_MS)
    ) return;

    checking = true;
    lastCheckAt = Date.now();
    try {
      await registration.update();
      if (!stopped && document.visibilityState === "visible") syncWaitingUpdate();
    } catch {
      // A failed check must not delay retrying when the connection returns.
      lastCheckAt = -Infinity;
    } finally {
      checking = false;
    }
  };

  const resumeApp = () => {
    if (document.visibilityState !== "visible") return;
    onResume();
    void checkForUpdate();
  };
  const handlePageShow = (event: PageTransitionEvent) => {
    if (event.persisted) resumeApp();
  };
  const check = () => { void checkForUpdate(); };

  const interval = window.setInterval(check, PWA_UPDATE_CHECK_INTERVAL_MS);
  window.addEventListener("online", check);
  window.addEventListener("pageshow", handlePageShow);
  document.addEventListener("visibilitychange", resumeApp);
  check();

  return () => {
    stopped = true;
    window.clearInterval(interval);
    window.removeEventListener("online", check);
    window.removeEventListener("pageshow", handlePageShow);
    document.removeEventListener("visibilitychange", resumeApp);
  };
}
