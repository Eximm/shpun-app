import { useEffect, useRef } from "react";
import { apiFetch } from "../../shared/api/client";
import { toast } from "../../shared/ui/toast";
import { enablePush, getPushState, isPushSupported } from "./push";

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

// We store "shown toast" in localStorage so it survives Telegram WebView re-creates.
// TTL prevents storage growth and allows repeating rare important notices after time.
const SHOWN_KEY_PREFIX = "notif.toast.shown.v2:";
const SHOWN_TTL_DAYS = 7;
const SHOWN_TTL_MS = SHOWN_TTL_DAYS * 24 * 60 * 60 * 1000;

// Keep at most N shown keys cleanup per run (cheap + safe)
const SHOWN_CLEANUP_LIMIT = 300;

// Poll interval
const POLL_MS = 8000;
// When tab is hidden, poll slower (or effectively pause)
const HIDDEN_POLL_MS = 30000;

// Push re-subscribe backoff (avoid loops if platform blocks it)
const PUSH_RETRY_MS = 10 * 60 * 1000;

/* =========================================================
   Cursor
   ========================================================= */

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

/* =========================================================
   Dedupe / Shown logic
   ========================================================= */

// small stable hash (djb2) for semantic key
function hashDjb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  // unsigned 32-bit
  return (h >>> 0).toString(16);
}

function normalize(s: string) {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

// Prefer event_id when it exists, but also add a semantic fallback.
// This protects from backends that generate new event_id for the same condition.
function makeShownKey(ev: BillingPushEvent): string | null {
  const eventId = normalize(ev.event_id);
  const lvl = normalize(ev.level || "info");
  const title = normalize(ev.title || "");
  const msg = normalize(ev.message || "");

  // if we have a stable event_id — use it
  if (eventId) return `id:${eventId}`;

  // if no id, use semantic key
  if (!title && !msg) return null;
  const semantic = `${lvl}|${title}|${msg}`;
  return `sem:${hashDjb2(semantic)}`;
}

function getShownStorageKey(shownKey: string) {
  return SHOWN_KEY_PREFIX + shownKey;
}

function hasShownToast(shownKey: string): boolean {
  try {
    const raw = localStorage.getItem(getShownStorageKey(shownKey));
    if (!raw) return false;

    const v = JSON.parse(raw) as { shownAt?: number };
    const shownAt = Number(v?.shownAt ?? 0);
    if (!Number.isFinite(shownAt) || shownAt <= 0) return false;

    if (Date.now() - shownAt > SHOWN_TTL_MS) {
      // expired -> drop
      localStorage.removeItem(getShownStorageKey(shownKey));
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function markToastShown(shownKey: string) {
  try {
    localStorage.setItem(getShownStorageKey(shownKey), JSON.stringify({ shownAt: Date.now() }));
  } catch {
    // ignore
  }
}

function cleanupShownKeys() {
  try {
    const now = Date.now();
    let checked = 0;

    // IMPORTANT: localStorage.length can change when we remove keys.
    // We'll just do bounded scan; it's fine if we skip some keys.
    for (let i = 0; i < localStorage.length && checked < SHOWN_CLEANUP_LIMIT; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(SHOWN_KEY_PREFIX)) continue;

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
        // broken json — remove
        localStorage.removeItem(k);
      }
    }
  } catch {
    // ignore
  }
}

/* =========================================================
   Push auto-resubscribe (after 410 / reinstall / cleanup)
   ========================================================= */

async function ensurePushSubscription(
  lastAttemptAtRef: { current: number },
  inFlightRef: { current: boolean },
) {
  // avoid overlapping attempts
  if (inFlightRef.current) return;

  // platform not supported
  if (!isPushSupported()) return;

  const now = Date.now();
  if (now - (lastAttemptAtRef.current || 0) < PUSH_RETRY_MS) return;

  lastAttemptAtRef.current = now;
  inFlightRef.current = true;

  try {
    const st = await getPushState();

    // If permission is not granted — don't bother.
    // (enablePush() will ask permission, but we don't want silent prompts on background ticks)
    if (st.permission !== "granted") return;

    // subscription exists -> nothing to do
    if (st.hasSubscription) return;

    // try to re-create subscription + sync with server
    await enablePush();
  } catch {
    // ignore
  } finally {
    inFlightRef.current = false;
  }
}

/* =========================================================
   Hook
   ========================================================= */

export function useBillingNotifications(enabled: boolean) {
  const cursorRef = useRef<Cursor>(readCursor());
  const timerRef = useRef<number | null>(null);

  // first poll after (re)enable: don't spam old toasts
  const warmupRef = useRef<boolean>(true);

  // ts when hook was enabled (unix seconds)
  const enabledAtTsRef = useRef<number>(0);

  // prevent overlapping requests (if one tick is slow)
  const inFlightRef = useRef<boolean>(false);

  // push resubscribe throttling
  const pushAttemptAtRef = useRef<number>(0);
  const pushInFlightRef = useRef<boolean>(false);

  function clearTimer() {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function scheduleNext(ms: number, fn: () => void) {
    clearTimer();
    timerRef.current = window.setTimeout(fn, ms);
  }

  useEffect(() => {
    if (!enabled) {
      clearTimer();
      inFlightRef.current = false;
      return;
    }

    let stopped = false;

    // re-read cursor every time we enable (important for Telegram WebView re-create / multi tabs)
    cursorRef.current = readCursor();

    warmupRef.current = true;
    enabledAtTsRef.current = Math.floor(Date.now() / 1000);

    cleanupShownKeys();

    // 🔥 attempt to restore push subscription once on enable
    void ensurePushSubscription(pushAttemptAtRef, pushInFlightRef);

    const tick = async () => {
      if (stopped) return;

      // if tab is hidden, poll slower (and also avoid bursts)
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      const nextDelay = hidden ? HIDDEN_POLL_MS : POLL_MS;

      // no overlap
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
        const items = r?.items || [];

        // Show toasts:
        // - normally: show all items (except toast=false, duplicates)
        // - during warmup: show only events that are NEW since enable moment
        const allowFromTs = warmupRef.current ? enabledAtTsRef.current : 0;

        for (const ev of items) {
          if (!ev) continue;
          if (ev.toast === false) continue;

          const evTs = Number(ev.ts ?? 0);
          if (allowFromTs && Number.isFinite(evTs) && evTs < allowFromTs) continue;

          const shownKey = makeShownKey(ev);
          if (!shownKey) continue;
          if (hasShownToast(shownKey)) continue;

          const title = ev.title || "Уведомление";
          const desc = ev.message || "";
          const lvl = ev.level || "info";

          // mark as shown BEFORE showing to avoid duplicate bursts on re-render/re-poll
          markToastShown(shownKey);

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
        inFlightRef.current = false;
        if (!stopped) scheduleNext(nextDelay, () => void tick());
      }
    };

    // run now
    void tick();

    // if visibility changes, reschedule faster when back
    const onVis = () => {
      if (stopped) return;

      if (document.visibilityState === "visible") {
        // when coming back, also try to restore push once (e.g. after 410 cleanup)
        void ensurePushSubscription(pushAttemptAtRef, pushInFlightRef);
        scheduleNext(200, () => void tick());
      }
    };

    try {
      document.addEventListener("visibilitychange", onVis);
    } catch {
      // ignore
    }

    return () => {
      stopped = true;
      clearTimer();
      inFlightRef.current = false;
      try {
        document.removeEventListener("visibilitychange", onVis);
      } catch {
        // ignore
      }
    };
  }, [enabled]);
}