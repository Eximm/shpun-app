import { useEffect, useMemo, useState } from "react";
import { toast } from "../../shared/ui/toast";
import { useMe } from "../auth/useMe";
import {
  enablePushByUserGesture,
  ensurePushSubscribed,
  getPushState,
  isPushSupported,
  isStandalonePwa,
} from "./push";

function isTelegramMiniApp(): boolean {
  try {
    const w = window as any;
    return Boolean(w?.Telegram?.WebApp?.initData || w?.Telegram?.WebApp?.initDataUnsafe);
  } catch {
    return false;
  }
}

function sessionDismissKey(uid: number, mode: "browser" | "pwa") {
  return `push.onboarding.dismissed:${mode}:u:${uid}`;
}

function readDismissed(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(key: string) {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // ignore
  }
}

export function usePushOnboarding(enabled: boolean) {
  const { me } = useMe() as any;

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
  const uid = useMemo(() => {
    const n = Number(me?.profile?.id ?? me?.profile?.user_id ?? me?.id ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }, [me?.profile?.id, me?.profile?.user_id, me?.id]);

  const standalone = state.standalone;
  const pushEnabled = state.permission === "granted" && state.hasSubscription;

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
    if (!enabled || !uid) return;
    void refresh();
  }, [enabled, uid]);

  useEffect(() => {
    if (!enabled || telegramMiniApp || !uid) return;

    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    const onFocus = () => {
      void refresh();
    };

    const onAppInstalled = () => {
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
  }, [enabled, telegramMiniApp, uid]);

  const browserDismissKey = sessionDismissKey(uid, "browser");
  const pwaDismissKey = sessionDismissKey(uid, "pwa");

  const shouldShow = useMemo(() => {
    if (!enabled) return false;
    if (!uid) return false;
    if (telegramMiniApp) return false;

    // Обычный браузер: мягко предлагаем установить приложение
    if (!standalone) {
      return !readDismissed(browserDismissKey);
    }

    // В установленной PWA — только если push поддерживается и ещё не включён
    if (!isPushSupported()) return false;
    if (pushEnabled) return false;

    return !readDismissed(pwaDismissKey);
  }, [enabled, uid, telegramMiniApp, standalone, pushEnabled, browserDismissKey, pwaDismissKey]);

  useEffect(() => {
    if (!enabled || telegramMiniApp || !uid) return;

    const t = window.setTimeout(() => {
      setOpen(shouldShow);
    }, 600);

    return () => window.clearTimeout(t);
  }, [enabled, telegramMiniApp, uid, shouldShow]);

  async function accept() {
    if (busy) return;
    setBusy(true);

    try {
      // В обычном браузере просто мягко подсказываем установку
      if (!isStandalonePwa()) {
        toast.info("Установите приложение", {
          description:
            "Откройте меню браузера и выберите «Установить приложение». В установленном приложении мы предложим включить уведомления.",
          durationMs: 4000,
        });
        writeDismissed(browserDismissKey);
        setOpen(false);
        return;
      }

      // В установленной PWA включаем push по клику пользователя
      const ok = await enablePushByUserGesture();

      if (ok) {
        await ensurePushSubscribed().catch(() => {});
        toast.success("Уведомления включены ✅", {
          description: "Теперь вы будете получать важные события.",
        });
        writeDismissed(pwaDismissKey);
        setOpen(false);
        await refresh();
      } else {
        toast.info("Уведомления не включены", {
          description: "Их можно включить позже в профиле.",
          durationMs: 2500,
        });
        writeDismissed(pwaDismissKey);
        setOpen(false);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    if (!uid) {
      setOpen(false);
      return;
    }

    if (!standalone) writeDismissed(browserDismissKey);
    else writeDismissed(pwaDismissKey);

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