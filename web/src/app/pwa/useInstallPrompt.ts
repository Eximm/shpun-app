import { useEffect, useMemo, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
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
  return /safari/.test(ua) && !/chrome|android|crios|fxios/.test(ua);
}

export function useInstallPrompt() {
  const [bipEvent, setBipEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(isStandalone());

  useEffect(() => {
    const onBIP = (e: Event) => {
      e.preventDefault();
      setBipEvent(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setInstalled(true);
      setBipEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const canPrompt = useMemo(() => !!bipEvent && !installed, [bipEvent, installed]);
  const showIOSHint = useMemo(() => !installed && isIOS() && isSafari(), [installed]);

  async function promptInstall() {
    if (!bipEvent) return;
    await bipEvent.prompt();
    const res = await bipEvent.userChoice;
    if (res.outcome === "accepted") setBipEvent(null);
  }

  return { installed, canPrompt, showIOSHint, promptInstall };
}
