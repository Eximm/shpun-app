import type { FastifyInstance } from 'fastify'
import { getSessionFromRequest } from '../../shared/session/sessionStore.js'
import { parseShmPeriod } from '../../shared/shm/period.js'
import {
  shmCreateServiceOrder,
  shmDeleteUserService,
  shmGetServiceOrder,
  shmGetUserServices,
  shmShpunAppRouterBind,
  shmShpunAppRouterList,
  shmShpunAppRouterUnbind,
} from '../../shared/shm/shmClient.js'

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
  const real = Number(x?.real_cost ?? NaN)
  if (Number.isFinite(real) && real >= 0) return real
  const cost = Number(x?.cost ?? 0)
  return Number.isFinite(cost) ? cost : 0
}

function pickPeriodRaw(p: any) {
  const raw = p === null || p === undefined ? '' : String(p)
  return raw.trim()
}

function unwrapUsObject(json: any): any | null {
  const data = json?.data ?? json
  if (Array.isArray(data)) return data[0] ?? null
  if (data && typeof data === 'object') return data
  return null
}

function ensureAuthed(req: any, reply: any): string | null {
  const session = getSessionFromRequest(req as any)
  const shmSessionId = session?.shmSessionId || null
  if (!shmSessionId) {
    reply.code(401).send({ ok: false, error: 'not_authenticated' })
    return null
  }
  return shmSessionId
}

async function loadUserServiceByUsi(shmSessionId: string, usi: number) {
  const r = await shmGetUserServices(shmSessionId, { limit: 50, offset: 0, filter: {} })
  if (!r.ok) {
    return { ok: false as const, status: r.status, json: r.json, text: r.text }
  }
  const raw = (r.json as any)?.data ?? []
  const list = Array.isArray(raw) ? raw : []
  const found = list.find((x: any) => Number(x?.user_service_id ?? 0) === usi) ?? null
  return { ok: true as const, item: found }
}

function isDebug(req: any) {
  const q = (req.query ?? {}) as any
  const v = String(q?.debug ?? '').trim()
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes'
}

export async function servicesRoutes(app: FastifyInstance) {
  app.get('/services', async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply)
    if (!shmSessionId) return

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

  app.delete('/services/:usi', async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply)
    if (!shmSessionId) return

    const usi = Number((req.params as any)?.usi ?? 0)
    if (!usi || !Number.isFinite(usi)) {
      return reply.code(400).send({ ok: false, error: 'bad_request', details: 'usi_required' })
    }

    const svc = await loadUserServiceByUsi(shmSessionId, usi)
    if (!svc.ok) {
      return reply.code(502).send({
        ok: false,
        error: 'shm_error',
        status: svc.status,
        details: svc.json ?? svc.text,
      })
    }
    if (!svc.item) {
      return reply.code(404).send({ ok: false, error: 'service_not_found' })
    }

    const r = await shmDeleteUserService(shmSessionId, usi)

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

    return reply.send({ ok: true, removed: true, usi })
  })

  // ---------------------
  // ROUTERS
  // ---------------------

  app.get('/services/:usi/router', async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply)
    if (!shmSessionId) return

    const debug = isDebug(req)

    const usi = Number((req.params as any)?.usi ?? 0)
    if (!usi || !Number.isFinite(usi)) {
      return reply.code(400).send({ ok: false, error: 'bad_request', details: 'usi_required' })
    }

    // (валидация услуги оставляем как была)
    const svc = await loadUserServiceByUsi(shmSessionId, usi)
    if (!svc.ok) {
      return reply.code(502).send({ ok: false, error: 'shm_error', status: svc.status, details: svc.json ?? svc.text })
    }
    if (!svc.item) {
      return reply.code(404).send({ ok: false, error: 'service_not_found' })
    }

    const statusRaw = String(svc.item?.status ?? '')
    const category = String(svc.item?.service?.category ?? svc.item?.category ?? '')

    if (category !== 'marzban-r') {
      return reply.code(400).send({ ok: false, error: 'not_router_service', details: debug ? { category, usi } : undefined })
    }
    if (String(statusRaw).toUpperCase() !== 'ACTIVE') {
      return reply.code(409).send({ ok: false, error: 'service_not_ready', status: statusRaw })
    }

    const r = await shmShpunAppRouterList(shmSessionId, usi)
    const j: any = r.json ?? {}

    if (!r.ok) {
      return reply.code(502).send({
        ok: false,
        error: 'shm_template_failed',
        status: r.status,
        details: debug ? { text: r.text, json: r.json } : undefined,
      })
    }
    if ((j?.ok ?? 0) !== 1) {
      return reply.code(400).send({ ok: false, error: j?.error || 'router_list_failed', details: debug ? j : undefined })
    }

    const routers = Array.isArray(j?.routers) ? j.routers : []

    if (debug) {
      return reply.send({
        ok: true,
        routers,
        debug: {
          usi,
          category,
          statusRaw,
          template_response: j,
        },
      })
    }

    return reply.send({ ok: true, routers })
  })

  app.post('/services/:usi/router/bind', async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply)
    if (!shmSessionId) return

    const debug = isDebug(req)

    const usi = Number((req.params as any)?.usi ?? 0)
    if (!usi || !Number.isFinite(usi)) {
      return reply.code(400).send({ ok: false, error: 'bad_request', details: 'usi_required' })
    }

    const code = String((req.body as any)?.code ?? '').trim()
    if (!code) return reply.code(400).send({ ok: false, error: 'code_required' })

    const svc = await loadUserServiceByUsi(shmSessionId, usi)
    if (!svc.ok) {
      return reply.code(502).send({ ok: false, error: 'shm_error', status: svc.status, details: svc.json ?? svc.text })
    }
    if (!svc.item) {
      return reply.code(404).send({ ok: false, error: 'service_not_found' })
    }

    const statusRaw = String(svc.item?.status ?? '')
    const category = String(svc.item?.service?.category ?? svc.item?.category ?? '')

    if (category !== 'marzban-r') return reply.code(400).send({ ok: false, error: 'not_router_service' })
    if (String(statusRaw).toUpperCase() !== 'ACTIVE') {
      return reply.code(409).send({ ok: false, error: 'service_not_ready', status: statusRaw })
    }

    const r = await shmShpunAppRouterBind(shmSessionId, usi, code)
    const j: any = r.json ?? {}

    if (!r.ok) {
      return reply.code(502).send({
        ok: false,
        error: 'shm_template_failed',
        status: r.status,
        details: debug ? { text: r.text, json: r.json } : undefined,
      })
    }
    if ((j?.ok ?? 0) !== 1) {
      return reply.code(400).send({ ok: false, error: j?.error || 'router_bind_failed', details: debug ? j : undefined })
    }

    if (debug) return reply.send({ ok: true, clean_code: j?.clean_code ?? '', debug: { template_response: j } })
    return reply.send({ ok: true, clean_code: j?.clean_code ?? '' })
  })

  app.post('/services/:usi/router/unbind', async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply)
    if (!shmSessionId) return

    const debug = isDebug(req)

    const usi = Number((req.params as any)?.usi ?? 0)
    if (!usi || !Number.isFinite(usi)) {
      return reply.code(400).send({ ok: false, error: 'bad_request', details: 'usi_required' })
    }

    const code = String((req.body as any)?.code ?? '').trim()
    if (!code) return reply.code(400).send({ ok: false, error: 'code_required' })

    const svc = await loadUserServiceByUsi(shmSessionId, usi)
    if (!svc.ok) {
      return reply.code(502).send({ ok: false, error: 'shm_error', status: svc.status, details: svc.json ?? svc.text })
    }
    if (!svc.item) {
      return reply.code(404).send({ ok: false, error: 'service_not_found' })
    }

    const statusRaw = String(svc.item?.status ?? '')
    const category = String(svc.item?.service?.category ?? svc.item?.category ?? '')

    if (category !== 'marzban-r') return reply.code(400).send({ ok: false, error: 'not_router_service' })
    if (String(statusRaw).toUpperCase() !== 'ACTIVE') {
      return reply.code(409).send({ ok: false, error: 'service_not_ready', status: statusRaw })
    }

    const r = await shmShpunAppRouterUnbind(shmSessionId, usi, code)
    const j: any = r.json ?? {}

    if (!r.ok) {
      return reply.code(502).send({
        ok: false,
        error: 'shm_template_failed',
        status: r.status,
        details: debug ? { text: r.text, json: r.json } : undefined,
      })
    }
    if ((j?.ok ?? 0) !== 1) {
      return reply.code(400).send({
        ok: false,
        error: j?.error || 'router_unbind_failed',
        details: debug ? j : undefined,
      })
    }

    if (debug) {
      return reply.send({
        ok: true,
        unbound: j?.unbound ?? 0,
        clean_code: j?.clean_code ?? '',
        debug: { template_response: j },
      })
    }

    return reply.send({ ok: true, unbound: j?.unbound ?? 0, clean_code: j?.clean_code ?? '' })
  })

  // =====================
  // /api/services/order
  // =====================
  app.get('/services/order', async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply)
    if (!shmSessionId) return

    const r = await shmGetServiceOrder(shmSessionId)

    if (!r.ok) {
      if (r.status === 401 || r.status === 403) return reply.code(401).send({ ok: false, error: 'not_authenticated' })
      return reply.code(502).send({ ok: false, error: 'shm_error', status: r.status, details: r.json ?? r.text })
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
          flags: { orderOnlyOnce: !!x?.config?.order_only_once },
        }
      })

    return reply.send({ ok: true, items })
  })

  app.put('/services/order', async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply)
    if (!shmSessionId) return

    const body = (req.body ?? {}) as any
    const serviceId = Number(body?.service_id ?? body?.serviceId ?? 0)

    if (!serviceId || !Number.isFinite(serviceId)) {
      return reply.code(400).send({ ok: false, error: 'bad_request', details: 'service_id_required' })
    }

    const r = await shmCreateServiceOrder(shmSessionId, serviceId)

    if (!r.ok) {
      if (r.status === 401 || r.status === 403) return reply.code(401).send({ ok: false, error: 'not_authenticated' })
      return reply.code(502).send({ ok: false, error: 'shm_error', status: r.status, details: r.json ?? r.text })
    }

    const us = unwrapUsObject(r.json)
    if (!us) return reply.code(502).send({ ok: false, error: 'shm_bad_response', details: r.json ?? r.text })

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