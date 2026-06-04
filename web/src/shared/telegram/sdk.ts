type TgWebApp = {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
  openLink?: (url: string, options?: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TgWebApp;
    };
  }
}

let telegramSdkPromise: Promise<TgWebApp | null> | null = null;
const TELEGRAM_MINI_APP_SESSION_KEY = "telegram.mini_app.session.v1";

function markTelegramMiniAppSession() {
  try {
    sessionStorage.setItem(TELEGRAM_MINI_APP_SESSION_KEY, "1");
  } catch {
    // ignore
  }
}

export function getTelegramWebApp(): TgWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

function readTelegramInitDataFromUrl(): string {
  const read = (raw: string) => {
    const value = String(raw || "").trim().replace(/^[?#]/, "");
    if (!value) return "";
    try {
      return new URLSearchParams(value).get("tgWebAppData")?.trim() || "";
    } catch {
      return "";
    }
  };

  return read(window.location.hash) || read(window.location.search);
}

export function readTelegramInitData(): string {
  const fromSdk = String(getTelegramWebApp()?.initData ?? "").trim();
  const initData = fromSdk || readTelegramInitDataFromUrl();
  if (initData.length > 50) markTelegramMiniAppSession();
  return initData;
}

export function hasTelegramMiniAppParams(): boolean {
  const hasParam = (raw: string) => {
    const value = String(raw || "").trim().replace(/^[?#]/, "");
    if (!value) return false;
    try {
      const params = new URLSearchParams(value);
      return params.has("tgWebAppData") || params.has("tgWebAppVersion") || params.has("tgWebAppPlatform");
    } catch {
      return false;
    }
  };

  return hasParam(window.location.hash) || hasParam(window.location.search);
}

export function isLikelyTelegramWebView(): boolean {
  try {
    const ua = String(navigator.userAgent || "");
    return /telegram/i.test(ua) || hasTelegramMiniAppParams();
  } catch {
    return hasTelegramMiniAppParams();
  }
}

export function isTelegramMiniAppEnv(): boolean {
  const detected = readTelegramInitData().length > 50 || hasTelegramMiniAppParams();
  try {
    if (detected) markTelegramMiniAppSession();
    return detected || sessionStorage.getItem(TELEGRAM_MINI_APP_SESSION_KEY) === "1";
  } catch {
    return detected;
  }
}

export async function ensureTelegramWebAppSdk(timeoutMs = 3000): Promise<TgWebApp | null> {
  const existing = getTelegramWebApp();
  if (existing) return existing;

  if (telegramSdkPromise) return telegramSdkPromise;

  telegramSdkPromise = new Promise<TgWebApp | null>((resolve) => {
    const prev = document.querySelector<HTMLScriptElement>('script[data-shpun-tg-webapp="1"]');
    let settled = false;
    let timeoutId = 0;

    const done = (tg: TgWebApp | null) => {
      if (settled) return;
      settled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      resolve(tg);
    };

    const waitForWebApp = () => {
      const started = Date.now();

      const poll = () => {
        const tg = getTelegramWebApp();

        if (tg) {
          done(tg);
          return;
        }

        if (Date.now() - started >= timeoutMs) {
          done(null);
          return;
        }

        window.setTimeout(poll, 50);
      };

      poll();
    };

    if (prev) {
      waitForWebApp();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.async = true;
    script.defer = true;
    script.setAttribute("data-shpun-tg-webapp", "1");

    timeoutId = window.setTimeout(() => {
      script.onload = null;
      script.onerror = null;
      script.remove();
      done(null);
    }, timeoutMs);
    script.onload = waitForWebApp;
    script.onerror = () => done(null);

    document.head.appendChild(script);
  }).finally(() => {
    telegramSdkPromise = null;
  });

  return telegramSdkPromise;
}
