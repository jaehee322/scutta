export type InstallEnvironment =
  | "android"
  | "ios"
  | "kakao-android"
  | "kakao-ios"
  | "kakao"
  | "desktop";

export function detectInstallEnvironment(
  userAgent: string,
  platform: string,
  touchPoints: number,
): InstallEnvironment {
  const isKakao = /KAKAOTALK/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);
  const isIos = /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && touchPoints > 1);

  if (isKakao && isAndroid) return "kakao-android";
  if (isKakao && isIos) return "kakao-ios";
  if (isKakao) return "kakao";
  if (isAndroid) return "android";
  if (isIos) {
    return "ios";
  }
  return "desktop";
}
