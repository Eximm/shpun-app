import { useEffect, useRef } from "react";
import { apiFetch } from "../../shared/api/client";
import { toast } from "../../shared/ui/toast";

type BillingPushEvent = {
  event_id: string;
  ts: number;
  level?: "info" | "success" | "error";
  title?: string;
  message?: string;
  toast?: boolean;
};

type Cursor = { ts: number; id: string };
type Resp = { ok: true; items: BillingPushEvent[]; nextCursor: Cursor };

const CURSOR_KEY = "notif.cursor.v2";

function readCursor(): Cursor {
  try {
    const raw = localStorage.getItem(CURSOR_KEY);
    if (!raw) return { ts: 0, id: "" };
    const v = JSON.parse(raw);
    const ts = Number(v?.ts ?? 0);
    const id = String(v?.id ?? "");
    return { ts: Number.isFinite(ts) ? ts : 0, id };
  } catch {
    return { ts: 0, id: "" };
  }
}

function saveCursor(c: Cursor) {
  try {
    localStorage.setItem(CURSOR_KEY, JSON.stringify({ ts: c.ts || 0, id: c.id || "" }));
  } catch {
    // ignore
  }
}

export function useBillingNotifications(enabled: boolean) {
  const cursorRef = useRef<Cursor>(readCursor());
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;

    async function tick() {
      if (stopped) return;

      try {
        const c = cursorRef.current || { ts: 0, id: "" };
        const qs =
          `afterTs=${encodeURIComponent(String(c.ts || 0))}` +
          `&afterId=${encodeURIComponent(String(c.id || ""))}`;

        const r = await apiFetch<Resp>(`/notifications?${qs}`);

        const next = r?.nextCursor;
        if (next && Number.isFinite(Number(next.ts))) {
          const nextCursor = { ts: Number(next.ts), id: String(next.id ?? "") };
          cursorRef.current = nextCursor;
          saveCursor(nextCursor);
        }

        for (const ev of r.items || []) {
          if (ev.toast === false) continue;

          const title = ev.title || "Уведомление";
          const desc = ev.message || "";
          const lvl = ev.level || "info";

          if (lvl === "success") toast.success(title, { description: desc });
          else if (lvl === "error") toast.error(title, { description: desc });
          else toast.info(title, { description: desc });
        }
      } catch {
        // тихо
      } finally {
        if (!stopped) timerRef.current = window.setTimeout(tick, 8000);
      }
    }

    tick();

    return () => {
      stopped = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [enabled]);
}