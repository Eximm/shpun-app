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
  last_user_id: number | null;
  is_blocked: number | null;
};

export type TrialDeviceUsageRow = {
  id: number;
  device_token: string;
  trial_group: string;
  used_at: number;
  user_id: number | null;
  service_id: number | null;
};

export type TrialPrefixStatsRow = {
  ipPrefix: string;
  devicesCount: number;
  blockedDevices: number;
  distinctUsers: number;
  attempts24h: number;
  lastSeenAt: number | null;
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
      trial_user_id INTEGER,
      last_user_id INTEGER,
      is_blocked INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS trial_device_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_token TEXT NOT NULL,
      trial_group TEXT NOT NULL,
      used_at INTEGER NOT NULL,
      user_id INTEGER,
      service_id INTEGER
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_trial_usage_device_group_unique
      ON trial_device_usage(device_token, trial_group);

    CREATE INDEX IF NOT EXISTS idx_trial_usage_device_token
      ON trial_device_usage(device_token);

    CREATE INDEX IF NOT EXISTS idx_trial_usage_trial_group
      ON trial_device_usage(trial_group);

    CREATE INDEX IF NOT EXISTS idx_trial_usage_used_at
      ON trial_device_usage(used_at);

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

    CREATE INDEX IF NOT EXISTS idx_trial_devices_last_ip
      ON trial_devices(last_ip);

    CREATE INDEX IF NOT EXISTS idx_trial_devices_first_ip
      ON trial_devices(first_ip);

    CREATE INDEX IF NOT EXISTS idx_trial_devices_last_seen_at
      ON trial_devices(last_seen_at);

    CREATE INDEX IF NOT EXISTS idx_trial_events_created_at
      ON trial_protection_events(created_at);

    CREATE INDEX IF NOT EXISTS idx_trial_events_device_token
      ON trial_protection_events(device_token);

    CREATE INDEX IF NOT EXISTS idx_trial_events_ip
      ON trial_protection_events(ip);

    CREATE INDEX IF NOT EXISTS idx_trial_events_ip_created_at
      ON trial_protection_events(ip, created_at);

    CREATE INDEX IF NOT EXISTS idx_trial_events_event_type_created_at
      ON trial_protection_events(event_type, created_at);

    CREATE INDEX IF NOT EXISTS idx_trial_events_reason_created_at
      ON trial_protection_events(reason, created_at);
  `);

  try {
    linkDb.exec(`
      ALTER TABLE trial_devices
      ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0
    `);
  } catch {}

  try {
    linkDb.exec(`
      ALTER TABLE trial_devices
      ADD COLUMN last_user_id INTEGER
    `);
  } catch {}

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
      input.userAgent ?? null,
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
          last_ip = COALESCE(?, last_ip),
          user_agent = COALESCE(?, user_agent)
      WHERE device_token = ?
    `)
    .run(
      input.now,
      input.ip ?? null,
      input.userAgent ?? null,
      input.deviceToken,
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
          trial_user_id = COALESCE(?, trial_user_id),
          last_user_id = COALESCE(?, last_user_id)
      WHERE device_token = ?
    `)
    .run(input.now, input.userId ?? null, input.userId ?? null, input.deviceToken);
}

export function markDeviceSeenByUser(input: {
  deviceToken: string;
  userId?: number | null;
}) {
  ensureDeviceTables();

  if (!input.userId) return;

  linkDb
    .prepare(`
      UPDATE trial_devices
      SET last_user_id = ?
      WHERE device_token = ?
    `)
    .run(input.userId, input.deviceToken);
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

export function getTrialUsageByDeviceAndGroup(
  deviceToken: string,
  trialGroup: string,
): TrialDeviceUsageRow | null {
  ensureDeviceTables();

  const row = linkDb
    .prepare(`
      SELECT *
      FROM trial_device_usage
      WHERE device_token = ?
        AND trial_group = ?
      LIMIT 1
    `)
    .get(deviceToken, trialGroup) as TrialDeviceUsageRow | undefined;

  return row ?? null;
}

export function upsertTrialUsage(input: {
  deviceToken: string;
  trialGroup: string;
  usedAt: number;
  userId?: number | null;
  serviceId?: number | null;
}) {
  ensureDeviceTables();

  linkDb
    .prepare(`
      INSERT INTO trial_device_usage (
        device_token, trial_group, used_at, user_id, service_id
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(device_token, trial_group) DO UPDATE SET
        used_at = excluded.used_at,
        user_id = COALESCE(excluded.user_id, trial_device_usage.user_id),
        service_id = COALESCE(excluded.service_id, trial_device_usage.service_id)
    `)
    .run(
      input.deviceToken,
      input.trialGroup,
      input.usedAt,
      input.userId ?? null,
      input.serviceId ?? null,
    );

  if (input.userId) {
    markDeviceSeenByUser({ deviceToken: input.deviceToken, userId: input.userId });
  }
}

export function deleteTrialUsageByDeviceAndGroup(
  deviceToken: string,
  trialGroup: string,
) {
  ensureDeviceTables();

  linkDb
    .prepare(`
      DELETE FROM trial_device_usage
      WHERE device_token = ?
        AND trial_group = ?
    `)
    .run(deviceToken, trialGroup);
}

export function deleteExpiredTrialUsage(cutoffTs: number) {
  ensureDeviceTables();

  linkDb
    .prepare(`
      DELETE FROM trial_device_usage
      WHERE used_at < ?
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
        trial_user_id,
        last_user_id,
        is_blocked
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
      input.metaJson ?? null,
    );

  if (input.deviceToken && input.userId) {
    markDeviceSeenByUser({
      deviceToken: input.deviceToken,
      userId: input.userId,
    });
  }
}

export function deleteAllTrialUsageByDevice(deviceToken: string) {
  ensureDeviceTables();

  linkDb
    .prepare(`
      DELETE FROM trial_device_usage
      WHERE device_token = ?
    `)
    .run(deviceToken);
}

export function deleteTrialProtectionEventsByDevice(deviceToken: string): number {
  ensureDeviceTables();

  const token = String(deviceToken ?? "").trim();
  if (!token) return 0;

  const result = linkDb
    .prepare(`
      DELETE FROM trial_protection_events
      WHERE device_token = ?
    `)
    .run(token);

  return Number(result?.changes ?? 0);
}

export function deleteDeviceByToken(deviceToken: string): number {
  ensureDeviceTables();

  const token = String(deviceToken ?? "").trim();
  if (!token) return 0;

  const result = linkDb
    .prepare(`
      DELETE FROM trial_devices
      WHERE device_token = ?
    `)
    .run(token);

  return Number(result?.changes ?? 0);
}

export function deleteDeviceCompletely(deviceToken: string) {
  ensureDeviceTables();

  const token = String(deviceToken ?? "").trim();
  if (!token) {
    return {
      deletedDevice: 0,
      deletedUsage: 0,
      deletedEvents: 0,
    };
  }

  const tx = linkDb.transaction((safeToken: string) => {
    const usageResult = linkDb
      .prepare(`
        DELETE FROM trial_device_usage
        WHERE device_token = ?
      `)
      .run(safeToken);

    const eventsResult = linkDb
      .prepare(`
        DELETE FROM trial_protection_events
        WHERE device_token = ?
      `)
      .run(safeToken);

    const deviceResult = linkDb
      .prepare(`
        DELETE FROM trial_devices
        WHERE device_token = ?
      `)
      .run(safeToken);

    return {
      deletedDevice: Number(deviceResult?.changes ?? 0),
      deletedUsage: Number(usageResult?.changes ?? 0),
      deletedEvents: Number(eventsResult?.changes ?? 0),
    };
  });

  return tx(token);
}

export function setDeviceBlocked(deviceToken: string, isBlocked: boolean) {
  ensureDeviceTables();

  linkDb
    .prepare(`
      UPDATE trial_devices
      SET is_blocked = ?
      WHERE device_token = ?
    `)
    .run(isBlocked ? 1 : 0, deviceToken);
}

export function listTrialDevicesWithUsage(limit: number) {
  ensureDeviceTables();

  return linkDb
    .prepare(`
      SELECT
        d.id,
        d.device_token,
        d.first_seen_at,
        d.last_seen_at,
        d.first_ip,
        d.last_ip,
        d.user_agent,
        d.trial_used_at,
        d.trial_user_id,
        d.last_user_id,
        d.is_blocked,
        COUNT(u.id) AS active_trial_count,
        MAX(u.used_at) AS last_trial_used_at
      FROM trial_devices d
      LEFT JOIN trial_device_usage u
        ON u.device_token = d.device_token
      GROUP BY
        d.id,
        d.device_token,
        d.first_seen_at,
        d.last_seen_at,
        d.first_ip,
        d.last_ip,
        d.user_agent,
        d.trial_used_at,
        d.trial_user_id,
        d.last_user_id,
        d.is_blocked
      ORDER BY d.last_seen_at DESC, d.id DESC
      LIMIT ?
    `)
    .all(limit);
}

export function getIpPrefix(ip: string): string {
  const v = String(ip ?? "").trim();
  if (!v) return "";

  if (v.includes(".")) {
    const parts = v.split(".");
    if (parts.length === 4) return parts.slice(0, 3).join(".");
  }

  if (v.includes(":")) {
    const parts = v.split(":");
    return parts.slice(0, 4).join(":");
  }

  return v;
}

export function getRecentTrialUsageByIpAndGroup(input: {
  ip: string;
  trialGroup: string;
  sinceTs: number;
  excludeDeviceToken?: string | null;
}): TrialDeviceUsageRow | null {
  ensureDeviceTables();

  if (!input.ip || !input.trialGroup) return null;

  const row = linkDb
    .prepare(`
      SELECT
        u.id,
        u.device_token,
        u.trial_group,
        u.used_at,
        u.user_id,
        u.service_id
      FROM trial_device_usage u
      INNER JOIN trial_devices d
        ON d.device_token = u.device_token
      WHERE u.trial_group = ?
        AND u.used_at >= ?
        AND (
          d.last_ip = ?
          OR d.first_ip = ?
        )
        AND (? IS NULL OR u.device_token != ?)
      ORDER BY u.used_at DESC
      LIMIT 1
    `)
    .get(
      input.trialGroup,
      input.sinceTs,
      input.ip,
      input.ip,
      input.excludeDeviceToken ?? null,
      input.excludeDeviceToken ?? null,
    ) as TrialDeviceUsageRow | undefined;

  return row ?? null;
}

export function countRecentTrialUsageByIpPrefix(input: {
  ipPrefix: string;
  trialGroup: string;
  sinceTs: number;
  excludeDeviceToken?: string | null;
}): number {
  ensureDeviceTables();

  if (!input.ipPrefix || !input.trialGroup) return 0;

  const row = linkDb
    .prepare(`
      SELECT COUNT(*) as cnt
      FROM trial_device_usage u
      INNER JOIN trial_devices d
        ON d.device_token = u.device_token
      WHERE u.trial_group = ?
        AND u.used_at >= ?
        AND (
          d.last_ip LIKE ?
          OR d.first_ip LIKE ?
        )
        AND (? IS NULL OR u.device_token != ?)
    `)
    .get(
      input.trialGroup,
      input.sinceTs,
      `${input.ipPrefix}%`,
      `${input.ipPrefix}%`,
      input.excludeDeviceToken ?? null,
      input.excludeDeviceToken ?? null,
    ) as { cnt?: number } | undefined;

  return Number(row?.cnt ?? 0);
}

export function countRecentTrialAttemptsByIpPrefix(input: {
  ipPrefix: string;
  sinceTs: number;
  trialGroup?: string | null;
}): number {
  ensureDeviceTables();

  if (!input.ipPrefix) return 0;

  const trialGroup = String(input.trialGroup ?? "").trim();

  if (trialGroup) {
    const row = linkDb
      .prepare(`
        SELECT COUNT(*) as cnt
        FROM trial_protection_events
        WHERE event_type = 'trial_group_check'
          AND created_at >= ?
          AND ip LIKE ?
          AND json_extract(meta_json, '$.trialGroup') = ?
      `)
      .get(input.sinceTs, `${input.ipPrefix}%`, trialGroup) as
      | { cnt?: number }
      | undefined;

    return Number(row?.cnt ?? 0);
  }

  const row = linkDb
    .prepare(`
      SELECT COUNT(*) as cnt
      FROM trial_protection_events
      WHERE event_type = 'trial_group_check'
        AND created_at >= ?
        AND ip LIKE ?
    `)
    .get(input.sinceTs, `${input.ipPrefix}%`) as { cnt?: number } | undefined;

  return Number(row?.cnt ?? 0);
}

export function countRecentDistinctDevicesByIpPrefix(input: {
  ipPrefix: string;
  sinceTs: number;
}): number {
  ensureDeviceTables();

  if (!input.ipPrefix) return 0;

  const row = linkDb
    .prepare(`
      SELECT COUNT(DISTINCT device_token) as cnt
      FROM trial_devices
      WHERE last_seen_at >= ?
        AND (
          last_ip LIKE ?
          OR first_ip LIKE ?
        )
    `)
    .get(input.sinceTs, `${input.ipPrefix}%`, `${input.ipPrefix}%`) as
    | { cnt?: number }
    | undefined;

  return Number(row?.cnt ?? 0);
}

export function countRecentTrialAttemptsByIpPrefixAndUserAgent(input: {
  ipPrefix: string;
  userAgent: string;
  sinceTs: number;
  trialGroup?: string | null;
}): number {
  ensureDeviceTables();

  if (!input.ipPrefix || !input.userAgent) return 0;

  const trialGroup = String(input.trialGroup ?? "").trim();

  if (trialGroup) {
    const row = linkDb
      .prepare(`
        SELECT COUNT(*) as cnt
        FROM trial_protection_events
        WHERE event_type = 'trial_group_check'
          AND created_at >= ?
          AND ip LIKE ?
          AND user_agent = ?
          AND json_extract(meta_json, '$.trialGroup') = ?
      `)
      .get(
        input.sinceTs,
        `${input.ipPrefix}%`,
        input.userAgent,
        trialGroup,
      ) as { cnt?: number } | undefined;

    return Number(row?.cnt ?? 0);
  }

  const row = linkDb
    .prepare(`
      SELECT COUNT(*) as cnt
      FROM trial_protection_events
      WHERE event_type = 'trial_group_check'
        AND created_at >= ?
        AND ip LIKE ?
        AND user_agent = ?
    `)
    .get(
      input.sinceTs,
      `${input.ipPrefix}%`,
      input.userAgent,
    ) as { cnt?: number } | undefined;

  return Number(row?.cnt ?? 0);
}

export function countDistinctUsersByIpPrefix(input: {
  ipPrefix: string;
  sinceTs: number;
  trialGroup?: string | null;
}): number {
  ensureDeviceTables();

  if (!input.ipPrefix) return 0;

  const trialGroup = String(input.trialGroup ?? "").trim();

  if (trialGroup) {
    const row = linkDb
      .prepare(`
        SELECT COUNT(DISTINCT u.user_id) as cnt
        FROM trial_device_usage u
        INNER JOIN trial_devices d
          ON d.device_token = u.device_token
        WHERE u.used_at >= ?
          AND u.user_id IS NOT NULL
          AND u.trial_group = ?
          AND (
            d.last_ip LIKE ?
            OR d.first_ip LIKE ?
          )
      `)
      .get(
        input.sinceTs,
        trialGroup,
        `${input.ipPrefix}%`,
        `${input.ipPrefix}%`,
      ) as { cnt?: number } | undefined;

    return Number(row?.cnt ?? 0);
  }

  const row = linkDb
    .prepare(`
      SELECT COUNT(DISTINCT u.user_id) as cnt
      FROM trial_device_usage u
      INNER JOIN trial_devices d
        ON d.device_token = u.device_token
      WHERE u.used_at >= ?
        AND u.user_id IS NOT NULL
        AND (
          d.last_ip LIKE ?
          OR d.first_ip LIKE ?
        )
    `)
    .get(
      input.sinceTs,
      `${input.ipPrefix}%`,
      `${input.ipPrefix}%`,
    ) as { cnt?: number } | undefined;

  return Number(row?.cnt ?? 0);
}

export function listDeviceTokensByIpPrefix(ipPrefix: string): string[] {
  ensureDeviceTables();

  const prefix = String(ipPrefix ?? "").trim();
  if (!prefix) return [];

  const rows = linkDb
    .prepare(`
      SELECT DISTINCT device_token
      FROM trial_devices
      WHERE (
        last_ip LIKE ?
        OR first_ip LIKE ?
      )
        AND device_token IS NOT NULL
        AND device_token != ''
    `)
    .all(`${prefix}%`, `${prefix}%`) as Array<{ device_token?: string }>;

  return rows
    .map((row) => String(row?.device_token ?? "").trim())
    .filter(Boolean);
}

export function deleteAllTrialUsageByDeviceTokens(deviceTokens: string[]): number {
  ensureDeviceTables();

  const tokens = Array.from(new Set(deviceTokens.map((x) => String(x ?? "").trim()).filter(Boolean)));
  if (tokens.length === 0) return 0;

  const placeholders = tokens.map(() => "?").join(", ");
  const result = linkDb
    .prepare(`
      DELETE FROM trial_device_usage
      WHERE device_token IN (${placeholders})
    `)
    .run(...tokens);

  return Number(result?.changes ?? 0);
}

export function resetTrialUsageByDeviceTokens(deviceTokens: string[]): number {
  ensureDeviceTables();

  const tokens = Array.from(new Set(deviceTokens.map((x) => String(x ?? "").trim()).filter(Boolean)));
  if (tokens.length === 0) return 0;

  const placeholders = tokens.map(() => "?").join(", ");
  const result = linkDb
    .prepare(`
      UPDATE trial_devices
      SET trial_used_at = NULL,
          trial_user_id = NULL
      WHERE device_token IN (${placeholders})
    `)
    .run(...tokens);

  return Number(result?.changes ?? 0);
}

export function setDevicesBlockedByTokens(deviceTokens: string[], isBlocked: boolean): number {
  ensureDeviceTables();

  const tokens = Array.from(new Set(deviceTokens.map((x) => String(x ?? "").trim()).filter(Boolean)));
  if (tokens.length === 0) return 0;

  const placeholders = tokens.map(() => "?").join(", ");
  const result = linkDb
    .prepare(`
      UPDATE trial_devices
      SET is_blocked = ?
      WHERE device_token IN (${placeholders})
    `)
    .run(isBlocked ? 1 : 0, ...tokens);

  return Number(result?.changes ?? 0);
}

export function deleteTrialProtectionEventsByIpPrefix(input: {
  ipPrefix: string;
  sinceTs?: number | null;
}): number {
  ensureDeviceTables();

  const prefix = String(input.ipPrefix ?? "").trim();
  if (!prefix) return 0;

  if (input.sinceTs != null) {
    const result = linkDb
      .prepare(`
        DELETE FROM trial_protection_events
        WHERE ip LIKE ?
          AND created_at >= ?
      `)
      .run(`${prefix}%`, input.sinceTs);

    return Number(result?.changes ?? 0);
  }

  const result = linkDb
    .prepare(`
      DELETE FROM trial_protection_events
      WHERE ip LIKE ?
    `)
    .run(`${prefix}%`);

  return Number(result?.changes ?? 0);
}

export function listObservedIpPrefixes(input?: {
  sinceTs?: number | null;
  limit?: number | null;
}): TrialPrefixStatsRow[] {
  ensureDeviceTables();

  const sinceTs = Number(input?.sinceTs ?? 0);
  const limit = Math.max(1, Math.min(Number(input?.limit ?? 20), 200));

  const deviceRows = linkDb
    .prepare(`
      SELECT
        d.device_token,
        COALESCE(d.last_ip, d.first_ip, '') as ip,
        d.is_blocked,
        d.last_seen_at
      FROM trial_devices d
      WHERE COALESCE(d.last_ip, d.first_ip, '') != ''
        AND d.last_seen_at >= ?
      ORDER BY d.last_seen_at DESC
    `)
    .all(sinceTs) as Array<{
      device_token?: string;
      ip?: string;
      is_blocked?: number;
      last_seen_at?: number | null;
    }>;

  const grouped = new Map<string, TrialPrefixStatsRow>();

  for (const row of deviceRows) {
    const ip = String(row?.ip ?? "").trim();
    const ipPrefix = getIpPrefix(ip);
    if (!ipPrefix) continue;

    const existing = grouped.get(ipPrefix) ?? {
      ipPrefix,
      devicesCount: 0,
      blockedDevices: 0,
      distinctUsers: 0,
      attempts24h: 0,
      lastSeenAt: null,
    };

    existing.devicesCount += 1;

    if (Number(row?.is_blocked ?? 0) === 1) {
      existing.blockedDevices += 1;
    }

    const lastSeenAt = Number(row?.last_seen_at ?? 0) || null;
    if (lastSeenAt && (!existing.lastSeenAt || lastSeenAt > existing.lastSeenAt)) {
      existing.lastSeenAt = lastSeenAt;
    }

    grouped.set(ipPrefix, existing);
  }

  const usageRows = linkDb
    .prepare(`
      SELECT DISTINCT
        COALESCE(d.last_ip, d.first_ip, '') as ip,
        u.user_id
      FROM trial_device_usage u
      INNER JOIN trial_devices d
        ON d.device_token = u.device_token
      WHERE u.used_at >= ?
        AND u.user_id IS NOT NULL
        AND COALESCE(d.last_ip, d.first_ip, '') != ''
    `)
    .all(sinceTs) as Array<{ ip?: string; user_id?: number | null }>;

  const usersByPrefix = new Map<string, Set<number>>();

  for (const row of usageRows) {
    const ipPrefix = getIpPrefix(String(row?.ip ?? "").trim());
    const userId = Number(row?.user_id ?? 0);
    if (!ipPrefix || !userId) continue;

    if (!usersByPrefix.has(ipPrefix)) {
      usersByPrefix.set(ipPrefix, new Set<number>());
    }
    usersByPrefix.get(ipPrefix)!.add(userId);
  }

  const attemptsRows = linkDb
    .prepare(`
      SELECT ip, COUNT(*) as cnt
      FROM trial_protection_events
      WHERE event_type = 'trial_group_check'
        AND created_at >= ?
        AND ip IS NOT NULL
        AND ip != ''
      GROUP BY ip
    `)
    .all(sinceTs) as Array<{ ip?: string; cnt?: number }>;

  const attemptsByPrefix = new Map<string, number>();

  for (const row of attemptsRows) {
    const ipPrefix = getIpPrefix(String(row?.ip ?? "").trim());
    if (!ipPrefix) continue;
    attemptsByPrefix.set(ipPrefix, (attemptsByPrefix.get(ipPrefix) ?? 0) + Number(row?.cnt ?? 0));
  }

  const items = Array.from(grouped.values())
    .map((item) => ({
      ...item,
      distinctUsers: usersByPrefix.get(item.ipPrefix)?.size ?? 0,
      attempts24h: attemptsByPrefix.get(item.ipPrefix) ?? 0,
    }))
    .sort((a, b) => {
      if (b.attempts24h !== a.attempts24h) return b.attempts24h - a.attempts24h;
      if (b.devicesCount !== a.devicesCount) return b.devicesCount - a.devicesCount;
      return (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0);
    })
    .slice(0, limit);

  return items;
}