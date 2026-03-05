// FILE: web/src/app/notifications/useBillingNotifications.ts
import { useEffect, useMemo, useRef } from "react";
import { apiFetch } from "../../shared/api/client";
import { toast } from "../../shared/ui/toast";
import { useMe } from "../auth/useMe";

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

const POLL_MS = 8000;
const HIDDEN_POLL_MS = 30000;

const SHOWN_TTL_DAYS = 7;
const SHOWN_TTL_MS = SHOWN_TTL_DAYS * 24 * 60 * 60 * 1000;

const SHOWN_CLEANUP_LIMIT = 300;

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/* =========================================================
   Cursor (scoped by user)
   ========================================================= */

function cursorKeyFor(uid: number): string {
  return `notif.cursor.v2:u:${uid}`;
}

function shownPrefixFor(uid: number): string {
  return `notif.toast.shown.v2:u:${uid}:`;
}

function readCursor(uid: number): Cursor {
  if (!uid) return { ts: 0, id: "" };
  try {
    const raw = localStorage.getItem(cursorKeyFor(uid));
    if (!raw) return { ts: 0, id: "" };
    const v = JSON.parse(raw);
    const ts = Number(v?.ts ?? 0);
    const id = String(v?.id ?? "");
    return { ts: Number.isFinite(ts) ? ts : 0, id };
  } catch {
    return { ts: 0, id: "" };
  }
}

function saveCursor(uid: number, c: Cursor) {
  if (!uid) return;
  try {
    localStorage.setItem(cursorKeyFor(uid), JSON.stringify({ ts: c.ts || 0, id: c.id || "" }));
  } catch {
    // ignore
  }
}

/* =========================================================
   Dedupe / Shown logic
   ========================================================= */

function hashDjb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

function normalize(s: string) {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

function makeShownKey(ev: BillingPushEvent): string | null {
  const eventId = normalize(ev.event_id);
  const lvl = normalize(ev.level || "info");
  const title = normalize(ev.title || "");
  const msg = normalize(ev.message || "");

  if (eventId) return `id:${eventId}`;

  if (!title && !msg) return null;
  const semantic = `${lvl}|${title}|${msg}`;
  return `sem:${hashDjb2(semantic)}`;
}

function getShownStorageKey(uid: number, shownKey: string) {
  return shownPrefixFor(uid) + shownKey;
}

function hasShownToast(uid: number, shownKey: string): boolean {
  if (!uid) return false;
  try {
    const raw = localStorage.getItem(getShownStorageKey(uid, shownKey));
    if (!raw) return false;

    const v = JSON.parse(raw) as { shownAt?: number };
    const shownAt = Number(v?.shownAt ?? 0);
    if (!Number.isFinite(shownAt) || shownAt <= 0) return false;

    if (Date.now() - shownAt > SHOWN_TTL_MS) {
      localStorage.removeItem(getShownStorageKey(uid, shownKey));
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function markToastShown(uid: number, shownKey: string) {
  if (!uid) return;
  try {
    localStorage.setItem(getShownStorageKey(uid, shownKey), JSON.stringify({ shownAt: Date.now() }));
  } catch {
    // ignore
  }
}

function cleanupShownKeys(uid: number) {
  if (!uid) return;
  const prefix = shownPrefixFor(uid);

  try {
    const now = Date.now();
    let checked = 0;

    for (let i = 0; i < localStorage.length && checked < SHOWN_CLEANUP_LIMIT; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;

      checked++;

      const raw = localStorage.getItem(k);
      if (!raw) continue;

      try {
        const v = JSON.parse(raw) as { shownAt?: number };
        const shownAt = Number(v?.shownAt ?? 0);
        if (!Number.isFinite(shownAt) || shownAt <= 0 || now - shownAt > SHOWN_TTL_MS) {
          localStorage.removeItem(k);
        }
      } catch {
        localStorage.removeItem(k);
      }
    }
  } catch {
    // ignore
  }
}

/* =========================================================
   Hook
   ========================================================= */

export function useBillingNotifications(enabled: boolean) {
  const { me } = useMe() as any;

  const uid = useMemo(() => {
    const n = Number(me?.profile?.id ?? me?.profile?.user_id ?? me?.id ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }, [me?.profile?.id, me?.profile?.user_id, me?.id]);

  const cursorRef = useRef<Cursor>({ ts: 0, id: "" });
  const timerRef = useRef<number | null>(null);

  const warmupRef = useRef<boolean>(true);
  const enabledAtTsRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const lastUidRef = useRef<number>(0);

  function clearTimer() {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function scheduleNext(ms: number, fn: () => void) {
    clearTimer();
    timerRef.current = window.setTimeout(fn, ms);
  }

  useEffect(() => {
    if (!enabled || !uid) {
      clearTimer();
      inFlightRef.current = false;
      return;
    }

    let stopped = false;

    if (lastUidRef.current !== uid) {
      lastUidRef.current = uid;
      cursorRef.current = readCursor(uid);
      cleanupShownKeys(uid);
    } else {
      cursorRef.current = readCursor(uid);
      cleanupShownKeys(uid);
    }

    warmupRef.current = true;
    enabledAtTsRef.current = nowUnix();

    const tick = async () => {
      if (stopped) return;

      const hidden = document.visibilityState === "hidden";
      const nextDelay = hidden ? HIDDEN_POLL_MS : POLL_MS;

      if (inFlightRef.current) {
        scheduleNext(nextDelay, () => void tick());
        return;
      }

      inFlightRef.current = true;

      try {
        const c = cursorRef.current || { ts: 0, id: "" };
        const qs =
          `afterTs=${encodeURIComponent(String(c.ts || 0))}` +
          `&afterId=${encodeURIComponent(String(c.id || ""))}`;

        const r = await apiFetch<Resp>(`/notifications?${qs}`);
        const items = Array.isArray((r as any)?.items) ? (r as any).items : [];

        const allowFromTs = warmupRef.current ? enabledAtTsRef.current : 0;

        for (const ev of items as BillingPushEvent[]) {
          if (!ev) continue;
          if (ev.toast === false) continue;

          const evTs = Number((ev as any).ts ?? 0);
          if (allowFromTs && Number.isFinite(evTs) && evTs < allowFromTs) continue;

          const shownKey = makeShownKey(ev);
          if (!shownKey) continue;
          if (hasShownToast(uid, shownKey)) continue;

          const title = ev.title || "Уведомление";
          const desc = ev.message || "";
          const lvl = ev.level || "info";

          markToastShown(uid, shownKey);

          if (lvl === "success") toast.success(title, { description: desc });
          else if (lvl === "error") toast.error(title, { description: desc });
          else toast.info(title, { description: desc });
        }

        const next = (r as any)?.nextCursor;
        if (next && Number.isFinite(Number(next.ts))) {
          const nextCursor = { ts: Number(next.ts), id: String(next.id ?? "") };
          cursorRef.current = nextCursor;
          saveCursor(uid, nextCursor);
        }

        if (warmupRef.current) warmupRef.current = false;
      } catch {
        // silent
      } finally {
        inFlightRef.current = false;
        if (!stopped) scheduleNext(nextDelay, () => void tick());
      }
    };

    void tick();

    const onVis = () => {
      if (stopped) return;
      if (document.visibilityState === "visible") scheduleNext(200, () => void tick());
    };

    const onOnline = () => {
      if (stopped) return;
      scheduleNext(200, () => void tick());
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);

    return () => {
      stopped = true;
      clearTimer();
      inFlightRef.current = false;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, uid]);
}