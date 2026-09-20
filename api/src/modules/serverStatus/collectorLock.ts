// api/src/modules/serverStatus/collectorLock.ts
//
// Single-active-collector lease.
//
// If the API is ever started with multiple replicas, only one of them may run
// the scrape/collector cycle, otherwise history would be written twice. This is
// a deliberately simple SQLite lease (not a distributed lock): one row, one
// owner, refreshed every cycle and considered expired if not renewed.

import os from "node:os";
import { linkDb } from "../../shared/linkdb/db.js";

linkDb.exec(`
CREATE TABLE IF NOT EXISTS monitoring_collector_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

let ownerId: string | null = null;

function instanceId() {
  if (!ownerId) {
    ownerId = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
  }
  return ownerId;
}

/**
 * Try to acquire/renew the collector lease.
 * @returns true when this instance owns the collector for the next window.
 */
export function acquireCollectorLease(ttlSec: number, now = Math.floor(Date.now() / 1000)): boolean {
  const owner = instanceId();
  const expiresAt = now + Math.max(30, ttlSec);

  const existing = linkDb.prepare(`SELECT owner, expires_at FROM monitoring_collector_lease WHERE id = 1`).get() as
    | { owner: string; expires_at: number }
    | undefined;

  if (!existing) {
    try {
      linkDb
        .prepare(`INSERT INTO monitoring_collector_lease (id, owner, expires_at) VALUES (1, ?, ?)`)
        .run(owner, expiresAt);
      return true;
    } catch {
      // Another instance inserted concurrently; fall through and re-check.
    }
  }

  const current = linkDb.prepare(`SELECT owner, expires_at FROM monitoring_collector_lease WHERE id = 1`).get() as
    | { owner: string; expires_at: number }
    | undefined;
  if (!current) return false;
  if (current.owner !== owner && current.expires_at > now) return false;

  const info = linkDb
    .prepare(`UPDATE monitoring_collector_lease SET owner = ?, expires_at = ?, updated_at = datetime('now') WHERE id = 1 AND (owner = ? OR expires_at <= ?)`)
    .run(owner, expiresAt, owner, now);
  return info.changes > 0;
}

export function releaseCollectorLease() {
  if (!ownerId) return;
  linkDb.prepare(`UPDATE monitoring_collector_lease SET expires_at = 0 WHERE id = 1 AND owner = ?`).run(ownerId);
}

export function collectorLeaseOwner() {
  const row = linkDb.prepare(`SELECT owner, expires_at FROM monitoring_collector_lease WHERE id = 1`).get() as
    | { owner: string; expires_at: number }
    | undefined;
  return row ?? null;
}