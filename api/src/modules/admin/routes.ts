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
} from "../device/deviceRepo.js";

async function ensureAdmin(shmSessionId: string) {
  const r = await shmShpunAppAdminStatus(shmSessionId);
  const isAdmin = r.ok && (r.json?.is_admin === 1 || r.json?.is_admin === true);
  return isAdmin;
}

function toPositiveInt(v: unknown, fallback: number, max = 200) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
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
    } catch {
      // fallback to cached/env values
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

  app.put("/admin/trial-protection/mode", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    const mode = String((req.body as any)?.mode ?? "").trim();

    if (!isTrialDeviceMode(mode)) {
      return reply.code(400).send({ ok: false, error: "bad_mode" });
    }

    const r = await shmShpunAppAdminSettingsSet(s.shmSessionId, {
      trialDeviceMode: mode,
    });

    if (!r.ok) {
      return reply.code(502).send({ ok: false, error: "shm_error" });
    }

    setCachedTrialDeviceMode(mode);

    return reply.send({ ok: true, mode });
  });

  app.put("/admin/trial-protection/ttl", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    const ttlHours = Number((req.body as any)?.ttlHours);

    if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 720) {
      return reply.code(400).send({ ok: false, error: "bad_ttl" });
    }

    const r = await shmShpunAppAdminSettingsSet(s.shmSessionId, {
      trialDeviceTtlHours: ttlHours,
    });

    if (!r.ok) {
      return reply.code(502).send({ ok: false, error: "shm_error" });
    }

    setCachedTrialDeviceTtlHours(ttlHours);

    return reply.send({ ok: true, ttlHours });
  });

  app.get("/admin/trial-protection/events", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    ensureDeviceTables();

    const q = (req.query ?? {}) as any;
    const limit = toPositiveInt(q?.limit, 30, 200);

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
    const limit = toPositiveInt(q?.limit, 50, 200);
    const showAll = String(q?.all ?? "").trim() === "1";

    const items = showAll
      ? linkDb
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
              d.is_blocked
            ORDER BY d.last_seen_at DESC, d.id DESC
            LIMIT ?
          `)
          .all(limit)
      : linkDb
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
              d.is_blocked,
              COUNT(u.id) AS active_trial_count,
              MAX(u.used_at) AS last_trial_used_at
            FROM trial_devices d
            JOIN trial_device_usage u
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
            LIMIT ?
          `)
          .all(limit);

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