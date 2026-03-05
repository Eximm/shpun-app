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

const LS_SEEN_KEY = "push.onboarding.seen.v1";

function isIOS(): boolean {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
}

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

  const shouldShow = useMemo(() => {
    if (!enabled) return false;
    if (readSeen()) return false;

    if (!isPushSupported()) return false;
    if (isPushDisabledByUser()) return false;

    // iOS: push only in installed PWA
    if (isIOS() && !isStandalonePwa()) return true; // покажем подсказку "сначала установи"

    // Если уже включено — не показываем
    const enabledNow = state.permission === "granted" && state.hasSubscription;
    if (enabledNow) return false;

    // Если запретили на уровне браузера — смысла нет, пусть идёт в настройки сайта
    if (state.permission === "denied") return false;

    // Для твоей политики: push только в установленной PWA
    if (!state.standalone) return true;

    // permission default/granted but no sub
    return true;
  }, [enabled, state.permission, state.hasSubscription, state.standalone]);

  async function refresh() {
    try {
      const s = await getPushState();
      setState(s);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (shouldShow) setOpen(true);
  }, [enabled, shouldShow]);

  async function accept() {
    if (busy) return;
    setBusy(true);
    try {
      // iOS not standalone: can't request push
      if (isIOS() && !isStandalonePwa()) {
        toast.info("Для уведомлений установи приложение", {
          description: "iPhone: Поделиться → На экран Домой, затем включи уведомления.",
          durationMs: 3500,
        });
        writeSeen(true);
        setOpen(false);
        return;
      }

      // for your policy: only PWA can ask
      if (!isStandalonePwa()) {
        toast.info("Установи PWA для push", {
          description: "Открой меню браузера (⋮) → «Установить приложение».",
          durationMs: 3500,
        });
        // не помечаем seen — покажем снова после установки
        setOpen(false);
        return;
      }

      const ok = await enablePushByUserGesture();
      if (ok) {
        await ensurePushSubscribed().catch(() => {});
        toast.success("Уведомления включены ✅", { description: "Будем писать о балансе и продлении." });
        writeSeen(true);
        setOpen(false);
        await refresh();
      } else {
        // пользователь мог нажать "не разрешать"
        await refresh();
        toast.info("Уведомления не включены", {
          description: "Можно включить позже в профиле.",
          durationMs: 2500,
        });
        writeSeen(true);
        setOpen(false);
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
    accept,
    dismiss,
    refresh,
  };
}