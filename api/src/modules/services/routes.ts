import type { FastifyInstance } from 'fastify'
import { shmGetUserServices } from '../../shared/shm/shmClient.js'
import { getSessionFromRequest } from '../../shared/session/sessionStore.js'

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

export async function servicesRoutes(app: FastifyInstance) {
  app.get('/services', async (req, reply) => {
    // ✅ единый способ: сессия из cookie sid (и touch/ttl внутри)
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
}
