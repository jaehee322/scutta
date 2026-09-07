export const PWA_DISPLAY_MODES = [
  "standalone",
  "minimal-ui",
  "fullscreen",
  "window-controls-overlay",
] as const;

export const PWA_INSTALL_NOTICE_DAY_KEY = "scutta.pwa.install-recommendation.day";

export function isPwaDisplayMode(
  iosStandalone: boolean | undefined,
  matches: (query: string) => boolean,
): boolean {
  try {
    return iosStandalone === true
      || PWA_DISPLAY_MODES.some((mode) => matches(`(display-mode: ${mode})`));
  } catch {
    // Do not recommend installation when the current display mode is unknown.
    return true;
  }
}

function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function claimDailyInstallRecommendation(
  now = Date.now(),
  getStorage: () => Pick<Storage, "getItem" | "setItem"> = () => window.localStorage,
): boolean {
  try {
    const today = new Date(now + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    if (!isIsoDay(today)) return false;
    const storage = getStorage();
    const previousDay = storage.getItem(PWA_INSTALL_NOTICE_DAY_KEY);
    if (previousDay !== null && isIsoDay(previousDay) && previousDay >= today) return false;
    // Claim immediately before showing. A failed write must not cause repeated notices.
    storage.setItem(PWA_INSTALL_NOTICE_DAY_KEY, today);
    return true;
  } catch {
    return false;
  }
}
