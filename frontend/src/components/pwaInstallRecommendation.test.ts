import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PWA_DISPLAY_MODES,
  PWA_INSTALL_NOTICE_DAY_KEY,
  claimDailyInstallRecommendation,
  isPwaDisplayMode,
} from "./pwaInstallRecommendation";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createStorage(initialValue: string | null = null) {
  let value = initialValue;
  return {
    getItem: vi.fn((_key: string): string | null => value),
    setItem: vi.fn((_key: string, nextValue: string): void => { value = nextValue; }),
  };
}

describe("isPwaDisplayMode", () => {
  it("excludes iOS standalone without depending on media queries", () => {
    const matches = vi.fn(() => false);
    expect(isPwaDisplayMode(true, matches)).toBe(true);
    expect(matches).not.toHaveBeenCalled();
  });

  it.each(PWA_DISPLAY_MODES)("excludes the %s display mode", (mode) => {
    const matches = vi.fn((query: string) => query === `(display-mode: ${mode})`);
    expect(isPwaDisplayMode(undefined, matches)).toBe(true);
    expect(matches).toHaveBeenCalledWith(`(display-mode: ${mode})`);
  });

  it.each([false, undefined])("allows a plain browser with iOS standalone=%s", (standalone) => {
    const matches = vi.fn(() => false);
    expect(isPwaDisplayMode(standalone, matches)).toBe(false);
    expect(matches.mock.calls).toHaveLength(4);
  });

  it("excludes uncertain display modes when detection fails", () => {
    expect(isPwaDisplayMode(undefined, () => { throw new Error("media query unavailable"); }))
      .toBe(true);
  });
});

describe("claimDailyInstallRecommendation", () => {
  const beforeKoreaMidnight = Date.parse("2026-09-08T14:59:59.999Z");

  it("claims only once on the same Korea calendar day", () => {
    const storage = createStorage();
    const getStorage = () => storage;
    expect(claimDailyInstallRecommendation(beforeKoreaMidnight, getStorage)).toBe(true);
    expect(storage.getItem).toHaveBeenCalledWith(PWA_INSTALL_NOTICE_DAY_KEY);
    expect(storage.setItem).toHaveBeenCalledWith(PWA_INSTALL_NOTICE_DAY_KEY, "2026-09-08");
    expect(claimDailyInstallRecommendation(beforeKoreaMidnight, getStorage)).toBe(false);
    expect(storage.setItem).toHaveBeenCalledOnce();
  });

  it("allows the next notice exactly at midnight in Korea, before the UTC date changes", () => {
    const storage = createStorage();
    const getStorage = () => storage;
    expect(claimDailyInstallRecommendation(beforeKoreaMidnight, getStorage)).toBe(true);
    expect(claimDailyInstallRecommendation(beforeKoreaMidnight + 1, getStorage)).toBe(true);
    expect(storage.setItem).toHaveBeenLastCalledWith(PWA_INSTALL_NOTICE_DAY_KEY, "2026-09-09");
    expect(claimDailyInstallRecommendation(beforeKoreaMidnight + 2, getStorage)).toBe(false);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });

  it("keeps a future claim through a cross-day clock rollback", () => {
    const storage = createStorage("2026-09-10");
    const getStorage = () => storage;
    expect(claimDailyInstallRecommendation(beforeKoreaMidnight, getStorage)).toBe(false);
    expect(claimDailyInstallRecommendation(Date.parse("2026-09-10T14:59:59Z"), getStorage))
      .toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(claimDailyInstallRecommendation(Date.parse("2026-09-10T15:00:00Z"), getStorage))
      .toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(PWA_INSTALL_NOTICE_DAY_KEY, "2026-09-11");
  });

  it.each(["broken", "2026-99-99", "2026-02-30", "2026-9-8"])(
    "replaces the invalid stored date %s after a successful write",
    (stored) => {
      const storage = createStorage(stored);
      expect(claimDailyInstallRecommendation(beforeKoreaMidnight, () => storage)).toBe(true);
      expect(storage.setItem).toHaveBeenCalledWith(PWA_INSTALL_NOTICE_DAY_KEY, "2026-09-08");
    },
  );

  it("honors a valid future leap day", () => {
    const storage = createStorage("2028-02-29");
    expect(claimDailyInstallRecommendation(beforeKoreaMidnight, () => storage)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("suppresses the notice when obtaining storage throws", () => {
    expect(claimDailyInstallRecommendation(beforeKoreaMidnight, () => {
      throw new Error("storage denied");
    })).toBe(false);
  });

  it("suppresses the notice when reading storage throws", () => {
    const storage = createStorage();
    storage.getItem.mockImplementation(() => { throw new Error("read denied"); });
    expect(claimDailyInstallRecommendation(beforeKoreaMidnight, () => storage)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("suppresses a failed write and claims only after persistence succeeds", () => {
    const storage = createStorage();
    storage.setItem.mockImplementationOnce(() => { throw new Error("quota exceeded"); });
    expect(claimDailyInstallRecommendation(beforeKoreaMidnight, () => storage)).toBe(false);
    expect(claimDailyInstallRecommendation(beforeKoreaMidnight, () => storage)).toBe(true);
    expect(claimDailyInstallRecommendation(beforeKoreaMidnight, () => storage)).toBe(false);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });

  it("catches a throwing localStorage getter without trying session storage", () => {
    const sessionStorage = vi.fn();
    vi.stubGlobal("window", {
      get localStorage() { throw new Error("storage access denied"); },
      get sessionStorage() { sessionStorage(); return createStorage(); },
    });
    expect(claimDailyInstallRecommendation(beforeKoreaMidnight)).toBe(false);
    expect(sessionStorage).not.toHaveBeenCalled();
  });

  it("uses the current time and localStorage by default", () => {
    const storage = createStorage();
    vi.spyOn(Date, "now").mockReturnValue(beforeKoreaMidnight + 1);
    vi.stubGlobal("window", { localStorage: storage });
    expect(claimDailyInstallRecommendation()).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(PWA_INSTALL_NOTICE_DAY_KEY, "2026-09-09");
  });

  it.each([NaN, Infinity])("does not claim with an invalid clock value %s", (now) => {
    const storage = createStorage();
    expect(claimDailyInstallRecommendation(now, () => storage)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
