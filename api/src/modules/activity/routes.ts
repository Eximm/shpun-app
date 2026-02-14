// api/src/modules/activity/routes.ts

import type { FastifyInstance } from 'fastify'
import { getSessionFromRequest } from '../../shared/session/sessionStore.js'
import { shmGetPays, shmFetch } from '../../shared/shm/shmClient.js'

type PayItem = {
  id: number
  money: number
  date?: string
  pay_system_id?: string
}

type WithdrawItem = {
  withdraw_id: number
  total?: number
  cost?: number
  create_date?: string
  withdraw_date?: string
  end_date?: string
}

export async function activityRoutes(app: FastifyInstance) {
  app.get('/activity', async (req, reply) => {
    const s = getSessionFromRequest(req as any)
    const shmSessionId = s?.shmSessionId || null

    if (!shmSessionId) {
      return reply.code(401).send({ ok: false, error: 'not_authenticated' })
    }

    // --- Pays (последние платежи) ---
    const paysRes = await shmGetPays(shmSessionId, { limit: 10, offset: 0 })

    let pays: PayItem[] = []
    if (paysRes.ok) {
      const raw = Array.isArray(paysRes.json?.data) ? paysRes.json?.data : []
      pays = raw.map((p: any) => ({
        id: Number(p?.id ?? 0) || 0,
        money: Number(p?.money ?? 0) || 0,
        date: p?.date ? String(p.date) : undefined,
        pay_system_id: p?.pay_system_id ? String(p.pay_system_id) : undefined,
      }))
    }

    // --- Withdraws (списания) ---
    const withdrawRes = await shmFetch<any>(shmSessionId, 'v1/user/withdraw', {
      method: 'GET',
      query: { limit: 10, offset: 0 },
    })

    let withdraws: WithdrawItem[] = []
    if (withdrawRes.ok) {
      const raw = Array.isArray(withdrawRes.json?.data) ? withdrawRes.json?.data : []
      withdraws = raw.map((w: any) => ({
        withdraw_id: Number(w?.withdraw_id ?? 0) || 0,
        total: w?.total !== undefined ? Number(w.total) : undefined,
        cost: w?.cost !== undefined ? Number(w.cost) : undefined,
        create_date: w?.create_date ? String(w.create_date) : undefined,
        withdraw_date: w?.withdraw_date ? String(w.withdraw_date) : undefined,
        end_date: w?.end_date ? String(w.end_date) : undefined,
      }))
    }

    return reply.send({
      ok: true,
      pays,
      withdraws,
    })
  })
}
