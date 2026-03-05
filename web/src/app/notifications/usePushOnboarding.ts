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

const SS_BROWSER_DISMISSED = "push.onboarding.browser.dismissed.session.v1";
const SS_PWA_DISMISSED = "push.onboarding.pwa.dismissed.session.v1";

function readSessionFlag(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeSessionFlag(key: string, value: boolean) {
  try {
    if (value) sessionStorage.setItem(key, "1");
    else sessionStorage.removeItem(key);
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
      // После установки браузерного варианта сразу даём шанс показать PWA prompt
      writeSessionFlag(SS_BROWSER_DISMISSED, false);
      writeSessionFlag(SS_PWA_DISMISSED, false);
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

    // в браузере / PWA feature должен поддерживаться
    if (!isPushSupported()) return false;

    // если пользователь руками выключил push в профиле — onboarding не навязываем
    if (isPushDisabledByUser()) return false;

    // если уже включено — ничего не показываем
    if (enabledNow) return false;

    // если браузер уже запретил permission — не показываем onboarding,
    // дальше только через профиль / настройки сайта
    if (state.permission === "denied") return false;

    // Обычный браузер: мягко предлагаем установить приложение,
    // но не долбим в одной и той же вкладке бесконечно
    if (!standalone) {
      return !readSessionFlag(SS_BROWSER_DISMISSED);
    }

    // Установленная PWA: если push не включен, предлагаем при каждом запуске приложения.
    // Внутри одной сессии можно закрыть один раз.
    return !readSessionFlag(SS_PWA_DISMISSED);
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
      // Обычный браузер: мягкое приглашение установить PWA
      if (!isStandalonePwa()) {
        toast.info("Установите приложение", {
          description:
            "Откройте меню браузера и выберите «Установить приложение». После установки мы предложим включить уведомления.",
          durationMs: 4000,
        });

        writeSessionFlag(SS_BROWSER_DISMISSED, true);
        setOpen(false);
        return;
      }

      // Установленная PWA: просим permission по клику
      const ok = await enablePushByUserGesture();

      if (ok) {
        await ensurePushSubscribed().catch(() => {});
        toast.success("Уведомления включены ✅", {
          description: "Теперь вы будете получать важные события.",
        });
        writeSessionFlag(SS_PWA_DISMISSED, true);
        setOpen(false);
        await refresh();
      } else {
        toast.info("Уведомления не включены", {
          description: "Их можно включить позже в профиле.",
          durationMs: 2500,
        });
        writeSessionFlag(SS_PWA_DISMISSED, true);
        setOpen(false);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    if (!standalone) {
      writeSessionFlag(SS_BROWSER_DISMISSED, true);
    } else {
      writeSessionFlag(SS_PWA_DISMISSED, true);
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