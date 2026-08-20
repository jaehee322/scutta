import { describe, expect, it } from "vitest";

import { detectInstallEnvironment } from "./pwaEnvironment";

describe("detectInstallEnvironment", () => {
  it("prioritizes the KakaoTalk in-app browser", () => {
    expect(detectInstallEnvironment("Mozilla/5.0 Android KAKAOTALK", "Linux", 5)).toBe(
      "kakao",
    );
  });

  it("detects Android and iPhone browsers", () => {
    expect(detectInstallEnvironment("Mozilla/5.0 Android", "Linux", 5)).toBe("android");
    expect(detectInstallEnvironment("Mozilla/5.0 iPhone", "iPhone", 5)).toBe("ios");
  });

  it("detects iPadOS using its desktop user agent", () => {
    expect(detectInstallEnvironment("Mozilla/5.0", "MacIntel", 5)).toBe("ios");
  });

  it("does not offer mobile instructions on desktop", () => {
    expect(detectInstallEnvironment("Mozilla/5.0 Windows NT 10.0", "Win32", 0)).toBe(
      "desktop",
    );
  });
});
