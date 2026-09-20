// api/src/modules/serverStatus/integrationsRepo.ts
//
// Monitoring integrations (Remnawave metrics/API, generic node_exporter).
// Secrets are stored encrypted (see ./crypto.ts) and are never returned by the
// API. Read models expose only `hasPassword` / `hasApiToken` flags.

import { linkDb } from "../../shared/linkdb/db.js";
import { decryptSecret, encryptSecret, isCredentialsKeyConfigured } from "./crypto.js";

export type IntegrationType = "remnawave" | "node_exporter";

export type MonitoringIntegrationRow = {
  id: number;
  name: string;
  type: IntegrationType;
  enabled: number;
  base_url: string;
  metrics_url: string;
  api_url: string;
  username: string;
  password_encrypted: string | null;
  api_token_encrypted: string | null;
  created_at: string;
  updated_at: string;
  last_check_at: string | null;
  last_check_status: string | null;
  last_error_code: string | null;
};

export type MonitoringIntegrationPublic = {
  id: number;
  name: string;
  type: IntegrationType;
  enabled: boolean;
  baseUrl: string;
  metricsUrl: string;
  apiUrl: string;
  username: string;
  hasPassword: boolean;
  hasApiToken: boolean;
  createdAt: string;
  updatedAt: string;
  lastCheckAt: string | null;
  lastCheckStatus: string | null;
  lastErrorCode: string | null;
};

linkDb.exec(`
CREATE TABLE IF NOT EXISTS monitoring_integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'remnawave',
  enabled INTEGER NOT NULL DEFAULT 1,
  base_url TEXT NOT NULL DEFAULT '',
  metrics_url TEXT NOT NULL DEFAULT '',
  api_url TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  password_encrypted TEXT,
  api_token_encrypted TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_check_at TEXT,
  last_check_status TEXT,
  last_error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_monitoring_integrations_type_enabled
  ON monitoring_integrations(type, enabled, id);
`);

function clean(v: unknown, max = 500) {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function integrationType(v: unknown): IntegrationType {
  return String(v ?? "").trim() === "node_exporter" ? "node_exporter" : "remnawave";
}

function normalizeUrl(v: unknown, max = 500) {
  const s = clean(v, max);
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return s;
  } catch {
    return "";
  }
}

export function toPublicIntegration(row: MonitoringIntegrationRow): MonitoringIntegrationPublic {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: Number(row.enabled) === 1,
    baseUrl: row.base_url,
    metricsUrl: row.metrics_url,
    apiUrl: row.api_url,
    username: row.username,
    // Only presence flags leave the server. Plaintext never does.
    hasPassword: Boolean(row.password_encrypted),
    hasApiToken: Boolean(row.api_token_encrypted),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckAt: row.last_check_at,
    lastCheckStatus: row.last_check_status,
    lastErrorCode: row.last_error_code,
  };
}

export function listIntegrations({ includeDisabled = true }: { includeDisabled?: boolean } = {}) {
  const sql = `
    SELECT * FROM monitoring_integrations
    ${includeDisabled ? "" : "WHERE enabled = 1"}
    ORDER BY enabled DESC, id ASC
  `;
  return linkDb.prepare(sql).all() as MonitoringIntegrationRow[];
}

export function listPublicIntegrations() {
  return listIntegrations().map(toPublicIntegration);
}

export function getIntegration(id: number) {
  return linkDb.prepare(`SELECT * FROM monitoring_integrations WHERE id = ?`).get(id) as
    | MonitoringIntegrationRow
    | undefined;
}

export function getIntegrationCredentials(row: MonitoringIntegrationRow) {
  const password = row.password_encrypted ? decryptSecret(row.password_encrypted) : null;
  const apiToken = row.api_token_encrypted ? decryptSecret(row.api_token_encrypted) : null;
  return {
    username: row.username || "",
    password,
    apiToken,
    // Ciphertext exists but could not be decrypted (wrong/changed/missing
    // master key). Callers must surface `credential_decrypt_failed`, never a raw
    // crypto error and never the ciphertext.
    passwordDecryptFailed: Boolean(row.password_encrypted) && password === null,
    apiTokenDecryptFailed: Boolean(row.api_token_encrypted) && apiToken === null,
  };
}

export function createIntegration(input: Record<string, unknown>) {
  const name = clean(input.name, 120) || "Remnawave";
  const type = integrationType(input.type);
  const baseUrl = normalizeUrl(input.baseUrl, 500);
  const metricsUrl = normalizeUrl(input.metricsUrl, 500);
  const apiUrl = normalizeUrl(input.apiUrl, 500);
  const username = clean(input.username, 200);

  if (type === "remnawave" && !metricsUrl && !baseUrl) {
    return { ok: false as const, error: "metrics_url_required" };
  }
  if (type === "node_exporter" && !metricsUrl && !baseUrl) {
    return { ok: false as const, error: "metrics_url_required" };
  }

  const password = clean(input.password, 500);
  const apiToken = clean(input.apiToken, 4000);

  if ((password || apiToken) && !isCredentialsKeyConfigured() && process.env.NODE_ENV === "production") {
    return { ok: false as const, error: "credentials_key_missing" };
  }

  const info = linkDb.prepare(`
    INSERT INTO monitoring_integrations
      (name, type, enabled, base_url, metrics_url, api_url, username, password_encrypted, api_token_encrypted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    type,
    input.enabled === false ? 0 : 1,
    baseUrl,
    metricsUrl,
    apiUrl,
    username,
    password ? encryptSecret(password) : null,
    apiToken ? encryptSecret(apiToken) : null,
  );

  return { ok: true as const, item: getIntegration(Number(info.lastInsertRowid))! };
}

export function updateIntegration(id: number, input: Record<string, unknown>) {
  const current = getIntegration(id);
  if (!current) return { ok: false as const, error: "not_found" };

  const type = "type" in input ? integrationType(input.type) : current.type;

  // Secret update semantics: omitted/empty input preserves the stored secret;
  // a non-empty value replaces it. `clearPassword`/`clearApiToken` remove it.
  let passwordEncrypted = current.password_encrypted;
  if (input.clearPassword === true) {
    passwordEncrypted = null;
  } else if ("password" in input) {
    const password = clean(input.password, 500);
    if (password) {
      if (!isCredentialsKeyConfigured() && process.env.NODE_ENV === "production") {
        return { ok: false as const, error: "credentials_key_missing" };
      }
      passwordEncrypted = encryptSecret(password);
    }
  }

  let apiTokenEncrypted = current.api_token_encrypted;
  if (input.clearApiToken === true) {
    apiTokenEncrypted = null;
  } else if ("apiToken" in input) {
    const apiToken = clean(input.apiToken, 4000);
    if (apiToken) {
      if (!isCredentialsKeyConfigured() && process.env.NODE_ENV === "production") {
        return { ok: false as const, error: "credentials_key_missing" };
      }
      apiTokenEncrypted = encryptSecret(apiToken);
    }
  }

  linkDb.prepare(`
    UPDATE monitoring_integrations
    SET name = ?,
        type = ?,
        enabled = ?,
        base_url = ?,
        metrics_url = ?,
        api_url = ?,
        username = ?,
        password_encrypted = ?,
        api_token_encrypted = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    "name" in input ? (clean(input.name, 120) || current.name) : current.name,
    type,
    "enabled" in input ? (input.enabled === false ? 0 : 1) : current.enabled,
    "baseUrl" in input ? normalizeUrl(input.baseUrl, 500) : current.base_url,
    "metricsUrl" in input ? normalizeUrl(input.metricsUrl, 500) : current.metrics_url,
    "apiUrl" in input ? normalizeUrl(input.apiUrl, 500) : current.api_url,
    "username" in input ? clean(input.username, 200) : current.username,
    passwordEncrypted,
    apiTokenEncrypted,
    id,
  );

  return { ok: true as const, item: getIntegration(id)! };
}

export function deleteIntegration(id: number) {
  return linkDb.prepare(`DELETE FROM monitoring_integrations WHERE id = ?`).run(id).changes > 0;
}

export function recordIntegrationCheck(id: number, status: string, errorCode: string | null = null) {
  linkDb.prepare(`
    UPDATE monitoring_integrations
    SET last_check_at = datetime('now'),
        last_check_status = ?,
        last_error_code = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(clean(status, 40), errorCode ? clean(errorCode, 80) : null, id);
}