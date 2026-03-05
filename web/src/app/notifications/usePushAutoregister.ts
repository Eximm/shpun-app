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
    if (!isPushSupported()) return;
    if (isPushDisabledByUser()) return;

    let stopped = false;

    const run = async () => {
      if (stopped) return;
      if (inFlightRef.current) return;

      // "по учебнику": permission запрашивается только по user gesture в UI
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

    // сразу после входа
    void run();

    const onVis = () => {
      if (document.visibilityState === "visible") void run();
    };

    const onOnline = () => {
      void run();
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled]);
}