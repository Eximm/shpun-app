import { useEffect, useMemo, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

function isStandalone(): boolean {
  const iosStandalone = (window.navigator as any).standalone === true;
  const mqStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
  return iosStandalone || !!mqStandalone;
}

function isIOS(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua);
}

function isSafari(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return /safari/.test(ua) && !/crios|fxios|edgios|opios|chrome|android/.test(ua);
}

function isTelegramWebView(): boolean {
  const ua = navigator.userAgent || "";
  const hasTgSDK = !!(window as any).Telegram?.WebApp;
  return hasTgSDK || /Telegram/i.test(ua);
}

/**
 * ============================================================
 * 🔥 ВАЖНО:
 * Ловим beforeinstallprompt как можно раньше (до React),
 * иначе Chrome на быстрых девайсах может показать свой auto-banner
 * до того, как useEffect повесит listener.
 * ============================================================
 */

let bufferedBip: BeforeInstallPromptEvent | null = null;

function installGlobalBipListenerOnce() {
  if ((window as any).__shpun_bip_listener_installed__) return;
  (window as any).__shpun_bip_listener_installed__ = true;

  window.addEventListener("beforeinstallprompt", (e: Event) => {
    // Всегда берём управление на себя (единый UX)
    e.preventDefault();
    bufferedBip = e as BeforeInstallPromptEvent;
  });
}

installGlobalBipListenerOnce();

export function useInstallPrompt() {
  const [bipEvent, setBipEvent] = useState<BeforeInstallPromptEvent | null>(
    () => bufferedBip
  );
  const [installed, setInstalled] = useState<boolean>(() => isStandalone());

  const inTelegram = useMemo(() => isTelegramWebView(), []);

  // синхронизируем установку (standalone может поменяться)
  useEffect(() => {
    const mq = window.matchMedia?.("(display-mode: standalone)");
    const onChange = () => setInstalled(isStandalone());

    if (mq) {
      if ("addEventListener" in mq) mq.addEventListener("change", onChange);
      else (mq as any).addListener(onChange);
    }

    const onVis = () => {
      if (document.visibilityState === "visible") setInstalled(isStandalone());
    };
    document.addEventListener("visibilitychange", onVis);

    const onAppInstalled = () => {
      setInstalled(true);
      bufferedBip = null;
      setBipEvent(null);
    };
    window.addEventListener("appinstalled", onAppInstalled);

    // если bufferedBip появился после первого рендера
    const t = window.setInterval(() => {
      if (!installed && !bipEvent && bufferedBip) setBipEvent(bufferedBip);
    }, 400);

    return () => {
      if (mq) {
        if ("removeEventListener" in mq) mq.removeEventListener("change", onChange);
        else (mq as any).removeListener(onChange);
      }
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("appinstalled", onAppInstalled);
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showIOSHint = useMemo(
    () => !installed && !inTelegram && isIOS() && isSafari(),
    [installed, inTelegram]
  );

  const canPrompt = useMemo(
    () => !!bipEvent && !installed && !inTelegram,
    [bipEvent, installed, inTelegram]
  );

  async function promptInstall() {
    if (!bipEvent) return;

    try {
      await bipEvent.prompt();
      await bipEvent.userChoice;
      // после попытки — очищаем, чтобы UI не “залипал”
      bufferedBip = null;
      setBipEvent(null);
    } catch {
      bufferedBip = null;
      setBipEvent(null);
    }
  }

  async function copyLink() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        return true;
      } catch {
        return false;
      }
    }
  }

  return { installed, canPrompt, showIOSHint, inTelegram, promptInstall, copyLink };
}
