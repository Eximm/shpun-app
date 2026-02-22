import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../shared/api/client'

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

type MeResp = {
  ok: true
  balance: number
  currency: string
}

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
  serviceId: number
  title: string
  descr: string
  category: string
  status: UiStatus
  statusRaw: string
  createdAt: string | null
  expireAt: string | null
  daysLeft: number | null
  price: number
  periodMonths: number
  currency: string
}

type ApiServicesResponse = {
  ok: true
  items: ApiServiceItem[]
  summary: any
}

type Kind = 'amneziawg' | 'marzban' | 'marzban_router'

function fmtMoney(n: number, cur: string) {
  const v = Number(n || 0)
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

function kindTitle(k: Kind) {
  switch (k) {
    case 'amneziawg':
      return 'AmneziaWG'
    case 'marzban':
      return 'Marzban (все устройства)'
    case 'marzban_router':
      return 'Shpun Router'
  }
}

function kindDescr(k: Kind) {
  switch (k) {
    case 'amneziawg':
      return 'VPN-протокол AmneziaWG.'
    case 'marzban':
      return 'Подписка Marzban для всех устройств.'
    case 'marzban_router':
      return 'Подписка Marzban для роутеров.'
  }
}

function safeOpen(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function ServicesOrder() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [balance, setBalance] = useState(0)
  const [currency, setCurrency] = useState('RUB')

  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [kind, setKind] = useState<Kind | null>(null)
  const [selected, setSelected] = useState<Tariff | null>(null)

  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreateResp['item'] | null>(null)

  const [paySystems, setPaySystems] = useState<PaySystem[]>([])
  const [overlayOpen, setOverlayOpen] = useState(false)

  const [waiting, setWaiting] = useState(false)
  const [waitMsg, setWaitMsg] = useState<string | null>(null)

  async function loadBase() {
    setLoading(true)
    setErr(null)
    try {
      const [o, me] = await Promise.all([
        apiFetch<OrderResp>('/services/order'),
        apiFetch<MeResp>('/me'),
      ])
      setTariffs(o.items || [])
      setBalance(Number(me.balance || 0))
      setCurrency(me.currency || 'RUB')
    } catch (e: any) {
      setErr(e?.message || 'Failed to load order data')
    } finally {
      setLoading(false)
    }
  }

  async function loadPaysystems() {
    const ps = await apiFetch<PaysystemsResp>('/payments/paysystems', { method: 'GET' })
    const items = ps?.items || []
    // фильтр старых “спасателей” если нужно
    const filtered = items.filter((x) => {
      const n = String(x?.name || '')
      if (n === 'Telegram Stars Rescue') return false
      if (n === 'Telegram Stars Karlson') return false
      return true
    })
    setPaySystems(filtered)
  }

  useEffect(() => {
    loadBase()
  }, [])

  const grouped = useMemo(() => {
    const m: Record<Kind, Tariff[]> = { amneziawg: [], marzban: [], marzban_router: [] }
    for (const t of tariffs) {
      m[kindFromCategory(t.category)].push(t)
    }
    for (const k of Object.keys(m) as Kind[]) {
      m[k].sort((a, b) => a.price - b.price)
    }
    return m
  }, [tariffs])

  const needTopup = useMemo(() => {
    if (!selected) return 0
    const n = Math.max(0, Math.ceil(selected.price - balance))
    return n
  }, [selected, balance])

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

      // если нужно пополнение — сразу показываем способы оплаты
      if (needTopup > 0) {
        await loadPaysystems()
      }

      // начинаем мягкое ожидание статуса
      setWaiting(true)
      setWaitMsg('Ожидаем обновление статуса услуги…')
    } catch (e: any) {
      setErr(e?.message || 'Failed to create service')
    } finally {
      setCreating(false)
    }
  }

  function startPay(ps: PaySystem) {
    if (!ps?.shm_url || !needTopup) return
    const url = `${ps.shm_url}${needTopup}`
    safeOpen(url)
    setOverlayOpen(true)
    setWaiting(true)
    setWaitMsg('Окно оплаты открыто. После оплаты мы проверим баланс и статус услуги.')
  }

  async function pollOnce() {
    // обновляем баланс
    try {
      const me = await apiFetch<MeResp>('/me')
      setBalance(Number(me.balance || 0))
      setCurrency(me.currency || 'RUB')
    } catch {
      // ignore
    }

    // проверяем статус услуги через /services
    if (!created?.userServiceId) return false
    try {
      const s = await apiFetch<ApiServicesResponse>('/services')
      const it = (s.items || []).find((x) => x.userServiceId === created.userServiceId)
      if (it && (it.status === 'active' || it.status === 'pending')) {
        setCreated((cur) => (cur ? { ...cur, status: it.status, statusRaw: it.statusRaw || cur.statusRaw } : cur))
        setWaitMsg('✅ Услуга активируется / активна. Можно перейти в раздел услуг.')
        setWaiting(false)
        return true
      }
    } catch {
      // ignore
    }

    return false
  }

  useEffect(() => {
    if (!waiting) return
    let cancelled = false
    const started = Date.now()

    async function loop() {
      if (cancelled) return
      const done = await pollOnce()
      if (done) return

      const elapsed = Date.now() - started
      const next = elapsed < 60_000 ? 3500 : 10_000
      setTimeout(loop, next)
    }

    const t = setTimeout(loop, 1200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, created?.userServiceId])

  function resetSelection() {
    setSelected(null)
    setCreated(null)
    setPaySystems([])
    setWaiting(false)
    setWaitMsg(null)
    setErr(null)
    setOverlayOpen(false)
  }

  if (loading) {
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

  if (err && !selected) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Подключение услуги</h1>
            <p className="p">Ошибка: {err}</p>
            <button className="btn btn--primary" onClick={loadBase}>Повторить</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="section">
      {/* Overlay (без inline-стилей — стили в index.css) */}
      {overlayOpen ? (
        <div className="overlay" onClick={() => setOverlayOpen(false)}>
          <div className="card overlay__card" onClick={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="overlay__title">Окно оплаты открыто ✅</div>
              <p className="p" style={{ marginTop: 8 }}>
                Завершите оплату во вкладке. Затем нажмите “Проверить”.
              </p>
              <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn btn--primary" onClick={pollOnce}>Проверить</button>
                <button className="btn" onClick={() => setOverlayOpen(false)}>Закрыть</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Header */}
      <div className="card">
        <div className="card__body">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 className="h1">Подключение услуги</h1>
              <p className="p">Баланс: <b>{fmtMoney(balance, currency)}</b></p>
            </div>
            <button className="btn" onClick={loadBase} title="Обновить">⟳</button>
          </div>

          {waitMsg ? <div className="pre" style={{ marginTop: 12 }}>{waitMsg}</div> : null}
          {err ? <div className="pre" style={{ marginTop: 12 }}>{err}</div> : null}
        </div>
      </div>

      {/* Step 1: categories */}
      {!kind ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="h1" style={{ fontSize: 18 }}>Категории</div>
              <p className="p">Выберите, что подключаем.</p>

              <div className="kv" style={{ marginTop: 12 }}>
                {(Object.keys(grouped) as Kind[]).map((k) => (
                  <button key={k} className="kv__item" onClick={() => setKind(k)} type="button">
                    <div className="kv__k">{kindTitle(k)}</div>
                    <div className="kv__v" style={{ marginTop: 6 }}>{kindDescr(k)}</div>
                    <div className="row" style={{ marginTop: 10 }}>
                      <span className="badge">{grouped[k].length} тарифов</span>
                      <span className="badge">Выбрать</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Step 2: tariffs */}
      {kind && !selected ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="h1" style={{ fontSize: 18 }}>{kindTitle(kind)}</div>
                  <p className="p">{kindDescr(kind)}</p>
                </div>
                <button className="btn" onClick={() => setKind(null)}>⇦ Назад</button>
              </div>

              <div className="kv" style={{ marginTop: 12 }}>
                {grouped[kind].map((t) => (
                  <button key={t.serviceId} className="kv__item" onClick={() => setSelected(t)} type="button">
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <div className="kv__k">{t.title}</div>
                      <span className="badge">{fmtMoney(t.price, t.currency)} / {t.periodHuman}</span>
                    </div>
                    {t.descr ? <div className="kv__v" style={{ marginTop: 6 }}>{t.descr}</div> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Step 3: confirm + pay */}
      {selected ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="h1" style={{ fontSize: 18 }}>{selected.title}</div>
                  <p className="p">{selected.descr || '—'}</p>
                </div>
                <button className="btn" onClick={resetSelection}>⇦ Назад</button>
              </div>

              <div className="kv" style={{ marginTop: 12 }}>
                <div className="kv__item">
                  <div className="kv__k">Стоимость</div>
                  <div className="kv__v">{fmtMoney(selected.price, selected.currency)}</div>
                </div>
                <div className="kv__item">
                  <div className="kv__k">Период</div>
                  <div className="kv__v">{selected.periodHuman}</div>
                </div>
                <div className="kv__item">
                  <div className="kv__k">Баланс</div>
                  <div className="kv__v">{fmtMoney(balance, currency)}</div>
                </div>
                <div className="kv__item">
                  <div className="kv__k">Не хватает</div>
                  <div className="kv__v">{needTopup > 0 ? fmtMoney(needTopup, currency) : '—'}</div>
                </div>
              </div>

              {!created ? (
                <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="btn btn--primary" onClick={createOrder} disabled={creating}>
                    {creating ? 'Создаём…' : needTopup > 0 ? 'Заказать и оплатить' : 'Подключить'}
                  </button>
                  <button className="btn" onClick={loadBase} disabled={creating}>Обновить</button>
                </div>
              ) : (
                <div className="pre" style={{ marginTop: 12 }}>
                  Услуга создана. usi: <b>{created.userServiceId}</b>, статус: <b>{created.status}</b>
                </div>
              )}

              {created && needTopup > 0 ? (
                <div className="section">
                  <div className="card" style={{ boxShadow: 'none' }}>
                    <div className="card__body">
                      <div className="h1" style={{ fontSize: 18 }}>Оплата</div>
                      <p className="p">Выберите способ оплаты. Откроется в новой вкладке.</p>

                      {paySystems.length === 0 ? (
                        <div className="pre">Способы оплаты не найдены.</div>
                      ) : (
                        <div className="kv" style={{ marginTop: 12 }}>
                          {paySystems.map((ps, idx) => (
                            <div className="kv__item" key={ps.shm_url || idx}>
                              <div className="row" style={{ justifyContent: 'space-between' }}>
                                <div className="kv__k">{ps.name || 'Payment method'}</div>
                                <span className="badge">{ps.recurring ? 'recurring' : 'one-time'}</span>
                              </div>
                              <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                                <button
                                  className="btn btn--primary"
                                  onClick={() => startPay(ps)}
                                  disabled={!ps.shm_url}
                                >
                                  Оплатить {fmtMoney(needTopup, currency)}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                        <button className="btn" onClick={pollOnce}>Я оплатил — проверить</button>
                        <button className="btn" onClick={() => window.location.assign('/services')}>
                          Перейти в услуги
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {created && needTopup === 0 ? (
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn btn--primary" onClick={() => window.location.assign('/services')}>
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