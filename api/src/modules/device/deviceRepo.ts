import { linkDb } from "../../shared/linkdb/db.js";

export type DeviceRow = {
  id: number;
  device_token: string;
  first_seen_at: number;
  last_seen_at: number;
  first_ip: string | null;
  last_ip: string | null;
  user_agent: string | null;
  trial_used_at: number | null;
  trial_user_id: number | null;
};

let inited = false;

export function ensureDeviceTables() {
  if (inited) return;

  linkDb.exec(`
    CREATE TABLE IF NOT EXISTS trial_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_token TEXT NOT NULL UNIQUE,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      first_ip TEXT,
      last_ip TEXT,
      user_agent TEXT,
      trial_used_at INTEGER,
      trial_user_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS trial_protection_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      device_token TEXT,
      user_id INTEGER,
      ip TEXT,
      user_agent TEXT,
      event_type TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT,
      meta_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_trial_devices_token
      ON trial_devices(device_token);

    CREATE INDEX IF NOT EXISTS idx_trial_events_created_at
      ON trial_protection_events(created_at);

    CREATE INDEX IF NOT EXISTS idx_trial_events_device_token
      ON trial_protection_events(device_token);
  `);

  inited = true;
}

export function getDeviceByToken(deviceToken: string): DeviceRow | null {
  ensureDeviceTables();

  const row = linkDb
    .prepare(`SELECT * FROM trial_devices WHERE device_token = ? LIMIT 1`)
    .get(deviceToken) as DeviceRow | undefined;

  return row ?? null;
}

export function createDevice(input: {
  deviceToken: string;
  now: number;
  ip?: string | null;
  userAgent?: string | null;
}) {
  ensureDeviceTables();

  linkDb
    .prepare(`
      INSERT INTO trial_devices (
        device_token, first_seen_at, last_seen_at, first_ip, last_ip, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.deviceToken,
      input.now,
      input.now,
      input.ip ?? null,
      input.ip ?? null,
      input.userAgent ?? null
    );
}

export function touchDevice(input: {
  deviceToken: string;
  now: number;
  ip?: string | null;
  userAgent?: string | null;
}) {
  ensureDeviceTables();

  linkDb
    .prepare(`
      UPDATE trial_devices
      SET last_seen_at = ?,
          last_ip = ?,
          user_agent = COALESCE(?, user_agent)
      WHERE device_token = ?
    `)
    .run(
      input.now,
      input.ip ?? null,
      input.userAgent ?? null,
      input.deviceToken
    );
}

export function markDeviceTrialUsed(input: {
  deviceToken: string;
  now: number;
  userId?: number | null;
}) {
  ensureDeviceTables();

  linkDb
    .prepare(`
      UPDATE trial_devices
      SET trial_used_at = ?,
          trial_user_id = COALESCE(?, trial_user_id)
      WHERE device_token = ?
    `)
    .run(input.now, input.userId ?? null, input.deviceToken);
}

export function resetDeviceTrialUsage(deviceToken: string) {
  ensureDeviceTables();

  linkDb
    .prepare(`
      UPDATE trial_devices
      SET trial_used_at = NULL,
          trial_user_id = NULL
      WHERE device_token = ?
    `)
    .run(deviceToken);
}

export function resetExpiredDeviceTrialUsage(cutoffTs: number) {
  ensureDeviceTables();

  linkDb
    .prepare(`
      UPDATE trial_devices
      SET trial_used_at = NULL,
          trial_user_id = NULL
      WHERE trial_used_at IS NOT NULL
        AND trial_used_at < ?
    `)
    .run(cutoffTs);
}

export function listTrialDevices(limit: number) {
  ensureDeviceTables();

  return linkDb
    .prepare(`
      SELECT
        id,
        device_token,
        first_seen_at,
        last_seen_at,
        first_ip,
        last_ip,
        user_agent,
        trial_used_at,
        trial_user_id
      FROM trial_devices
      ORDER BY last_seen_at DESC, id DESC
      LIMIT ?
    `)
    .all(limit);
}

export function insertTrialProtectionEvent(input: {
  createdAt: number;
  deviceToken?: string | null;
  userId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  eventType: string;
  decision: "allow" | "observe" | "block";
  reason?: string | null;
  metaJson?: string | null;
}) {
  ensureDeviceTables();

  linkDb
    .prepare(`
      INSERT INTO trial_protection_events (
        created_at, device_token, user_id, ip, user_agent,
        event_type, decision, reason, meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.createdAt,
      input.deviceToken ?? null,
      input.userId ?? null,
      input.ip ?? null,
      input.userAgent ?? null,
      input.eventType,
      input.decision,
      input.reason ?? null,
      input.metaJson ?? null
    );
}