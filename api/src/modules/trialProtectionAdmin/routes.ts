import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { linkDb } from "../../shared/linkdb/db.js";
import { getTrialDeviceMode, getTrialDeviceTtlHours } from "../device/deviceService.js";
import {
  deleteAllTrialUsageByDevice,
  resetDeviceTrialUsage,
  setDeviceBlocked,
} from "../device/deviceRepo.js";

function ensureAuthed(req: any, reply: any): string | null {
  const session = getSessionFromRequest(req as any);
  const shmSessionId = session?.shmSessionId || null;
  if (!shmSessionId) {
    reply.code(401).send({ ok: false, error: "not_authenticated" });
    return null;
  }
  return shmSessionId;
}

function toPositiveInt(v: unknown, fallback: number, max = 200) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
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

export async function trialProtectionAdminRoutes(app: FastifyInstance) {
  app.get("/admin/trial-protection/status", async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply);
    if (!shmSessionId) return;

    const mode = getTrialDeviceMode();
    const ttlHours = getTrialDeviceTtlHours();

    const nowTs = Math.floor(Date.now() / 1000);
    const since24h = nowTs - 24 * 60 * 60;

    const devicesWithTrialRow = linkDb
      .prepare(`
        SELECT COUNT(*) as cnt
        FROM trial_devices
        WHERE trial_used_at IS NOT NULL
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

    return reply.send({
      ok: true,
      mode,
      ttlHours,
      devicesWithTrial: Number(devicesWithTrialRow?.cnt ?? 0),
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

  app.get("/admin/trial-protection/events", async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply);
    if (!shmSessionId) return;

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

  app.post("/admin/trial-protection/device/reset", async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply);
    if (!shmSessionId) return;

    const deviceToken = String((req.body as any)?.deviceToken ?? "").trim();
    if (!deviceToken) {
      return reply.code(400).send({ ok: false, error: "device_token_required" });
    }

    resetDeviceTrialUsage(deviceToken);
    deleteAllTrialUsageByDevice(deviceToken);

    return reply.send({ ok: true });
  });

  app.post("/admin/trial-protection/device/block", async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply);
    if (!shmSessionId) return;

    const deviceToken = String((req.body as any)?.deviceToken ?? "").trim();
    if (!deviceToken) {
      return reply.code(400).send({ ok: false, error: "device_token_required" });
    }

    setDeviceBlocked(deviceToken, true);

    return reply.send({ ok: true });
  });

  app.post("/admin/trial-protection/device/unblock", async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply);
    if (!shmSessionId) return;

    const deviceToken = String((req.body as any)?.deviceToken ?? "").trim();
    if (!deviceToken) {
      return reply.code(400).send({ ok: false, error: "device_token_required" });
    }

    setDeviceBlocked(deviceToken, false);

    return reply.send({ ok: true });
  });
}