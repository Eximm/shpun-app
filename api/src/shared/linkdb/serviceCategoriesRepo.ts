// FILE: api/src/shared/linkdb/serviceCategoriesRepo.ts
import { linkDb } from "./db.js";

/* ─── Schema ─────────────────────────────────────────────────────────────── */

linkDb.exec(`
CREATE TABLE IF NOT EXISTS service_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_key TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL DEFAULT '',
  descr       TEXT NOT NULL DEFAULT '',
  short_descr TEXT NOT NULL DEFAULT '',
  connect_kind TEXT NOT NULL DEFAULT 'marzban',
  sort_order  INTEGER NOT NULL DEFAULT 100,
  badge       TEXT,
  badge_tone  TEXT NOT NULL DEFAULT 'soft',
  recommended INTEGER NOT NULL DEFAULT 0,
  hidden      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS service_category_items (
  category_key TEXT NOT NULL,
  service_id   INTEGER NOT NULL,
  PRIMARY KEY (category_key, service_id)
);

CREATE INDEX IF NOT EXISTS idx_sci_service_id
  ON service_category_items(service_id);
`);

/* ─── Types ─────────────────────────────────────────────────────────────── */

export type ServiceCategory = {
  id: number;
  category_key: string;
  title: string;
  descr: string;
  short_descr: string;
  connect_kind: string;
  sort_order: number;
  badge: string | null;
  badge_tone: string;
  recommended: boolean;
  hidden: boolean;
  created_at: number;
  updated_at: number;
  service_ids: number[];
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function rowToCategory(row: any): Omit<ServiceCategory, "service_ids"> {
  return {
    id:           Number(row.id),
    category_key: String(row.category_key),
    title:        String(row.title ?? ""),
    descr:        String(row.descr ?? ""),
    short_descr:  String(row.short_descr ?? ""),
    connect_kind: String(row.connect_kind ?? "marzban"),
    sort_order:   Number(row.sort_order ?? 100),
    badge:        row.badge ?? null,
    badge_tone:   String(row.badge_tone ?? "soft"),
    recommended:  Number(row.recommended ?? 0) === 1,
    hidden:       Number(row.hidden ?? 0) === 1,
    created_at:   Number(row.created_at ?? 0),
    updated_at:   Number(row.updated_at ?? 0),
  };
}

function getServiceIds(category_key: string): number[] {
  const rows = linkDb
    .prepare(`SELECT service_id FROM service_category_items WHERE category_key = ?`)
    .all(category_key) as any[];
  return rows.map((r) => Number(r.service_id));
}

/* ─── Queries ────────────────────────────────────────────────────────────── */

export function listServiceCategories(opts?: { includeHidden?: boolean }): ServiceCategory[] {
  const includeHidden = opts?.includeHidden ?? false;
  const rows = linkDb
    .prepare(`
      SELECT * FROM service_categories
      ${includeHidden ? "" : "WHERE hidden = 0"}
      ORDER BY sort_order ASC, id ASC
    `)
    .all() as any[];

  return rows.map((row) => ({
    ...rowToCategory(row),
    service_ids: getServiceIds(row.category_key),
  }));
}

export function getServiceCategory(category_key: string): ServiceCategory | null {
  const row = linkDb
    .prepare(`SELECT * FROM service_categories WHERE category_key = ?`)
    .get(category_key) as any;
  if (!row) return null;
  return { ...rowToCategory(row), service_ids: getServiceIds(category_key) };
}

export function createServiceCategory(data: {
  category_key: string;
  title: string;
  descr?: string;
  short_descr?: string;
  connect_kind?: string;
  sort_order?: number;
  badge?: string | null;
  badge_tone?: string;
  recommended?: boolean;
  hidden?: boolean;
  service_ids?: number[];
}): { ok: true; category: ServiceCategory } | { ok: false; error: string } {
  const key = String(data.category_key ?? "").trim();
  if (!key) return { ok: false, error: "category_key_required" };

  try {
    const now = Math.floor(Date.now() / 1000);
    linkDb.prepare(`
      INSERT INTO service_categories
        (category_key, title, descr, short_descr, connect_kind, sort_order, badge, badge_tone, recommended, hidden, created_at, updated_at)
      VALUES
        (@category_key, @title, @descr, @short_descr, @connect_kind, @sort_order, @badge, @badge_tone, @recommended, @hidden, @now, @now)
    `).run({
      category_key: key,
      title:        String(data.title ?? ""),
      descr:        String(data.descr ?? ""),
      short_descr:  String(data.short_descr ?? ""),
      connect_kind: String(data.connect_kind ?? "marzban"),
      sort_order:   Number(data.sort_order ?? 100),
      badge:        data.badge ?? null,
      badge_tone:   String(data.badge_tone ?? "soft"),
      recommended:  data.recommended ? 1 : 0,
      hidden:       data.hidden ? 1 : 0,
      now,
    });

    if (data.service_ids?.length) {
      setServiceIds(key, data.service_ids);
    }

    return { ok: true, category: getServiceCategory(key)! };
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) return { ok: false, error: "category_key_already_exists" };
    return { ok: false, error: "db_insert_failed" };
  }
}

export function updateServiceCategory(
  category_key: string,
  data: Partial<{
    title: string;
    descr: string;
    short_descr: string;
    connect_kind: string;
    sort_order: number;
    badge: string | null;
    badge_tone: string;
    recommended: boolean;
    hidden: boolean;
    service_ids: number[];
  }>
): { ok: true; category: ServiceCategory } | { ok: false; error: string } {
  const existing = getServiceCategory(category_key);
  if (!existing) return { ok: false, error: "not_found" };

  try {
    const now = Math.floor(Date.now() / 1000);
    linkDb.prepare(`
      UPDATE service_categories SET
        title        = @title,
        descr        = @descr,
        short_descr  = @short_descr,
        connect_kind = @connect_kind,
        sort_order   = @sort_order,
        badge        = @badge,
        badge_tone   = @badge_tone,
        recommended  = @recommended,
        hidden       = @hidden,
        updated_at   = @now
      WHERE category_key = @category_key
    `).run({
      category_key,
      title:        data.title        ?? existing.title,
      descr:        data.descr        ?? existing.descr,
      short_descr:  data.short_descr  ?? existing.short_descr,
      connect_kind: data.connect_kind ?? existing.connect_kind,
      sort_order:   data.sort_order   ?? existing.sort_order,
      badge:        "badge" in data ? (data.badge ?? null) : existing.badge,
      badge_tone:   data.badge_tone   ?? existing.badge_tone,
      recommended:  ("recommended" in data ? data.recommended : existing.recommended) ? 1 : 0,
      hidden:       ("hidden" in data ? data.hidden : existing.hidden) ? 1 : 0,
      now,
    });

    if ("service_ids" in data && Array.isArray(data.service_ids)) {
      setServiceIds(category_key, data.service_ids);
    }

    return { ok: true, category: getServiceCategory(category_key)! };
  } catch {
    return { ok: false, error: "db_update_failed" };
  }
}

export function deleteServiceCategory(category_key: string): { ok: true; deleted: boolean } | { ok: false; error: string } {
  try {
    linkDb.prepare(`DELETE FROM service_category_items WHERE category_key = ?`).run(category_key);
    const r = linkDb.prepare(`DELETE FROM service_categories WHERE category_key = ?`).run(category_key);
    return { ok: true, deleted: Number((r as any).changes ?? 0) > 0 };
  } catch {
    return { ok: false, error: "db_delete_failed" };
  }
}

function setServiceIds(category_key: string, service_ids: number[]) {
  linkDb.prepare(`DELETE FROM service_category_items WHERE category_key = ?`).run(category_key);
  const stmt = linkDb.prepare(`INSERT OR IGNORE INTO service_category_items (category_key, service_id) VALUES (?, ?)`);
  for (const sid of service_ids) {
    if (Number.isFinite(sid) && sid > 0) stmt.run(category_key, sid);
  }
}

/** Для фронта: маппинг service_id -> category_key */
export function getServiceIdToCategoryMap(): Map<number, string> {
  const rows = linkDb
    .prepare(`SELECT service_id, category_key FROM service_category_items`)
    .all() as any[];
  const map = new Map<number, string>();
  for (const r of rows) map.set(Number(r.service_id), String(r.category_key));
  return map;
}