// FILE: web/src/pages/PromoModal.tsx

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../shared/api/client'

/* ─── Types ──────────────────────────────────────────────────────────────── */

type Phase =
  | { tag: 'idle' }
  | { tag: 'loading' }
  | { tag: 'success'; result: RenderResult }
  | { tag: 'error'; message: string; kind: 'warn' | 'bad' }

type RenderResult = {
  kind:    'good' | 'warn'
  title:   string
  text:    string
  chips:   string[]
  needPay: number | null
}

type ShmItem = {
  type?:          string
  title?:         string
  text?:          string
  chips?:         string | string[]
  period_days?:   number | string | null
  period_months?: number | string | null
  threshold?:     number | string | null
  discount?:      number | string | null
  service?:       string
}

type ApplyResp = {
  ok:            boolean
  bonusAdded?:   number | null
  bonusAfter?:   number | null
  balanceAfter?: number | null
  item?:         ShmItem | null
  error?:        string
  message?:      string
}

export type SuccessData = {
  bonusAdded:   number | null
  bonusAfter:   number | null
  balanceAfter: number | null
}

/* ─── Item rendering (портировано из старого миниаппа) ───────────────────── */

function toNum(v: any): number {
  if (v == null) return NaN
  const s = String(v).replace(',', '.').replace(/[^\d.]/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

function fmtNum(v: any): string {
  const n = toNum(v)
  if (!Number.isFinite(n)) return String(v ?? '')
  return (Math.round(n * 100) / 100).toFixed(2).replace('.00', '')
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n) + ' ₽'
}

function substAll(str: string, dict: Record<string, string>): string {
  let s = String(str || '')
  Object.keys(dict).forEach(k => {
    if (dict[k] != null && dict[k] !== '') s = s.split(`{${k}}`).join(String(dict[k]))
  })
  return s
}

function stripUnsubstituted(s: string): string {
  return String(s || '')
    .replace(/\{[a-z0-9_]+\}/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([:;,.!?])/g, '$1')
    .replace(/:\s*(₽|%|дней|дня|день|мес\.?|месяц(?:а|ев)?)\b/gi, ':')
    .replace(/:\s*$/g, '')
    .trim()
}

function parseChips(chips: any): string[] {
  if (Array.isArray(chips)) return chips.map(x => String(x))
  if (typeof chips === 'string') return chips.split('|').map(s => s.trim()).filter(Boolean)
  return []
}

function isMeaningfulChip(s: string): boolean {
  const t = String(s || '').trim()
  if (!t) return false
  if (/^(срок|порог|скидка)\s*:?$/i.test(t)) return false
  if (/^(срок|порог|скидка)\s*:\s*(₽|%|дней|дня|день|мес\.?|месяц(?:а|ев)?)\s*$/i.test(t)) return false
  if (/^скидка\s*:\s*0+\s*%?\s*$/i.test(t)) return false
  if (/^порог\s*:\s*0+\s*₽?\s*$/i.test(t)) return false
  return true
}

function renderFromItem(item: ShmItem, extra: SuccessData): RenderResult {
  const type         = String(item?.type || 'other')
  const periodDays   = toNum(item?.period_days)
  const periodMonths = toNum(item?.period_months)
  const thresholdRaw = toNum(item?.threshold)
  const threshold    = Number.isFinite(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : 0
  const discountRaw  = toNum(item?.discount)
  const discount     = Number.isFinite(discountRaw) && discountRaw > 0 ? discountRaw : null
  const discountFallback = (item?.discount != null && String(item.discount).trim() !== '' && String(item.discount) !== '0')
    ? String(item.discount).trim() : ''

  const dict: Record<string, string> = {
    threshold:     threshold ? fmtNum(threshold) : '',
    discount:      discount != null ? fmtNum(discount) : discountFallback,
    period_days:   Number.isFinite(periodDays)   ? fmtNum(periodDays)   : '',
    period_months: Number.isFinite(periodMonths) ? fmtNum(periodMonths) : '',
    service:       item?.service || '',
  }

  const title    = stripUnsubstituted(substAll(item?.title || '✅ Промокод применён', dict))
  const baseText = stripUnsubstituted(substAll(item?.text  || 'Промокод успешно применён.', dict))
  let chips = parseChips(item?.chips).map(x => stripUnsubstituted(substAll(x, dict))).filter(isMeaningfulChip)

  if (type === 'tariff') {
    const bal  = extra.balanceAfter
    const need = (Number.isFinite(bal!) && threshold > 0) ? Math.max(0, threshold - bal!) : threshold > 0 ? threshold : 0
    if (Number.isFinite(bal!)) chips.push(`Баланс: ${fmtMoney(bal!)}`)

    if (threshold > 0 && need > 0) {
      return { kind: 'warn', title, text: baseText + `\n\nЧтобы активировать тариф, пополните баланс на ${fmtMoney(need)}.`, chips, needPay: need }
    }
    return { kind: 'good', title, text: baseText + '\n\n✅ Тариф активирован. Проверьте раздел «Услуги».', chips, needPay: null }
  }

  if (type === 'bonus') {
    if (Number.isFinite(extra.bonusAdded!) && extra.bonusAdded! > 0) chips.push(`Получено бонусов: +${fmtNum(extra.bonusAdded)} ₽`)
    if (Number.isFinite(extra.bonusAfter!)) chips.push(`Баланс бонусов: ${fmtNum(extra.bonusAfter)} ₽`)
    return { kind: 'good', title, text: baseText, chips, needPay: null }
  }

  return { kind: 'good', title, text: baseText, chips, needPay: null }
}

function renderFromNumbers(extra: SuccessData): RenderResult {
  const chips: string[] = []
  if (extra.bonusAdded != null && extra.bonusAdded > 0) chips.push(`Начислено бонусов: +${fmtNum(extra.bonusAdded)}`)
  if (extra.bonusAfter != null) chips.push(`Бонусов всего: ${fmtNum(extra.bonusAfter)}`)
  if (extra.balanceAfter != null) chips.push(`Баланс: ${fmtMoney(extra.balanceAfter)}`)
  return {
    kind:    'good',
    title:   '✅ Промокод применён!',
    text:    chips.length ? '' : 'Проверьте раздел «Услуги» — тариф мог активироваться автоматически.',
    chips,
    needPay: null,
  }
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function sanitizeCode(raw: string) {
  return raw.trim().replace(/\s+/g, '').toUpperCase()
}

/* ─── Confetti ───────────────────────────────────────────────────────────── */

type Particle = {
  id: number; x: number; y: number; vx: number; vy: number
  color: string; size: number; life: number; maxLife: number
  rotation: number; rotSpeed: number
}

const CONFETTI_COLORS = ['#7c5cff', '#4dd7ff', '#a78bfa', '#34d399', '#fbbf24', '#f472b6']

function useConfetti() {
  const [particles, setParticles] = useState<Particle[]>([])
  const rafRef = useRef<number | null>(null)
  const pRef   = useRef<Particle[]>([])

  const burst = useCallback((ox: number, oy: number) => {
    const now = Date.now()
    pRef.current = Array.from({ length: 56 }, (_, i) => {
      const angle = (Math.PI * 2 * i) / 56 + (Math.random() - 0.5) * 0.5
      const speed = 3 + Math.random() * 5.5
      return {
        id: now + i, x: ox, y: oy,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2.5,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 4 + Math.random() * 5, life: 0,
        maxLife: 40 + Math.floor(Math.random() * 30),
        rotation: Math.random() * 360, rotSpeed: (Math.random() - 0.5) * 14,
      }
    })
    setParticles([...pRef.current])
    const tick = () => {
      pRef.current = pRef.current
        .map(p => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, vy: p.vy + 0.28, vx: p.vx * 0.97, life: p.life + 1, rotation: p.rotation + p.rotSpeed }))
        .filter(p => p.life < p.maxLife)
      setParticles([...pRef.current])
      if (pRef.current.length > 0) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])
  return { particles, burst }
}

function ConfettiLayer({ particles }: { particles: Particle[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    particles.forEach(p => {
      ctx.save()
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.maxLife)
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rotation * Math.PI / 180)
      ctx.fillStyle = p.color
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.55)
      ctx.restore()
    })
  }, [particles])
  return <canvas ref={canvasRef} width={600} height={500} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', borderRadius: 'inherit' }} />
}

/* ─── PromoModal ─────────────────────────────────────────────────────────── */

export type PromoModalProps = {
  open:       boolean
  onClose:    () => void
  onSuccess?: (data: SuccessData) => void
}

export function PromoModal({ open, onClose, onSuccess }: PromoModalProps) {
  const [code,    setCode]    = useState('')
  const [phase,   setPhase]   = useState<Phase>({ tag: 'idle' })
  const [mounted, setMounted] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const btnRef   = useRef<HTMLButtonElement>(null)
  const { particles, burst } = useConfetti()

  useEffect(() => {
    if (open) {
      setMounted(true)
      const t = setTimeout(() => inputRef.current?.focus(), 80)
      return () => clearTimeout(t)
    } else {
      const t = setTimeout(() => { setMounted(false); setCode(''); setPhase({ tag: 'idle' }) }, 280)
      return () => clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, onClose])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const handleApply = useCallback(async () => {
    const clean = sanitizeCode(code)
    if (!clean) { setPhase({ tag: 'error', message: 'Введите промокод', kind: 'bad' }); inputRef.current?.focus(); return }

    setPhase({ tag: 'loading' })

    try {
      const resp = await apiFetch<ApplyResp>('/promo/apply', { method: 'POST', body: { code: clean } })

      if (!resp.ok) {
        setPhase({ tag: 'error', message: resp.message || 'Промокод не найден или недоступен.', kind: resp.error === 'already_used' ? 'warn' : 'bad' })
        return
      }

      const extra: SuccessData = {
        bonusAdded:   resp.bonusAdded   ?? null,
        bonusAfter:   resp.bonusAfter   ?? null,
        balanceAfter: resp.balanceAfter ?? null,
      }

      const result = resp.item ? renderFromItem(resp.item, extra) : renderFromNumbers(extra)
      setPhase({ tag: 'success', result })
      onSuccess?.(extra)

      if (result.kind === 'good' && btnRef.current) {
        const btnRect  = btnRef.current.getBoundingClientRect()
        const cardRect = btnRef.current.closest('.promo-modal__card')?.getBoundingClientRect()
        if (cardRect) burst(btnRect.left - cardRect.left + btnRect.width / 2, btnRect.top - cardRect.top + btnRect.height / 2)
      }
    } catch (e: any) {
      setPhase({ tag: 'error', message: e?.message || 'Ошибка соединения. Попробуйте ещё раз.', kind: 'bad' })
    }
  }, [code, burst, onSuccess])

  const handlePaste = async () => {
    try { const text = await navigator.clipboard.readText(); setCode(sanitizeCode(text)); setPhase({ tag: 'idle' }); inputRef.current?.focus() }
    catch { /* unavailable */ }
  }

  const handleClose = () => { if (phase.tag !== 'loading') onClose() }

  if (!mounted) return null

  const isLoading = phase.tag === 'loading'
  const isSuccess = phase.tag === 'success'
  const res = isSuccess ? (phase as Extract<Phase, { tag: 'success' }>).result : null

  return (
    <div className={`promo-modal${open ? ' promo-modal--open' : ' promo-modal--closing'}`} role="dialog" aria-modal="true" aria-label="Применить промокод" onClick={e => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="promo-modal__card">
        {particles.length > 0 && <ConfettiLayer particles={particles} />}

        <div className="promo-modal__head">
          <span className="promo-modal__headIcon" aria-hidden>🎁</span>
          <div className="promo-modal__headText">
            <div className="promo-modal__title">Промокод</div>
            <div className="promo-modal__sub">Введите код — применим мгновенно</div>
          </div>
          <button className="btn promo-modal__close" onClick={handleClose} disabled={isLoading} aria-label="Закрыть">✕</button>
        </div>

        <div className="promo-modal__body">
          {!isSuccess && (
            <div className="promo-modal__inputRow">
              <input
                ref={inputRef}
                className={`input promo-modal__input${phase.tag === 'error' ? ' input--invalid' : ''}`}
                value={code}
                onChange={e => { setCode(e.target.value.toUpperCase()); if (phase.tag === 'error') setPhase({ tag: 'idle' }) }}
                onKeyDown={e => { if (e.key === 'Enter') void handleApply() }}
                placeholder="BONUS2026"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={isLoading}
                maxLength={64}
              />
              <button className="btn promo-modal__pasteBtn" onClick={handlePaste} title="Вставить" disabled={isLoading} tabIndex={-1}>📋</button>
            </div>
          )}

          {phase.tag === 'error' && (
            <div className={`promo-modal__alert promo-modal__alert--${phase.kind}`}>
              {phase.kind === 'warn' ? '⚠️' : '❌'} {phase.message}
            </div>
          )}

          {isSuccess && res && (
            <div className="promo-modal__success">
              <div className="promo-modal__successIcon" aria-hidden>{res.kind === 'warn' ? '⚠️' : '✅'}</div>
              <div className="promo-modal__successTitle">{res.title}</div>
              {res.text && <div className="promo-modal__successText">{res.text}</div>}
              {res.chips.length > 0 && (
                <div className="promo-modal__chips">
                  {res.chips.map((c, i) => (
                    <div key={i} className={`chip promo-modal__chip${res.kind === 'good' ? ' chip--ok' : ' chip--warn'}`}>{c}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="promo-modal__footer">
          {!isSuccess ? (
            <div className="promo-modal__footerRow">
              <button ref={btnRef} className={`btn btn--primary promo-modal__applyBtn${isLoading ? ' promo-modal__applyBtn--loading' : ''}`} onClick={() => void handleApply()} disabled={isLoading}>
                {isLoading ? <><span className="promo-modal__spinner" aria-hidden /> Проверяем…</> : '🚀 Применить'}
              </button>
              <button className="btn promo-modal__cancelBtn" onClick={handleClose} disabled={isLoading}>Отмена</button>
            </div>
          ) : (
            <button className="btn btn--primary promo-modal__applyBtn" onClick={handleClose}>Готово ✓</button>
          )}
        </div>
      </div>
    </div>
  )
}