// FILE: api/src/modules/promo/routes.ts

import type { FastifyInstance } from 'fastify'
import { getSessionFromRequest } from '../../shared/session/sessionStore.js'
import {
  shmShpunAppPromoApply,
  shmShpunAppPromoOpportunities,
  shmShpunAppPromoProfile,
} from '../../shared/shm/shmClient.js'
import { hasReviewByUserId } from '../reviews/repo.js'
import { getPromotionDisplaySettingsMap } from './displaySettingsRepo.js'
import { applyPromotionDisplaySettings, buildBonusOpportunities } from './opportunities.js'

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

function toFinite(v: any): number | null {
  const n = Number(String(v ?? '').replace(',', '.').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

export async function promoRoutes(app: FastifyInstance) {

  /**
   * GET /promo/opportunities
   *
   * Billing remains the source of truth for financial eligibility. The app
   * only adds its local one-review-per-account state and shapes a generic list
   * that the UI can extend with future campaigns.
   */
  app.get('/promo/opportunities', async (req, reply) => {
    const session = getSessionFromRequest(req as any) as any
    const shmSessionId = String(session?.shmSessionId ?? '').trim()
    const userId = Number(session?.shmUserId ?? session?.userId ?? 0)
    if (!shmSessionId || !Number.isFinite(userId) || userId <= 0) {
      return reply.code(401).send({ ok: false, error: 'not_authenticated' })
    }

    const statusRes = await shmShpunAppPromoOpportunities(shmSessionId)
    const billing = (statusRes.json ?? {}) as any
    if (!statusRes.ok || !isOk(billing?.ok)) {
      return reply.code(502).send({
        ok: false,
        error: 'opportunities_failed',
        message: 'Не удалось проверить доступные бонусы.',
      })
    }

    return reply.send({
      ok: true,
      items: applyPromotionDisplaySettings(
        buildBonusOpportunities({
          billing,
          canCreateReview: !hasReviewByUserId(Math.trunc(userId)),
        }),
        getPromotionDisplaySettingsMap(),
      ),
    })
  })

  /**
   * POST /promo/apply
   * body: { code: string }
   *
   * Применяет промокод через shpun_app template (action=promo.apply).
   * Биллинг сам считает delta бонусов и возвращает:
   *   - bonus_added / bonus_after / balance_after
   *   - item: { type, title, text, chips, period_days, threshold, discount, service }
   */
  app.post('/promo/apply', async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply)
    if (!shmSessionId) return

    const body = (req.body ?? {}) as any
    const code = sanitizeCode(body?.code)

    if (!code) {
      return reply.code(400).send({
        ok: false,
        error: 'code_required',
        message: 'Введите промокод.',
      })
    }

    const applyRes = await shmShpunAppPromoApply(shmSessionId, code)
    const j = (applyRes.json ?? {}) as any

    if (!applyRes.ok || !isOk(j?.ok)) {
      const error = String(j?.error ?? 'apply_failed')
      const message =
        error === 'already_used'
          ? 'Вы уже использовали этот промокод.'
          : j?.message || 'Промокод не найден или недоступен.'

      return reply.send({ ok: false, error, message })
    }

    return reply.send({
      ok:           true,
      code,
      bonusAdded:   toFinite(j?.bonus_added),
      bonusAfter:   toFinite(j?.bonus_after),
      balanceAfter: toFinite(j?.balance_after),
      // item из шаблона промокода — может быть null если шаблона нет
      item:         j?.item ?? null,
    })
  })

  /**
   * GET /promo/profile
   * Текущий баланс и бонусы.
   */
  app.get('/promo/profile', async (req, reply) => {
    const shmSessionId = ensureAuthed(req, reply)
    if (!shmSessionId) return

    const r = await shmShpunAppPromoProfile(shmSessionId)
    if (!r.ok) {
      return reply.code(502).send({
        ok: false,
        error: 'profile_failed',
        message: 'Не удалось загрузить профиль.',
      })
    }

    const j = (r.json ?? {}) as any
    return reply.send({
      ok:      true,
      balance: toFinite(j?.balance),
      bonus:   toFinite(j?.bonus),
    })
  })
}
