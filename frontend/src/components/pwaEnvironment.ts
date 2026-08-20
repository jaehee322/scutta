export type InstallEnvironment = "android" | "ios" | "kakao" | "desktop";

export function detectInstallEnvironment(
  userAgent: string,
  platform: string,
  touchPoints: number,
): InstallEnvironment {
  if (/KAKAOTALK/i.test(userAgent)) return "kakao";
  if (/Android/i.test(userAgent)) return "android";
  if (/iPad|iPhone|iPod/i.test(userAgent) || (platform === "MacIntel" && touchPoints > 1)) {
    return "ios";
  }
  return "desktop";
}
