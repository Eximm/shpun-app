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
  // Safari on iOS includes "safari"; Chrome iOS uses CriOS; Firefox iOS uses FxiOS
  return /safari/.test(ua) && !/crios|fxios|edgios|opios|chrome|android/.test(ua);
}

function isTelegramWebView(): boolean {
  const ua = navigator.userAgent || "";
  const hasTgSDK = !!(window as any).Telegram?.WebApp;
  return hasTgSDK || /Telegram/i.test(ua);
}

export function useInstallPrompt() {
  const [bipEvent, setBipEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(() => isStandalone());

  // keep installed state in sync (display-mode can change)
  useEffect(() => {
    const mq = window.matchMedia?.("(display-mode: standalone)");
    if (!mq) return;

    const onChange = () => setInstalled(isStandalone());

    // Safari < 14 uses addListener/removeListener
    if ("addEventListener" in mq) mq.addEventListener("change", onChange);
    else (mq as any).addListener(onChange);

    // also re-check when tab becomes visible again (sometimes after install)
    const onVis = () => {
      if (document.visibilityState === "visible") setInstalled(isStandalone());
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if ("removeEventListener" in mq) mq.removeEventListener("change", onChange);
      else (mq as any).removeListener(onChange);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    const onBIP = (e: Event) => {
      // IMPORTANT: must preventDefault to show our own UI
      e.preventDefault();
      setBipEvent(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setInstalled(true);
      setBipEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBIP as any);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP as any);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const inTelegram = useMemo(() => isTelegramWebView(), []);
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
      const res = await bipEvent.userChoice;

      // If accepted, clear. If dismissed, also clear to avoid stuck CTA this session.
      // (Chrome may not re-fire BIP soon after dismissal anyway.)
      setBipEvent(null);

      if (res?.outcome === "accepted") {
        // appinstalled will also flip installed=true
      }
    } catch {
      // On any failure, just clear for this session
      setBipEvent(null);
    }
  }

  async function copyLink() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      // fallback
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

  return {
    installed,
    canPrompt,
    showIOSHint,
    inTelegram,
    promptInstall,
    copyLink,
  };
}
