import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import {
  shmShpunAppAdminSettingsGet,
  shmShpunAppAdminSettingsSet,
  shmShpunAppAdminStatus,
} from "../../shared/shm/shmClient.js";
import { linkDb } from "../../shared/linkdb/db.js";
import {
  getTrialDeviceMode,
  getTrialDeviceTtlHours,
  setCachedTrialDeviceMode,
  setCachedTrialDeviceTtlHours,
  logTrialEvent,
} from "../device/deviceService.js";
import {
  ensureDeviceTables,
  resetDeviceTrialUsage,
  deleteAllTrialUsageByDevice,
  setDeviceBlocked,
  listDeviceTokensByIpPrefix,
  deleteAllTrialUsageByDeviceTokens,
  resetTrialUsageByDeviceTokens,
  setDevicesBlockedByTokens,
  deleteTrialProtectionEventsByIpPrefix,
  getIpPrefix,
  deleteDeviceCompletely,
  listObservedIpPrefixes,
} from "../device/deviceRepo.js";

async function ensureAdmin(shmSessionId: string) {
  const r = await shmShpunAppAdminStatus(shmSessionId);
  return r.ok && (r.json?.is_admin === 1 || r.json?.is_admin === true);
}

function toPositiveInt(v: unknown, fallback: number, max = 200) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function toOptionalPositiveInt(v: unknown, max = 100000) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.floor(n), max);
}

function isTrialDeviceMode(v: unknown): v is "off" | "observe" | "enforce" {
  return v === "off" || v === "observe" || v === "enforce";
}

function getSessionUserId(req: any): number | null {
  const s = getSessionFromRequest(req);
  const raw = s?.userId ?? null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function countEvents(params: {
  sinceTs: number;
  eventType?: string;
  decision?: "allow" | "observe" | "block";
  reason?: string;
}) {
  const where: string[] = ["created_at >= ?"];
  const values: any[] = [params.sinceTs];

  if (params.eventType) {
    where.push("event_type = ?");
    values.push(params.eventType);
  }
  if (params.decision) {
    where.push("decision = ?");
    values.push(params.decision);
  }
  if (params.reason) {
    where.push("reason = ?");
    values.push(params.reason);
  }

  const row = linkDb
    .prepare(`
      SELECT COUNT(*) as cnt
      FROM trial_protection_events
      WHERE ${where.join(" AND ")}
    `)
    .get(...values) as { cnt?: number } | undefined;

  return Number(row?.cnt ?? 0);
}

function tryParseMeta(metaJson: unknown) {
  if (!metaJson) return null;
  try {
    return JSON.parse(String(metaJson));
  } catch {
    return null;
  }
}

export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin/settings", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    const r = await shmShpunAppAdminSettingsGet(s.shmSessionId);
    if (!r.ok) {
      return reply.code(502).send({ ok: false, error: "shm_error" });
    }

    return reply.send(r.json);
  });

  app.put("/admin/settings/order-rules", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    const mode = (req.body as any)?.orderBlockMode;

    const r = await shmShpunAppAdminSettingsSet(s.shmSessionId, {
      orderBlockMode: mode,
    });

    if (!r.ok) {
      return reply.code(502).send({ ok: false, error: "shm_error" });
    }

    return reply.send(r.json);
  });

  app.get("/admin/trial-protection/status", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    ensureDeviceTables();

    let mode = getTrialDeviceMode();
    let ttlHours = getTrialDeviceTtlHours();

    let ipPrefixUsageThreshold = 2;
    let ipPrefixAttemptThreshold = 3;
    let ipPrefixDistinctDevicesThreshold = 3;
    let ipPrefixUserAgentAttemptThreshold = 2;
    let ipPrefixDistinctUsersThreshold = 3;

    try {
      const settingsRes = await shmShpunAppAdminSettingsGet(s.shmSessionId);
      const settings = settingsRes?.json?.settings ?? settingsRes?.json ?? {};

      if (isTrialDeviceMode(settings?.trialDeviceMode)) {
        mode = settings.trialDeviceMode;
        setCachedTrialDeviceMode(settings.trialDeviceMode);
      }

      const ttlRaw = Number(settings?.trialDeviceTtlHours);
      if (Number.isFinite(ttlRaw) && ttlRaw > 0) {
        ttlHours = ttlRaw;
        setCachedTrialDeviceTtlHours(ttlRaw);
      }

      const usageThresholdRaw = Number(settings?.trialIpPrefixUsageThreshold);
      if (Number.isFinite(usageThresholdRaw) && usageThresholdRaw >= 1) {
        ipPrefixUsageThreshold = Math.floor(usageThresholdRaw);
      }

      const attemptThresholdRaw = Number(settings?.trialIpPrefixAttemptThreshold);
      if (Number.isFinite(attemptThresholdRaw) && attemptThresholdRaw >= 1) {
        ipPrefixAttemptThreshold = Math.floor(attemptThresholdRaw);
      }

      const distinctDevicesThresholdRaw = Number(settings?.trialIpPrefixDistinctDevicesThreshold);
      if (Number.isFinite(distinctDevicesThresholdRaw) && distinctDevicesThresholdRaw >= 1) {
        ipPrefixDistinctDevicesThreshold = Math.floor(distinctDevicesThresholdRaw);
      }

      const userAgentAttemptThresholdRaw = Number(settings?.trialIpPrefixUserAgentAttemptThreshold);
      if (Number.isFinite(userAgentAttemptThresholdRaw) && userAgentAttemptThresholdRaw >= 1) {
        ipPrefixUserAgentAttemptThreshold = Math.floor(userAgentAttemptThresholdRaw);
      }

      const distinctUsersThresholdRaw = Number(settings?.trialIpPrefixDistinctUsersThreshold);
      if (Number.isFinite(distinctUsersThresholdRaw) && distinctUsersThresholdRaw >= 1) {
        ipPrefixDistinctUsersThreshold = Math.floor(distinctUsersThresholdRaw);
      }
    } catch {
      // fallback to cached/env/default values
    }

    const nowTs = Math.floor(Date.now() / 1000);
    const since24h = nowTs - 24 * 60 * 60;

    const devicesWithTrialRow = linkDb
      .prepare(`
        SELECT COUNT(DISTINCT device_token) as cnt
        FROM trial_device_usage
      `)
      .get() as { cnt?: number } | undefined;

    const activeTrialGroupsRow = linkDb
      .prepare(`
        SELECT COUNT(*) as cnt
        FROM trial_device_usage
      `)
      .get() as { cnt?: number } | undefined;

    const distinctDevices24hRow = linkDb
      .prepare(`
        SELECT COUNT(DISTINCT device_token) as cnt
        FROM trial_protection_events
        WHERE created_at >= ?
          AND device_token IS NOT NULL
          AND device_token != ''
      `)
      .get(since24h) as { cnt?: number } | undefined;

    const distinctIps24hRow = linkDb
      .prepare(`
        SELECT COUNT(DISTINCT ip) as cnt
        FROM trial_protection_events
        WHERE created_at >= ?
          AND ip IS NOT NULL
          AND ip != ''
      `)
      .get(since24h) as { cnt?: number } | undefined;

    const activeBlockedDevicesRow = linkDb
      .prepare(`
        SELECT COUNT(*) as cnt
        FROM trial_devices
        WHERE is_blocked = 1
      `)
      .get() as { cnt?: number } | undefined;

    return reply.send({
      ok: true,
      mode,
      ttlHours,
      ipPrefixUsageThreshold,
      ipPrefixAttemptThreshold,
      ipPrefixDistinctDevicesThreshold,
      ipPrefixUserAgentAttemptThreshold,
      ipPrefixDistinctUsersThreshold,
      devicesWithTrial: Number(devicesWithTrialRow?.cnt ?? 0),
      activeTrialGroups: Number(activeTrialGroupsRow?.cnt ?? 0),
      activeBlockedDevices: Number(activeBlockedDevicesRow?.cnt ?? 0),
      distinctDevices24h: Number(distinctDevices24hRow?.cnt ?? 0),
      distinctIps24h: Number(distinctIps24hRow?.cnt ?? 0),
      attempts24h: countEvents({
        sinceTs: since24h,
        eventType: "trial_group_check",
      }),
      allows24h: countEvents({
        sinceTs: since24h,
        eventType: "trial_group_check",
        decision: "allow",
      }),
      observes24h: countEvents({
        sinceTs: since24h,
        eventType: "trial_group_check",
        decision: "observe",
      }),
      blocks24h: countEvents({
        sinceTs: since24h,
        eventType: "trial_group_check",
        decision: "block",
      }),
      reuseDevice24h: countEvents({
        sinceTs: since24h,
        reason: "trial_already_used_in_group_on_device",
      }),
      reuseIp24h: countEvents({
        sinceTs: since24h,
        reason: "trial_already_used_in_group_on_ip",
      }),
      abuseIpPrefix24h: countEvents({
        sinceTs: since24h,
        reason: "trial_abuse_detected_on_ip_prefix",
      }),
      blockDevice24h: countEvents({
        sinceTs: since24h,
        reason: "trial_already_used_in_group_on_device",
      }),
      blockIp24h: countEvents({
        sinceTs: since24h,
        reason: "trial_already_used_in_group_on_ip",
      }),
      blockIpPrefix24h: countEvents({
        sinceTs: since24h,
        reason: "trial_abuse_detected_on_ip_prefix",
      }),
      missingDeviceToken24h: countEvents({
        sinceTs: since24h,
        reason: "missing_device_token",
      }),
      manualBlocks24h: countEvents({
        sinceTs: since24h,
        reason: "device_manually_blocked",
      }),
    });
  });

  app.put("/admin/trial-protection/settings", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    const body = (req.body ?? {}) as any;

    const mode = String(body?.mode ?? "").trim();
    if (!isTrialDeviceMode(mode)) {
      return reply.code(400).send({ ok: false, error: "bad_mode" });
    }

    const ttlHours = Number(body?.ttlHours);
    if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 720) {
      return reply.code(400).send({ ok: false, error: "bad_ttl" });
    }

    const ipPrefixUsageThreshold = Number(body?.ipPrefixUsageThreshold);
    if (!Number.isFinite(ipPrefixUsageThreshold) || ipPrefixUsageThreshold < 1 || ipPrefixUsageThreshold > 100) {
      return reply.code(400).send({ ok: false, error: "bad_ip_prefix_usage_threshold" });
    }

    const ipPrefixAttemptThreshold = Number(body?.ipPrefixAttemptThreshold);
    if (!Number.isFinite(ipPrefixAttemptThreshold) || ipPrefixAttemptThreshold < 1 || ipPrefixAttemptThreshold > 200) {
      return reply.code(400).send({ ok: false, error: "bad_ip_prefix_attempt_threshold" });
    }

    const ipPrefixDistinctDevicesThreshold = Number(body?.ipPrefixDistinctDevicesThreshold);
    if (
      !Number.isFinite(ipPrefixDistinctDevicesThreshold) ||
      ipPrefixDistinctDevicesThreshold < 1 ||
      ipPrefixDistinctDevicesThreshold > 200
    ) {
      return reply.code(400).send({ ok: false, error: "bad_ip_prefix_distinct_devices_threshold" });
    }

    const ipPrefixUserAgentAttemptThreshold = Number(body?.ipPrefixUserAgentAttemptThreshold);
    if (
      !Number.isFinite(ipPrefixUserAgentAttemptThreshold) ||
      ipPrefixUserAgentAttemptThreshold < 1 ||
      ipPrefixUserAgentAttemptThreshold > 200
    ) {
      return reply.code(400).send({ ok: false, error: "bad_ip_prefix_user_agent_attempt_threshold" });
    }

    const ipPrefixDistinctUsersThreshold = Number(body?.ipPrefixDistinctUsersThreshold);
    if (
      !Number.isFinite(ipPrefixDistinctUsersThreshold) ||
      ipPrefixDistinctUsersThreshold < 1 ||
      ipPrefixDistinctUsersThreshold > 200
    ) {
      return reply.code(400).send({ ok: false, error: "bad_ip_prefix_distinct_users_threshold" });
    }

    const r = await shmShpunAppAdminSettingsSet(s.shmSessionId, {
      trialDeviceMode: mode,
      trialDeviceTtlHours: ttlHours,
      trialIpPrefixUsageThreshold: Math.floor(ipPrefixUsageThreshold),
      trialIpPrefixAttemptThreshold: Math.floor(ipPrefixAttemptThreshold),
      trialIpPrefixDistinctDevicesThreshold: Math.floor(ipPrefixDistinctDevicesThreshold),
      trialIpPrefixUserAgentAttemptThreshold: Math.floor(ipPrefixUserAgentAttemptThreshold),
      trialIpPrefixDistinctUsersThreshold: Math.floor(ipPrefixDistinctUsersThreshold),
    });

    if (!r.ok) {
      return reply.code(502).send({ ok: false, error: "shm_error" });
    }

    setCachedTrialDeviceMode(mode);
    setCachedTrialDeviceTtlHours(ttlHours);

    return reply.send({
      ok: true,
      mode,
      ttlHours,
      ipPrefixUsageThreshold: Math.floor(ipPrefixUsageThreshold),
      ipPrefixAttemptThreshold: Math.floor(ipPrefixAttemptThreshold),
      ipPrefixDistinctDevicesThreshold: Math.floor(ipPrefixDistinctDevicesThreshold),
      ipPrefixUserAgentAttemptThreshold: Math.floor(ipPrefixUserAgentAttemptThreshold),
      ipPrefixDistinctUsersThreshold: Math.floor(ipPrefixDistinctUsersThreshold),
    });
  });

  app.get("/admin/trial-protection/events", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    ensureDeviceTables();

    const q = (req.query ?? {}) as any;
    const limit = toPositiveInt(q?.limit, 20, 200);

    const items = linkDb
      .prepare(`
        SELECT
          id,
          created_at,
          device_token,
          user_id,
          ip,
          user_agent,
          event_type,
          decision,
          reason,
          meta_json
        FROM trial_protection_events
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(limit)
      .map((row: any) => ({
        ...row,
        meta: tryParseMeta(row.meta_json),
      }));

    return reply.send({ ok: true, items });
  });

  app.get("/admin/trial-protection/devices", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    ensureDeviceTables();

    const q = (req.query ?? {}) as any;
    const limit = toOptionalPositiveInt(q?.limit);
    const showAll = String(q?.all ?? "").trim() === "1";

    const baseSelect = `
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
        d.is_blocked,
        COUNT(u.id) AS active_trial_count,
        MAX(u.used_at) AS last_trial_used_at
      FROM trial_devices d
    `;

    const allQuery = `
      ${baseSelect}
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
        d.is_blocked
      ORDER BY d.last_seen_at DESC, d.id DESC
    `;

    const activeOnlyQuery = `
      ${baseSelect}
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
        d.is_blocked
      HAVING COUNT(u.id) > 0 OR d.is_blocked = 1
      ORDER BY d.last_seen_at DESC, d.id DESC
    `;

    const sql = `${showAll ? allQuery : activeOnlyQuery}${limit ? "\nLIMIT ?" : ""}`;
    const stmt = linkDb.prepare(sql);
    const items = limit ? stmt.all(limit) : stmt.all();

    return reply.send({ ok: true, items });
  });

  app.get("/admin/trial-protection/prefixes", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    ensureDeviceTables();

    const q = (req.query ?? {}) as any;
    const limit = toPositiveInt(q?.limit, 20, 100);
    const sinceTs = Math.floor(Date.now() / 1000) - 24 * 60 * 60;

    const items = listObservedIpPrefixes({ sinceTs, limit });

    return reply.send({ ok: true, items });
  });

  app.post("/admin/trial-protection/reset-device", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    const adminUserId = getSessionUserId(req);

    const deviceToken = String((req.body as any)?.deviceToken ?? "").trim();
    if (!deviceToken) {
      return reply.code(400).send({ ok: false, error: "device_token_required" });
    }

    resetDeviceTrialUsage(deviceToken);
    deleteAllTrialUsageByDevice(deviceToken);

    logTrialEvent({
      deviceToken,
      userId: adminUserId,
      eventType: "device_trial_reset_by_admin",
      decision: "allow",
      reason: "manual_admin_reset",
      meta: {
        by: "admin",
        adminUserId,
        resetScope: "all_groups",
      },
    });

    return reply.send({ ok: true, deviceToken, reset: true });
  });

  app.post("/admin/trial-protection/delete-device", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    const adminUserId = getSessionUserId(req);

    const deviceToken = String((req.body as any)?.deviceToken ?? "").trim();
    if (!deviceToken) {
      return reply.code(400).send({ ok: false, error: "device_token_required" });
    }

    const result = deleteDeviceCompletely(deviceToken);

    logTrialEvent({
      deviceToken,
      userId: adminUserId,
      eventType: "device_deleted_by_admin",
      decision: "allow",
      reason: "manual_admin_delete",
      meta: {
        by: "admin",
        adminUserId,
        deletedDevice: result.deletedDevice,
        deletedUsage: result.deletedUsage,
        deletedEvents: result.deletedEvents,
      },
    });

    return reply.send({
      ok: true,
      deviceToken,
      deletedDevice: result.deletedDevice,
      deletedUsage: result.deletedUsage,
      deletedEvents: result.deletedEvents,
    });
  });

  app.post("/admin/trial-protection/reset-prefix", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    ensureDeviceTables();

    const adminUserId = getSessionUserId(req);
    const body = (req.body ?? {}) as any;

    const rawIp = String(body?.ip ?? "").trim();
    const rawPrefix = String(body?.ipPrefix ?? "").trim();
    const clearEvents = Number(body?.clearEvents ?? 1) === 1;
    const unblockDevices = Number(body?.unblockDevices ?? 1) === 1;

    const ipPrefix = rawPrefix || getIpPrefix(rawIp);

    if (!ipPrefix) {
      return reply.code(400).send({ ok: false, error: "ip_or_prefix_required" });
    }

    const ttlHours = getTrialDeviceTtlHours();
    const sinceTs = Math.floor(Date.now() / 1000) - ttlHours * 60 * 60;

    const deviceTokens = listDeviceTokensByIpPrefix(ipPrefix);

    const resetDevices = resetTrialUsageByDeviceTokens(deviceTokens);
    const deletedUsage = deleteAllTrialUsageByDeviceTokens(deviceTokens);
    const unblockedDevices = unblockDevices ? setDevicesBlockedByTokens(deviceTokens, false) : 0;
    const deletedEvents = clearEvents
      ? deleteTrialProtectionEventsByIpPrefix({ ipPrefix, sinceTs })
      : 0;

    logTrialEvent({
      userId: adminUserId,
      ip: rawIp || null,
      eventType: "trial_prefix_reset_by_admin",
      decision: "allow",
      reason: "manual_admin_prefix_reset",
      meta: {
        by: "admin",
        adminUserId,
        ipPrefix,
        sourceIp: rawIp || null,
        matchedDevices: deviceTokens.length,
        resetDevices,
        deletedUsage,
        unblockedDevices,
        deletedEvents,
        clearEvents,
        unblockDevices,
        ttlHours,
      },
    });

    return reply.send({
      ok: true,
      ipPrefix,
      matchedDevices: deviceTokens.length,
      resetDevices,
      deletedUsage,
      unblockedDevices,
      deletedEvents,
    });
  });

  app.post("/admin/trial-protection/block-device", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    const adminUserId = getSessionUserId(req);

    const deviceToken = String((req.body as any)?.deviceToken ?? "").trim();
    if (!deviceToken) {
      return reply.code(400).send({ ok: false, error: "device_token_required" });
    }

    setDeviceBlocked(deviceToken, true);

    logTrialEvent({
      deviceToken,
      userId: adminUserId,
      eventType: "device_blocked_by_admin",
      decision: "block",
      reason: "manual_admin_block",
      meta: {
        by: "admin",
        adminUserId,
      },
    });

    return reply.send({ ok: true, deviceToken, blocked: true });
  });

  app.post("/admin/trial-protection/unblock-device", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    const adminUserId = getSessionUserId(req);

    const deviceToken = String((req.body as any)?.deviceToken ?? "").trim();
    if (!deviceToken) {
      return reply.code(400).send({ ok: false, error: "device_token_required" });
    }

    setDeviceBlocked(deviceToken, false);

    logTrialEvent({
      deviceToken,
      userId: adminUserId,
      eventType: "device_unblocked_by_admin",
      decision: "allow",
      reason: "manual_admin_unblock",
      meta: {
        by: "admin",
        adminUserId,
      },
    });

    return reply.send({ ok: true, deviceToken, blocked: false });
  });

  app.post("/admin/trial-protection/clear-events", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    ensureDeviceTables();

    const body = (req.body ?? {}) as any;
    const keepLatest = Math.max(0, Number(body?.keepLatest ?? 0)) || 0;

    let deleted = 0;

    if (keepLatest > 0) {
      const row = linkDb
        .prepare(`
          SELECT id
          FROM trial_protection_events
          ORDER BY id DESC
          LIMIT 1 OFFSET ?
        `)
        .get(keepLatest - 1) as { id?: number } | undefined;

      if (row?.id) {
        const result = linkDb
          .prepare(`
            DELETE FROM trial_protection_events
            WHERE id < ?
          `)
          .run(row.id);

        deleted = Number(result?.changes ?? 0);
      }
    } else {
      const result = linkDb.prepare(`DELETE FROM trial_protection_events`).run();
      deleted = Number(result?.changes ?? 0);
    }

    return reply.send({ ok: true, deleted, keepLatest });
  });
}