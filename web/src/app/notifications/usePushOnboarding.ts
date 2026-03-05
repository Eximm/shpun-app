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

const LS_SEEN_KEY = "push.onboarding.seen.v4";

function readSeen(): boolean {
  try {
    return localStorage.getItem(LS_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSeen(v: boolean) {
  try {
    if (v) localStorage.setItem(LS_SEEN_KEY, "1");
    else localStorage.removeItem(LS_SEEN_KEY);
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
  const enabledNow = state.permission === "granted" && state.hasSubscription;

  const shouldShow = useMemo(() => {
    if (!enabled) return false;
    if (telegramMiniApp) return false; // в Telegram Mini App onboarding не показываем вообще
    if (readSeen()) return false;
    if (!isPushSupported()) return false;
    if (isPushDisabledByUser()) return false;
    if (enabledNow) return false;
    if (state.permission === "denied") return false;

    // В браузере покажем мягкое приглашение установить приложение,
    // в PWA покажем предложение включить уведомления.
    return true;
  }, [enabled, telegramMiniApp, enabledNow, state.permission]);

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
      // после установки PWA onboarding можно показать снова,
      // чтобы уже предложить включить уведомления
      writeSeen(false);
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

  useEffect(() => {
    if (!enabled || telegramMiniApp) return;

    const t = window.setTimeout(() => {
      setOpen(shouldShow);
    }, 800);

    return () => window.clearTimeout(t);
  }, [enabled, telegramMiniApp, shouldShow, state.standalone, state.permission, state.hasSubscription]);

  async function accept() {
    if (busy) return;
    setBusy(true);

    try {
      // В обычном браузере мягко предлагаем установить приложение.
      // Не считаем onboarding завершённым, чтобы после установки спросить про уведомления снова.
      if (!isStandalonePwa()) {
        toast.info("Установите приложение", {
          description:
            "Откройте меню браузера и выберите «Установить приложение». После установки мы предложим включить уведомления.",
          durationMs: 4000,
        });
        setOpen(false);
        return;
      }

      const ok = await enablePushByUserGesture();

      if (ok) {
        await ensurePushSubscribed().catch(() => {});
        toast.success("Уведомления включены ✅", {
          description: "Теперь вы будете получать важные события.",
        });
        writeSeen(true);
        setOpen(false);
        await refresh();
      } else {
        toast.info("Уведомления не включены", {
          description: "Их можно включить позже в профиле.",
          durationMs: 2500,
        });
        writeSeen(true);
        setOpen(false);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    writeSeen(true);
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