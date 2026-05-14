export type PwaInstallPlatform = "ios" | "android" | "windows" | "mac" | "linux" | "desktop" | "unknown";

function userAgent(): string {
  try {
    return String(navigator.userAgent || "");
  } catch {
    return "";
  }
}

function userAgentDataPlatform(): string {
  try {
    return String((navigator as any)?.userAgentData?.platform || "");
  } catch {
    return "";
  }
}

export function detectPwaInstallPlatform(): PwaInstallPlatform {
  const ua = userAgent();
  const uaPlatform = userAgentDataPlatform().toLowerCase();
  const platform = String((navigator as any)?.platform || "").toLowerCase();
  const isTouchMac = platform.includes("mac") && Number((navigator as any)?.maxTouchPoints || 0) > 1;

  if (/ipad|iphone|ipod/i.test(ua) || isTouchMac) return "ios";
  if (/android/i.test(ua) || uaPlatform.includes("android")) return "android";
  if (/windows/i.test(ua) || uaPlatform.includes("windows") || platform.includes("win")) return "windows";
  if (/macintosh|mac os x/i.test(ua) || uaPlatform.includes("mac") || platform.includes("mac")) return "mac";
  if (/linux/i.test(ua) || uaPlatform.includes("linux") || platform.includes("linux")) return "linux";
  if (ua) return "desktop";
  return "unknown";
}

export function isIOSPwaInstallPlatform(platform = detectPwaInstallPlatform()): boolean {
  return platform === "ios";
}

export function pwaGuideKey(platform: PwaInstallPlatform): "ios" | "android" | "windows" | "desktop" {
  if (platform === "ios") return "ios";
  if (platform === "android") return "android";
  if (platform === "windows") return "windows";
  return "desktop";
}
