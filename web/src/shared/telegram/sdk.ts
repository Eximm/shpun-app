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

export function getTelegramWebApp(): TgWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

// ❗ УПРОЩЕНО: только реальный WebApp
export function isTelegramMiniAppEnv(): boolean {
  return !!getTelegramWebApp();
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
