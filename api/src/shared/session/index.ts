import type { FastifyInstance } from "fastify";
import { shmGetUserServices } from "../../shared/shm/shmClient";

/**
 * ВАЖНО: тут нужен доступ к shm_session_id из твоего session store.
 * Я оставил функцию-заглушку getShmSessionIdFromRequest — ты либо
 * 1) подставляешь свою реализацию (2 строки),
 * либо
 * 2) присылаешь api/src/shared/session/* и я сделаю идеально под твою схему.
 */
async function getShmSessionIdFromRequest(req: any): Promise<string | null> {
  // ====== ВАРИАНТ A (пример): если у тебя есть req.cookies.sid ======
  // const sid = req.cookies?.sid
  // if (!sid) return null
  // const s = getSession(sid) // <- твой sessionStore
  // return s?.shm_session_id ?? null

  // ====== ВАРИАНТ B (пример): если у тебя есть helper getSession(req) ======
  // const s = getSession(req)
  // return s?.shm_session_id ?? null

  return null; // <-- заменишь
}

type UiServiceStatus = "active" | "blocked" | "pending" | "not_paid" | "removed" | "error" | "init";

function mapStatus(shmStatus: string | undefined): UiServiceStatus {
  switch ((shmStatus || "").toUpperCase()) {
    case "ACTIVE": return "active";
    case "BLOCK": return "blocked";
    case "PROGRESS": return "pending";
    case "NOT PAID": return "not_paid";
    case "REMOVED": return "removed";
    case "ERROR": return "error";
    case "INIT": return "init";
    default: return "init";
  }
}

function toIso(d: any): string | null {
  if (!d) return null;
  const t = Date.parse(String(d));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diff = t - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export async function servicesModule(app: FastifyInstance) {
  // GET /api/services
  app.get("/services", async (req, reply) => {
    const shmSessionId = await getShmSessionIdFromRequest(req);
    if (!shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const limit = Number((req.query as any)?.limit ?? 50);
    const offset = Number((req.query as any)?.offset ?? 0);

    const r = await shmGetUserServices(shmSessionId, { limit, offset, filter: {} });

    if (!r.ok) {
      // Если SHM сессию не принял — пробрасываем как not_authenticated
      if (r.status === 401 || r.status === 403) {
        return reply.code(401).send({ ok: false, error: "not_authenticated" });
      }
      return reply.code(502).send({
        ok: false,
        error: "shm_error",
        status: r.status,
        details: r.json ?? r.text,
      });
    }

    // SHM: { data: [USObject], items, limit, offset, status }
    const data = (r.json as any)?.data ?? [];
    const items = Array.isArray(data) ? data : [];

    const mapped = items.map((us: any) => {
      const svc = us?.service || {};
      const statusRaw = us?.status;
      const status = mapStatus(statusRaw);

      const expireAt = toIso(us?.expire);
      const createdAt = toIso(us?.created);

      const cost = Number(svc?.cost ?? 0) || 0;
      const period = Number(svc?.period ?? 1) || 1;

      return {
        userServiceId: Number(us?.user_service_id ?? 0) || 0,
        serviceId: Number(us?.service_id ?? svc?.service_id ?? 0) || 0,
        title: String(svc?.name ?? `Service #${us?.service_id ?? ""}`),
        descr: String(svc?.descr ?? ""),
        category: String(svc?.category ?? ""),
        status,                 // для UI
        statusRaw: String(statusRaw ?? ""),
        createdAt,
        expireAt,
        daysLeft: daysUntil(expireAt),
        price: cost,
        periodMonths: period,
        currency: "RUB",        // в SHM сейчас нет валюты в Service, считаем RUB
      };
    });

    // Summary для Home/Services
    const summary = {
      total: mapped.length,
      active: mapped.filter((x) => x.status === "active").length,
      blocked: mapped.filter((x) => x.status === "blocked").length,
      pending: mapped.filter((x) => x.status === "pending").length,
      notPaid: mapped.filter((x) => x.status === "not_paid").length,
      expiringSoon: mapped.filter((x) => (x.daysLeft ?? 9999) >= 0 && (x.daysLeft ?? 9999) <= 7).length,
      monthlyCost: mapped
        .filter((x) => x.status === "active" || x.status === "pending" || x.status === "not_paid")
        .reduce((s, x) => s + (Number(x.price) || 0), 0),
      currency: "RUB",
    };

    return reply.send({
      ok: true,
      items: mapped,
      summary,
      shm: {
        limit: (r.json as any)?.limit ?? limit,
        offset: (r.json as any)?.offset ?? offset,
        items: (r.json as any)?.items ?? mapped.length,
      },
    });
  });
}
