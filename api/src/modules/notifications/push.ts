// api/src/modules/notifications/push.ts
import type { FastifyInstance } from 'fastify'
import { getSessionFromRequest } from '../../shared/session/sessionStore.js'
import { listEvents, putEvent, type BillingPushEvent } from './inbox.js'

function envStr(name: string, def = '') {
  const v = String(process.env[name] ?? '').trim()
  return v || def
}

/**
 * Billing → HTTP PUSH → Shpun App
 * - POST /api/billing/push (unauth, protected by secret header)
 * - GET  /api/notifications (authed, user + broadcast)
 */
export async function pushRoutes(app: FastifyInstance) {
  // ===== POST /api/billing/push =====
  app.post('/billing/push', async (req, reply) => {
    const secret = envStr('BILLING_PUSH_SECRET', '')
    if (secret) {
      const sign = String(req.headers['x-shpun-sign'] ?? '').trim()
      if (sign !== secret) {
        return reply.code(401).send({ ok: false, error: 'bad_signature' })
      }
    }

    const body = (req.body ?? {}) as BillingPushEvent
    const r = putEvent(body)

    if (!r.ok) return reply.code(400).send({ ok: false, error: r.error })
    return reply.send({ ok: true, dedup: r.dedup })
  })

  // ===== GET /api/notifications =====
  app.get('/notifications', async (req, reply) => {
    const s = getSessionFromRequest(req)
    const uid = s?.userId ? Number(s.userId) : 0

    const q = (req.query ?? {}) as any
    const afterTs = Number(q.afterTs ?? 0)

    const { items, nextCursor } = listEvents({ afterTs, userId: uid })
    return reply.send({ ok: true, items, nextCursor })
  })
}