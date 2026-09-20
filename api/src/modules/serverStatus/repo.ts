import { linkDb } from "../../shared/linkdb/db.js";
import { decryptSecret, encryptSecret, isCredentialsKeyConfigured } from "./crypto.js";
import { sanitizePerNodeThresholds } from "./settingsRepo.js";

export type ServerKind = "vpn" | "gateway" | "infra";
export type ServerVisibility = "public" | "admin_only";
export type ExporterAuthType = "none" | "basic";

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
  visibility: ServerVisibility;
  affects_public_health: number;
  node_exporter_enabled: number;
  exporter_auth_type: ExporterAuthType;
  exporter_username: string;
  exporter_password_encrypted: string | null;
  remnawave_integration_id: number | null;
  remnawave_node_uuid: string | null;
  thresholds_json: string | null;
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

/*
 * Monitoring 2.0 columns. Every step is idempotent and safe to re-run on a
 * legacy database: ADD COLUMN is attempted in its own try/catch (SQLite has no
 * IF NOT EXISTS for columns) and every index is created only after its column
 * exists, so a previous index-before-ALTER crash can never recur.
 */
function addColumn(sql: string) {
  try {
    linkDb.exec(sql);
  } catch {
    /* column already exists */
  }
}

addColumn(`ALTER TABLE monitored_servers ADD COLUMN country_code TEXT`);
addColumn(`ALTER TABLE monitored_servers ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'`);
addColumn(`ALTER TABLE monitored_servers ADD COLUMN affects_public_health INTEGER NOT NULL DEFAULT 1`);
addColumn(`ALTER TABLE monitored_servers ADD COLUMN node_exporter_enabled INTEGER NOT NULL DEFAULT 1`);
addColumn(`ALTER TABLE monitored_servers ADD COLUMN exporter_auth_type TEXT NOT NULL DEFAULT 'none'`);
addColumn(`ALTER TABLE monitored_servers ADD COLUMN exporter_username TEXT NOT NULL DEFAULT ''`);
addColumn(`ALTER TABLE monitored_servers ADD COLUMN exporter_password_encrypted TEXT`);
addColumn(`ALTER TABLE monitored_servers ADD COLUMN remnawave_integration_id INTEGER`);
addColumn(`ALTER TABLE monitored_servers ADD COLUMN remnawave_node_uuid TEXT`);
addColumn(`ALTER TABLE monitored_servers ADD COLUMN thresholds_json TEXT`);

linkDb.exec(`
CREATE INDEX IF NOT EXISTS idx_monitored_servers_visibility_active
  ON monitored_servers(visibility, active, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_monitored_servers_remnawave
  ON monitored_servers(remnawave_integration_id, remnawave_node_uuid);
`);

function kind(v: unknown): ServerKind {
  const s = String(v ?? "").trim();
  if (s === "infra") return "infra";
  if (s === "gateway") return "gateway";
  return "vpn";
}

function visibility(v: unknown): ServerVisibility {
  return String(v ?? "").trim() === "admin_only" ? "admin_only" : "public";
}

function exporterAuthType(v: unknown): ExporterAuthType {
  return String(v ?? "").trim() === "basic" ? "basic" : "none";
}

function clean(v: unknown, max = 300) {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function countryCode(v: unknown) {
  const code = clean(v, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function boolInt(v: unknown, fallback = 1) {
  if (v === undefined || v === null || v === "") return fallback;
  if (v === true || v === 1 || v === "1") return 1;
  if (v === false || v === 0 || v === "0") return 0;
  const s = String(v).trim().toLowerCase();
  if (["true", "yes", "on", "enabled"].includes(s)) return 1;
  if (["false", "no", "off", "disabled"].includes(s)) return 0;
  return fallback;
}

function exporterFromHost(host: string, exporterUrl?: string, nodeExporterEnabled = true) {
  const raw = clean(exporterUrl, 500);
  if (raw) return raw;
  if (!nodeExporterEnabled) return "";
  const h = clean(host, 260).replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  return h ? `http://${h}:9100/metrics` : "";
}

function uuid(v: unknown): string | null {
  const s = clean(v, 64);
  if (!s) return null;
  // Remnawave node UUIDs are stable identifiers; accept any sane id charset.
  return /^[A-Za-z0-9._:-]{4,64}$/.test(s) ? s : null;
}

export function listMonitoredServers(
  { includeInactive = false, visibility: vis }: { includeInactive?: boolean; visibility?: ServerVisibility } = {},
) {
  const where: string[] = [];
  if (!includeInactive) where.push("active = 1");
  if (vis) where.push("visibility = ?");
  const sql = `
    SELECT * FROM monitored_servers
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY kind = 'infra', kind = 'gateway', sort_order ASC, id ASC
  `;
  return (vis ? linkDb.prepare(sql).all(vis) : linkDb.prepare(sql).all()) as MonitoredServerRow[];
}

/** Servers that may appear in the user-facing Server Status page. */
export function listPublicServers() {
  return listMonitoredServers({ visibility: "public" });
}

/**
 * Servers that participate in aggregate public health: public ones plus hidden
 * ones explicitly marked `affects_public_health`. The hidden identity is never
 * exposed — only the aggregate state.
 */
export function listHealthServers() {
  return linkDb
    .prepare(`
      SELECT * FROM monitored_servers
      WHERE active = 1 AND (visibility = 'public' OR affects_public_health = 1)
      ORDER BY kind = 'infra', kind = 'gateway', sort_order ASC, id ASC
    `)
    .all() as MonitoredServerRow[];
}

export function getMonitoredServer(id: number) {
  return linkDb.prepare(`SELECT * FROM monitored_servers WHERE id = ?`).get(id) as MonitoredServerRow | undefined;
}

/** Public projection for admin API list (secrets stay server-side). */
export function toAdminServer(row: MonitoredServerRow) {
  const { exporter_password_encrypted, ...rest } = row;
  return {
    ...rest,
    hasExporterPassword: Boolean(exporter_password_encrypted),
  };
}

export function getExporterCredentials(row: MonitoredServerRow) {
  return {
    authType: row.exporter_auth_type,
    username: row.exporter_username || "",
    password: decryptSecret(row.exporter_password_encrypted),
  };
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
  visibility?: unknown;
  affectsPublicHealth?: unknown;
  nodeExporterEnabled?: unknown;
  exporterAuthType?: unknown;
  exporterUsername?: unknown;
  exporterPassword?: unknown;
  remnawaveIntegrationId?: unknown;
  remnawaveNodeUuid?: unknown;
  thresholds?: unknown;
  thresholdsJson?: unknown;
}) {
  const host = clean(input.host, 260);
  const title = clean(input.title, 160) || host;
  const nodeExporterEnabled = boolInt(input.nodeExporterEnabled, 1) === 1;
  const exporterUrl = exporterFromHost(host, clean(input.exporterUrl, 500), nodeExporterEnabled);
  if (!host) return { ok: false as const, error: "host_required" };
  if (nodeExporterEnabled && !exporterUrl) return { ok: false as const, error: "host_required" };
  if (clean(input.countryCode, 10) && !countryCode(input.countryCode)) {
    return { ok: false as const, error: "country_code_invalid" };
  }

  const authType = exporterAuthType(input.exporterAuthType);
  const password = clean(input.exporterPassword, 500);
  if (password && authType !== "basic") {
    return { ok: false as const, error: "exporter_password_requires_basic" };
  }
  if (password && !isCredentialsKeyConfigured() && process.env.NODE_ENV === "production") {
    return { ok: false as const, error: "credentials_key_missing" };
  }

  const thresholds = sanitizePerNodeThresholds(input.thresholdsJson ?? input.thresholds);
  if (!thresholds.ok) {
    return { ok: false as const, error: thresholds.error };
  }

  const info = linkDb.prepare(`
    INSERT INTO monitored_servers
      (title, host, exporter_url, kind, country_code, active, sort_order, uplink_mbps,
       visibility, affects_public_health, node_exporter_enabled, exporter_auth_type,
       exporter_username, exporter_password_encrypted, remnawave_integration_id,
       remnawave_node_uuid, thresholds_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title,
    host,
    exporterUrl,
    kind(input.kind),
    countryCode(input.countryCode),
    input.active === false ? 0 : 1,
    Number.isFinite(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : 100,
    Number.isFinite(Number(input.uplinkMbps)) && Number(input.uplinkMbps) > 0 ? Number(input.uplinkMbps) : null,
    visibility(input.visibility),
    boolInt(input.affectsPublicHealth, 1),
    nodeExporterEnabled ? 1 : 0,
    authType,
    clean(input.exporterUsername, 200),
    password ? encryptSecret(password) : null,
    Number.isFinite(Number(input.remnawaveIntegrationId)) && Number(input.remnawaveIntegrationId) > 0
      ? Math.trunc(Number(input.remnawaveIntegrationId))
      : null,
    uuid(input.remnawaveNodeUuid),
    thresholds.json,
  );

  return { ok: true as const, item: getMonitoredServer(Number(info.lastInsertRowid))! };
}

export function updateMonitoredServer(id: number, input: Record<string, unknown>) {
  const current = getMonitoredServer(id);
  if (!current) return { ok: false as const, error: "not_found" };

  const host = "host" in input ? clean(input.host, 260) : current.host;
  const nodeExporterEnabled =
    "nodeExporterEnabled" in input ? boolInt(input.nodeExporterEnabled, 1) === 1 : Number(current.node_exporter_enabled) === 1;
  const exporterUrl =
    "exporterUrl" in input || "host" in input || "nodeExporterEnabled" in input
      ? exporterFromHost(host, clean(input.exporterUrl ?? current.exporter_url, 500), nodeExporterEnabled)
      : current.exporter_url;
  if (!host) return { ok: false as const, error: "host_required" };
  if (nodeExporterEnabled && !exporterUrl) return { ok: false as const, error: "host_required" };
  if ("countryCode" in input && clean(input.countryCode, 10) && !countryCode(input.countryCode)) {
    return { ok: false as const, error: "country_code_invalid" };
  }

  const authType = "exporterAuthType" in input ? exporterAuthType(input.exporterAuthType) : current.exporter_auth_type;

  // Secret update semantics: empty/missing preserves, non-empty replaces,
  // clearExporterPassword removes.
  let passwordEncrypted = current.exporter_password_encrypted;
  if (input.clearExporterPassword === true) {
    passwordEncrypted = null;
  } else if ("exporterPassword" in input) {
    const password = clean(input.exporterPassword, 500);
    if (password) {
      if (authType !== "basic") return { ok: false as const, error: "exporter_password_requires_basic" };
      if (!isCredentialsKeyConfigured() && process.env.NODE_ENV === "production") {
        return { ok: false as const, error: "credentials_key_missing" };
      }
      passwordEncrypted = encryptSecret(password);
    }
  }
  if (authType === "none") passwordEncrypted = null;

  const remnawaveIntegrationId =
    "remnawaveIntegrationId" in input
      ? (Number.isFinite(Number(input.remnawaveIntegrationId)) && Number(input.remnawaveIntegrationId) > 0
          ? Math.trunc(Number(input.remnawaveIntegrationId))
          : null)
      : current.remnawave_integration_id;
  const remnawaveNodeUuid =
    "remnawaveNodeUuid" in input ? uuid(input.remnawaveNodeUuid) : current.remnawave_node_uuid;

  let thresholdsJson = current.thresholds_json;
  if ("thresholdsJson" in input || "thresholds" in input) {
    const sanitized = sanitizePerNodeThresholds(input.thresholdsJson ?? input.thresholds);
    if (!sanitized.ok) return { ok: false as const, error: sanitized.error };
    thresholdsJson = sanitized.json;
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
        visibility = ?,
        affects_public_health = ?,
        node_exporter_enabled = ?,
        exporter_auth_type = ?,
        exporter_username = ?,
        exporter_password_encrypted = ?,
        remnawave_integration_id = ?,
        remnawave_node_uuid = ?,
        thresholds_json = ?,
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
    "visibility" in input ? visibility(input.visibility) : current.visibility,
    "affectsPublicHealth" in input ? boolInt(input.affectsPublicHealth, current.affects_public_health) : current.affects_public_health,
    nodeExporterEnabled ? 1 : 0,
    authType,
    "exporterUsername" in input ? clean(input.exporterUsername, 200) : current.exporter_username,
    passwordEncrypted,
    remnawaveIntegrationId,
    remnawaveNodeUuid,
    thresholdsJson,
    id,
  );

  return { ok: true as const, item: getMonitoredServer(id)! };
}

export function deleteMonitoredServer(id: number) {
  return linkDb.prepare(`DELETE FROM monitored_servers WHERE id = ?`).run(id).changes > 0;
}