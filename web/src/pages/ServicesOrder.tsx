import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../shared/api/client'
import { useMe } from '../app/auth/useMe'
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

type ApiServicesResponse = {
  ok: true
  items: ApiServiceItem[]
  summary: any
}

type Kind = 'amneziawg' | 'marzban' | 'marzban_router'

const AMNEZIA_WARN_KEY = 'order.amnezia.warn.dismissed.v1'
const HIDDEN_PAYSYSTEMS = new Set(['Telegram Stars Rescue', 'Telegram Stars Karlson'])

const KIND_META: Record<
  Kind,
  {
    title: string
    descr: string
    shortDescr: string
    recommended?: boolean
  }
> = {
  marzban: {
    title: 'Marzban',
    descr:
      'Высокая стабильность и скорость. Подходит для телефонов, ПК и планшетов. Доступ ко всем серверам.',
    shortDescr: 'Стабильно и быстро. Для телефона, ПК и планшета. Специальные маршруты для белых списков.',
    recommended: true,
  },
  marzban_router: {
    title: 'Router VPN',
    descr:
      'Создано специально для прошивки Shpun Router. Протокол Reality — максимально незаметность. Работает на всех устройствах через ваш роутер.',
    shortDescr: 'VPN на всю домашнюю сеть через роутер. Протокол Reality.',
  },
  amneziawg: {
    title: 'AmneziaWG',
    descr:
      'Подключение на один выбранный сервер. Простая настройка и минимум параметров. Может работать нестабильно в ряде регионов.',
    shortDescr: 'Простой VPN на один сервер. В некоторых регионах бывает нестабильным или вовсе не рабочим.',
  },
}

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
    // ignore
  }
}

function getCreateOrderErrorInfo(e: any): { title: string; description: string } {
  const errorCode = String(e?.error || e?.code || '').trim()
  const message = String(e?.message || '').trim()

  if (errorCode === 'unpaid_order_exists') {
    return {
      title: 'Есть неоплаченная услуга',
      description: 'Сначала оплатите или удалите уже созданную неоплаченную услугу, чтобы оформить новую.',
    }
  }

  if (errorCode === 'unpaid_same_service_exists') {
    return {
      title: 'Есть неоплаченный заказ этого типа',
      description: 'Сначала оплатите или удалите неоплаченную услугу этого типа, чтобы оформить новую.',
    }
  }

  return {
    title: 'Не удалось создать услугу',
    description: message || 'Не удалось создать заказ. Попробуйте ещё раз.',
  }
}

export function ServicesOrder() {
  const navigate = useNavigate()
  const { me, loading: meLoading, error: meError, refetch } = useMe()

  const balanceAmount = nnum(me?.balance?.amount, 0)
  const currency = String(me?.balance?.currency || 'RUB')
  const bonus = nnum((me as any)?.bonus, 0)
  const discountPercent = Math.max(0, nnum((me as any)?.discount, 0))
  const hasDiscount = discountPercent > 0

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [kind, setKind] = useState<Kind | null>(null)
  const [selected, setSelected] = useState<Tariff | null>(null)

  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreateResp['item'] | null>(null)

  const [paySystems, setPaySystems] = useState<PaySystem[]>([])
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [detailsCollapsed, setDetailsCollapsed] = useState(false)
  const [waitMsg, setWaitMsg] = useState<string | null>(null)

  const [lastPayUrl, setLastPayUrl] = useState<string | null>(null)
  const [lastPayAmount, setLastPayAmount] = useState<number>(0)
  const [openingPay, setOpeningPay] = useState(false)
  const [payOpenError, setPayOpenError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [amneziaWarnOpen, setAmneziaWarnOpen] = useState(false)

  const grouped = useMemo(() => {
    const map: Record<Kind, Tariff[]> = {
      amneziawg: [],
      marzban: [],
      marzban_router: [],
    }

    for (const t of tariffs) {
      map[kindFromCategory(String(t.category || ''))].push({
        ...t,
        price: nnum(t.price, 0),
      })
    }

    for (const k of Object.keys(map) as Kind[]) {
      map[k].sort((a, b) => nnum(a.price, 0) - nnum(b.price, 0))
    }

    return map
  }, [tariffs])

  const priceCalc = useMemo(() => {
    if (!selected) {
      return {
        base: 0,
        discounted: 0,
        bonusUsed: 0,
        balanceUsed: 0,
        needTopup: 0,
      }
    }

    const base = nnum(selected.price, 0)
    const discounted = Math.round(base * (1 - discountPercent / 100))
    const bonusLimit = Math.floor(discounted * 0.5)
    const bonusUsed = Math.min(bonus, bonusLimit)
    const afterBonus = Math.max(0, discounted - bonusUsed)
    const balanceUsed = Math.min(balanceAmount, afterBonus)
    const needTopup = Math.max(0, afterBonus - balanceUsed)

    return {
      base,
      discounted,
      bonusUsed,
      balanceUsed,
      needTopup,
    }
  }, [selected, discountPercent, bonus, balanceAmount])

  const needTopup = priceCalc.needTopup

  const toPay = useMemo(() => {
    return Math.max(1, priceCalc.needTopup)
  }, [priceCalc.needTopup])

  const shouldShowPay = useMemo(() => {
    if (!created) return false
    if (needTopup > 0) return true
    return String(created.status || '').toLowerCase() === 'not_paid'
  }, [created, needTopup])

  const topError = err || (meError ? String((meError as any)?.message || meError) : null)
  const selectedKindMeta = kind ? KIND_META[kind] : null

  const moodChecking = (seed: string) => getMood('payment_checking', { seed }) ?? 'Пара секунд…'
  const moodSuccess = (seed: string, amount?: number) => getMood('payment_success', { seed, amount }) ?? 'Принято.'

  const calcCards = useMemo(() => {
    if (!selected) return []

    const items: Array<{ key: string; title: string; value: string }> = [
      {
        key: 'base',
        title: 'Базовая стоимость',
        value: fmtMoney(priceCalc.base, selected.currency),
      },
    ]

    if (hasDiscount && priceCalc.discounted !== priceCalc.base) {
      items.push({
        key: 'discounted',
        title: 'Со скидкой',
        value: fmtMoney(priceCalc.discounted, selected.currency),
      })
    }

    items.push({
      key: 'period',
      title: 'Период',
      value: selected.periodHuman,
    })

    if (priceCalc.bonusUsed > 0) {
      items.push({
        key: 'bonus',
        title: 'Бонусы',
        value: `-${fmtMoney(priceCalc.bonusUsed, currency)}`,
      })
    }

    if (priceCalc.balanceUsed > 0) {
      items.push({
        key: 'balance',
        title: 'Покрывается балансом',
        value: fmtMoney(priceCalc.balanceUsed, currency),
      })
    }

    return items
  }, [selected, priceCalc, hasDiscount, currency])

  useEffect(() => {
    void loadTariffs()

    try {
      const q = new URLSearchParams(window.location.search)
      const k = q.get('kind')
      if (k === 'marzban_router' || k === 'marzban' || k === 'amneziawg') {
        setKind(k)
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (kind !== 'amneziawg') return
    if (readAmneziaWarnDismissed()) return
    setAmneziaWarnOpen(true)
  }, [kind])

  async function loadTariffs() {
    setLoading(true)
    setErr(null)

    try {
      const resp = await apiFetch<OrderResp>('/services/order')
      setTariffs(resp.items || [])
    } catch (e: any) {
      setErr(e?.message || 'Failed to load tariffs')
    } finally {
      setLoading(false)
    }
  }

  async function loadPaysystems() {
    const resp = await apiFetch<PaysystemsResp>('/payments/paysystems', { method: 'GET' })
    const items = (resp?.items || []).filter((x) => !HIDDEN_PAYSYSTEMS.has(String(x?.name || '')))
    setPaySystems(items)
  }

  async function createOrder() {
    if (!selected) return

    setCreating(true)
    setErr(null)

    try {
      const resp = await apiFetch<CreateResp>('/services/order', {
        method: 'PUT',
        body: JSON.stringify({ service_id: selected.serviceId }),
      })

      const item = resp.item
      const orderId = String(item?.userServiceId || '')
      const status = String(item?.status || '').toLowerCase()

      setCreated(item)
      setDetailsCollapsed(true)

      if (status === 'not_paid' || needTopup > 0) {
        await loadPaysystems()
        setWaitMsg('Выберите способ оплаты ниже.')

        toast.info('Заказ создан', {
          description: moodChecking(orderId),
        })
      } else {
        setWaitMsg('✅ Услуга создана. Можно перейти в раздел услуг.')

        toast.success('Готово', {
          description: 'Услуга создана и активируется.',
        })

        toast.success('Оплата принята', {
          description: moodSuccess(orderId, nnum(selected.price, 0)),
        })
      }
    } catch (e: any) {
      const info = getCreateOrderErrorInfo(e)
      setErr(info.description)
      toast.error(info.title, { description: info.description })
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

    const url = buildPayUrl(ps.shm_url, toPay)
    const seed = String(created?.userServiceId || '') || String(selected?.serviceId || '')

    setLastPayUrl(url)
    setLastPayAmount(toPay)

    setOpeningPay(true)
    const opened = await tryOpenPayment(url)
    setOpeningPay(false)

    setOverlayOpen(true)

    if (opened) {
      setWaitMsg('Окно оплаты открыто. После оплаты нажмите “Я оплатил — проверить” или перейдите в “Услуги”.')

      toast.info('Окно оплаты открыто', {
        description: moodChecking(seed),
      })
    } else {
      setPayOpenError('Не удалось открыть оплату (вкладка могла быть заблокирована). Откройте ссылку вручную.')
      setWaitMsg('Откройте ссылку оплаты и завершите оплату. Затем вернитесь сюда и нажмите “Я оплатил — проверить”.')

      toast.error('Не удалось открыть оплату', {
        description: 'Вкладка могла быть заблокирована. Откройте ссылку вручную.',
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
      toast.error('Не удалось открыть оплату', {
        description: 'Откройте ссылку вручную.',
      })
      return
    }

    toast.info('Окно оплаты открыто', {
      description: 'Завершите оплату и вернитесь для проверки.',
    })
  }

  async function pollOnce() {
    const seed = String(created?.userServiceId || '') || String(selected?.serviceId || '')

    toast.info('Проверяем платёж', {
      description: moodChecking(seed),
    })

    try {
      await Promise.resolve(refetch?.())
    } catch {
      // ignore
    }

    if (!created?.userServiceId) return false

    try {
      const resp = await apiFetch<ApiServicesResponse>('/services')
      const item = (resp.items || []).find((x) => x.userServiceId === created.userServiceId)

      if (item && (item.status === 'active' || item.status === 'pending')) {
        setCreated((cur) =>
          cur
            ? {
                ...cur,
                status: item.status,
                statusRaw: item.statusRaw || cur.statusRaw,
              }
            : cur,
        )

        setWaitMsg('✅ Услуга активируется / активна. Можно перейти в раздел услуг.')

        toast.success('Готово', {
          description: 'Услуга активирована.',
        })

        toast.success('Оплата принята', {
          description: moodSuccess(seed, toPay),
        })

        return true
      }
    } catch {
      // ignore
    }

    setWaitMsg('Пока не вижу обновления статуса. Попробуйте ещё раз через несколько секунд.')
    toast.info('Пока не подтверждено', {
      description: 'Попробуйте ещё раз через несколько секунд.',
    })

    return false
  }

  async function handleCopyLink() {
    if (!lastPayUrl) return

    const ok = await copyToClipboard(lastPayUrl)
    setCopied(ok)

    if (!ok) {
      setPayOpenError('Не получилось скопировать ссылку автоматически. Скопируйте вручную из строки ниже.')
      toast.error('Не удалось скопировать', {
        description: 'Скопируйте ссылку вручную.',
      })
      return
    }

    toast.success('Ссылка скопирована', {
      description: 'Можно вставлять в браузер или отправить себе.',
    })
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

  return (
    <div className="section">
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

              {lastPayUrl ? <div className="pre so__mt12 so__lastPayUrl">{lastPayUrl}</div> : null}

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

      <div className="card">
        <div className="card__body">
          <div className="row so__headerRow">
            <div>
              <h1 className="h1">Подключение услуги</h1>

              <div className="so__heroMeta">
                <span className="badge">Баланс: {fmtMoney(balanceAmount, currency)}</span>
                <span className="badge">Бонусы: {bonus}</span>
                {hasDiscount ? <span className="badge">Скидка клиента: -{Math.round(discountPercent)}%</span> : null}
              </div>
            </div>
          </div>

          {waitMsg ? <div className="pre so__mt12 so__statusBox">{waitMsg}</div> : null}
          {topError ? <div className="pre so__mt12">Ошибка: {topError}</div> : null}
        </div>
      </div>

      {!kind ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="row so__spaceBetween">
                <div>
                  <div className="h1 so__h18">Выберите тип услуги</div>
                  <p className="p so__mt6 so__muted">Если не уверены, выбирайте Marzban.</p>
                </div>

                <button className="btn" onClick={() => navigate(-1)}>
                  ⇦ Назад
                </button>
              </div>

              <div className="kv so__kindGrid">
                {(['marzban', 'marzban_router', 'amneziawg'] as Kind[]).map((k) => {
                  const isRecommended = !!KIND_META[k].recommended

                  return (
                    <button
                      key={k}
                      type="button"
                      className={`kv__item so__kindCard ${isRecommended ? 'so__kindCard--recommended' : ''}`}
                      onClick={() => setKind(k)}
                      title="Выбрать"
                    >
                      <div className="row so__spaceBetween">
                        <div className="services-cat__headLeft">
                          {isRecommended ? <div className="so__badgeRecommended">Рекомендуем</div> : null}

                          <div className="services-cat__titleRow">
                            <div className="services-cat__title so__kindCardTitle">{KIND_META[k].title}</div>
                          </div>

                          <p className="p so__kindCardDescr">{KIND_META[k].shortDescr}</p>
                        </div>

                        <span className="badge">{grouped[k].length}</span>
                      </div>

                      <div className="actions actions--1 so__mt12">
                        <span className="btn btn--primary so__btnFull">
                          {k === 'marzban' ? 'Выбрать Marzban' : 'Выбрать'}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {kind && !selected ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="row so__spaceBetween">
                <div>
                  <div className="h1 so__h18">{selectedKindMeta?.title}</div>
                  {kind === 'marzban' ? (
                    <p className="p so__mt6 so__muted">Рекомендуемый вариант для большинства пользователей.</p>
                  ) : null}
                </div>

                <button className="btn" onClick={() => setKind(null)}>
                  ⇦ Назад
                </button>
              </div>

              <div className="pre so__descrBox">{selectedKindMeta?.descr}</div>

              {kind === 'marzban_router' ? (
                <div className="actions actions--1 so__mt12">
                  <button className="btn so__btnFull" onClick={() => navigate('/help/router')}>
                    📘 Инструкция Shpun Router
                  </button>
                </div>
              ) : null}

              <div className="kv so__tariffList">
                {grouped[kind].map((t, idx) => (
                  <button
                    key={t.serviceId}
                    type="button"
                    className={`kv__item so__tariffBtn ${idx === 0 ? 'so__tariffCard--focus' : ''}`}
                    onClick={() => setSelected(t)}
                  >
                    <div className="row so__spaceBetween">
                      <div className="kv__k so__payMethodTitle">{t.title}</div>
                      <span className="badge">
                        {fmtMoney(t.price, t.currency)} / {t.periodHuman}
                      </span>
                    </div>

                    {t.descr ? <div className="kv__v so__mt6 so__muted">{t.descr}</div> : null}

                    <div className="actions actions--1 so__mt12">
                      <span className="btn btn--primary so__btnFull">Заказать</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selected ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="so__checkoutHead">
                <div>
                  <div className="so__checkoutTitle">{selected.title}</div>
                  <p className="p so__checkoutDescr">{selected.descr || '—'}</p>
                </div>

                <button className="btn" onClick={resetSelection}>
                  ⇦ Назад
                </button>
              </div>

              <div className={`so__details ${detailsCollapsed ? 'is-collapsed' : ''}`}>
                <div className="so__calcGrid">
                  {calcCards.map((item) => (
                    <div key={item.key} className="kv__item so__calcCard">
                      <div className="kv__k">{item.title}</div>
                      <div className="kv__v">{item.value}</div>
                    </div>
                  ))}
                </div>

                {!created ? (
                  <div className="actions actions--1 so__mt12">
                    <button className="btn btn--primary so__btnFull" onClick={createOrder} disabled={creating}>
                      {creating
                        ? 'Создаём…'
                        : needTopup > 0
                          ? `Заказать и оплатить ${fmtMoney(toPay, currency)}`
                          : 'Подключить'}
                    </button>
                  </div>
                ) : (
                  <div className="pre so__createdBox">
                    Услуга создана. USI: <b>{created.userServiceId}</b>, статус: <b>{created.status}</b>
                  </div>
                )}
              </div>

              {created && shouldShowPay ? (
                <div className="so__pay so__mt12">
                  <div className="card so__cardFlat">
                    <div className="card__body">
                      <div className="row so__spaceBetween">
                        <div>
                          <div className="h1 so__h18">Оплата</div>
                          <p className="p so__muted">Выберите способ оплаты и завершите заказ.</p>
                        </div>
                        <span className="badge">{fmtMoney(toPay, currency)}</span>
                      </div>

                      {paySystems.length === 0 ? (
                        <div className="pre so__mt12">Способы оплаты не найдены.</div>
                      ) : (
                        <div className="kv so__payMethods">
                          {paySystems.map((ps, idx) => (
                            <div className="kv__item" key={ps.shm_url || idx}>
                              <div className="row so__spaceBetween">
                                <div className="kv__k so__payMethodTitle">{ps.name || 'Payment method'}</div>
                                <span className="badge">{ps.recurring ? 'recurring' : 'one-time'}</span>
                              </div>

                              <div className="actions actions--1 so__payMethodActions">
                                <button
                                  className="btn btn--primary so__btnFull"
                                  onClick={() => startPay(ps)}
                                  disabled={!ps.shm_url || openingPay}
                                >
                                  {openingPay ? 'Открываем…' : `Оплатить ${fmtMoney(toPay, currency)}`}
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
                        <div className="pre so__lastPayUrl">
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