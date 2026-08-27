import { linkDb } from "../../shared/linkdb/db.js";

export type ServerKind = "vpn" | "infra";

export type MonitoredServerRow = {
  id: number;
  title: string;
  host: string;
  exporter_url: string;
  kind: ServerKind;
  country_code: string | null;
  active: number;
  sort_order: number;
  uplink_mbps: number | null;
  created_at: string;
  updated_at: string;
};

linkDb.exec(`
CREATE TABLE IF NOT EXISTS monitored_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  host TEXT NOT NULL DEFAULT '',
  exporter_url TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'vpn',
  country_code TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100,
  uplink_mbps REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_monitored_servers_kind_active
  ON monitored_servers(kind, active, sort_order, id);
`);

try { linkDb.exec(`ALTER TABLE monitored_servers ADD COLUMN country_code TEXT`); } catch { /* already exists */ }

function kind(v: unknown): ServerKind {
  return String(v ?? "").trim() === "infra" ? "infra" : "vpn";
}

function clean(v: unknown, max = 300) {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function countryCode(v: unknown) {
  const code = clean(v, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function exporterFromHost(host: string, exporterUrl?: string) {
  const raw = clean(exporterUrl, 500);
  if (raw) return raw;
  const h = clean(host, 260).replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  return h ? `http://${h}:9100/metrics` : "";
}

export function listMonitoredServers({ includeInactive = false }: { includeInactive?: boolean } = {}) {
  const sql = `
    SELECT id, title, host, exporter_url, kind, country_code, active, sort_order, uplink_mbps, created_at, updated_at
    FROM monitored_servers
    ${includeInactive ? "" : "WHERE active = 1"}
    ORDER BY kind = 'infra', sort_order ASC, id ASC
  `;
  return linkDb.prepare(sql).all() as MonitoredServerRow[];
}

export function getMonitoredServer(id: number) {
  return linkDb.prepare(`
    SELECT id, title, host, exporter_url, kind, country_code, active, sort_order, uplink_mbps, created_at, updated_at
    FROM monitored_servers
    WHERE id = ?
  `).get(id) as MonitoredServerRow | undefined;
}

export function createMonitoredServer(input: {
  title?: unknown;
  host?: unknown;
  exporterUrl?: unknown;
  kind?: unknown;
  countryCode?: unknown;
  active?: unknown;
  sortOrder?: unknown;
  uplinkMbps?: unknown;
}) {
  const host = clean(input.host, 260);
  const title = clean(input.title, 160) || host;
  const exporterUrl = exporterFromHost(host, clean(input.exporterUrl, 500));
  if (!host || !exporterUrl) return { ok: false as const, error: "host_required" };
  if (clean(input.countryCode, 10) && !countryCode(input.countryCode)) {
    return { ok: false as const, error: "country_code_invalid" };
  }

  const info = linkDb.prepare(`
    INSERT INTO monitored_servers (title, host, exporter_url, kind, country_code, active, sort_order, uplink_mbps)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title,
    host,
    exporterUrl,
    kind(input.kind),
    countryCode(input.countryCode),
    input.active === false ? 0 : 1,
    Number.isFinite(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : 100,
    Number.isFinite(Number(input.uplinkMbps)) && Number(input.uplinkMbps) > 0 ? Number(input.uplinkMbps) : null,
  );

  return { ok: true as const, item: getMonitoredServer(Number(info.lastInsertRowid))! };
}

export function updateMonitoredServer(id: number, input: Record<string, unknown>) {
  const current = getMonitoredServer(id);
  if (!current) return { ok: false as const, error: "not_found" };

  const host = "host" in input ? clean(input.host, 260) : current.host;
  const exporterUrl = "exporterUrl" in input || "host" in input
    ? exporterFromHost(host, clean(input.exporterUrl ?? current.exporter_url, 500))
    : current.exporter_url;
  if (!host || !exporterUrl) return { ok: false as const, error: "host_required" };
  if ("countryCode" in input && clean(input.countryCode, 10) && !countryCode(input.countryCode)) {
    return { ok: false as const, error: "country_code_invalid" };
  }

  linkDb.prepare(`
    UPDATE monitored_servers
    SET title = ?,
        host = ?,
        exporter_url = ?,
        kind = ?,
        country_code = ?,
        active = ?,
        sort_order = ?,
        uplink_mbps = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    "title" in input ? (clean(input.title, 160) || host) : current.title,
    host,
    exporterUrl,
    "kind" in input ? kind(input.kind) : current.kind,
    "countryCode" in input ? countryCode(input.countryCode) : current.country_code,
    "active" in input ? (input.active === false ? 0 : 1) : current.active,
    "sortOrder" in input && Number.isFinite(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : current.sort_order,
    "uplinkMbps" in input
      ? (Number.isFinite(Number(input.uplinkMbps)) && Number(input.uplinkMbps) > 0 ? Number(input.uplinkMbps) : null)
      : current.uplink_mbps,
    id,
  );

  return { ok: true as const, item: getMonitoredServer(id)! };
}

export function deleteMonitoredServer(id: number) {
  return linkDb.prepare(`DELETE FROM monitored_servers WHERE id = ?`).run(id).changes > 0;
}
