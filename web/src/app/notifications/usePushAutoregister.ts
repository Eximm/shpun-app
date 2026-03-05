import { useEffect, useRef } from "react";
import { enablePush, getPushState, isPushSupported } from "./push";

const RETRY_MS = 10 * 60 * 1000;

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
        if (st.permission !== "granted") return; // не дёргаем системный prompt тут
        if (st.hasSubscription) return;

        await enablePush(); // создаст subscription и отправит на сервер
      } catch {
        // ignore
      } finally {
        inFlightRef.current = false;
      }
    };

    // один раз при маунте + при возвращении во вкладку
    void run();

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