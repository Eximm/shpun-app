import type { FastifyInstance } from 'fastify'
import { getSessionFromRequest } from '../../shared/session/sessionStore.js'
import { parseShmPeriod } from '../../shared/shm/period.js'
import { shmCreateServiceOrder, shmGetServiceOrder, shmGetUserServices } from '../../shared/shm/shmClient.js'

function mapStatus(raw?: string) {
  const s = String(raw || '').toUpperCase()
  if (s === 'ACTIVE') return 'active'
  if (s === 'BLOCK') return 'blocked'
  if (s === 'PROGRESS') return 'pending'
  if (s === 'NOT PAID') return 'not_paid'
  if (s === 'REMOVED') return 'removed'
  if (s === 'ERROR') return 'error'
  return 'init'
}

function toIso(d: any): string | null {
  if (!d) return null
  const t = Date.parse(String(d))
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

function calcDaysLeft(iso: string | null) {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const diff = t - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function pickPrice(x: any) {
  // для UI почти всегда лучше real_cost, если он есть
  const real = Number(x?.real_cost ?? NaN)
  if (Number.isFinite(real) && real >= 0) return real
  const cost = Number(x?.cost ?? 0)
  return Number.isFinite(cost) ? cost : 0
}

function pickPeriodRaw(p: any) {
  const raw = p === null || p === undefined ? '' : String(p)
  return raw.trim()
}

// SHM create-order иногда возвращает массив USObject или объект.
// Берём первый элемент массива или сам объект.
function unwrapUsObject(json: any): any | null {
  const data = json?.data ?? json
  if (Array.isArray(data)) return data[0] ?? null
  if (data && typeof data === 'object') return data
  return null
}

export async function servicesRoutes(app: FastifyInstance) {
  // =====================
  // /api/services (уже было)
  // =====================
  app.get('/services', async (req, reply) => {
    const session = getSessionFromRequest(req as any)
    const shmSessionId = session?.shmSessionId || null

    if (!shmSessionId) {
      return reply.code(401).send({ ok: false, error: 'not_authenticated' })
    }

    const r = await shmGetUserServices(shmSessionId, {
      limit: 50,
      offset: 0,
      filter: {},
    })

    if (!r.ok) {
      if (r.status === 401 || r.status === 403) {
        return reply.code(401).send({ ok: false, error: 'not_authenticated' })
      }

      return reply.code(502).send({
        ok: false,
        error: 'shm_error',
        status: r.status,
        details: r.json ?? r.text,
      })
    }

    const raw = (r.json as any)?.data ?? []
    const list = Array.isArray(raw) ? raw : []

    const items = list.map((us: any) => {
      const svc = us?.service ?? {}
      const expireAt = toIso(us?.expire)
      const createdAt = toIso(us?.created)

      return {
        userServiceId: Number(us?.user_service_id ?? 0) || 0,
        serviceId: Number(us?.service_id ?? 0) || 0,
        title: String(svc?.name ?? 'Service'),
        descr: String(svc?.descr ?? ''),
        category: String(svc?.category ?? ''),
        status: mapStatus(us?.status),
        statusRaw: String(us?.status ?? ''),
        createdAt,
        expireAt,
        daysLeft: calcDaysLeft(expireAt),
        price: Number(svc?.cost ?? 0) || 0,
        periodMonths: Number(svc?.period ?? 1) || 1,
        currency: 'RUB',
      }
    })

    const summary = {
      total: items.length,
      active: items.filter((x) => x.status === 'active').length,
      blocked: items.filter((x) => x.status === 'blocked').length,
      pending: items.filter((x) => x.status === 'pending').length,
      notPaid: items.filter((x) => x.status === 'not_paid').length,
      expiringSoon: items.filter((x) => (x.daysLeft ?? 999) >= 0 && (x.daysLeft ?? 999) <= 7).length,
      monthlyCost: items
        .filter((x) => x.status === 'active' || x.status === 'pending' || x.status === 'not_paid')
        .reduce((s, x) => s + (x.price || 0), 0),
      currency: 'RUB',
    }

    return reply.send({ ok: true, items, summary })
  })

  // =====================
  // /api/services/order (list tariffs)
  // =====================
  app.get('/services/order', async (req, reply) => {
    const session = getSessionFromRequest(req as any)
    const shmSessionId = session?.shmSessionId || null

    if (!shmSessionId) {
      return reply.code(401).send({ ok: false, error: 'not_authenticated' })
    }

    const r = await shmGetServiceOrder(shmSessionId)

    if (!r.ok) {
      if (r.status === 401 || r.status === 403) {
        return reply.code(401).send({ ok: false, error: 'not_authenticated' })
      }
      return reply.code(502).send({
        ok: false,
        error: 'shm_error',
        status: r.status,
        details: r.json ?? r.text,
      })
    }

    const raw = (r.json as any)?.data ?? []
    const list = Array.isArray(raw) ? raw : []

    const items = list
      .filter((x: any) => Number(x?.deleted ?? 0) === 0)
      .filter((x: any) => Number(x?.allow_to_order ?? 1) === 1)
      .map((x: any) => {
        const periodRaw = pickPeriodRaw(x?.period)
        const p = parseShmPeriod(periodRaw)

        return {
          serviceId: Number(x?.service_id ?? 0) || 0,
          category: String(x?.category ?? ''),
          title: String(x?.name ?? 'Service'),
          descr: x?.descr == null ? '' : String(x?.descr),
          price: pickPrice(x),
          currency: 'RUB',
          periodRaw,
          periodHuman: p.human,
          flags: {
            orderOnlyOnce: !!x?.config?.order_only_once,
          },
        }
      })

    return reply.send({ ok: true, items })
  })

  // =====================
  // /api/services/order (create user-service)
  // =====================
  app.put('/services/order', async (req, reply) => {
    const session = getSessionFromRequest(req as any)
    const shmSessionId = session?.shmSessionId || null

    if (!shmSessionId) {
      return reply.code(401).send({ ok: false, error: 'not_authenticated' })
    }

    const body = (req.body ?? {}) as any
    const serviceId = Number(body?.service_id ?? body?.serviceId ?? 0)

    if (!serviceId || !Number.isFinite(serviceId)) {
      return reply.code(400).send({ ok: false, error: 'bad_request', details: 'service_id_required' })
    }

    const r = await shmCreateServiceOrder(shmSessionId, serviceId)

    if (!r.ok) {
      if (r.status === 401 || r.status === 403) {
        return reply.code(401).send({ ok: false, error: 'not_authenticated' })
      }
      return reply.code(502).send({
        ok: false,
        error: 'shm_error',
        status: r.status,
        details: r.json ?? r.text,
      })
    }

    const us = unwrapUsObject(r.json)
    if (!us) {
      return reply.code(502).send({ ok: false, error: 'shm_bad_response', details: r.json ?? r.text })
    }

    const statusRaw = String(us?.status ?? '')
    const item = {
      userServiceId: Number(us?.user_service_id ?? 0) || 0,
      serviceId: Number(us?.service_id ?? serviceId) || serviceId,
      status: mapStatus(statusRaw),
      statusRaw,
    }

    return reply.send({ ok: true, item, raw: us })
  })
}