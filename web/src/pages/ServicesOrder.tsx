// FILE: web/src/pages/ServicesOrder.tsx

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../shared/api/client'
import { useMe } from '../app/auth/useMe'
import { useI18n } from '../shared/i18n'
import { toast } from '../shared/ui/toast'
import { getMood } from '../shared/payments-mood'

/* ─── Types ─────────────────────────────────────────────────────────────── */

type Tariff = {
  serviceId: number
  category: string
  title: string
  descr: string
  price: number
  currency: string
  periodRaw?: string
  periodHuman: string
  flags?: { orderOnlyOnce?: boolean }
}

type ServiceCategory = {
  category_key: string
  title: string
  descr: string
  short_descr: string
  connect_kind: string
  sort_order: number
  badge: string | null
  badge_tone: string
  recommended: boolean
  hidden: boolean
  emoji: string | null
  accent_from: string | null
  accent_to: string | null
  card_bg: string | null
  button_label: string | null
  billing_category_keys: string[]
  service_ids: number[]
  hint_enabled: boolean
  hint_title: string | null
  hint_text: string | null
  hint_button_label: string | null
  hint_button_url: string | null
}

type PaySystem = {
  name?: string
  shm_url?: string
  recurring?: string | number
  amount?: number
}

type CreateResp = {
  ok: true
  item: { userServiceId: number; serviceId: number; status: string; statusRaw: string }
}

type ApiServiceItem = {
  userServiceId: number
  status: 'active' | 'blocked' | 'pending' | 'not_paid' | 'removed' | 'error' | 'init'
  statusRaw: string
}

/* ─── Constants ──────────────────────────────────────────────────────────── */

const AMNEZIA_WARN_KEY = 'order.amnezia.warn.dismissed.v1'
const ROUTER_HINT_KEY = 'order.router.hint.dismissed.v1'
const HIDDEN_PAYSYSTEMS = new Set(['Telegram Stars Rescue', 'Telegram Stars Karlson'])
const HINT_SESSION_PREFIX = 'cat.hint.shown.'

/* ─── Utils ─────────────────────────────────────────────────────────────── */

function nnum(v: any, def = 0) {
  const x = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v)
  return Number.isFinite(x) ? x : def
}

function fmtMoney(n: number, cur: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: cur || 'RUB',
      maximumFractionDigits: 0,
    }).format(nnum(n))
  } catch {
    return `${nnum(n)} ${cur || 'RUB'}`
  }
}

function matchesPattern(pattern: string, billingCategory: string): boolean {
  if (pattern.endsWith('*')) return billingCategory.startsWith(pattern.slice(0, -1))
  return pattern === billingCategory
}

function resolveCategoryKey(billingCategory: string, categories: ServiceCategory[], serviceId: number): string | null {
  for (const cat of categories) {
    if (cat.service_ids.includes(serviceId)) return cat.category_key
  }
  for (const cat of categories) {
    for (const pat of cat.billing_category_keys) {
      if (matchesPattern(pat, billingCategory)) return cat.category_key
    }
  }
  return null
}

function buildPayUrl(base: string, amount: number) {
  const a = Math.max(1, Math.ceil(nnum(amount, 1)))
  return base.includes('{amount}') ? base.replace('{amount}', String(a)) : `${base}${a}`
}

function isStars(ps: PaySystem) {
  const n = String(ps?.name || '').toLowerCase()
  const u = String(ps?.shm_url || '').toLowerCase()
  return n.includes('stars') || u.includes('telegram_stars')
}

function isCard(ps: PaySystem) {
  const n = String(ps?.name || '').toLowerCase()
  const u = String(ps?.shm_url || '').toLowerCase()
  return n.includes('карт') || n.includes('card') || n.includes('перевод') || u.includes('card')
}

function methodAccent(ps: PaySystem): { stripe: string; amountColor: string; hintColor: string; icon: string; hint: string } {
  const name = String(ps?.name || '').toLowerCase()

  if (name.includes('сбп') || name.includes('sbp') || name.includes('быстр')) {
    return {
      stripe: '#2be38f',
      amountColor: '#2be38f',
      hintColor: 'rgba(43,227,143,0.80)',
      icon: '⚡',
      hint: 'Мгновенно · рекомендуем',
    }
  }

  if (isStars(ps)) {
    return {
      stripe: '#f59e0b',
      amountColor: 'rgba(255,255,255,0.80)',
      hintColor: 'rgba(255,255,255,0.38)',
      icon: '⭐',
      hint: 'Telegram Stars',
    }
  }

  if (name.includes('юмани') || name.includes('yoomoney') || name.includes('юмoney') || name.includes('юmon')) {
    return {
      stripe: '#a78bff',
      amountColor: 'rgba(255,255,255,0.80)',
      hintColor: 'rgba(255,255,255,0.38)',
      icon: '💜',
      hint: 'Внешняя оплата',
    }
  }

  if (name.includes('crypto') || name.includes('крипт')) {
    return {
      stripe: '#4dd7ff',
      amountColor: 'rgba(255,255,255,0.80)',
      hintColor: 'rgba(255,255,255,0.38)',
      icon: '🔶',
      hint: 'Криптовалюта',
    }
  }

  if (isCard(ps)) {
    return {
      stripe: 'rgba(255,255,255,0.18)',
      amountColor: 'rgba(255,255,255,0.35)',
      hintColor: 'rgba(255,255,255,0.28)',
      icon: '💳',
      hint: 'Ручная проверка · до 1 ч',
    }
  }

  return {
    stripe: 'rgba(124,92,255,0.60)',
    amountColor: 'rgba(255,255,255,0.80)',
    hintColor: 'rgba(255,255,255,0.38)',
    icon: '💳',
    hint: 'Внешняя оплата',
  }
}

function getTelegramWebApp(): any | null {
  return (window as any)?.Telegram?.WebApp || null
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.top = '-1000px'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

function readAmneziaWarnDismissed() {
  try {
    return localStorage.getItem(AMNEZIA_WARN_KEY) === '1'
  } catch {
    return false
  }
}

function saveAmneziaWarnDismissed() {
  try {
    localStorage.setItem(AMNEZIA_WARN_KEY, '1')
  } catch {
    /* ignore */
  }
}

function readRouterHintDismissed() {
  try {
    return localStorage.getItem(ROUTER_HINT_KEY) === '1'
  } catch {
    return false
  }
}

function saveRouterHintDismissed() {
  try {
    localStorage.setItem(ROUTER_HINT_KEY, '1')
  } catch {
    /* ignore */
  }
}

function getOrderError(e: any): { title: string; description: string } {
  const code = String(e?.error || e?.code || '').trim()
  const msg = String(e?.message || '').trim()

  if (code === 'unpaid_order_exists') {
    return {
      title: 'Есть активный или неоплаченный заказ',
      description: 'Сначала оплатите или удалите существующую услугу.',
    }
  }

  if (code === 'unpaid_same_service_exists') {
    return {
      title: 'Есть заказ этого типа',
      description: 'Сначала оплатите или удалите существующую услугу этого типа.',
    }
  }

  return {
    title: 'Не удалось создать услугу',
    description: msg || 'Попробуйте ещё раз.',
  }
}

function getCategoryTheme(cat?: ServiceCategory | null) {
  const accentFrom = cat?.accent_from || '#7c5cff'
  const accentTo = cat?.accent_to || '#4dd7ff'
  const cardBg = cat?.card_bg || 'rgba(255,255,255,0.04)'

  return {
    accentFrom,
    accentTo,
    cardBg,
    borderColor: `${accentFrom}55`,
    glow: `0 6px 18px ${accentFrom}35`,
    buttonBg: `linear-gradient(135deg, ${accentFrom}, ${accentTo})`,
  }
}

function getCategoryButtonStyle(cat?: ServiceCategory | null): CSSProperties {
  const theme = getCategoryTheme(cat)

  return {
    width: '100%',
    minHeight: 44,
    borderRadius: 12,
    background: theme.buttonBg,
    color: '#fff',
    border: `1px solid ${theme.borderColor}`,
    boxShadow: theme.glow,
    fontWeight: 900,
    letterSpacing: '0.02em',
  }
}

/* ─── CategoryCard ───────────────────────────────────────────────────────── */

function CategoryCard({ cat, onClick }: { cat: ServiceCategory; onClick: () => void }) {
  const theme = getCategoryTheme(cat)
  const btnLabel = cat.button_label || 'Выбрать'

  return (
    <button
      type="button"
      className={`kv__item so__kindCard${cat.recommended ? ' so__kindCard--recommended' : ''}`}
      onClick={onClick}
      style={{
        border: `1.5px solid ${theme.borderColor}`,
        background: theme.cardBg,
        borderRadius: 16,
        padding: 16,
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -40,
          left: -40,
          width: 180,
          height: 180,
          background: `radial-gradient(circle, ${theme.accentFrom}18, transparent 65%)`,
          pointerEvents: 'none',
        }}
      />

      {cat.recommended && <div className="so__badgeRecommended">⭐ Рекомендуем</div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontWeight: 900, fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}>
          {cat.emoji && <span style={{ fontSize: 22 }}>{cat.emoji}</span>}
          {cat.title}
        </div>

        {cat.badge && (
          <span className={`chip chip--${cat.badge_tone || 'soft'}`} style={{ flexShrink: 0, marginLeft: 8 }}>
            {cat.badge}
          </span>
        )}
      </div>

      <p className="p" style={{ marginTop: 0, marginBottom: 14 }}>
        {cat.short_descr}
      </p>

      <div
        style={{
          width: '100%',
          minHeight: 44,
          borderRadius: 12,
          background: theme.buttonBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 900,
          fontSize: 14,
          color: '#fff',
          boxShadow: theme.glow,
          letterSpacing: '0.02em',
        }}
      >
        {btnLabel}
      </div>
    </button>
  )
}

/* ─── ServicesOrder ──────────────────────────────────────────────────────── */

export function ServicesOrder() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const { me, loading: meLoading, error: meError, refetch } = useMe()

  const balanceAmount = nnum(me?.balance?.amount)
  const currency = String(me?.balance?.currency || 'RUB')
  const bonus = nnum((me as any)?.bonus)
  const discountPercent = Math.max(0, nnum((me as any)?.discount))
  const hasDiscount = discountPercent > 0

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [selectedCat, setSelectedCat] = useState<ServiceCategory | null>(null)
  const [selected, setSelected] = useState<Tariff | null>(null)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreateResp['item'] | null>(null)
  const [paySystems, setPaySystems] = useState<PaySystem[]>([])
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [detailsCollapsed, setDetailsCollapsed] = useState(false)
  const [waitMsg, setWaitMsg] = useState<string | null>(null)
  const [lastPayUrl, setLastPayUrl] = useState<string | null>(null)
  const [openingPay, setOpeningPay] = useState(false)
  const [payOpenError, setPayOpenError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [amneziaWarnOpen, setAmneziaWarnOpen] = useState(false)
  const [routerHintOpen, setRouterHintOpen] = useState(false)
  const [catHintOpen, setCatHintOpen] = useState(false)
  const [catHintData, setCatHintData] = useState<ServiceCategory | null>(null)

  const groupedByCat = useMemo(() => {
    const map = new Map<string, Tariff[]>()

    for (const t of tariffs) {
      const key = resolveCategoryKey(t.category, categories, t.serviceId) ?? '__other__'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push({ ...t, price: nnum(t.price) })
    }

    for (const [, arr] of map) {
      arr.sort((a, b) => nnum(a.price) - nnum(b.price))
    }

    return map
  }, [tariffs, categories])

  const visibleCategories = useMemo(() => {
    return categories.filter((c) => !c.hidden && (groupedByCat.get(c.category_key)?.length ?? 0) > 0)
  }, [categories, groupedByCat])

  const tariffsInCat = useMemo(() => {
    if (!selectedCat) return []
    return groupedByCat.get(selectedCat.category_key) ?? []
  }, [selectedCat, groupedByCat])

  const priceCalc = useMemo(() => {
    if (!selected) return { base: 0, discounted: 0, bonusUsed: 0, balanceUsed: 0, needTopup: 0 }

    const base = nnum(selected.price)
    const discounted = Math.round(base * (1 - discountPercent / 100))
    const bonusUsed = Math.min(bonus, Math.floor(discounted * 0.5))
    const afterBonus = Math.max(0, discounted - bonusUsed)
    const balanceUsed = Math.min(balanceAmount, afterBonus)

    return {
      base,
      discounted,
      bonusUsed,
      balanceUsed,
      needTopup: Math.max(0, afterBonus - balanceUsed),
    }
  }, [selected, discountPercent, bonus, balanceAmount])

  const needTopup = priceCalc.needTopup
  const toPay = Math.max(1, needTopup)

  const shouldShowPay = useMemo(() => {
    if (!created) return false
    if (needTopup > 0) return true
    return String(created.status || '').toLowerCase() === 'not_paid'
  }, [created, needTopup])

  const calcCards = useMemo(() => {
    if (!selected) return []

    const items = [
      {
        key: 'base',
        title: t('servicesOrder.calc.base'),
        value: fmtMoney(priceCalc.base, selected.currency),
      },
    ]

    if (hasDiscount && priceCalc.discounted !== priceCalc.base) {
      items.push({
        key: 'discounted',
        title: t('servicesOrder.calc.discount'),
        value: fmtMoney(priceCalc.discounted, selected.currency),
      })
    }

    items.push({
      key: 'period',
      title: t('servicesOrder.calc.period'),
      value: selected.periodHuman,
    })

    if (priceCalc.bonusUsed > 0) {
      items.push({
        key: 'bonus',
        title: t('servicesOrder.calc.bonus'),
        value: `-${fmtMoney(priceCalc.bonusUsed, currency)}`,
      })
    }

    if (priceCalc.balanceUsed > 0) {
      items.push({
        key: 'balance',
        title: t('servicesOrder.calc.balance'),
        value: fmtMoney(priceCalc.balanceUsed, currency),
      })
    }

    return items
  }, [selected, priceCalc, hasDiscount, currency, t])

  const moodChecking = (seed: string) => getMood('payment_checking', { seed }) ?? t('connect.wait')
  const moodSuccess = (seed: string, amt?: number) => getMood('payment_success', { seed, amount: amt }) ?? t('home.toast.balance_added.title')
  const selectedTheme = getCategoryTheme(selectedCat)

  async function loadAll() {
    setLoading(true)
    setErr(null)

    try {
      const [tariffResp, catResp] = await Promise.all([
        apiFetch<{ ok: true; items: Tariff[] }>('/services/order'),
        apiFetch<{ ok: true; items: ServiceCategory[] }>('/services/categories').catch(() => ({ ok: true as const, items: [] })),
      ])

      setTariffs(tariffResp.items || [])
      setCategories(catResp.items || [])
    } catch (e: any) {
      setErr(e?.message || 'error')
    } finally {
      setLoading(false)
    }
  }

  async function loadPaysystems() {
    const r = await apiFetch<{ ok: true; items: PaySystem[] }>('/payments/paysystems', { method: 'GET' })
    setPaySystems((r?.items || []).filter((x) => !HIDDEN_PAYSYSTEMS.has(String(x?.name || ''))))
  }

  useEffect(() => {
    void loadAll()

    try {
      const k = new URLSearchParams(window.location.search).get('kind')

      if (k) {
        const timer = setTimeout(() => {
          setCategories((cats) => {
            const found = cats.find((c) => c.connect_kind === k)
            if (found) setSelectedCat(found)
            return cats
          })
        }, 500)

        return () => clearTimeout(timer)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!selectedCat) return

    if (selectedCat.connect_kind === 'amneziawg' && !readAmneziaWarnDismissed()) {
      setAmneziaWarnOpen(true)
    }

    if (selectedCat.connect_kind === 'marzban_router' && !readRouterHintDismissed()) {
      setRouterHintOpen(true)
    }

    if (selectedCat.hint_enabled && selectedCat.hint_text) {
      const key = HINT_SESSION_PREFIX + selectedCat.category_key

      if (!sessionStorage.getItem(key)) {
        setCatHintData(selectedCat)
        setCatHintOpen(true)
      }
    }
  }, [selectedCat])

  async function createOrder() {
    if (!selected) return

    setCreating(true)
    setErr(null)

    try {
      const r = await apiFetch<CreateResp>('/services/order', {
        method: 'PUT',
        body: JSON.stringify({ service_id: selected.serviceId }),
      })

      const item = r.item
      setCreated(item)
      setDetailsCollapsed(true)

      const status = String(item?.status || '').toLowerCase()
      const seed = String(item?.userServiceId || '')

      if (status === 'not_paid' || needTopup > 0) {
        await loadPaysystems()
        setWaitMsg(t('servicesOrder.status.choose_payment'))
        toast.info(getMood('service_order_created') ?? '🛒 Заказ создан', { description: moodChecking(seed) })
      } else {
        setWaitMsg(t('servicesOrder.status.activated'))
        toast.success(getMood('service_activated') ?? '🚀 Готово', { description: moodSuccess(seed, nnum(selected.price)) })
      }
    } catch (e: any) {
      const info = getOrderError(e)
      setErr(info.description)
      toast.error(info.title, { description: info.description })
    } finally {
      setCreating(false)
    }
  }

  async function tryOpenPayment(url: string): Promise<boolean> {
    const tg = getTelegramWebApp()

    if (tg?.openLink) {
      try {
        tg.openLink(url)
        return true
      } catch {
        return false
      }
    }

    try {
      return !!window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      return false
    }
  }

  async function startPay(ps: PaySystem) {
    setCopied(false)
    setPayOpenError(null)

    if (!ps?.shm_url) {
      setPayOpenError(t('servicesOrder.pay.no_url'))
      setOverlayOpen(true)
      toast.error('😬 Метод недоступен', { description: 'Выберите другой способ оплаты.' })
      return
    }

    const url = buildPayUrl(ps.shm_url, toPay)
    const seed = String(created?.userServiceId || selected?.serviceId || '')

    setLastPayUrl(url)
    setOpeningPay(true)

    const opened = await tryOpenPayment(url)

    setOpeningPay(false)
    setOverlayOpen(true)

    if (opened) {
      setWaitMsg(t('servicesOrder.status.pay_opened'))
      toast.info('🚀 Открываем оплату', { description: moodChecking(seed) })
    } else {
      setPayOpenError(t('servicesOrder.pay.blocked'))
      setWaitMsg(t('servicesOrder.status.pay_manual'))
      toast.error('🚫 Браузер заблокировал окно', { description: 'Скопируйте ссылку и откройте вручную.' })
    }
  }

  async function retryOpenLast() {
    if (!lastPayUrl) return

    setCopied(false)
    setPayOpenError(null)
    setOpeningPay(true)

    const opened = await tryOpenPayment(lastPayUrl)

    setOpeningPay(false)

    if (!opened) {
      setPayOpenError(t('servicesOrder.pay.blocked'))
      toast.error('🚫 Браузер заблокировал окно', { description: 'Скопируйте ссылку и откройте вручную.' })
      return
    }

    toast.info('🚀 Открыли', { description: 'Завершите платёж и вернитесь.' })
  }

  async function pollOnce() {
    const seed = String(created?.userServiceId || selected?.serviceId || '')

    toast.info('🔍 Проверяем', { description: moodChecking(seed) })

    try {
      await Promise.resolve(refetch?.())
    } catch {
      /* ignore */
    }

    if (!created?.userServiceId) return

    try {
      const r = await apiFetch<{ ok: true; items: ApiServiceItem[] }>('/services')
      const item = (r.items || []).find((x) => x.userServiceId === created.userServiceId)

      if (item && (item.status === 'active' || item.status === 'pending')) {
        setCreated((cur) => (cur ? { ...cur, status: item.status, statusRaw: item.statusRaw || cur.statusRaw } : cur))
        setWaitMsg(t('servicesOrder.status.activated'))
        toast.success(getMood('service_activated') ?? '🎉 Оплата подтверждена', { description: moodSuccess(seed, toPay) })
        return
      }
    } catch {
      /* ignore */
    }

    setWaitMsg(t('servicesOrder.status.not_confirmed'))
    toast.info(getMood('payment_failed') ?? '⏳ Пока не видим', { description: 'Подождите немного и проверьте снова.' })
  }

  async function handleCopyLink() {
    if (!lastPayUrl) return

    const ok = await copyToClipboard(lastPayUrl)
    setCopied(ok)

    if (!ok) {
      setPayOpenError('Не скопировалось')
      toast.error('😬 Не скопировалось', { description: 'Попробуйте вручную.' })
      return
    }

    toast.success(getMood('copied') ?? '📋 Ссылка скопирована', { description: 'Вставьте в браузер и оплатите.' })
  }

  function resetSelection() {
    setSelected(null)
    setSelectedCat(null)
    setCreated(null)
    setPaySystems([])
    setWaitMsg(null)
    setErr(null)
    setOverlayOpen(false)
    setDetailsCollapsed(false)
    setLastPayUrl(null)
    setPayOpenError(null)
    setOpeningPay(false)
    setCopied(false)
  }

  if (loading || meLoading) {
    return (
      <div className="app-loader" style={{ opacity: 1, transition: 'opacity 180ms ease', pointerEvents: 'auto' }}>
        <div className="app-loader__card">
          <div className="app-loader__shine" />
          <div className="app-loader__brandRow">
            <div className="app-loader__mark" />
            <div className="app-loader__title">Shpun App</div>
          </div>
          <div className="app-loader__text">{t('home.loading.text')}</div>
        </div>
      </div>
    )
  }

  const topError = err || (meError ? String((meError as any)?.message || meError) : null)

  return (
    <div className="section">
      {overlayOpen &&
        createPortal(
          <div className="modal" role="dialog" aria-modal="true" onMouseDown={() => setOverlayOpen(false)}>
            <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
              <div className="card__body">
                <div className="modal__head">
                  <div className="modal__title">
                    {payOpenError ? '⚠️ ' + t('servicesOrder.pay.failed_title') : '💳 ' + t('servicesOrder.pay.window_title')}
                  </div>
                  <button className="btn modal__close" type="button" onClick={() => setOverlayOpen(false)} aria-label={t('common.close')}>
                    ✕
                  </button>
                </div>

                <div className="modal__content">
                  <p className="p">{payOpenError ? t('servicesOrder.pay.open_manually') : t('servicesOrder.pay.complete_then_check')}</p>

                  {payOpenError && (
                    <div className="pre" style={{ marginTop: 10, borderColor: 'rgba(255,77,109,0.28)' }}>
                      {payOpenError}
                    </div>
                  )}

                  {lastPayUrl && (
                    <div className="pre" style={{ marginTop: 10, wordBreak: 'break-all', userSelect: 'text', fontSize: 12 }}>
                      {lastPayUrl}
                    </div>
                  )}

                  {copied && <div className="home-alert home-alert--ok" style={{ marginTop: 8 }}>✅ {t('connect.copy_link')}</div>}
                </div>

                <div className="actions actions--1" style={{ marginTop: 14 }}>
                  <button className="btn btn--primary" onClick={() => void retryOpenLast()} disabled={!lastPayUrl || openingPay} type="button">
                    {openingPay ? t('connect.wait') : t('servicesOrder.pay.reopen')}
                  </button>
                  <button className="btn" onClick={() => void handleCopyLink()} disabled={!lastPayUrl} type="button">
                    📋 {t('connect.copy_link')}
                  </button>
                  <button className="btn" onClick={() => void pollOnce()} type="button">
                    🔄 {t('servicesOrder.pay.poll')}
                  </button>
                  <button className="btn" onClick={() => navigate('/services')} type="button">
                    → {t('services.page.title')}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {amneziaWarnOpen &&
        createPortal(
          <div className="modal" role="dialog" aria-modal="true" onMouseDown={saveAmneziaWarnDismissed}>
            <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
              <div className="card__body">
                <div className="modal__head">
                  <div className="modal__title">⚠️ {t('servicesOrder.amnezia.warn.title')}</div>
                </div>
                <div className="modal__content">
                  <p className="p">{t('servicesOrder.amnezia.warn.text')}</p>
                </div>
                <div className="actions actions--1" style={{ marginTop: 14 }}>
                  <button className="btn btn--primary" onClick={() => { saveAmneziaWarnDismissed(); setAmneziaWarnOpen(false) }} type="button">
                    OK
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {routerHintOpen &&
        createPortal(
          <div className="modal" role="dialog" aria-modal="true" onMouseDown={() => { saveRouterHintDismissed(); setRouterHintOpen(false) }}>
            <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
              <div className="card__body">
                <div className="modal__head">
                  <div className="modal__title">📡 {t('servicesOrder.router.hint.title')}</div>
                </div>
                <div className="modal__content">
                  <p className="p">{t('servicesOrder.router.hint.text')}</p>
                </div>
                <div className="actions actions--2" style={{ marginTop: 14 }}>
                  <button className="btn" onClick={() => { saveRouterHintDismissed(); setRouterHintOpen(false) }} type="button">
                    {t('servicesOrder.router.hint.skip')}
                  </button>
                  <button className="btn btn--primary" onClick={() => { saveRouterHintDismissed(); setRouterHintOpen(false); navigate('/help/router') }} type="button">
                    📘 {t('servicesOrder.router.hint.open')}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {catHintOpen && catHintData &&
        createPortal(
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={() => {
              sessionStorage.setItem(HINT_SESSION_PREFIX + catHintData.category_key, '1')
              setCatHintOpen(false)
            }}
          >
            <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
              <div className="card__body">
                {catHintData.hint_title && (
                  <div className="modal__head">
                    <div className="modal__title">{catHintData.hint_title}</div>
                  </div>
                )}

                <div className="modal__content">
                  <p className="p">{catHintData.hint_text}</p>
                </div>

                <div className={`actions actions--${catHintData.hint_button_label ? '2' : '1'}`} style={{ marginTop: 14 }}>
                  {catHintData.hint_button_label && catHintData.hint_button_url && (
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        sessionStorage.setItem(HINT_SESSION_PREFIX + catHintData.category_key, '1')
                        setCatHintOpen(false)
                        navigate(catHintData.hint_button_url!)
                      }}
                    >
                      {catHintData.hint_button_label}
                    </button>
                  )}

                  <button
                    className="btn btn--primary"
                    type="button"
                    onClick={() => {
                      sessionStorage.setItem(HINT_SESSION_PREFIX + catHintData.category_key, '1')
                      setCatHintOpen(false)
                    }}
                  >
                    OK
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <div className="card">
        <div className="card__body">
          <h1 className="h1">{t('servicesOrder.title')}</h1>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <span className="chip chip--accent">
              💰 {t('home.tiles.balance')}: <b style={{ marginLeft: 4 }}>{fmtMoney(balanceAmount, currency)}</b>
            </span>
            <span className="chip">
              🎁 {t('home.tiles.bonus')}: <b style={{ marginLeft: 4 }}>{bonus}</b>
            </span>
            {hasDiscount && (
              <span className="chip chip--ok">
                🏷️ {t('servicesOrder.discount')}: <b style={{ marginLeft: 4 }}>-{Math.round(discountPercent)}%</b>
              </span>
            )}
          </div>

          {waitMsg && <div className="home-alert home-alert--ok" style={{ marginTop: 12 }}>{waitMsg}</div>}

          {topError && (
            <div className="pre" style={{ marginTop: 12, borderColor: 'rgba(255,77,109,0.28)' }}>
              {topError}
            </div>
          )}
        </div>
      </div>

      {!selectedCat && (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <div className="h1">{t('servicesOrder.step.kind.title')}</div>
                  <p className="p" style={{ marginTop: 4 }}>{t('servicesOrder.step.kind.hint')}</p>
                </div>
                <button className="btn" onClick={() => navigate(-1)} type="button" style={{ flexShrink: 0 }}>
                  ← {t('common.close')}
                </button>
              </div>

              <div className="kv" style={{ marginTop: 14 }}>
                {visibleCategories.length === 0 ? (
                  <div className="pre">{t('servicesOrder.no_categories')}</div>
                ) : (
                  visibleCategories.map((cat) => <CategoryCard key={cat.category_key} cat={cat} onClick={() => setSelectedCat(cat)} />)
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedCat && !selected && (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div className="h1" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {selectedCat.emoji && <span style={{ fontSize: 22 }}>{selectedCat.emoji}</span>}
                    {selectedCat.title}
                  </div>
                  {selectedCat.descr && <p className="p" style={{ marginTop: 4 }}>{selectedCat.descr}</p>}
                </div>

                <button className="btn" onClick={() => setSelectedCat(null)} type="button" style={{ flexShrink: 0 }}>
                  ← {t('common.close')}
                </button>
              </div>

              {selectedCat.connect_kind === 'marzban_router' && (
                <div className="actions actions--1" style={{ marginTop: 12 }}>
                  <button
                    className="btn"
                    onClick={() => navigate('/help/router')}
                    type="button"
                    style={{ borderColor: 'rgba(96,165,250,0.38)', color: 'rgba(147,197,253,1)' }}
                  >
                    📘 {t('servicesOrder.router.hint.open_short', 'Инструкция')}
                  </button>
                </div>
              )}

              <div className="kv" style={{ marginTop: 14 }}>
                {tariffsInCat.map((tariff, idx) => {
                  const isHighlighted = selectedCat.recommended && idx === 0

                  return (
                    <button
                      key={tariff.serviceId}
                      type="button"
                      className={`kv__item so__tariffBtn${isHighlighted ? ' so__tariffCard--focus' : ''}`}
                      onClick={() => setSelected(tariff)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        cursor: 'pointer',
                        borderRadius: 14,
                        padding: 14,
                        border: `1.5px solid ${selectedTheme.borderColor}`,
                        background: selectedTheme.cardBg,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 900, fontSize: 15 }}>{tariff.title}</div>
                        <span
                          className="chip chip--accent"
                          style={{
                            borderColor: selectedTheme.borderColor,
                            boxShadow: `inset 0 0 0 1px ${selectedTheme.accentFrom}22`,
                          }}
                        >
                          {fmtMoney(tariff.price, tariff.currency)} / {tariff.periodHuman}
                        </span>
                      </div>

                      {tariff.descr && <p className="p" style={{ marginTop: 6 }}>{tariff.descr}</p>}

                      <div className="actions actions--1" style={{ marginTop: 12 }}>
                        <span className="btn" style={getCategoryButtonStyle(selectedCat)}>
                          {t('servicesOrder.step.tariff.order')}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div className="h1">{selected.title}</div>
                <button className="btn" onClick={resetSelection} type="button" style={{ flexShrink: 0 }}>
                  ← {t('common.close')}
                </button>
              </div>

              {selected.descr && <p className="p" style={{ marginTop: 4 }}>{selected.descr}</p>}

              {!detailsCollapsed && calcCards.length > 0 && (
                <div className="kv kv--2" style={{ marginTop: 12 }}>
                  {calcCards.map((item) => (
                    <div key={item.key} className="kv__item">
                      <div className="kv__k">{item.title}</div>
                      <div className="kv__v" style={{ fontSize: 16 }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {!created ? (
                <div className="actions actions--1" style={{ marginTop: 14 }}>
                  <button
                    className="btn"
                    onClick={() => void createOrder()}
                    disabled={creating}
                    type="button"
                    style={{
                      ...getCategoryButtonStyle(selectedCat),
                      minHeight: 52,
                      fontSize: 16,
                    }}
                  >
                    {creating
                      ? t('connect.wait')
                      : needTopup > 0
                        ? `🛒 ${t('servicesOrder.step.checkout.order_pay')} ${fmtMoney(toPay, currency)}`
                        : `🚀 ${t('servicesOrder.step.checkout.connect')}`}
                  </button>
                </div>
              ) : (
                <div className="home-alert home-alert--ok" style={{ marginTop: 12 }}>
                  ✅ {t('servicesOrder.created')} USI: <b>{created.userServiceId}</b>
                </div>
              )}
            </div>
          </div>

          {created && shouldShowPay && (
            <div className="section">
              <div className="card">
                <div className="card__body" style={{ padding: '12px 14px' }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: 'rgba(255,255,255,0.35)',
                      marginBottom: 10,
                    }}
                  >
                    {t('payments.methods.title')}
                  </div>

                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)', marginBottom: 10 }}>
                    {t('servicesOrder.pay.choose')}: <strong style={{ color: 'rgba(255,255,255,0.72)' }}>{fmtMoney(toPay, currency)}</strong>
                  </div>

                  {paySystems.length === 0 ? (
                    <div className="pre" style={{ marginTop: 12 }}>{t('servicesOrder.pay.none')}</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                      {paySystems.map((ps, idx) => {
                        const accent = methodAccent(ps)

                        return (
                          <button
                            key={ps.shm_url || idx}
                            type="button"
                            onClick={() => void startPay(ps)}
                            disabled={!ps.shm_url || openingPay}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              padding: '12px 14px',
                              borderRadius: 11,
                              width: '100%',
                              textAlign: 'left',
                              background: 'rgba(255,255,255,0.06)',
                              border: '0.5px solid rgba(255,255,255,0.10)',
                              borderLeft: `3px solid ${accent.stripe}`,
                              cursor: !ps.shm_url || openingPay ? 'not-allowed' : 'pointer',
                              opacity: !ps.shm_url || openingPay ? 0.65 : 1,
                            }}
                          >
                            <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}>
                              {accent.icon}
                            </span>

                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 800,
                                  color: 'rgba(255,255,255,0.92)',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {ps.name || t('servicesOrder.pay.method')}
                              </div>

                              <div style={{ fontSize: 10, color: accent.hintColor, marginTop: 2 }}>
                                {accent.hint}
                              </div>
                            </div>

                            <div
                              style={{
                                fontSize: 14,
                                fontWeight: 900,
                                color: accent.amountColor,
                                flexShrink: 0,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {openingPay ? t('connect.wait') : fmtMoney(toPay, currency)}
                            </div>

                            <span style={{ fontSize: 14, color: accent.stripe, opacity: 0.7, flexShrink: 0 }}>
                              →
                            </span>
                          </button>
                        )
                      })}

                      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', lineHeight: 1.4, marginTop: 4 }}>
                        После оплаты вернитесь сюда и нажмите “Проверить оплату”.
                      </p>
                    </div>
                  )}

                  <div className="actions actions--2" style={{ marginTop: 12 }}>
                    <button className="btn" onClick={() => void pollOnce()} type="button">
                      🔄 {t('servicesOrder.pay.poll')}
                    </button>
                    <button className="btn" onClick={() => navigate('/services')} type="button">
                      → {t('services.page.title')}
                    </button>
                  </div>

                  {lastPayUrl && (
                    <div className="pre" style={{ marginTop: 10, wordBreak: 'break-all', opacity: 0.55, fontSize: 11 }}>
                      {lastPayUrl}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {created && !shouldShowPay && (
            <div className="actions actions--1" style={{ marginTop: 12 }}>
              <button
                className="btn"
                onClick={() => navigate('/services')}
                type="button"
                style={{
                  ...getCategoryButtonStyle(selectedCat),
                  minHeight: 52,
                }}
              >
                → {t('services.page.title')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ServicesOrder
