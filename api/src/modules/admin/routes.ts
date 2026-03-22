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
  listTrialDevices,
  resetDeviceTrialUsage,
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
  const raw = (s as any)?.userId ?? (s as any)?.uid ?? (s as any)?.user_id ?? null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
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
        SELECT COUNT(*) as cnt
        FROM trial_devices
        WHERE trial_used_at IS NOT NULL
      `)
      .get() as { cnt?: number } | undefined;

    const reuse24hRow = linkDb
      .prepare(`
        SELECT COUNT(*) as cnt
        FROM trial_protection_events
        WHERE event_type = 'trial_reuse_detected'
          AND created_at >= ?
      `)
      .get(since24h) as { cnt?: number } | undefined;

    const blocks24hRow = linkDb
      .prepare(`
        SELECT COUNT(*) as cnt
        FROM trial_protection_events
        WHERE decision = 'block'
          AND created_at >= ?
      `)
      .get(since24h) as { cnt?: number } | undefined;

    return reply.send({
      ok: true,
      mode,
      ttlHours,
      devicesWithTrial: Number(devicesWithTrialRow?.cnt ?? 0),
      reuse24h: Number(reuse24hRow?.cnt ?? 0),
      blocks24h: Number(blocks24hRow?.cnt ?? 0),
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
      .all(limit);

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
    const items = listTrialDevices(limit);

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

    logTrialEvent({
      deviceToken,
      userId: adminUserId,
      eventType: "device_trial_reset_by_admin",
      decision: "allow",
      reason: "manual_admin_reset",
      meta: { by: "admin", adminUserId },
    });

    return reply.send({ ok: true, deviceToken, reset: true });
  });
}