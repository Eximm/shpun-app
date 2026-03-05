import { useEffect, useMemo, useState } from "react";
import { toast } from "../../shared/ui/toast";
import {
  enablePushByUserGesture,
  ensurePushSubscribed,
  getPushState,
  isPushDisabledByUser,
  isPushSupported,
  isStandalonePwa,
} from "./push";

const LS_BROWSER_INSTALL_SEEN = "push.onboarding.browser_install.seen.v1";
const LS_PWA_PUSH_SEEN = "push.onboarding.pwa_push.seen.v1";

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeBool(key: string, v: boolean) {
  try {
    if (v) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function isTelegramMiniApp(): boolean {
  try {
    const w = window as any;
    return Boolean(w?.Telegram?.WebApp?.initData || w?.Telegram?.WebApp?.initDataUnsafe);
  } catch {
    return false;
  }
}

export function usePushOnboarding(enabled: boolean) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [state, setState] = useState<{
    supported: boolean;
    permission: NotificationPermission | "unsupported";
    hasSubscription: boolean;
    standalone: boolean;
  }>({
    supported: false,
    permission: "unsupported",
    hasSubscription: false,
    standalone: false,
  });

  const telegramMiniApp = useMemo(() => isTelegramMiniApp(), []);
  const standalone = state.standalone;
  const enabledNow = state.permission === "granted" && state.hasSubscription;

  async function refresh() {
    try {
      if (telegramMiniApp) {
        setState({
          supported: false,
          permission: "unsupported",
          hasSubscription: false,
          standalone: false,
        });
        return;
      }

      const s = await getPushState();
      setState(s);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || telegramMiniApp) return;

    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    const onFocus = () => {
      void refresh();
    };

    const onAppInstalled = () => {
      // После установки PWA:
      // - browser invite больше не нужен
      // - push invite можно показывать
      writeBool(LS_BROWSER_INSTALL_SEEN, true);
      writeBool(LS_PWA_PUSH_SEEN, false);
      void refresh();
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("appinstalled", onAppInstalled as EventListener);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("appinstalled", onAppInstalled as EventListener);
    };
  }, [enabled, telegramMiniApp]);

  const shouldShow = useMemo(() => {
    if (!enabled) return false;
    if (telegramMiniApp) return false;
    if (!isPushSupported()) return false;
    if (isPushDisabledByUser()) return false;
    if (state.permission === "denied") return false;
    if (enabledNow) return false;

    // Обычный браузер: только мягкое приглашение установить приложение
    if (!standalone) {
      return !readBool(LS_BROWSER_INSTALL_SEEN);
    }

    // Установленная PWA: только предложение включить уведомления
    return !readBool(LS_PWA_PUSH_SEEN);
  }, [enabled, telegramMiniApp, standalone, state.permission, enabledNow]);

  useEffect(() => {
    if (!enabled || telegramMiniApp) return;

    const t = window.setTimeout(() => {
      setOpen(shouldShow);
    }, 800);

    return () => window.clearTimeout(t);
  }, [enabled, telegramMiniApp, shouldShow]);

  async function accept() {
    if (busy) return;
    setBusy(true);

    try {
      // Обычный браузер: мягко зовём установить PWA
      if (!isStandalonePwa()) {
        toast.info("Установите приложение", {
          description:
            "Откройте меню браузера и выберите «Установить приложение». После установки мы предложим включить уведомления.",
          durationMs: 4000,
        });

        writeBool(LS_BROWSER_INSTALL_SEEN, true);
        setOpen(false);
        return;
      }

      // PWA: включаем push
      const ok = await enablePushByUserGesture();

      if (ok) {
        await ensurePushSubscribed().catch(() => {});
        toast.success("Уведомления включены ✅", {
          description: "Теперь вы будете получать важные события.",
        });
        writeBool(LS_PWA_PUSH_SEEN, true);
        setOpen(false);
        await refresh();
      } else {
        toast.info("Уведомления не включены", {
          description: "Их можно включить позже в профиле.",
          durationMs: 2500,
        });
        writeBool(LS_PWA_PUSH_SEEN, true);
        setOpen(false);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    if (!standalone) {
      writeBool(LS_BROWSER_INSTALL_SEEN, true);
    } else {
      writeBool(LS_PWA_PUSH_SEEN, true);
    }
    setOpen(false);
  }

  return {
    open,
    busy,
    state,
    telegramMiniApp,
    accept,
    dismiss,
    refresh,
  };
}