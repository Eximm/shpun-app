// FILE: api/src/modules/admin/routes.ts
import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import {
  shmFetch,
  shmShpunAppAdminSettingsGet,
  shmShpunAppAdminSettingsSet,
  shmShpunAppAdminStatus,
  shmShpunAppAdminPartnerPercentSet,
  shmShpunAppAdminPartnerStats,
} from "../../shared/shm/shmClient.js";
import { linkDb } from "../../shared/linkdb/db.js";
import {
  getTrialDeviceMode,
  getTrialDeviceTtlHours,
  getTrialRequireVerifiedEmail,
  setCachedTrialDeviceMode,
  setCachedTrialDeviceTtlHours,
  setTrialRequireVerifiedEmail,
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

import {
  listServiceCategories,
  getServiceCategory,
  createServiceCategory,
  updateServiceCategory,
  deleteServiceCategory,
} from "../../shared/linkdb/serviceCategoriesRepo.js";
import {
  deleteReferralAlias,
  getReferralAliasById,
  isValidReferralAlias,
  listReferralAliases,
  saveReferralAlias,
} from "../../shared/linkdb/referralAliasesRepo.js";

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

function boolFromAny(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const s = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(s)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(s)) return false;
  return fallback;
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

function normalizeIdList(value: unknown, max = 1000): number[] {
  const arr = Array.isArray(value) ? value : [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of arr) {
    const n = Math.trunc(Number(
      raw && typeof raw === "object"
        ? (raw as any).user_id ?? (raw as any).id
        : raw
    ));
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

function unwrapTemplateJson(json: any): any {
  const data = json?.data;
  return data && typeof data === "object" && !Array.isArray(data) ? data : json;
}

function extractRows(json: any): any[] {
  const data = json?.data ?? json?.items ?? json?.rows ?? [];
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return Object.values(data);
  return [];
}

function isActiveService(row: any): boolean {
  const raw = String(
    row?.status ??
    row?.state ??
    row?.user_service_status ??
    row?.service_status ??
    ""
  ).trim().toUpperCase();
  return raw === "ACTIVE";
}

function extractServiceOwnerId(row: any): number {
  const nestedUser = row?.user && typeof row.user === "object" ? row.user : {};
  const nestedClient = row?.client && typeof row.client === "object" ? row.client : {};
  const n = Math.trunc(Number(
    row?.user_id ??
    row?.uid ??
    row?.account_id ??
    row?.client_id ??
    row?.customer_id ??
    nestedUser?.user_id ??
    nestedUser?.id ??
    nestedClient?.user_id ??
    nestedClient?.id ??
    0
  ));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function loadAdminUserServices(shmSessionId: string, limit = 1000, maxRows = 10000) {
  const rows: any[] = [];
  let offset = 0;
  let failed = false;

  for (;;) {
    const r = await shmFetch<any>(shmSessionId, "v1/user/service", {
      method: "GET",
      query: { limit, offset, filter: "{}" },
    });
    if (!r.ok) {
      failed = true;
      break;
    }

    const page = extractRows(r.json);
    rows.push(...page);
    if (page.length < limit || rows.length >= maxRows) break;
    offset += limit;
  }

  return {
    ok: !failed,
    rows: rows.slice(0, maxRows),
    truncated: rows.length >= maxRows,
  };
}

async function hasActiveServiceByUserFilter(shmSessionId: string, userId: number): Promise<boolean | null> {
  const filterVariants = [
    { user_id: userId },
    { uid: userId },
    { id: userId },
  ];

  for (const filterObj of filterVariants) {
    const filter = JSON.stringify(filterObj);
    const r = await shmFetch<any>(shmSessionId, "v1/user/service", {
      method: "GET",
      query: { limit: 100, offset: 0, filter },
    });
    if (!r.ok) continue;
    const rows = extractRows(r.json);
    if (rows.length > 0) return rows.some(isActiveService);
  }

  return null;
}

async function countActivePartnerUsersByUserFilter(shmSessionId: string, userIds: number[]) {
  const ids = normalizeIdList(userIds, 1000);
  let activeUsers = 0;
  let checkedUsers = 0;
  let failedUsers = 0;
  const concurrency = 8;
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= ids.length) return;
      const active = await hasActiveServiceByUserFilter(shmSessionId, ids[index]);
      if (active === null) {
        failedUsers += 1;
        continue;
      }
      checkedUsers += 1;
      if (active) activeUsers += 1;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()));
  return { activeUsers, checkedUsers, failedUsers };
}

async function countActivePartnerUsersByAdminServiceList(shmSessionId: string, userIds: number[]) {
  const ids = normalizeIdList(userIds, 1000);
  const idSet = new Set(ids);
  const activeOwnerIds = new Set<number>();
  const seenOwnerIds = new Set<number>();

  const loaded = await loadAdminUserServices(shmSessionId);
  if (!loaded.ok) {
    return {
      activeUsers: 0,
      checkedUsers: 0,
      failedUsers: ids.length,
      scannedServices: loaded.rows.length,
      serviceRowsWithOwner: 0,
      truncated: loaded.truncated,
    };
  }

  let serviceRowsWithOwner = 0;
  for (const row of loaded.rows) {
    const ownerId = extractServiceOwnerId(row);
    if (!ownerId) continue;
    serviceRowsWithOwner += 1;
    if (!idSet.has(ownerId)) continue;
    seenOwnerIds.add(ownerId);
    if (isActiveService(row)) activeOwnerIds.add(ownerId);
  }

  return {
    activeUsers: activeOwnerIds.size,
    checkedUsers: seenOwnerIds.size,
    failedUsers: Math.max(0, ids.length - seenOwnerIds.size),
    scannedServices: loaded.rows.length,
    serviceRowsWithOwner,
    truncated: loaded.truncated,
  };
}

async function hasActiveService(shmSessionId: string, userId: number): Promise<boolean | null> {
  const filter = JSON.stringify({ user_id: userId });
  const r = await shmFetch<any>(shmSessionId, "v1/user/service", {
    method: "GET",
    query: { limit: 100, offset: 0, filter },
  });
  if (!r.ok) return null;
  return extractRows(r.json).some(isActiveService);
}

async function countActivePartnerUsersByServices(shmSessionId: string, userIds: number[]) {
  const byList = await countActivePartnerUsersByAdminServiceList(shmSessionId, userIds);
  if (byList.serviceRowsWithOwner > 0 && byList.checkedUsers > 0) {
    return { ...byList, method: "admin_service_list" as const };
  }

  const byFilter = await countActivePartnerUsersByUserFilter(shmSessionId, userIds);
  return {
    ...byFilter,
    scannedServices: byList.scannedServices,
    serviceRowsWithOwner: byList.serviceRowsWithOwner,
    truncated: byList.truncated,
    method: "user_service_filter" as const,
  };
}

export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin/referral-aliases", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });
    if (!(await ensureAdmin(s.shmSessionId))) return reply.code(403).send({ ok: false, error: "not_admin" });
    return reply.send({ ok: true, items: listReferralAliases() });
  });

  app.get("/admin/referral-aliases/:id/stats", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });
    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    const item = getReferralAliasById((req.params as any)?.id);
    if (!item) return reply.code(404).send({ ok: false, error: "alias_not_found" });

    const result = await shmShpunAppAdminPartnerStats(s.shmSessionId, item.partner_id);
    const statsJson = unwrapTemplateJson(result.json as any);
    if (!result.ok || !statsJson?.ok) {
      return reply.code(502).send({
        ok: false,
        error: statsJson?.error || "partner_stats_failed",
      });
    }

    const referralUserIds = normalizeIdList(
      Array.isArray(statsJson?.referral_users) && statsJson.referral_users.length > 0
        ? statsJson.referral_users
        : statsJson?.referral_user_ids
    );
    const serviceStats = referralUserIds.length > 0
      ? await countActivePartnerUsersByServices(s.shmSessionId, referralUserIds)
      : null;

    return reply.send({
      ok: true,
      partnerId: item.partner_id,
      totalUsers: Number(statsJson?.total_users ?? 0),
      activeUsers: serviceStats
        ? serviceStats.activeUsers
        : Number(statsJson?.active_users ?? 0),
      scannedUsers: Number(statsJson?.scanned_users ?? 0),
      truncated: Boolean(statsJson?.truncated),
      serviceCheckedUsers: serviceStats?.checkedUsers ?? 0,
      serviceCheckFailedUsers: serviceStats?.failedUsers ?? 0,
      serviceStatsMethod: serviceStats?.method ?? "",
      scannedServices: serviceStats?.scannedServices ?? 0,
      serviceRowsWithOwner: serviceStats?.serviceRowsWithOwner ?? 0,
      serviceStatsTruncated: Boolean(serviceStats?.truncated),
      referralUserIdsCount: referralUserIds.length,
      templateVersion: String(statsJson?.ver ?? ""),
      activeSource: serviceStats ? "services" : "template",
    });
  });

  app.put("/admin/referral-aliases", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });
    if (!(await ensureAdmin(s.shmSessionId))) return reply.code(403).send({ ok: false, error: "not_admin" });
    try {
      const body = (req.body ?? {}) as any;
      const partnerId = Math.trunc(Number(body.partnerId));
      const incomePercent = Math.trunc(Number(body.partnerRewardPercent ?? 0));
      if (!isValidReferralAlias(body.alias)) throw new Error("invalid_alias");
      if (!Number.isFinite(partnerId) || partnerId <= 0) throw new Error("invalid_partner_id");
      if (!Number.isFinite(incomePercent) || incomePercent < 0 || incomePercent > 100) {
        throw new Error("invalid_reward_percent");
      }

      const shmResult = await shmShpunAppAdminPartnerPercentSet(
        s.shmSessionId,
        partnerId,
        incomePercent
      );
      if (!shmResult.ok || !(shmResult.json as any)?.ok) {
        return reply.code(502).send({
          ok: false,
          error: (shmResult.json as any)?.error || "partner_percent_not_saved",
        });
      }

      return reply.send({ ok: true, item: saveReferralAlias(body) });
    } catch (error: any) {
      const code = String(error?.message ?? "invalid_referral_alias");
      return reply.code(code.includes("UNIQUE") ? 409 : 400).send({ ok: false, error: code });
    }
  });

  app.delete("/admin/referral-aliases/:id", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });
    if (!(await ensureAdmin(s.shmSessionId))) return reply.code(403).send({ ok: false, error: "not_admin" });
    const deleted = deleteReferralAlias((req.params as any)?.id);
    return deleted
      ? reply.send({ ok: true })
      : reply.code(404).send({ ok: false, error: "alias_not_found" });
  });

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
    let requireVerifiedEmail = getTrialRequireVerifiedEmail();

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

      requireVerifiedEmail = boolFromAny(
        settings?.trialRequireVerifiedEmail ?? settings?.requireVerifiedEmail,
        requireVerifiedEmail
      );
      setTrialRequireVerifiedEmail(requireVerifiedEmail);
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
      requireVerifiedEmail,
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
      emailBlocks24h: countEvents({
        sinceTs: since24h,
        reason: "trial_email_not_verified",
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

    const requireVerifiedEmail = Boolean(body?.requireVerifiedEmail);

    const r = await shmShpunAppAdminSettingsSet(s.shmSessionId, {
      trialDeviceMode: mode,
      trialDeviceTtlHours: ttlHours,
      trialIpPrefixUsageThreshold: Math.floor(ipPrefixUsageThreshold),
      trialIpPrefixAttemptThreshold: Math.floor(ipPrefixAttemptThreshold),
      trialIpPrefixDistinctDevicesThreshold: Math.floor(ipPrefixDistinctDevicesThreshold),
      trialIpPrefixUserAgentAttemptThreshold: Math.floor(ipPrefixUserAgentAttemptThreshold),
      trialIpPrefixDistinctUsersThreshold: Math.floor(ipPrefixDistinctUsersThreshold),
      trialRequireVerifiedEmail: requireVerifiedEmail,
      requireVerifiedEmail,
    });

    if (!r.ok) {
      return reply.code(502).send({ ok: false, error: "shm_error" });
    }

    setCachedTrialDeviceMode(mode);
    setCachedTrialDeviceTtlHours(ttlHours);
    setTrialRequireVerifiedEmail(requireVerifiedEmail);

    return reply.send({
      ok: true,
      mode,
      ttlHours,
      ipPrefixUsageThreshold: Math.floor(ipPrefixUsageThreshold),
      ipPrefixAttemptThreshold: Math.floor(ipPrefixAttemptThreshold),
      ipPrefixDistinctDevicesThreshold: Math.floor(ipPrefixDistinctDevicesThreshold),
      ipPrefixUserAgentAttemptThreshold: Math.floor(ipPrefixUserAgentAttemptThreshold),
      ipPrefixDistinctUsersThreshold: Math.floor(ipPrefixDistinctUsersThreshold),
      requireVerifiedEmail,
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
        d.last_user_id,
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
          d.last_user_id,
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

    const sql = `${showAll ? allQuery : activeOnlyQuery}${limit ? " LIMIT ?" : ""}`;
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
  // ── Service Categories ─────────────────────────────────────────────────────

  app.get("/admin/service-categories", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });
    if (!(await ensureAdmin(s.shmSessionId))) return reply.code(403).send({ ok: false, error: "not_admin" });

    const items = listServiceCategories({ includeHidden: true });
    return reply.send({ ok: true, items });
  });

  app.post("/admin/service-categories", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });
    if (!(await ensureAdmin(s.shmSessionId))) return reply.code(403).send({ ok: false, error: "not_admin" });

    const body = (req.body ?? {}) as any;
    const result = createServiceCategory({
      category_key:          String(body?.category_key ?? "").trim(),
      title:                 String(body?.title ?? "").trim(),
      descr:                 String(body?.descr ?? "").trim(),
      short_descr:           String(body?.short_descr ?? "").trim(),
      connect_kind:          String(body?.connect_kind ?? "marzban").trim(),
      sort_order:            Number(body?.sort_order ?? 100),
      badge:                 body?.badge ? String(body.badge).trim() : null,
      badge_tone:            String(body?.badge_tone ?? "soft").trim(),
      recommended:           Boolean(body?.recommended),
      hidden:                Boolean(body?.hidden),
      emoji:                 body?.emoji ? String(body.emoji).trim() : null,
      accent_from:           body?.accent_from ? String(body.accent_from).trim() : null,
      accent_to:             body?.accent_to   ? String(body.accent_to).trim()   : null,
      card_bg:               body?.card_bg     ? String(body.card_bg).trim()     : null,
      button_label:          body?.button_label ? String(body.button_label).trim() : null,
      billing_category_keys: Array.isArray(body?.billing_category_keys) ? body.billing_category_keys.map(String) : [],
      hint_enabled:      Boolean(body?.hint_enabled),
      hint_title:        body?.hint_title        ? String(body.hint_title).trim()        : null,
      hint_text:         body?.hint_text         ? String(body.hint_text).trim()         : null,
      hint_button_label: body?.hint_button_label ? String(body.hint_button_label).trim() : null,
      hint_button_url:   body?.hint_button_url   ? String(body.hint_button_url).trim()   : null,
      service_ids:       Array.isArray(body?.service_ids) ? body.service_ids.map(Number) : [],
    });

    if (!result.ok) return reply.code(400).send({ ok: false, error: result.error });
    return reply.send({ ok: true, category: result.category });
  });

  app.put("/admin/service-categories/:key", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });
    if (!(await ensureAdmin(s.shmSessionId))) return reply.code(403).send({ ok: false, error: "not_admin" });

    const key = String((req.params as any)?.key ?? "").trim();
    if (!key) return reply.code(400).send({ ok: false, error: "key_required" });

    const body = (req.body ?? {}) as any;
    const data: any = {};

    if ("title"        in body) data.title        = String(body.title).trim();
    if ("descr"        in body) data.descr        = String(body.descr).trim();
    if ("short_descr"  in body) data.short_descr  = String(body.short_descr).trim();
    if ("connect_kind" in body) data.connect_kind = String(body.connect_kind).trim();
    if ("sort_order"   in body) data.sort_order   = Number(body.sort_order);
    if ("badge"        in body) data.badge        = body.badge ? String(body.badge).trim() : null;
    if ("badge_tone"   in body) data.badge_tone   = String(body.badge_tone).trim();
    if ("recommended"  in body) data.recommended  = Boolean(body.recommended);
    if ("hidden"       in body) data.hidden       = Boolean(body.hidden);
    if ("service_ids"           in body) data.service_ids           = Array.isArray(body.service_ids) ? body.service_ids.map(Number) : [];
    if ("emoji"                 in body) data.emoji                 = body.emoji         ? String(body.emoji).trim()         : null;
    if ("accent_from"           in body) data.accent_from           = body.accent_from   ? String(body.accent_from).trim()   : null;
    if ("accent_to"             in body) data.accent_to             = body.accent_to     ? String(body.accent_to).trim()     : null;
    if ("card_bg"               in body) data.card_bg               = body.card_bg       ? String(body.card_bg).trim()       : null;
    if ("button_label"          in body) data.button_label          = body.button_label  ? String(body.button_label).trim()  : null;
    if ("billing_category_keys" in body) data.billing_category_keys = Array.isArray(body.billing_category_keys) ? body.billing_category_keys.map(String) : [];
    if ("hint_enabled"          in body) data.hint_enabled      = Boolean(body.hint_enabled);
    if ("hint_title"            in body) data.hint_title        = body.hint_title        ? String(body.hint_title).trim()        : null;
    if ("hint_text"             in body) data.hint_text         = body.hint_text         ? String(body.hint_text).trim()         : null;
    if ("hint_button_label"     in body) data.hint_button_label = body.hint_button_label ? String(body.hint_button_label).trim() : null;
    if ("hint_button_url"       in body) data.hint_button_url   = body.hint_button_url   ? String(body.hint_button_url).trim()   : null;

    const result = updateServiceCategory(key, data);
    if (!result.ok) return reply.code(result.error === "not_found" ? 404 : 400).send({ ok: false, error: result.error });
    return reply.send({ ok: true, category: result.category });
  });

  app.delete("/admin/service-categories/:key", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });
    if (!(await ensureAdmin(s.shmSessionId))) return reply.code(403).send({ ok: false, error: "not_admin" });

    const key = String((req.params as any)?.key ?? "").trim();
    if (!key) return reply.code(400).send({ ok: false, error: "key_required" });

    const result = deleteServiceCategory(key);
    if (!result.ok) return reply.code(500).send({ ok: false, error: result.error });
    return reply.send({ ok: true, deleted: result.deleted });
  });
}
