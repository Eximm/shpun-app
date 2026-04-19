// FILE: api/src/modules/promo/routes.ts

import type { FastifyInstance } from 'fastify'
import { getSessionFromRequest } from '../../shared/session/sessionStore.js'
import { shmPromoApply, shmPromoDescribe, shmPromoProfile } from '../../shared/shm/shmClient.js'

function ensureAuthed(req: any, reply: any): string | null {
  const session = getSessionFromRequest(req as any)
  const shmSessionId = session?.shmSessionId || null
  if (!shmSessionId) {
    reply.code(401).send({ ok: false, error: 'not_authenticated' })
    return null
  }
  return shmSessionId
}

function isOk(v: any): boolean {
  return v === true || v === 'true' || v === 1 || v === '1'
}

function sanitizeCode(raw: any): string {
  return String(raw ?? '').trim().replace(/\s+/g, '').toUpperCase()
}

export async function promoRoutes(app: FastifyInstance) {

  /**
   * POST /promo/apply
   * body: { code: string }
   * Применяет промокод через биллинг.
   * Возвращает результат применения + описание + профиль после применения.
   */
  app.post('/promo/apply', async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply)
    if (!shmSessionId) return

    const body = (req.body ?? {}) as any
    const code = sanitizeCode(body?.code)

    if (!code) {
      return reply.code(400).send({ ok: false, error: 'code_required', message: 'Введите промокод.' })
    }

    // 1. Профиль до применения (для расчёта delta бонусов)
    let balanceBefore: number | null = null
    let bonusBefore: number | null = null
    try {
      const profileBefore = await shmPromoProfile(shmSessionId)
      if (profileBefore.ok && profileBefore.json) {
        const j = profileBefore.json as any
        const b = Number(String(j?.balance ?? '').replace(',', '.').replace(/[^\d.]/g, ''))
        const bn = Number(String(j?.bonus ?? '').replace(',', '.').replace(/[^\d.]/g, ''))
        if (Number.isFinite(b))  balanceBefore = b
        if (Number.isFinite(bn)) bonusBefore   = bn
      }
    } catch { /* fail-open */ }

    // 2. Применяем промокод
    const applyRes = await shmPromoApply(shmSessionId, code)

    if (!applyRes.ok || !isOk((applyRes.json as any)?.ok)) {
      const j = (applyRes.json ?? {}) as any
      const raw = String(applyRes.text ?? '')

      // Уже использован
      if (/already been used/i.test(raw) || /already_used/i.test(String(j?.status ?? ''))) {
        return reply.send({
          ok: false,
          error: 'already_used',
          message: 'Вы уже использовали этот промокод.',
        })
      }

      // Не найден / недоступен
      return reply.send({
        ok: false,
        error: 'apply_failed',
        message: j?.message || 'Промокод не найден или недоступен.',
      })
    }

    // 3. Профиль после применения
    let balanceAfter: number | null = null
    let bonusAfter: number | null = null
    try {
      const profileAfter = await shmPromoProfile(shmSessionId)
      if (profileAfter.ok && profileAfter.json) {
        const j = profileAfter.json as any
        const b  = Number(String(j?.balance ?? '').replace(',', '.').replace(/[^\d.]/g, ''))
        const bn = Number(String(j?.bonus ?? '').replace(',', '.').replace(/[^\d.]/g, ''))
        if (Number.isFinite(b))  balanceAfter = b
        if (Number.isFinite(bn)) bonusAfter   = bn
      }
    } catch { /* fail-open */ }

    const bonusAdded = (bonusBefore !== null && bonusAfter !== null && bonusAfter > bonusBefore)
      ? Math.round((bonusAfter - bonusBefore) * 100) / 100
      : null

    // 4. Описание промокода (шаблон с именем = код)
    let item: any = null
    try {
      const descRes = await shmPromoDescribe(shmSessionId, code)
      if (descRes.ok && isOk((descRes.json as any)?.ok)) {
        item = (descRes.json as any)?.item ?? null
      }
    } catch { /* fail-open */ }

    return reply.send({
      ok: true,
      code,
      item,
      bonusAdded,
      balanceAfter,
      bonusAfter,
    })
  })

  /**
   * GET /promo/profile
   * Текущий баланс и бонусы пользователя (для UI после применения).
   */
  app.get('/promo/profile', async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply)
    if (!shmSessionId) return

    const r = await shmPromoProfile(shmSessionId)
    if (!r.ok) {
      return reply.code(502).send({ ok: false, error: 'profile_failed', message: 'Не удалось загрузить профиль.' })
    }

    const j = (r.json ?? {}) as any
    const balance = Number(String(j?.balance ?? '').replace(',', '.').replace(/[^\d.]/g, ''))
    const bonus   = Number(String(j?.bonus   ?? '').replace(',', '.').replace(/[^\d.]/g, ''))

    return reply.send({
      ok: true,
      balance: Number.isFinite(balance) ? balance : null,
      bonus:   Number.isFinite(bonus)   ? bonus   : null,
    })
  })
}