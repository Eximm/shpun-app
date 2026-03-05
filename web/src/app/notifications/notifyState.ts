// FILE: web/src/app/notifications/notifyState.ts
import { apiFetch } from "../../shared/api/client";

export type Cursor = { ts: number; id: string };

function cursorKeyFor(uid: number): string {
  return `notif.cursor.v2:u:${uid}`;
}

export function readNotifCursor(uid: number): Cursor {
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

type Resp = { ok: true; items: any[]; nextCursor: Cursor };

export async function hasNewNotifications(uid: number): Promise<boolean> {
  if (!uid) return false;

  const c = readNotifCursor(uid);
  const qs =
    `afterTs=${encodeURIComponent(String(c.ts || 0))}` +
    `&afterId=${encodeURIComponent(String(c.id || ""))}` +
    `&limit=1`;

  const r = await apiFetch<Resp>(`/notifications?${qs}`);
  const items = Array.isArray(r?.items) ? r.items : [];
  return items.length > 0;
}