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

// "shown toast" is per-tab (sessionStorage), so it survives route changes
// but resets on new tab / browser restart.
const SHOWN_TOAST_PREFIX = "notif.toast.shown.v1:";

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

function hasShownToast(eventId: string): boolean {
  const id = String(eventId || "").trim();
  if (!id) return true; // if no id => never toast (safe)
  try {
    return sessionStorage.getItem(SHOWN_TOAST_PREFIX + id) === "1";
  } catch {
    return false;
  }
}

function markToastShown(eventId: string) {
  const id = String(eventId || "").trim();
  if (!id) return;
  try {
    sessionStorage.setItem(SHOWN_TOAST_PREFIX + id, "1");
  } catch {
    // ignore
  }
}

export function useBillingNotifications(enabled: boolean) {
  const cursorRef = useRef<Cursor>(readCursor());
  const timerRef = useRef<number | null>(null);

  // first poll after (re)enable: don't spam old toasts
  const warmupRef = useRef<boolean>(true);

  // ts when hook was enabled (unix seconds)
  const enabledAtTsRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    warmupRef.current = true;
    enabledAtTsRef.current = Math.floor(Date.now() / 1000);

    async function tick() {
      if (stopped) return;

      try {
        const c = cursorRef.current || { ts: 0, id: "" };
        const qs =
          `afterTs=${encodeURIComponent(String(c.ts || 0))}` +
          `&afterId=${encodeURIComponent(String(c.id || ""))}`;

        const r = await apiFetch<Resp>(`/notifications?${qs}`);

        const items = r?.items || [];

        // Show toasts:
        // - normally: show all items (except toast=false, duplicates)
        // - during warmup: show only events that are NEW since enable moment
        const allowFromTs = warmupRef.current ? enabledAtTsRef.current : 0;

        for (const ev of items) {
          if (!ev) continue;
          if (ev.toast === false) continue;

          const eventId = String(ev.event_id ?? "").trim();
          if (!eventId) continue;

          // during warmup, skip old events (before user opened/enabled app)
          const evTs = Number(ev.ts ?? 0);
          if (allowFromTs && Number.isFinite(evTs) && evTs < allowFromTs) continue;

          if (hasShownToast(eventId)) continue;

          const title = ev.title || "Уведомление";
          const desc = ev.message || "";
          const lvl = ev.level || "info";

          markToastShown(eventId);

          if (lvl === "success") toast.success(title, { description: desc });
          else if (lvl === "error") toast.error(title, { description: desc });
          else toast.info(title, { description: desc });
        }

        // advance cursor AFTER processing items
        const next = r?.nextCursor;
        if (next && Number.isFinite(Number(next.ts))) {
          const nextCursor = { ts: Number(next.ts), id: String(next.id ?? "") };
          cursorRef.current = nextCursor;
          saveCursor(nextCursor);
        }

        if (warmupRef.current) warmupRef.current = false;
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