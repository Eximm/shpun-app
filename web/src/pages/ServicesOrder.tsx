// web/src/pages/ServicesOrder.tsx

import { useEffect, useMemo, useState } from 'react'
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

type Kind = 'amneziawg' | 'marzban' | 'marzban_router'

/* ─── Constants ──────────────────────────────────────────────────────────── */

const AMNEZIA_WARN_KEY  = 'order.amnezia.warn.dismissed.v1'
const ROUTER_HINT_KEY   = 'order.router.hint.dismissed.v1'
const HIDDEN_PAYSYSTEMS = new Set(['Telegram Stars Rescue', 'Telegram Stars Karlson'])

const KIND_META: Record<Kind, { title: string; descr: string; shortDescr: string; recommended?: boolean }> = {
  marzban: {
    title: 'Marzban',
    descr: 'Высокая стабильность и скорость. Подходит для телефонов, ПК и планшетов. Доступ ко всем серверам.',
    shortDescr: 'Стабильно и быстро. Для телефона, ПК и планшета.',
    recommended: true,
  },
  marzban_router: {
    title: 'Router VPN',
    descr: 'Создано специально для прошивки Shpun Router. Протокол Reality — максимально незаметность. Работает на всех устройствах через ваш роутер.',
    shortDescr: 'VPN на всю домашнюю сеть через роутер. Протокол Reality.',
  },
  amneziawg: {
    title: 'AmneziaWG',
    descr: 'Подключение на один выбранный сервер. Простая настройка и минимум параметров. Может работать нестабильно в ряде регионов.',
    shortDescr: 'Простой VPN на один сервер. В некоторых регионах бывает нестабильным.',
  },
}

/* ─── Utils ─────────────────────────────────────────────────────────────── */

function nnum(v: any, def = 0) {
  const x = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v)
  return Number.isFinite(x) ? x : def
}

function fmtMoney(n: number, cur: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'RUB', maximumFractionDigits: 0 }).format(nnum(n))
  } catch { return `${nnum(n)} ${cur || 'RUB'}`; }
}

function kindFromCategory(cat: string): Kind {
  if (cat.startsWith('vpn-')) return 'amneziawg'
  if (cat === 'marzban') return 'marzban'
  return 'marzban_router'
}

function buildPayUrl(base: string, amount: number) {
  const a = Math.max(1, Math.ceil(nnum(amount, 1)))
  return base.includes('{amount}') ? base.replace('{amount}', String(a)) : `${base}${a}`
}

function getTelegramWebApp(): any | null { return (window as any)?.Telegram?.WebApp || null; }

async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-1000px'
      document.body.appendChild(ta); ta.focus(); ta.select()
      const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok
    } catch { return false; }
  }
}

function readAmneziaWarnDismissed() { try { return localStorage.getItem(AMNEZIA_WARN_KEY) === '1'; } catch { return false; } }
function saveAmneziaWarnDismissed() { try { localStorage.setItem(AMNEZIA_WARN_KEY, '1'); } catch { /* ignore */ } }
function readRouterHintDismissed() { try { return localStorage.getItem(ROUTER_HINT_KEY) === '1'; } catch { return false; } }
function saveRouterHintDismissed() { try { localStorage.setItem(ROUTER_HINT_KEY, '1'); } catch { /* ignore */ } }

function getOrderError(e: any): { title: string; description: string } {
  const code = String(e?.error || e?.code || '').trim()
  const msg  = String(e?.message || '').trim()
  if (code === 'unpaid_order_exists')       return { title: 'Есть неоплаченная услуга',             description: 'Сначала оплатите или удалите уже созданную неоплаченную услугу.' }
  if (code === 'unpaid_same_service_exists') return { title: 'Есть неоплаченный заказ этого типа', description: 'Сначала оплатите или удалите неоплаченную услугу этого типа.' }
  return { title: 'Не удалось создать услугу', description: msg || 'Не удалось создать заказ. Попробуйте ещё раз.' }
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export function ServicesOrder() {
  const navigate = useNavigate()
  const { t }    = useI18n()
  const { me, loading: meLoading, error: meError, refetch } = useMe()

  const balanceAmount  = nnum(me?.balance?.amount)
  const currency       = String(me?.balance?.currency || 'RUB')
  const bonus          = nnum((me as any)?.bonus)
  const discountPercent = Math.max(0, nnum((me as any)?.discount))
  const hasDiscount    = discountPercent > 0

  const [loading,  setLoading]  = useState(true)
  const [err,      setErr]      = useState<string | null>(null)
  const [tariffs,  setTariffs]  = useState<Tariff[]>([])
  const [kind,     setKind]     = useState<Kind | null>(null)
  const [selected, setSelected] = useState<Tariff | null>(null)

  const [creating,          setCreating]          = useState(false)
  const [created,           setCreated]           = useState<CreateResp['item'] | null>(null)
  const [paySystems,        setPaySystems]        = useState<PaySystem[]>([])
  const [overlayOpen,       setOverlayOpen]       = useState(false)
  const [detailsCollapsed,  setDetailsCollapsed]  = useState(false)
  const [waitMsg,           setWaitMsg]           = useState<string | null>(null)
  const [lastPayUrl,        setLastPayUrl]        = useState<string | null>(null)
  const [openingPay,        setOpeningPay]        = useState(false)
  const [payOpenError,      setPayOpenError]      = useState<string | null>(null)
  const [copied,            setCopied]            = useState(false)
  const [amneziaWarnOpen,   setAmneziaWarnOpen]   = useState(false)
  const [routerHintOpen,    setRouterHintOpen]    = useState(false)

  const grouped = useMemo(() => {
    const map: Record<Kind, Tariff[]> = { amneziawg: [], marzban: [], marzban_router: [] }
    for (const t of tariffs) map[kindFromCategory(String(t.category || ''))].push({ ...t, price: nnum(t.price) })
    for (const k of Object.keys(map) as Kind[]) map[k].sort((a, b) => nnum(a.price) - nnum(b.price))
    return map
  }, [tariffs])

  const priceCalc = useMemo(() => {
    if (!selected) return { base: 0, discounted: 0, bonusUsed: 0, balanceUsed: 0, needTopup: 0 }
    const base        = nnum(selected.price)
    const discounted  = Math.round(base * (1 - discountPercent / 100))
    const bonusUsed   = Math.min(bonus, Math.floor(discounted * 0.5))
    const afterBonus  = Math.max(0, discounted - bonusUsed)
    const balanceUsed = Math.min(balanceAmount, afterBonus)
    return { base, discounted, bonusUsed, balanceUsed, needTopup: Math.max(0, afterBonus - balanceUsed) }
  }, [selected, discountPercent, bonus, balanceAmount])

  const needTopup = priceCalc.needTopup
  const toPay     = Math.max(1, needTopup)

  const shouldShowPay = useMemo(() => {
    if (!created) return false
    if (needTopup > 0) return true
    return String(created.status || '').toLowerCase() === 'not_paid'
  }, [created, needTopup])

  const calcCards = useMemo(() => {
    if (!selected) return []
    const items = [{ key: 'base', title: t('servicesOrder.calc.base'), value: fmtMoney(priceCalc.base, selected.currency) }]
    if (hasDiscount && priceCalc.discounted !== priceCalc.base)
      items.push({ key: 'discounted', title: t('servicesOrder.calc.discount'), value: fmtMoney(priceCalc.discounted, selected.currency) })
    items.push({ key: 'period', title: t('servicesOrder.calc.period'), value: selected.periodHuman })
    if (priceCalc.bonusUsed > 0)   items.push({ key: 'bonus',   title: t('servicesOrder.calc.bonus'),   value: `-${fmtMoney(priceCalc.bonusUsed, currency)}` })
    if (priceCalc.balanceUsed > 0) items.push({ key: 'balance', title: t('servicesOrder.calc.balance'), value: fmtMoney(priceCalc.balanceUsed, currency) })
    return items
  }, [selected, priceCalc, hasDiscount, currency, t])

  const moodChecking = (seed: string)              => getMood('payment_checking', { seed }) ?? t('connect.wait')
  const moodSuccess  = (seed: string, amt?: number) => getMood('payment_success',  { seed, amount: amt }) ?? t('home.toast.balance_added.title')

  /* ── Load ────────────────────────────────────────────────────────────────── */
  async function loadTariffs() {
    setLoading(true); setErr(null)
    try {
      const r = await apiFetch<{ ok: true; items: Tariff[] }>('/services/order')
      setTariffs(r.items || [])
    } catch (e: any) { setErr(e?.message || 'error') }
    finally { setLoading(false) }
  }

  async function loadPaysystems() {
    const r = await apiFetch<{ ok: true; items: PaySystem[] }>('/payments/paysystems', { method: 'GET' })
    setPaySystems((r?.items || []).filter((x) => !HIDDEN_PAYSYSTEMS.has(String(x?.name || ''))))
  }

  useEffect(() => {
    void loadTariffs()
    try {
      const k = new URLSearchParams(window.location.search).get('kind')
      if (k === 'marzban_router' || k === 'marzban' || k === 'amneziawg') setKind(k)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (kind === 'amneziawg'    && !readAmneziaWarnDismissed()) setAmneziaWarnOpen(true)
    if (kind === 'marzban_router' && !readRouterHintDismissed())  setRouterHintOpen(true)
  }, [kind])

  /* ── Actions ─────────────────────────────────────────────────────────────── */
  async function createOrder() {
    if (!selected) return
    setCreating(true); setErr(null)
    try {
      const r    = await apiFetch<CreateResp>('/services/order', { method: 'PUT', body: JSON.stringify({ service_id: selected.serviceId }) })
      const item = r.item
      setCreated(item); setDetailsCollapsed(true)
      const status = String(item?.status || '').toLowerCase()
      const seed   = String(item?.userServiceId || '')
      if (status === 'not_paid' || needTopup > 0) {
        await loadPaysystems()
        setWaitMsg(t('servicesOrder.status.choose_payment'))
        toast.info(t('servicesOrder.toast.created'), { description: moodChecking(seed) })
      } else {
        setWaitMsg(t('servicesOrder.status.activated'))
        toast.success(t('servicesOrder.toast.done'), { description: moodSuccess(seed, nnum(selected.price)) })
      }
    } catch (e: any) {
      const info = getOrderError(e)
      setErr(info.description)
      toast.error(info.title, { description: info.description })
    } finally { setCreating(false) }
  }

  async function tryOpenPayment(url: string): Promise<boolean> {
    const tg = getTelegramWebApp()
    if (tg?.openLink) { try { tg.openLink(url); return true; } catch { return false; } }
    try { return !!window.open(url, '_blank', 'noopener,noreferrer'); } catch { return false; }
  }

  async function startPay(ps: PaySystem) {
    setCopied(false); setPayOpenError(null)
    if (!ps?.shm_url) {
      setPayOpenError(t('servicesOrder.pay.no_url'))
      setOverlayOpen(true)
      toast.error(t('servicesOrder.pay.unavailable'), { description: t('servicesOrder.pay.no_url') })
      return
    }
    const url  = buildPayUrl(ps.shm_url, toPay)
    const seed = String(created?.userServiceId || selected?.serviceId || '')
    setLastPayUrl(url)
    setOpeningPay(true)
    const opened = await tryOpenPayment(url)
    setOpeningPay(false); setOverlayOpen(true)
    if (opened) {
      setWaitMsg(t('servicesOrder.status.pay_opened'))
      toast.info(t('servicesOrder.toast.pay_opened'), { description: moodChecking(seed) })
    } else {
      setPayOpenError(t('servicesOrder.pay.blocked'))
      setWaitMsg(t('servicesOrder.status.pay_manual'))
      toast.error(t('servicesOrder.pay.blocked'), { description: t('servicesOrder.pay.open_manually') })
    }
  }

  async function retryOpenLast() {
    if (!lastPayUrl) return
    setCopied(false); setPayOpenError(null); setOpeningPay(true)
    const opened = await tryOpenPayment(lastPayUrl)
    setOpeningPay(false)
    if (!opened) { setPayOpenError(t('servicesOrder.pay.blocked')); toast.error(t('servicesOrder.pay.blocked'), { description: t('servicesOrder.pay.open_manually') }); return; }
    toast.info(t('servicesOrder.toast.pay_opened'), { description: t('servicesOrder.status.pay_opened') })
  }

  async function pollOnce() {
    const seed = String(created?.userServiceId || selected?.serviceId || '')
    toast.info(t('servicesOrder.toast.checking'), { description: moodChecking(seed) })
    try { await Promise.resolve(refetch?.()) } catch { /* ignore */ }
    if (!created?.userServiceId) return
    try {
      const r    = await apiFetch<{ ok: true; items: ApiServiceItem[] }>('/services')
      const item = (r.items || []).find((x) => x.userServiceId === created.userServiceId)
      if (item && (item.status === 'active' || item.status === 'pending')) {
        setCreated((cur) => cur ? { ...cur, status: item.status, statusRaw: item.statusRaw || cur.statusRaw } : cur)
        setWaitMsg(t('servicesOrder.status.activated'))
        toast.success(t('servicesOrder.toast.done'),    { description: moodSuccess(seed, toPay) })
        toast.success(t('servicesOrder.toast.paid'),    { description: moodSuccess(seed, toPay) })
        return
      }
    } catch { /* ignore */ }
    setWaitMsg(t('servicesOrder.status.not_confirmed'))
    toast.info(t('servicesOrder.toast.not_confirmed'), { description: t('servicesOrder.status.retry') })
  }

  async function handleCopyLink() {
    if (!lastPayUrl) return
    const ok = await copyToClipboard(lastPayUrl)
    setCopied(ok)
    if (!ok) { setPayOpenError(t('servicesOrder.pay.copy_failed')); toast.error(t('servicesOrder.pay.copy_failed')); return; }
    toast.success(t('connect.copy_link'), { description: t('servicesOrder.pay.copy_ok') })
  }

  function resetSelection() {
    setSelected(null); setCreated(null); setPaySystems([]); setWaitMsg(null); setErr(null)
    setOverlayOpen(false); setDetailsCollapsed(false); setLastPayUrl(null)
    setPayOpenError(null); setOpeningPay(false); setCopied(false)
  }

  /* ── Loading ─────────────────────────────────────────────────────────────── */
  if (loading || meLoading) {
    return (
      <div className="app-loader" style={{ opacity: 1, transition: "opacity 180ms ease", pointerEvents: "auto" }}>
        <div className="app-loader__card">
          <div className="app-loader__shine" />
          <div className="app-loader__brandRow"><div className="app-loader__mark" /><div className="app-loader__title">Shpun App</div></div>
          <div className="app-loader__text">{t('home.loading.text')}</div>
        </div>
      </div>
    )
  }

  const topError = err || (meError ? String((meError as any)?.message || meError) : null)

  /* ── Render ──────────────────────────────────────────────────────────────── */
  return (
    <div className="section">

      {/* Оверлей оплаты */}
      {overlayOpen && createPortal(
        <div className="modal" role="dialog" aria-modal="true" onMouseDown={() => setOverlayOpen(false)}>
          <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="modal__head">
                <div className="modal__title">{payOpenError ? t('servicesOrder.pay.failed_title') : t('servicesOrder.pay.window_title')}</div>
                <button className="btn modal__close" type="button" onClick={() => setOverlayOpen(false)} aria-label={t('common.close')}>✕</button>
              </div>
              <div className="modal__content">
                <p className="p">
                  {payOpenError ? t('servicesOrder.pay.open_manually') : t('servicesOrder.pay.complete_then_check')}
                </p>
                {payOpenError && <div className="pre" style={{ marginTop: 12 }}>{payOpenError}</div>}
                {lastPayUrl   && <div className="pre" style={{ marginTop: 12, wordBreak: 'break-all', userSelect: 'text' }}>{lastPayUrl}</div>}
                {copied       && <div className="pre" style={{ marginTop: 8 }}>✅ {t('connect.copy_link')}</div>}
              </div>
              <div className="actions actions--1" style={{ marginTop: 12 }}>
                <button className="btn btn--primary" onClick={() => void retryOpenLast()} disabled={!lastPayUrl || openingPay} type="button">
                  {openingPay ? t('connect.wait') : t('servicesOrder.pay.reopen')}
                </button>
                <button className="btn" onClick={() => void handleCopyLink()} disabled={!lastPayUrl} type="button">{t('connect.copy_link')}</button>
                <button className="btn" onClick={() => void pollOnce()} type="button">{t('servicesOrder.pay.poll')}</button>
                <button className="btn" onClick={() => navigate('/services')} type="button">{t('services.page.title')}</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Предупреждение AmneziaWG */}
      {amneziaWarnOpen && createPortal(
        <div className="modal" role="dialog" aria-modal="true" onMouseDown={saveAmneziaWarnDismissed}>
          <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="modal__head">
                <div className="modal__title">⚠️ {t('servicesOrder.amnezia.warn.title')}</div>
              </div>
              <div className="modal__content">
                <p className="p">{t('servicesOrder.amnezia.warn.text')}</p>
              </div>
              <div className="actions actions--1" style={{ marginTop: 12 }}>
                <button className="btn btn--primary" onClick={() => { saveAmneziaWarnDismissed(); setAmneziaWarnOpen(false); }} type="button">OK</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Подсказка Router VPN */}
      {routerHintOpen && createPortal(
        <div className="modal" role="dialog" aria-modal="true" onMouseDown={() => { saveRouterHintDismissed(); setRouterHintOpen(false); }}>
          <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="modal__head">
                <div className="modal__title">📘 {t('servicesOrder.router.hint.title')}</div>
              </div>
              <div className="modal__content">
                <p className="p">{t('servicesOrder.router.hint.text')}</p>
              </div>
              <div className="actions actions--2" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => { saveRouterHintDismissed(); setRouterHintOpen(false); }} type="button">
                  {t('servicesOrder.router.hint.skip')}
                </button>
                <button className="btn btn--primary" onClick={() => { saveRouterHintDismissed(); setRouterHintOpen(false); navigate('/help/router'); }} type="button">
                  {t('servicesOrder.router.hint.open')}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Шапка */}
      <div className="card">
        <div className="card__body">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 className="h1">{t('servicesOrder.title')}</h1>
              <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <span className="chip chip--soft">{t('home.tiles.balance')}: {fmtMoney(balanceAmount, currency)}</span>
                <span className="chip chip--soft">{t('home.tiles.bonus')}: {bonus}</span>
                {hasDiscount && <span className="chip chip--soft">{t('servicesOrder.discount')}: -{Math.round(discountPercent)}%</span>}
              </div>
            </div>
          </div>
          {waitMsg  && <div className="pre" style={{ marginTop: 12 }}>{waitMsg}</div>}
          {topError && <div className="pre" style={{ marginTop: 12 }}>{topError}</div>}
        </div>
      </div>

      {/* Шаг 1 — выбор типа */}
      {!kind && (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="h1">{t('servicesOrder.step.kind.title')}</div>
                <button className="btn" onClick={() => navigate(-1)} type="button" style={{ flexShrink: 0 }}>← {t('common.close')}</button>
              </div>
              <p className="p" style={{ marginTop: 4 }}>{t('servicesOrder.step.kind.hint')}</p>

              <div className="kv" style={{ marginTop: 12 }}>
                {(['marzban', 'marzban_router', 'amneziawg'] as Kind[]).map((k) => (
                  <button key={k} type="button" className={`kv__item so__kindCard ${KIND_META[k].recommended ? 'so__kindCard--recommended' : ''}`} onClick={() => setKind(k)}>
                    <div>
                      {KIND_META[k].recommended && <div className="so__badgeRecommended">{t('servicesOrder.recommended')}</div>}
                      <div className="list__title">{KIND_META[k].title}</div>
                      <p className="p" style={{ marginTop: 4 }}>{KIND_META[k].shortDescr}</p>
                    </div>
                    <div className="actions actions--1" style={{ marginTop: 12 }}>
                      <span className="btn btn--primary" style={{ width: '100%' }}>{t('servicesOrder.step.kind.select')}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Шаг 2 — выбор тарифа */}
      {kind && !selected && (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="h1">{KIND_META[kind].title}</div>
                <button className="btn" onClick={() => setKind(null)} type="button" style={{ flexShrink: 0 }}>← {t('common.close')}</button>
              </div>
              {KIND_META[kind].recommended && <p className="p" style={{ marginTop: 4 }}>{t('servicesOrder.step.tariff.recommended_hint')}</p>}

              <div className="pre" style={{ marginTop: 12 }}>{KIND_META[kind].descr}</div>

              {kind === 'marzban_router' && (
                <div className="actions actions--1" style={{ marginTop: 12 }}>
                  <button className="btn btn--soft" onClick={() => navigate('/help/router')} type="button"
                    style={{ borderColor: "rgba(96,165,250,0.4)", color: "rgba(147,197,253,1)" }}>
                    📘 {t('servicesRouter.footer.text')}
                  </button>
                </div>
              )}

              <div className="kv" style={{ marginTop: 12 }}>
                {grouped[kind].map((tariff, idx) => (
                  <button key={tariff.serviceId} type="button" className={`kv__item so__tariffBtn ${kind === 'marzban' && idx === 0 ? 'so__tariffCard--focus' : ''}`} onClick={() => setSelected(tariff)}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <div className="list__title">{tariff.title}</div>
                      <span className="chip chip--soft">{fmtMoney(tariff.price, tariff.currency)} / {tariff.periodHuman}</span>
                    </div>
                    {tariff.descr && <p className="p" style={{ marginTop: 4 }}>{tariff.descr}</p>}
                    <div className="actions actions--1" style={{ marginTop: 12 }}>
                      <span className="btn btn--primary" style={{ width: '100%' }}>{t('servicesOrder.step.tariff.order')}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Шаг 3 — оформление */}
      {selected && (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="h1">{selected.title}</div>
                <button className="btn" onClick={resetSelection} type="button" style={{ flexShrink: 0 }}>← {t('common.close')}</button>
              </div>
              {selected.descr && <p className="p" style={{ marginTop: 4 }}>{selected.descr}</p>}

              {!detailsCollapsed && (
                <div className="kv" style={{ marginTop: 12 }}>
                  {calcCards.map((item) => (
                    <div key={item.key} className="kv__item">
                      <div className="kv__k">{item.title}</div>
                      <div className="kv__v">{item.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {!created ? (
                <div className="actions actions--1" style={{ marginTop: 12 }}>
                  <button className="btn btn--primary" onClick={() => void createOrder()} disabled={creating} type="button" style={{ width: '100%' }}>
                    {creating ? t('connect.wait') : needTopup > 0 ? `${t('servicesOrder.step.checkout.order_pay')} ${fmtMoney(toPay, currency)}` : t('servicesOrder.step.checkout.connect')}
                  </button>
                </div>
              ) : (
                <div className="pre" style={{ marginTop: 12 }}>
                  {t('servicesOrder.created')} USI: <b>{created.userServiceId}</b>
                </div>
              )}
            </div>
          </div>

          {/* Оплата */}
          {created && shouldShowPay && (
            <div className="section">
              <div className="card">
                <div className="card__body">
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div className="h1">{t('payments.page.title')}</div>
                      <p className="p">{t('servicesOrder.pay.choose')}</p>
                    </div>
                    <span className="chip chip--soft">{fmtMoney(toPay, currency)}</span>
                  </div>

                  {paySystems.length === 0 ? (
                    <div className="pre" style={{ marginTop: 12 }}>{t('servicesOrder.pay.none')}</div>
                  ) : (
                    <div className="kv" style={{ marginTop: 12 }}>
                      {paySystems.map((ps, idx) => (
                        <div className="kv__item" key={ps.shm_url || idx}>
                          <div className="kv__k">{ps.name || t('servicesOrder.pay.method')}</div>
                          <div className="actions actions--1" style={{ marginTop: 8 }}>
                            <button className="btn btn--primary" onClick={() => void startPay(ps)} disabled={!ps.shm_url || openingPay} type="button" style={{ width: '100%' }}>
                              {openingPay ? t('connect.wait') : `${t('servicesOrder.pay.pay')} ${fmtMoney(toPay, currency)}`}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="actions actions--2" style={{ marginTop: 12 }}>
                    <button className="btn" onClick={() => void pollOnce()} type="button">{t('servicesOrder.pay.poll')}</button>
                    <button className="btn" onClick={() => navigate('/services')} type="button">{t('services.page.title')}</button>
                  </div>

                  {lastPayUrl && (
                    <div className="pre" style={{ marginTop: 12, wordBreak: 'break-all', opacity: 0.6, fontSize: 12 }}>{lastPayUrl}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {created && !shouldShowPay && (
            <div className="actions actions--1" style={{ marginTop: 12 }}>
              <button className="btn btn--primary" onClick={() => navigate('/services')} type="button" style={{ width: '100%' }}>
                {t('services.page.title')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}