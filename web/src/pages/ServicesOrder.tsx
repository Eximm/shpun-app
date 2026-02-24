import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../shared/api/client'
import { useMe } from '../app/auth/useMe'

// ✅ NEW: toast + mood
import { toast } from '../shared/ui/toast'
import { getMood } from '../shared/payments-mood'

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

type OrderResp = { ok: true; items: Tariff[] }

type PaySystem = {
  name?: string
  shm_url?: string
  recurring?: string | number
  amount?: number
}

type PaysystemsResp = { ok: true; items: PaySystem[] }

type CreateResp = {
  ok: true
  item: {
    userServiceId: number
    serviceId: number
    status: string
    statusRaw: string
  }
  raw?: any
}

type UiStatus = 'active' | 'blocked' | 'pending' | 'not_paid' | 'removed' | 'error' | 'init'
type ApiServiceItem = {
  userServiceId: number
  status: UiStatus
  statusRaw: string
}
type ApiServicesResponse = { ok: true; items: ApiServiceItem[]; summary: any }

type Kind = 'amneziawg' | 'marzban' | 'marzban_router'

function nnum(v: any, def = 0) {
  const x = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v)
  return Number.isFinite(x) ? x : def
}

function fmtMoney(n: number, cur: string) {
  const v = nnum(n, 0)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: cur || 'RUB',
      maximumFractionDigits: 0,
    }).format(v)
  } catch {
    return `${v} ${cur || 'RUB'}`
  }
}

function kindFromCategory(cat: string): Kind {
  if (cat.startsWith('vpn-')) return 'amneziawg'
  if (cat === 'marzban') return 'marzban'
  return 'marzban_router'
}

/** названия — как в твоих скринах/боте */
function kindTitle(k: Kind) {
  switch (k) {
    case 'marzban':
      return 'Marzban'
    case 'marzban_router':
      return 'Router VPN'
    case 'amneziawg':
      return 'AmneziaWG'
  }
}

/** длинные описания — внутри категории */
function kindDescr(k: Kind) {
  switch (k) {
    case 'marzban':
      return 'Высокая стабильность и скорость. Подходит для телефонов, ПК и планшетов. Доступ ко всем серверам.'
    case 'marzban_router':
      return 'Создано специально для прошивки Shpun Router. Протокол Reality — максимально незаметность. Работает на всех устройствах через ваш роутер.'
    case 'amneziawg':
      return 'Подключение на один выбранный сервер. Простая настройка и минимум параметров. Может работать нестабильно в ряде регионов.'
  }
}

/** короткие описания — на карточках выбора типа */
function kindDescrShort(k: Kind) {
  switch (k) {
    case 'marzban':
      return 'Стабильно и быстро. Для телефона, ПК и планшета. Все серверы.'
    case 'marzban_router':
      return 'VPN на всю домашнюю сеть через роутер. Протокол Reality.'
    case 'amneziawg':
      return 'Простой VPN на один сервер. В некоторых регионах бывает нестабильным.'
  }
}

function buildPayUrl(base: string, amount: number) {
  const a = Math.max(1, Math.ceil(nnum(amount, 1)))
  if (base.includes('{amount}')) return base.replace('{amount}', String(a))
  return `${base}${a}`
}

function getTelegramWebApp(): any | null {
  const w = window as any
  return w?.Telegram?.WebApp || null
}

async function copyToClipboard(text: string) {
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

/** ====== Amnezia warning (как в боте) ====== */
const AMNEZIA_WARN_KEY = 'order.amnezia.warn.dismissed.v1'
function readAmneziaWarnDismissed(): boolean {
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
    // ignore
  }
}

export function ServicesOrder() {
  const navigate = useNavigate()

  // ✅ единый источник денег, как на Home
  const { me, loading: meLoading, error: meError, refetch } = useMe()

  const balanceAmount = nnum(me?.balance?.amount, 0)
  const currency = String(me?.balance?.currency || 'RUB')
  const bonus = nnum((me as any)?.bonus, 0)
  const available = balanceAmount + bonus

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [kind, setKind] = useState<Kind | null>(null)
  const [selected, setSelected] = useState<Tariff | null>(null)

  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreateResp['item'] | null>(null)

  const [paySystems, setPaySystems] = useState<PaySystem[]>([])
  const [overlayOpen, setOverlayOpen] = useState(false)

  // UX: сворачиваем details после "Заказать"
  const [detailsCollapsed, setDetailsCollapsed] = useState(false)

  const [waitMsg, setWaitMsg] = useState<string | null>(null)

  // ✅ для стабильной оплаты/фоллбеков
  const [lastPayUrl, setLastPayUrl] = useState<string | null>(null)
  const [lastPayAmount, setLastPayAmount] = useState<number>(0)
  const [openingPay, setOpeningPay] = useState(false)
  const [payOpenError, setPayOpenError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // ✅ предупреждение Amnezia (1 раз)
  const [amneziaWarnOpen, setAmneziaWarnOpen] = useState(false)

  async function loadPaysystems() {
    const ps = await apiFetch<PaysystemsResp>('/payments/paysystems', { method: 'GET' })
    const items = ps?.items || []
    const filtered = items.filter((x) => {
      const n = String(x?.name || '')
      if (n === 'Telegram Stars Rescue') return false
      if (n === 'Telegram Stars Karlson') return false
      return true
    })
    setPaySystems(filtered)
  }

  async function loadTariffs() {
    setLoading(true)
    setErr(null)
    try {
      const o = await apiFetch<OrderResp>('/services/order')
      setTariffs(o.items || [])
    } catch (e: any) {
      setErr(e?.message || 'Failed to load tariffs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTariffs()

    // ✅ deep-link: /services/order?kind=marzban_router
    try {
      const q = new URLSearchParams(window.location.search)
      const k = q.get('kind')
      if (k === 'marzban_router' || k === 'marzban' || k === 'amneziawg') {
        setKind(k)
      }
    } catch {
      // ignore
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grouped = useMemo(() => {
    const m: Record<Kind, Tariff[]> = { amneziawg: [], marzban: [], marzban_router: [] }
    for (const t of tariffs) {
      m[kindFromCategory(String(t.category || ''))].push({
        ...t,
        price: nnum((t as any).price, 0),
      })
    }
    for (const k of Object.keys(m) as Kind[]) {
      m[k].sort((a, b) => nnum(a.price, 0) - nnum(b.price, 0))
    }
    return m
  }, [tariffs])

  const needTopup = useMemo(() => {
    if (!selected) return 0
    const price = nnum(selected.price, 0)
    const diff = price - available
    return diff > 0 ? Math.ceil(diff) : 0
  }, [selected, available])

  const shouldShowPay = useMemo(() => {
    if (!created) return false
    if (needTopup > 0) return true
    return String(created.status || '').toLowerCase() === 'not_paid'
  }, [created, needTopup])

  async function createOrder() {
    if (!selected) return
    setCreating(true)
    setErr(null)

    try {
      const r = await apiFetch<CreateResp>('/services/order', {
        method: 'PUT',
        body: JSON.stringify({ service_id: selected.serviceId }),
      })
      setCreated(r.item)

      // UX: сворачиваем details и показываем оплату
      setDetailsCollapsed(true)

      const orderId = String(r.item?.userServiceId || '')
      const amount = nnum(selected?.price, 0)

      if (String(r.item?.status || '').toLowerCase() === 'not_paid' || needTopup > 0) {
        await loadPaysystems()
        setWaitMsg('Выберите способ оплаты ниже.')

        toast.info('Заказ создан', {
          description:
            getMood('payment_checking', { seed: orderId }) ??
            'Выберите способ оплаты ниже.',
        })
      } else {
        setWaitMsg('✅ Услуга создана. Можно перейти в раздел услуг.')

        toast.success('Готово', {
          description:
            getMood('service_activated', { seed: orderId }) ??
            'Услуга создана и активируется.',
        })
        // иногда оплата проходит мгновенно — можно и так:
        toast.success('Оплата прошла', {
          description:
            getMood('payment_success', { amount, seed: orderId }) ??
            'Принято.',
        })
      }
    } catch (e: any) {
      const msg = e?.message || 'Failed to create service'
      setErr(msg)
      toast.error('Не удалось создать услугу', { description: msg })
    } finally {
      setCreating(false)
    }
  }

  async function tryOpenPayment(url: string) {
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
      const w = window.open(url, '_blank', 'noopener,noreferrer')
      return !!w
    } catch {
      return false
    }
  }

  async function startPay(ps: PaySystem) {
    setCopied(false)
    setPayOpenError(null)

    if (!ps?.shm_url) {
      setPayOpenError('У этого способа оплаты нет ссылки.')
      setOverlayOpen(true)
      toast.error('Оплата недоступна', { description: 'У этого способа оплаты нет ссылки.' })
      return
    }

    const toPay = needTopup > 0 ? needTopup : Math.max(1, Math.ceil(nnum(selected?.price, 0) - available))

    const url = buildPayUrl(ps.shm_url, toPay)
    setLastPayUrl(url)
    setLastPayAmount(toPay)

    setOpeningPay(true)
    const opened = await tryOpenPayment(url)
    setOpeningPay(false)

    setOverlayOpen(true)

    const seed = String(created?.userServiceId || '') || String(selected?.serviceId || '')

    if (opened) {
      setWaitMsg('Окно оплаты открыто. После оплаты нажмите “Я оплатил — проверить” или перейдите в “Услуги”.')

      toast.info('Окно оплаты открыто', {
        description:
          getMood('payment_checking', { seed }) ??
          'После оплаты нажмите “Я оплатил — проверить”.',
      })
    } else {
      setPayOpenError('Не удалось открыть оплату (вкладка могла быть заблокирована). Откройте ссылку вручную.')
      setWaitMsg('Откройте ссылку оплаты и завершите оплату. Затем вернитесь сюда и нажмите “Я оплатил — проверить”.')

      toast.error('Не удалось открыть оплату', {
        description:
          'Вкладка могла быть заблокирована. Откройте ссылку вручную.',
      })
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
      setPayOpenError('Не удалось открыть оплату. Откройте ссылку вручную.')
      toast.error('Не удалось открыть оплату', { description: 'Откройте ссылку вручную.' })
    } else {
      toast.info('Окно оплаты открыто', {
        description: 'Завершите оплату и вернитесь для проверки.',
      })
    }
  }

  async function pollOnce() {
    const seed = String(created?.userServiceId || '') || String(selected?.serviceId || '')

    toast.info('Проверяем платёж', {
      description: getMood('payment_checking', { seed }) ?? 'Пара секунд…',
    })

    try {
      await Promise.resolve(refetch?.())
    } catch {
      // ignore
    }

    if (!created?.userServiceId) return false
    try {
      const s = await apiFetch<ApiServicesResponse>('/services')
      const it = (s.items || []).find((x) => x.userServiceId === created.userServiceId)
      if (it && (it.status === 'active' || it.status === 'pending')) {
        setCreated((cur) => (cur ? { ...cur, status: it.status, statusRaw: it.statusRaw || cur.statusRaw } : cur))
        setWaitMsg('✅ Услуга активируется / активна. Можно перейти в раздел услуг.')

        toast.success('Готово', {
          description: getMood('service_activated', { seed }) ?? 'Услуга активирована.',
        })

        // если хочешь — можно показать и “оплата прошла”, но без спама:
        const amount = needTopup > 0 ? needTopup : nnum(selected?.price, 0)
        toast.success('Оплата прошла', {
          description: getMood('payment_success', { amount, seed }) ?? 'Принято.',
        })

        return true
      }
    } catch {
      // ignore
    }

    setWaitMsg('Пока не вижу обновления статуса. Попробуйте ещё раз через несколько секунд.')

    toast.info('Пока не подтверждено', {
      description: getMood('payment_failed', { seed }) ?? 'Попробуйте ещё раз через несколько секунд.',
    })

    return false
  }

  function resetSelection() {
    setSelected(null)
    setCreated(null)
    setPaySystems([])
    setWaitMsg(null)
    setErr(null)
    setOverlayOpen(false)
    setDetailsCollapsed(false)

    setLastPayUrl(null)
    setLastPayAmount(0)
    setPayOpenError(null)
    setOpeningPay(false)
    setCopied(false)
  }

  async function handleCopyLink() {
    if (!lastPayUrl) return
    const ok = await copyToClipboard(lastPayUrl)
    setCopied(ok)
    if (!ok) {
      setPayOpenError('Не получилось скопировать ссылку автоматически. Скопируйте вручную из строки ниже.')
      toast.error('Не удалось скопировать', { description: 'Скопируйте ссылку вручную.' })
    } else {
      toast.success('Ссылка скопирована', { description: 'Можно вставлять в браузер или отправить себе.' })
    }
  }

  // ✅ показываем предупреждение при заходе в категорию AmneziaWG (только 1 раз)
  useEffect(() => {
    if (kind !== 'amneziawg') return
    if (readAmneziaWarnDismissed()) return
    setAmneziaWarnOpen(true)
  }, [kind])

  function closeAmneziaWarn() {
    saveAmneziaWarnDismissed()
    setAmneziaWarnOpen(false)
  }

  if (loading || meLoading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Подключение услуги</h1>
            <p className="p">Загрузка…</p>
          </div>
        </div>
      </div>
    )
  }

  const topError = err || (meError ? String((meError as any).message || meError) : null)

  return (
    <div className="section">
      {/* ==== overlay оплаты ==== */}
      {overlayOpen ? (
        <div className="overlay" onClick={() => setOverlayOpen(false)}>
          <div className="card overlay__card" onClick={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="overlay__title">{payOpenError ? 'Оплата не открылась' : 'Окно оплаты'}</div>

              <p className="p so__mt8">
                {payOpenError
                  ? 'Если вы в Telegram или браузер блокирует всплывающие окна — откройте ссылку вручную.'
                  : 'Завершите оплату в открывшемся окне. Затем вернитесь сюда и проверьте статус.'}
              </p>

              {payOpenError ? <div className="pre so__mt12">Причина: {payOpenError}</div> : null}

              {lastPayUrl ? (
                <div className="pre so__mt12" style={{ userSelect: 'text' }}>
                  {lastPayUrl}
                </div>
              ) : null}

              {copied ? <div className="pre so__mt12">✅ Ссылка скопирована</div> : null}

              <div className="actions actions--1 so__mt12">
                <button className="btn btn--primary" onClick={retryOpenLast} disabled={!lastPayUrl || openingPay}>
                  {openingPay ? 'Открываем…' : 'Открыть ещё раз'}
                </button>

                <button className="btn" onClick={handleCopyLink} disabled={!lastPayUrl}>
                  Скопировать ссылку
                </button>

                <button className="btn" onClick={pollOnce}>
                  Я оплатил — проверить
                </button>

                <button className="btn" onClick={() => window.location.assign('/services')}>
                  Перейти в услуги
                </button>

                <button className="btn" onClick={() => setOverlayOpen(false)}>
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ==== предупреждение AmneziaWG ==== */}
      {amneziaWarnOpen ? (
        <div className="overlay" onClick={closeAmneziaWarn}>
          <div className="card overlay__card" onClick={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="overlay__title">⚠️ Важно про AmneziaWG</div>

              <div className="p so__mt8">
                Стабильность AmneziaWG не гарантирована и может зависеть от провайдера. Использование — на свой риск.
                Для надёжной работы рекомендуем подписку Marzban.
              </div>

              <div className="actions actions--1 so__mt12">
                <button className="btn btn--primary" onClick={closeAmneziaWarn}>
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ==== header ==== */}
      <div className="card">
        <div className="card__body">
          <div className="row so__headerRow">
            <div>
              <h1 className="h1">Подключение услуги</h1>
              <div className="p so__mt6">
                Баланс: <b>{fmtMoney(balanceAmount, currency)}</b>
                <span className="dot" />
                Бонусы: <b>{bonus}</b>
                <span className="dot" />
                Доступно: <b>{fmtMoney(available, currency)}</b>
              </div>
            </div>
          </div>

          {waitMsg ? <div className="pre so__mt12">{waitMsg}</div> : null}
          {topError ? <div className="pre so__mt12">Ошибка: {topError}</div> : null}
        </div>
      </div>

      {/* ==== categories ==== */}
      {!kind ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="row so__spaceBetween">
                <div className="h1 so__h18" style={{ fontWeight: 800, letterSpacing: '-0.01em' }}>
                  Выберите тип услуги
                </div>
                <button className="btn" onClick={() => navigate(-1)}>
                  ⇦ Назад
                </button>
              </div>

              <p className="p so__mt6" style={{ opacity: 0.8 }}>
                Подберём подходящий вариант под ваше устройство.
              </p>

              <div className="kv so__mt12">
                {(['marzban', 'marzban_router', 'amneziawg'] as Kind[]).map((k) => (
                  <button
                    key={k}
                    className="kv__item"
                    onClick={() => setKind(k)}
                    type="button"
                    title="Выбрать"
                    style={{ textAlign: 'left', display: 'block' }}
                  >
                    <div className="row so__spaceBetween" style={{ alignItems: 'flex-start', gap: 10 }}>
                      <div className="services-cat__headLeft">
                        <div className="services-cat__titleRow">
                          <div className="services-cat__title">{kindTitle(k)}</div>
                        </div>

                        <p className="p so__mt6" style={{ opacity: 0.8 }}>
                          {kindDescrShort(k)}
                        </p>
                      </div>

                      <span className="badge" style={{ whiteSpace: 'nowrap' }}>
                        {grouped[k].length}
                      </span>
                    </div>
                    <div className="actions actions--1 so__mt12" style={{ pointerEvents: 'none' }}>
                      <span className="btn btn--primary so__btnFull" style={{ textAlign: 'center' }}>
                        Выбрать
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ==== tariffs ==== */}
      {kind && !selected ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="row so__spaceBetween">
                <div className="h1 so__h18" style={{ fontWeight: 800, letterSpacing: '-0.01em' }}>
                  {kindTitle(kind)}
                </div>

                <button className="btn" onClick={() => setKind(null)}>
                  ⇦ Назад
                </button>
              </div>

              <div
                className="pre so__mt12"
                style={{
                  border: '1px solid rgba(148,163,184,.35)',
                  opacity: 0.82,
                }}
              >
                {kindDescr(kind)}
              </div>

              {kind === 'marzban_router' ? (
                <div className="actions actions--1 so__mt12">
                  <button className="btn so__btnFull" onClick={() => navigate('/help/router')}>
                    📘 Инструкция Shpun Router
                  </button>
                </div>
              ) : null}

              <div className="kv so__mt12">
                {grouped[kind].map((t) => (
                  <button key={t.serviceId} className="kv__item" onClick={() => setSelected(t)} type="button">
                    <div className="row so__spaceBetween">
                      <div className="kv__k" style={{ fontWeight: 700 }}>
                        {t.title}
                      </div>
                      <span className="badge">
                        {fmtMoney(t.price, t.currency)} / {t.periodHuman}
                      </span>
                    </div>
                    {t.descr ? (
                      <div className="kv__v so__mt6" style={{ opacity: 0.82 }}>
                        {t.descr}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ==== selected / checkout ==== */}
      {selected ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="row so__spaceBetween">
                <div>
                  <div className="h1 so__h18" style={{ fontWeight: 800, letterSpacing: '-0.01em' }}>
                    {selected.title}
                  </div>
                  <p className="p" style={{ opacity: 0.82 }}>
                    {selected.descr || '—'}
                  </p>
                </div>
                <button className="btn" onClick={resetSelection}>
                  ⇦ Назад
                </button>
              </div>

              <div className={`so__details ${detailsCollapsed ? 'is-collapsed' : ''}`}>
                <div
                  style={{
                    marginTop: 12,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: 10,
                  }}
                >
                  <div className="kv__item">
                    <div className="kv__k">Стоимость</div>
                    <div className="kv__v">{fmtMoney(nnum(selected.price, 0), selected.currency)}</div>
                  </div>

                  <div className="kv__item">
                    <div className="kv__k">Период</div>
                    <div className="kv__v">{selected.periodHuman}</div>
                  </div>

                  <div className="kv__item">
                    <div className="kv__k">Баланс</div>
                    <div className="kv__v">{fmtMoney(balanceAmount, currency)}</div>
                  </div>

                  <div className="kv__item">
                    <div className="kv__k">Бонусы</div>
                    <div className="kv__v">{bonus}</div>
                  </div>

                  <div className="kv__item">
                    <div className="kv__k">Доступно</div>
                    <div className="kv__v">{fmtMoney(available, currency)}</div>
                  </div>

                  <div className="kv__item">
                    <div className="kv__k">Не хватает</div>
                    <div className="kv__v">{needTopup > 0 ? fmtMoney(needTopup, currency) : '—'}</div>
                  </div>
                </div>

                {!created ? (
                  <div className="actions actions--1 so__mt12">
                    <button className="btn btn--primary so__btnFull" onClick={createOrder} disabled={creating}>
                      {creating ? 'Создаём…' : needTopup > 0 ? 'Заказать и оплатить' : 'Подключить'}
                    </button>
                  </div>
                ) : (
                  <div className="pre so__mt12">
                    Услуга создана. usi: <b>{created.userServiceId}</b>, статус <b>{created.status}</b>
                  </div>
                )}
              </div>

              {created && shouldShowPay ? (
                <div className="so__pay so__mt12">
                  <div className="card so__cardFlat">
                    <div className="card__body">
                      <div className="h1 so__h18" style={{ fontWeight: 800, letterSpacing: '-0.01em' }}>
                        Оплата
                      </div>
                      <p className="p" style={{ opacity: 0.82 }}>
                        Выберите способ оплаты. Мы откроем оплату, а вы сможете вернуться и проверить статус.
                      </p>

                      {paySystems.length === 0 ? (
                        <div className="pre">Способы оплаты не найдены.</div>
                      ) : (
                        <div className="kv so__mt12">
                          {paySystems.map((ps, idx) => (
                            <div className="kv__item" key={ps.shm_url || idx}>
                              <div className="row so__spaceBetween">
                                <div className="kv__k" style={{ fontWeight: 700 }}>
                                  {ps.name || 'Payment method'}
                                </div>
                                <span className="badge">{ps.recurring ? 'recurring' : 'one-time'}</span>
                              </div>

                              <div className="actions actions--1 so__mt10">
                                <button
                                  className="btn btn--primary so__btnFull"
                                  onClick={() => startPay(ps)}
                                  disabled={!ps.shm_url || openingPay}
                                >
                                  {openingPay
                                    ? 'Открываем…'
                                    : `Оплатить ${fmtMoney(needTopup > 0 ? needTopup : 1, currency)}`}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="actions actions--1 so__mt12">
                        <button className="btn so__btnFull" onClick={pollOnce}>
                          Я оплатил — проверить
                        </button>
                        <button className="btn so__btnFull" onClick={() => window.location.assign('/services')}>
                          Перейти в услуги
                        </button>
                      </div>

                      {lastPayUrl ? (
                        <div className="pre so__mt12" style={{ opacity: 0.85 }}>
                          Последняя ссылка оплаты (на {Math.max(1, Math.ceil(lastPayAmount || 1))}): {lastPayUrl}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {created && !shouldShowPay ? (
                <div className="actions actions--1 so__mt12">
                  <button className="btn btn--primary so__btnFull" onClick={() => window.location.assign('/services')}>
                    Перейти в услуги
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}