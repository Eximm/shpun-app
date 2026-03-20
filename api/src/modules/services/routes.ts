import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { parseShmPeriod } from "../../shared/shm/period.js";
import {
  shmCreateServiceOrder,
  shmDeleteUserService,
  shmGetServiceOrder,
  shmGetUserServices,
  shmShpunAppConnectGet,
  shmShpunAppOrderRulesGet,
  shmShpunAppRouterBind,
  shmShpunAppRouterList,
  shmShpunAppRouterUnbind,
  shmStopUserService,
  shmStorageManageGetText,
} from "../../shared/shm/shmClient.js";

function mapStatus(raw?: string) {
  const s = String(raw || "").toUpperCase();
  if (s === "ACTIVE") return "active";
  if (s === "BLOCK") return "blocked";
  if (s === "PROGRESS") return "pending";
  if (s === "NOT PAID") return "not_paid";
  if (s === "REMOVED") return "removed";
  if (s === "ERROR") return "error";
  return "init";
}

function toIso(d: any): string | null {
  if (!d) return null;
  const t = Date.parse(String(d));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function calcDaysLeft(iso: string | null) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diff = t - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function pickPrice(x: any) {
  const cost = Number(x?.cost ?? 0);
  return Number.isFinite(cost) && cost >= 0 ? cost : 0;
}

function pickPeriodRaw(p: any) {
  const raw = p === null || p === undefined ? "" : String(p);
  return raw.trim();
}

function unwrapUsObject(json: any): any | null {
  const data = json?.data ?? json;
  if (Array.isArray(data)) return data[0] ?? null;
  if (data && typeof data === "object") return data;
  return null;
}

function ensureAuthed(req: any, reply: any): string | null {
  const session = getSessionFromRequest(req as any);
  const shmSessionId = session?.shmSessionId || null;
  if (!shmSessionId) {
    reply.code(401).send({ ok: false, error: "not_authenticated" });
    return null;
  }
  return shmSessionId;
}

async function loadUserServiceByUsi(shmSessionId: string, usi: number) {
  const r = await shmGetUserServices(shmSessionId, { limit: 50, offset: 0, filter: {} });
  if (!r.ok) {
    return { ok: false as const, status: r.status, json: r.json, text: r.text };
  }
  const raw = (r.json as any)?.data ?? [];
  const list = Array.isArray(raw) ? raw : [];
  const found = list.find((x: any) => Number(x?.user_service_id ?? 0) === usi) ?? null;
  return { ok: true as const, item: found };
}

function isDebug(req: any) {
  const q = (req.query ?? {}) as any;
  const v = String(q?.debug ?? "").trim();
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

function normalizeProfileText(text: string) {
  if (!text) return "";
  let t = text;
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); // remove BOM
  t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim(); // normalize newlines
  return t;
}

/* ============================================================
   Clean error helpers (no tech codes in UX)
============================================================ */

function sendNotAuthenticated(reply: any) {
  return reply.code(401).send({ ok: false, error: "not_authenticated" });
}

function sendShmError(
  reply: any,
  opts: {
    httpCode?: number; // default 502
    status?: number;
    details?: any;
    debug?: boolean;
    message?: string;
  }
) {
  return reply.code(opts.httpCode ?? 502).send({
    ok: false,
    error: "shm_error",
    message: opts.message ?? "Не удалось обновить данные. Попробуйте ещё раз чуть позже.",
    status: opts.status,
    details: opts.debug ? opts.details : undefined,
  });
}

function sendTemplateError(
  reply: any,
  opts: {
    httpCode?: number; // default 502
    status?: number;
    details?: any;
    debug?: boolean;
    message?: string;
  }
) {
  return reply.code(opts.httpCode ?? 502).send({
    ok: false,
    error: "shm_template_failed",
    message: opts.message ?? "Не удалось выполнить операцию. Попробуйте ещё раз чуть позже.",
    status: opts.status,
    details: opts.debug ? opts.details : undefined,
  });
}

function sendStorageError(
  reply: any,
  opts: {
    httpCode?: number; // default 502
    status?: number;
    details?: any;
    debug?: boolean;
    message?: string;
  }
) {
  return reply.code(opts.httpCode ?? 502).send({
    ok: false,
    error: "shm_storage_failed",
    message: opts.message ?? "Не удалось получить данные для подключения. Попробуйте ещё раз.",
    status: opts.status,
    details: opts.debug ? opts.details : undefined,
  });
}

/* ============================================================
   Routes
============================================================ */

export async function servicesRoutes(app: FastifyInstance) {
  app.get("/services", async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply);
    if (!shmSessionId) return;

    const debug = isDebug(req);

    const r = await shmGetUserServices(shmSessionId, {
      limit: 50,
      offset: 0,
      filter: {},
    });

    if (!r.ok) {
      if (r.status === 401 || r.status === 403) return sendNotAuthenticated(reply);
      return sendShmError(reply, {
        status: r.status,
        details: r.json ?? r.text,
        debug,
        message: "Не удалось загрузить список услуг. Попробуйте ещё раз.",
      });
    }

    const raw = (r.json as any)?.data ?? [];
    const list = Array.isArray(raw) ? raw : [];

    const items = list.map((us: any) => {
      const svc = us?.service ?? {};
      const expireAt = toIso(us?.expire);
      const createdAt = toIso(us?.created);

      return {
        userServiceId: Number(us?.user_service_id ?? 0) || 0,
        serviceId: Number(us?.service_id ?? 0) || 0,
        title: String(svc?.name ?? "Service"),
        descr: String(svc?.descr ?? ""),
        category: String(svc?.category ?? ""),
        status: mapStatus(us?.status),
        statusRaw: String(us?.status ?? ""),
        createdAt,
        expireAt,
        daysLeft: calcDaysLeft(expireAt),
        price: Number(svc?.cost ?? 0) || 0,
        periodMonths: Number(svc?.period ?? 1) || 1,
        currency: "RUB",
      };
    });

    const summary = {
      total: items.length,
      active: items.filter((x) => x.status === "active").length,
      blocked: items.filter((x) => x.status === "blocked").length,
      pending: items.filter((x) => x.status === "pending").length,
      notPaid: items.filter((x) => x.status === "not_paid").length,
      expiringSoon: items.filter((x) => (x.daysLeft ?? 999) >= 0 && (x.daysLeft ?? 999) <= 7).length,
      monthlyCost: items
        .filter((x) => x.status === "active" || x.status === "pending" || x.status === "not_paid")
        .reduce((s, x) => s + (x.price || 0), 0),
      currency: "RUB",
    };

    return reply.send({ ok: true, items, summary });
  });

  /**
   * ✅ STOP / BLOCK service
   * POST /api/services/:usi/stop
   */
  app.post("/services/:usi/stop", async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply);
    if (!shmSessionId) return;

    const debug = isDebug(req);

    const usi = Number((req.params as any)?.usi ?? 0);
    if (!usi || !Number.isFinite(usi)) {
      return reply.code(400).send({ ok: false, error: "bad_request", details: "usi_required" });
    }

    const svc = await loadUserServiceByUsi(shmSessionId, usi);
    if (!svc.ok) {
      return sendShmError(reply, {
        status: svc.status,
        details: svc.json ?? svc.text,
        debug,
        message: "Не удалось обновить статус услуги. Попробуйте ещё раз.",
      });
    }
    if (!svc.item) {
      return reply.code(404).send({ ok: false, error: "service_not_found" });
    }

    const statusRaw = String(svc.item?.status ?? "");
    const statusUi = mapStatus(statusRaw);

    if (statusUi === "pending" || statusUi === "init") {
      return reply.code(409).send({
        ok: false,
        error: "service_not_ready",
        status: statusRaw,
        message: "Услуга ещё не готова. Попробуйте позже.",
      });
    }

    if (statusUi === "removed") return reply.send({ ok: true, stopped: false, already: "removed", usi });
    if (statusUi === "blocked" || statusUi === "not_paid" || statusUi === "error") {
      return reply.send({ ok: true, stopped: false, already: statusUi, usi });
    }

    const r = await shmStopUserService(shmSessionId, usi);

    if (!r.ok) {
      if (r.status === 401 || r.status === 403) return sendNotAuthenticated(reply);
      return sendShmError(reply, {
        status: r.status,
        details: r.json ?? r.text,
        debug,
        message: "Не удалось остановить услугу. Попробуйте ещё раз.",
      });
    }

    return reply.send({ ok: true, stopped: true, usi });
  });

  app.delete("/services/:usi", async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply);
    if (!shmSessionId) return;

    const debug = isDebug(req);

    const usi = Number((req.params as any)?.usi ?? 0);
    if (!usi || !Number.isFinite(usi)) {
      return reply.code(400).send({ ok: false, error: "bad_request", details: "usi_required" });
    }

    const svc = await loadUserServiceByUsi(shmSessionId, usi);
    if (!svc.ok) {
      return sendShmError(reply, {
        status: svc.status,
        details: svc.json ?? svc.text,
        debug,
        message: "Не удалось обновить данные услуги. Попробуйте ещё раз.",
      });
    }
    if (!svc.item) {
      return reply.code(404).send({ ok: false, error: "service_not_found" });
    }

    const r = await shmDeleteUserService(shmSessionId, usi);

    if (!r.ok) {
      if (r.status === 401 || r.status === 403) return sendNotAuthenticated(reply);
      return sendShmError(reply, {
        status: r.status,
        details: r.json ?? r.text,
        debug,
        message: "Не удалось удалить услугу. Попробуйте ещё раз.",
      });
    }

    return reply.send({ ok: true, removed: true, usi });
  });

  // ---------------------
  // CONNECT (Marzban / AmneziaWG)
  // ---------------------

  /**
   * Универсальная ручка: вернуть данные для подключения услуги.
   * GET /api/services/:usi/connect/:kind
   * kind: marzban | amneziawg
   */
  app.get("/services/:usi/connect/:kind", async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply);
    if (!shmSessionId) return;

    const debug = isDebug(req);

    const usi = Number((req.params as any)?.usi ?? 0);
    const kind = String((req.params as any)?.kind ?? "").trim().toLowerCase();

    if (!usi || !Number.isFinite(usi)) {
      return reply.code(400).send({ ok: false, error: "bad_request", details: "usi_required" });
    }
    if (!kind) return reply.code(400).send({ ok: false, error: "bad_request", details: "kind_required" });

    const svc = await loadUserServiceByUsi(shmSessionId, usi);
    if (!svc.ok) {
      return sendShmError(reply, {
        status: svc.status,
        details: svc.json ?? svc.text,
        debug,
        message: "Не удалось получить данные услуги. Попробуйте ещё раз.",
      });
    }
    if (!svc.item) return reply.code(404).send({ ok: false, error: "service_not_found" });

    const statusRaw = String(svc.item?.status ?? "");
    const category = String(svc.item?.service?.category ?? svc.item?.category ?? "");

    if (String(statusRaw).toUpperCase() !== "ACTIVE") {
      return reply.code(409).send({ ok: false, error: "service_not_ready", status: statusRaw, message: "Услуга ещё не готова." });
    }

    if (kind === "marzban") {
      const r = await shmShpunAppConnectGet(shmSessionId, usi, "marzban");
      const j: any = r.json ?? {};

      if (!r.ok) {
        return sendTemplateError(reply, {
          status: r.status,
          debug,
          details: { text: r.text, json: r.json },
          message: "Не удалось получить данные подключения. Попробуйте ещё раз.",
        });
      }
      if ((j?.ok ?? 0) !== 1) {
        return reply.code(400).send({
          ok: false,
          error: j?.error || "connect_get_failed",
          message: "Не удалось получить данные подключения. Попробуйте ещё раз.",
          details: debug ? j : undefined,
        });
      }

      const subscriptionUrl = String(j?.subscription_url ?? "").trim();
      if (!subscriptionUrl) {
        return reply.code(502).send({
          ok: false,
          error: "connect_payload_empty",
          message: "Не удалось получить данные подключения. Попробуйте ещё раз.",
          details: debug ? { kind, category, template_response: j } : undefined,
        });
      }

      if (debug) {
        return reply.send({
          ok: true,
          kind,
          usi,
          category,
          subscriptionUrl,
          debug: { template_response: j },
        });
      }

      return reply.send({ ok: true, kind, subscriptionUrl });
    }

    if (kind === "amneziawg") {
      const storageName = `vpn${usi}`;
      const r = await shmStorageManageGetText(shmSessionId, storageName);

      if (!r.ok) {
        if (r.status === 401 || r.status === 403) return sendNotAuthenticated(reply);
        return sendStorageError(reply, {
          status: r.status,
          debug,
          details: { text: r.text, json: r.json },
          message: "Не удалось получить конфигурацию. Попробуйте ещё раз.",
        });
      }

      const configText = normalizeProfileText(String(r.text ?? ""));
      if (!configText) {
        return reply.code(502).send({
          ok: false,
          error: "config_empty",
          message: "Конфигурация пуста. Попробуйте ещё раз.",
          details: debug ? { storageName } : undefined,
        });
      }

      if (debug) {
        return reply.send({
          ok: true,
          kind,
          usi,
          category,
          storageName,
          configName: `${storageName}.conf`,
          configText,
        });
      }

      return reply.send({
        ok: true,
        kind,
        configName: `${storageName}.conf`,
        configText,
      });
    }

    return reply.code(400).send({ ok: false, error: "unknown_kind", details: kind, message: "Неизвестный тип подключения." });
  });

  // ---------------------
  // ROUTERS
  // ---------------------

  app.get("/services/:usi/router", async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply);
    if (!shmSessionId) return;

    const debug = isDebug(req);

    const usi = Number((req.params as any)?.usi ?? 0);
    if (!usi || !Number.isFinite(usi)) {
      return reply.code(400).send({ ok: false, error: "bad_request", details: "usi_required" });
    }

    const svc = await loadUserServiceByUsi(shmSessionId, usi);
    if (!svc.ok) {
      return sendShmError(reply, { status: svc.status, details: svc.json ?? svc.text, debug, message: "Не удалось обновить данные. Попробуйте ещё раз." });
    }
    if (!svc.item) return reply.code(404).send({ ok: false, error: "service_not_found" });

    const statusRaw = String(svc.item?.status ?? "");
    const category = String(svc.item?.service?.category ?? svc.item?.category ?? "");

    if (category !== "marzban-r") {
      return reply.code(400).send({
        ok: false,
        error: "not_router_service",
        message: "Эта услуга не поддерживает роутер-привязку.",
        details: debug ? { category, usi } : undefined,
      });
    }
    if (String(statusRaw).toUpperCase() !== "ACTIVE") {
      return reply.code(409).send({ ok: false, error: "service_not_ready", status: statusRaw, message: "Услуга ещё не готова." });
    }

    const r = await shmShpunAppRouterList(shmSessionId, usi);
    const j: any = r.json ?? {};

    if (!r.ok) {
      return sendTemplateError(reply, {
        status: r.status,
        debug,
        details: { text: r.text, json: r.json },
        message: "Не удалось загрузить список роутеров. Попробуйте ещё раз.",
      });
    }
    if ((j?.ok ?? 0) !== 1) {
      return reply.code(400).send({
        ok: false,
        error: j?.error || "router_list_failed",
        message: "Не удалось загрузить список роутеров. Попробуйте ещё раз.",
        details: debug ? j : undefined,
      });
    }

    const routers = Array.isArray(j?.routers) ? j.routers : [];

    if (debug) {
      return reply.send({
        ok: true,
        routers,
        debug: { usi, category, statusRaw, template_response: j },
      });
    }

    return reply.send({ ok: true, routers });
  });

  app.post("/services/:usi/router/bind", async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply);
    if (!shmSessionId) return;

    const debug = isDebug(req);

    const usi = Number((req.params as any)?.usi ?? 0);
    if (!usi || !Number.isFinite(usi)) {
      return reply.code(400).send({ ok: false, error: "bad_request", details: "usi_required" });
    }

    const code = String((req.body as any)?.code ?? "").trim();
    if (!code) return reply.code(400).send({ ok: false, error: "code_required", message: "Введите код роутера." });

    const svc = await loadUserServiceByUsi(shmSessionId, usi);
    if (!svc.ok) return sendShmError(reply, { status: svc.status, details: svc.json ?? svc.text, debug, message: "Не удалось обновить данные. Попробуйте ещё раз." });
    if (!svc.item) return reply.code(404).send({ ok: false, error: "service_not_found" });

    const statusRaw = String(svc.item?.status ?? "");
    const category = String(svc.item?.service?.category ?? svc.item?.category ?? "");

    if (category !== "marzban-r") return reply.code(400).send({ ok: false, error: "not_router_service", message: "Эта услуга не поддерживает привязку роутера." });
    if (String(statusRaw).toUpperCase() !== "ACTIVE") return reply.code(409).send({ ok: false, error: "service_not_ready", status: statusRaw, message: "Услуга ещё не готова." });

    const r = await shmShpunAppRouterBind(shmSessionId, usi, code);
    const j: any = r.json ?? {};

    if (!r.ok) {
      return sendTemplateError(reply, { status: r.status, debug, details: { text: r.text, json: r.json }, message: "Не удалось привязать роутер. Попробуйте ещё раз." });
    }
    if ((j?.ok ?? 0) !== 1) {
      return reply.code(400).send({
        ok: false,
        error: j?.error || "router_bind_failed",
        message: "Не удалось привязать роутер. Проверьте код и попробуйте ещё раз.",
        details: debug ? j : undefined,
      });
    }

    if (debug) return reply.send({ ok: true, clean_code: j?.clean_code ?? "", debug: { template_response: j } });
    return reply.send({ ok: true, clean_code: j?.clean_code ?? "" });
  });

  app.post("/services/:usi/router/unbind", async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply);
    if (!shmSessionId) return;

    const debug = isDebug(req);

    const usi = Number((req.params as any)?.usi ?? 0);
    if (!usi || !Number.isFinite(usi)) {
      return reply.code(400).send({ ok: false, error: "bad_request", details: "usi_required" });
    }

    const code = String((req.body as any)?.code ?? "").trim();
    if (!code) return reply.code(400).send({ ok: false, error: "code_required", message: "Введите код роутера." });

    const svc = await loadUserServiceByUsi(shmSessionId, usi);
    if (!svc.ok) return sendShmError(reply, { status: svc.status, details: svc.json ?? svc.text, debug, message: "Не удалось обновить данные. Попробуйте ещё раз." });
    if (!svc.item) return reply.code(404).send({ ok: false, error: "service_not_found" });

    const statusRaw = String(svc.item?.status ?? "");
    const category = String(svc.item?.service?.category ?? svc.item?.category ?? "");

    if (category !== "marzban-r") return reply.code(400).send({ ok: false, error: "not_router_service", message: "Эта услуга не поддерживает отвязку роутера." });
    if (String(statusRaw).toUpperCase() !== "ACTIVE") return reply.code(409).send({ ok: false, error: "service_not_ready", status: statusRaw, message: "Услуга ещё не готова." });

    const r = await shmShpunAppRouterUnbind(shmSessionId, usi, code);
    const j: any = r.json ?? {};

    if (!r.ok) {
      return sendTemplateError(reply, { status: r.status, debug, details: { text: r.text, json: r.json }, message: "Не удалось отвязать роутер. Попробуйте ещё раз." });
    }
    if ((j?.ok ?? 0) !== 1) {
      return reply.code(400).send({
        ok: false,
        error: j?.error || "router_unbind_failed",
        message: "Не удалось отвязать роутер. Попробуйте ещё раз.",
        details: debug ? j : undefined,
      });
    }

    if (debug) {
      return reply.send({
        ok: true,
        unbound: j?.unbound ?? 0,
        clean_code: j?.clean_code ?? "",
        debug: { template_response: j },
      });
    }

    return reply.send({ ok: true, unbound: j?.unbound ?? 0, clean_code: j?.clean_code ?? "" });
  });

  // =====================
  // /api/services/order
  // =====================

  app.get("/services/order", async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply);
    if (!shmSessionId) return;

    const debug = isDebug(req);

    const r = await shmGetServiceOrder(shmSessionId);

    if (!r.ok) {
      if (r.status === 401 || r.status === 403) return sendNotAuthenticated(reply);
      return sendShmError(reply, {
        status: r.status,
        details: r.json ?? r.text,
        debug,
        message: "Не удалось загрузить тарифы. Попробуйте ещё раз.",
      });
    }

    const raw = (r.json as any)?.data ?? [];
    const list = Array.isArray(raw) ? raw : [];

    const items = list
      .filter((x: any) => Number(x?.deleted ?? 0) === 0)
      .filter((x: any) => Number(x?.allow_to_order ?? 1) === 1)
      .map((x: any) => {
        const periodRaw = pickPeriodRaw(x?.period);
        const p = parseShmPeriod(periodRaw);

        return {
          serviceId: Number(x?.service_id ?? 0) || 0,
          category: String(x?.category ?? ""),
          title: String(x?.name ?? "Service"),
          descr: x?.descr == null ? "" : String(x?.descr),
          price: pickPrice(x),
          currency: "RUB",
          periodRaw,
          periodHuman: p.human,
          flags: { orderOnlyOnce: !!x?.config?.order_only_once },
        };
      });

    return reply.send({ ok: true, items });
  });

  app.put("/services/order", async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply);
    if (!shmSessionId) return;

    const debug = isDebug(req);

    const body = (req.body ?? {}) as any;
    const serviceId = Number(body?.service_id ?? body?.serviceId ?? 0);

    if (!serviceId || !Number.isFinite(serviceId)) {
      return reply.code(400).send({ ok: false, error: "bad_request", details: "service_id_required" });
    }

    // =====================
    // ORDER BLOCK CHECK
    // =====================

    let orderBlockMode: "off" | "same_type" | "any" = "off";

    try {
      const settingsRes = await shmShpunAppOrderRulesGet(shmSessionId);

      if (settingsRes.ok) {
        const modeRaw = String((settingsRes.json as any)?.orderBlockMode ?? "off").trim();
        if (modeRaw === "off" || modeRaw === "same_type" || modeRaw === "any") {
          orderBlockMode = modeRaw;
        }
      }
    } catch {
      // fail-open: если настройки не прочитались, не ломаем оформление заказа
    }

    if (orderBlockMode !== "off") {
      const servicesRes = await shmGetUserServices(shmSessionId, {
        limit: 50,
        offset: 0,
        filter: {},
      });

      if (!servicesRes.ok) {
        if (servicesRes.status === 401 || servicesRes.status === 403) return sendNotAuthenticated(reply);
        return sendShmError(reply, {
          status: servicesRes.status,
          details: servicesRes.json ?? servicesRes.text,
          debug,
          message: "Не удалось проверить существующие услуги. Попробуйте ещё раз.",
        });
      }

      const rawServices = (servicesRes.json as any)?.data ?? [];
      const userServices = Array.isArray(rawServices) ? rawServices : [];

      const unpaidServices = userServices.filter((x: any) => {
        const status = String(x?.status ?? "").trim().toUpperCase();
        return status === "NOT PAID";
      });

      if (unpaidServices.length > 0) {
        if (orderBlockMode === "any") {
          return reply.code(409).send({
            ok: false,
            error: "unpaid_order_exists",
            message: "У вас уже есть неоплаченная услуга. Оплатите её или удалите, чтобы создать новую.",
          });
        }

        if (orderBlockMode === "same_type") {
          const orderListRes = await shmGetServiceOrder(shmSessionId);

          if (!orderListRes.ok) {
            if (orderListRes.status === 401 || orderListRes.status === 403) return sendNotAuthenticated(reply);
            return sendShmError(reply, {
              status: orderListRes.status,
              details: orderListRes.json ?? orderListRes.text,
              debug,
              message: "Не удалось проверить тип услуги. Попробуйте ещё раз.",
            });
          }

          const orderItems = (orderListRes.json as any)?.data ?? [];
          const availableServices = Array.isArray(orderItems) ? orderItems : [];

          const requestedService =
            availableServices.find((x: any) => Number(x?.service_id ?? 0) === serviceId) ?? null;

          const requestedCategory = String(requestedService?.category ?? "").trim();

          if (requestedCategory) {
            const hasSameTypeUnpaid = unpaidServices.some((x: any) => {
              const existingCategory = String(x?.service?.category ?? x?.category ?? "").trim();
              return existingCategory === requestedCategory;
            });

            if (hasSameTypeUnpaid) {
              return reply.code(409).send({
                ok: false,
                error: "unpaid_same_service_exists",
                message: "У вас уже есть неоплаченная услуга этого типа. Оплатите её или удалите, чтобы создать новую.",
              });
            }
          }
        }
      }
    }

    const r = await shmCreateServiceOrder(shmSessionId, serviceId);

    if (!r.ok) {
      if (r.status === 401 || r.status === 403) return sendNotAuthenticated(reply);
      return sendShmError(reply, {
        status: r.status,
        details: r.json ?? r.text,
        debug,
        message: "Не удалось создать заказ. Попробуйте ещё раз.",
      });
    }

    const us = unwrapUsObject(r.json);
    if (!us) {
      return reply.code(502).send({
        ok: false,
        error: "shm_bad_response",
        message: "Сервер вернул некорректный ответ. Попробуйте ещё раз.",
        details: debug ? (r.json ?? r.text) : undefined,
      });
    }

    const statusRaw = String(us?.status ?? "");
    const item = {
      userServiceId: Number(us?.user_service_id ?? 0) || 0,
      serviceId: Number(us?.service_id ?? serviceId) || serviceId,
      status: mapStatus(statusRaw),
      statusRaw,
    };

    return reply.send({ ok: true, item, raw: us });
  });
}