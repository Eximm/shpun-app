import { useEffect, useRef } from "react";
import { ensurePushSubscribed, isPushSupported } from "./push";

// backoff между попытками
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
        // ✅ без permission prompt
        await ensurePushSubscribed();
      } catch {
        // ignore
      } finally {
        inFlightRef.current = false;
      }
    };

    // 1) сразу
    void run();

    // 2) при возвращении в приложение/вкладку
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