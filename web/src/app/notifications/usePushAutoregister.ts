import { useEffect, useRef } from "react";
import { enablePush, getPushState, isPushSupported } from "./push";

// backoff между попытками
const RETRY_MS = 10 * 60 * 1000;

// чтобы не доставать пользователя бесконечными prompt'ами
const PROMPT_ONCE_KEY = "push.prompted.once.v1";

export function usePushAutoregister(enabled: boolean) {
  const lastAttemptAtRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;

    const run = async () => {
      if (stopped) return;
      if (inFlightRef.current) return;
      if (!isPushSupported()) return;

      const now = Date.now();
      if (now - lastAttemptAtRef.current < RETRY_MS) return;

      lastAttemptAtRef.current = now;
      inFlightRef.current = true;

      try {
        const st = await getPushState();

        // Если уже есть подписка — ок
        if (st.permission === "granted" && st.hasSubscription) return;

        // Если denied — ничего не сделать автоматически
        if (st.permission === "denied") return;

        // Если permission default — один раз попробуем запросить и подписаться
        if (st.permission === "default") {
          const alreadyPrompted = localStorage.getItem(PROMPT_ONCE_KEY) === "1";
          if (alreadyPrompted) return;
          localStorage.setItem(PROMPT_ONCE_KEY, "1");
        }

        // Создаст subscription (если можно) и отправит на сервер /subscribe
        await enablePush();
      } catch {
        // ignore
      } finally {
        inFlightRef.current = false;
      }
    };

    // 1) сразу
    void run();

    // 2) при возвращении на вкладку/в приложение
    const onVis = () => {
      if (document.visibilityState === "visible") void run();
    };

    try {
      document.addEventListener("visibilitychange", onVis);
    } catch {}

    return () => {
      stopped = true;
      try {
        document.removeEventListener("visibilitychange", onVis);
      } catch {}
    };
  }, [enabled]);
}