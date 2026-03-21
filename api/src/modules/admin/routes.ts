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
} from "../device/deviceService.js";
import { ensureDeviceTables } from "../device/deviceRepo.js";

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

    try {
      const settingsRes = await shmShpunAppAdminSettingsGet(s.shmSessionId);
      const settingsMode = settingsRes?.json?.settings?.trialDeviceMode ?? settingsRes?.json?.trialDeviceMode;

      if (isTrialDeviceMode(settingsMode)) {
        mode = settingsMode;
        setCachedTrialDeviceMode(settingsMode);
      }
    } catch {
      // fallback to cached/env mode
    }

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
}