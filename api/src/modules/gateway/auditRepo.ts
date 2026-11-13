// api/src/modules/gateway/auditRepo.ts
//
// Append-only audit log of gateway routing mutations (phase 2). Every
// operational change records who did it, on which gateway/backend/server,
// the action, and before/after context.

import { linkDb } from "../../shared/linkdb/db.js";

linkDb.exec(`
CREATE TABLE IF NOT EXISTS gateway_route_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  admin_user_id INTEGER,
  gateway_id INTEGER NOT NULL,
  gateway_host TEXT NOT NULL,
  backend TEXT NOT NULL,
  server TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_gateway_route_changes_recent
  ON gateway_route_changes(id DESC);
`);

export type GatewayChangeInput = {
  adminUserId: number | null;
  gatewayId: number;
  gatewayHost: string;
  backend: string;
  server: string;
  action: string;
  detail?: Record<string, unknown>;
};

export type GatewayChangeRow = {
  id: number;
  created_at: string;
  admin_user_id: number | null;
  gateway_id: number;
  gateway_host: string;
  backend: string;
  server: string;
  action: string;
  detail: Record<string, unknown> | null;
};

export function recordGatewayChange(input: GatewayChangeInput): number {
  const info = linkDb
    .prepare(
      `INSERT INTO gateway_route_changes
         (admin_user_id, gateway_id, gateway_host, backend, server, action, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.adminUserId ?? null,
      input.gatewayId,
      input.gatewayHost,
      input.backend,
      input.server,
      input.action,
      input.detail ? JSON.stringify(input.detail) : null,
    );
  return Number(info.lastInsertRowid);
}

export function listGatewayChanges(gatewayId: number, limit = 50): GatewayChangeRow[] {
  const rows = linkDb
    .prepare(
      `SELECT * FROM gateway_route_changes
       WHERE gateway_id = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(gatewayId, Math.max(1, Math.min(200, Math.trunc(limit)))) as any[];

  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    admin_user_id: r.admin_user_id ?? null,
    gateway_id: r.gateway_id,
    gateway_host: r.gateway_host,
    backend: r.backend,
    server: r.server,
    action: r.action,
    detail: safeParse(r.detail_json),
  }));
}

function safeParse(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string" || !text) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
