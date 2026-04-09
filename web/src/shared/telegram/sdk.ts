type TgWebApp = {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TgWebApp;
    };
  }
}

let telegramSdkPromise: Promise<TgWebApp | null> | null = null;

function getTelegramWebApp(): TgWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

function hasTelegramLaunchHints(): boolean {
  try {
    const sp = new URLSearchParams(window.location.search || "");

    if (sp.get("tgWebAppData")) return true;
    if (sp.get("tgWebAppPlatform")) return true;
    if (sp.get("tgWebAppVersion")) return true;
    if (sp.get("tgWebAppThemeParams")) return true;
  } catch {
    // ignore
  }

  return false;
}

export function isTelegramMiniAppEnv(): boolean {
  const tg = getTelegramWebApp();
  if (tg) return true;
  return hasTelegramLaunchHints();
}

export async function ensureTelegramWebAppSdk(timeoutMs = 1600): Promise<TgWebApp | null> {
  const existing = getTelegramWebApp();
  if (existing) return existing;

  if (telegramSdkPromise) return telegramSdkPromise;

  telegramSdkPromise = new Promise<TgWebApp | null>((resolve) => {
    const prev = document.querySelector<HTMLScriptElement>('script[data-shpun-tg-webapp="1"]');
    if (prev) {
      const started = Date.now();

      const poll = () => {
        const tg = getTelegramWebApp();
        if (tg) {
          resolve(tg);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          resolve(null);
          return;
        }
        window.setTimeout(poll, 80);
      };

      poll();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.async = true;
    script.defer = true;
    script.setAttribute("data-shpun-tg-webapp", "1");

    const timeoutId = window.setTimeout(() => {
      resolve(null);
    }, timeoutMs);

    script.onload = () => {
      window.clearTimeout(timeoutId);
      resolve(getTelegramWebApp());
    };

    script.onerror = () => {
      window.clearTimeout(timeoutId);
      resolve(null);
    };

    document.head.appendChild(script);
  }).finally(() => {
    telegramSdkPromise = null;
  });

  return telegramSdkPromise;
}

export { getTelegramWebApp };