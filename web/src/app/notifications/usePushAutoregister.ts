// FILE: web/src/app/notifications/usePushAutoregister.ts
import { useEffect, useRef } from "react";
import { ensurePushSubscribed, isPushDisabledByUser, isPushSupported } from "./push";

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
      if (isPushDisabledByUser()) return;

      // "по учебнику": без user gesture permission НЕ спрашиваем.
      if (Notification.permission !== "granted") return;

      const now = Date.now();
      if (now - lastAttemptAtRef.current < RETRY_MS) return;

      inFlightRef.current = true;
      lastAttemptAtRef.current = now;

      try {
        await ensurePushSubscribed();
      } catch {
        // ignore
      } finally {
        inFlightRef.current = false;
      }
    };

    void run();

    const onVis = () => {
      if (document.visibilityState === "visible") void run();
    };

    window.addEventListener("online", run as any);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stopped = true;
      window.removeEventListener("online", run as any);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled]);
}