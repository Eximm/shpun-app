import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../shared/api/client'
import { useMe } from '../app/auth/useMe'

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

function fmtMoney0(n: number, cur: string) {
  const v = nnum(n, 0)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: cur || 'RUB',
      maximumFractionDigits: 0,
    }).format(v)
  } catch {
    return `${Math.round(v)} ${cur || 'RUB'}`
  }
}

function fmtMoney2(n: number, cur: string) {
  const v = nnum(n, 0)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: cur || 'RUB',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
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

/**
 * Бонусами можно оплатить не более 50% стоимости тарифа.
 */
function calcBonusCap(price: number) {
  return price * 0.5
}

export function ServicesOrder() {
  // ✅ единый источник денег (как на Home)
  const { me, loading: meLoading, error: meError, refetch } = useMe()

  const balanceAmount = nnum(me?.balance?.amount, 0)
  const currency = String(me?.balance?.currency || 'RUB')
  const bonus = nnum((me as any)?.bonus, 0)
  const discountPercent = nnum((me as any)?.discount, 0) // инфо, без математики к цене тарифа

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [kind, setKind] = useState<Kind | null>(null)
  const [selected, setSelected] = useState<Tariff | null>(null)

  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreateResp['item'] | null>(null)

  const [paySystems, setPaySystems] = useState<PaySystem[]>([])
  const [overlayOpen, setOverlayOpen] = useState(false)

  // polling is started ONLY after user clicked “Pay”
  const [waiting, setWaiting] = useState(false)
  const [waitMsg, setWaitMsg] = useState<string | null>(null)

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

  async function hardRefresh() {
    await Promise.all([loadTariffs(), Promise.resolve(refetch?.())])
  }

  useEffect(() => {
    loadTariffs()
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

  // ====== “Чек” расчёта (понятно пользователю) ======
  const calc = useMemo(() => {
    if (!selected) {
      return {
        price: 0,
        bonusCap: 0,
        bonusUsed: 0,
        leftAfterBonus: 0,
        balanceUsed: 0,
        toPayExact: 0,
        toPayRounded: 0,
      }
    }

    const price = nnum(selected.price, 0)
    const bonusCap = calcBonusCap(price)
    const bonusUsed = Math.max(0, Math.min(bonus, bonusCap, price))

    const leftAfterBonus = Math.max(0, price - bonusUsed)
    const balanceUsed = Math.max(0, Math.min(balanceAmount, leftAfterBonus))
    const toPayExact = Math.max(0, price - bonusUsed - balanceUsed)

    // Платёжки обычно ждут целые рубли — округляем вверх
    const toPayRounded = toPayExact > 0 ? Math.ceil(toPayExact) : 0

    return { price, bonusCap, bonusUsed, leftAfterBonus, balanceUsed, toPayExact, toPayRounded }
  }, [selected, bonus, balanceAmount])

  const shouldShowPay = useMemo(() => {
    // Показываем оплату если не хватает денег ИЛИ если SHM говорит NOT PAID
    if (!created) return false
    if (calc.toPayRounded > 0) return true
    return String(created.status || '').toLowerCase() === 'not_paid'
  }, [created, calc.toPayRounded])

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

      // если not_paid или не хватает — сразу тянем способы оплаты
      if (String(r.item?.status || '').toLowerCase() === 'not_paid' || calc.toPayRounded > 0) {
        await loadPaysystems()
      }

      // ✅ ВАЖНО: НЕ начинаем поллить здесь.
      // Пользователь должен спокойно выбрать способ оплаты.
      setWaiting(false)
      setWaitMsg(null)
    } catch (e: any) {
      setErr(e?.message || 'Failed to create service')
    } finally {
      setCreating(false)
    }
  }

  function startPay(ps: PaySystem) {
    if (!ps?.shm_url) return

    const toPay = calc.toPayRounded > 0 ? calc.toPayRounded : 1
    safeOpen(`${ps.shm_url}${toPay}`)

    setOverlayOpen(true)

    // ✅ Поллинг только после того, как пользователь реально ушёл в оплату
    setWaiting(true)
    setWaitMsg('Открыли оплату. После оплаты вернитесь сюда — мы проверим баланс и статус услуги.')
  }

  async function pollOnce() {
    // обновляем me (баланс/бонусы)
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

      const elapsed = Date.now() - started
      if (elapsed > 3 * 60_000) {
        setWaiting(false)
        setWaitMsg('Если вы оплатили — нажмите “Я оплатил — проверить”.')
        return
      }

      const done = await pollOnce()
      if (done) return

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

  const topError = err || (meError ? String(meError.message || meError) : null)

  return (
    <div className="section">
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

      <div className="card">
        <div className="card__body">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 className="h1">Подключение услуги</h1>
              <div className="p" style={{ marginTop: 6 }}>
                Баланс: <b>{fmtMoney0(balanceAmount, currency)}</b>
                <span className="dot" />
                Бонусы: <b>{fmtMoney2(bonus, currency)}</b>
              </div>
            </div>
            <button className="btn" onClick={hardRefresh} title="Обновить">⟳</button>
          </div>

          {waitMsg ? <div className="pre" style={{ marginTop: 12 }}>{waitMsg}</div> : null}
          {topError ? <div className="pre" style={{ marginTop: 12 }}>Ошибка: {topError}</div> : null}
        </div>
      </div>

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
                      <span className="badge">{fmtMoney0(t.price, t.currency)} / {t.periodHuman}</span>
                    </div>
                    {t.descr ? <div className="kv__v" style={{ marginTop: 6 }}>{t.descr}</div> : null}
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
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="h1" style={{ fontSize: 18 }}>{selected.title}</div>
                  <p className="p">{selected.descr || '—'}</p>
                </div>
                <button className="btn" onClick={resetSelection}>⇦ Назад</button>
              </div>

              {/* ====== Понятный расчёт ====== */}
              <div className="kv" style={{ marginTop: 12 }}>
                <div className="kv__item">
                  <div className="kv__k">Цена тарифа</div>
                  <div className="kv__v">{fmtMoney0(calc.price, selected.currency)}</div>
                </div>

                <div className="kv__item">
                  <div className="kv__k">Период</div>
                  <div className="kv__v">{selected.periodHuman}</div>
                </div>

                <div className="kv__item">
                  <div className="kv__k">Скидка аккаунта</div>
                  <div className="kv__v">
                    {discountPercent > 0 ? `${discountPercent}% (учтётся при списании)` : '—'}
                  </div>
                </div>

                <div className="kv__item">
                  <div className="kv__k">Оплата бонусами</div>
                  <div className="kv__v">
                    − {fmtMoney2(calc.bonusUsed, currency)}
                    <span className="dot" />
                    лимит: {fmtMoney2(calc.bonusCap, currency)}
                  </div>
                </div>

                <div className="kv__item">
                  <div className="kv__k">С вашего баланса</div>
                  <div className="kv__v">− {fmtMoney2(calc.balanceUsed, currency)}</div>
                </div>

                <div className="kv__item">
                  <div className="kv__k"><b>К оплате</b></div>
                  <div className="kv__v">
                    <b>{calc.toPayRounded > 0 ? fmtMoney0(calc.toPayRounded, currency) : fmtMoney0(0, currency)}</b>
                    {calc.toPayRounded > 0 && Math.abs(calc.toPayRounded - calc.toPayExact) > 0.001 ? (
                      <span className="dot" />
                    ) : null}
                    {calc.toPayRounded > 0 && Math.abs(calc.toPayRounded - calc.toPayExact) > 0.001 ? (
                      <span style={{ opacity: 0.85 }}>
                        округлили вверх с {fmtMoney2(calc.toPayExact, currency)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {!created ? (
                <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="btn btn--primary" onClick={createOrder} disabled={creating}>
                    {creating ? 'Создаём…' : calc.toPayRounded > 0 ? 'Заказать и оплатить' : 'Подключить'}
                  </button>
                  <button className="btn" onClick={hardRefresh} disabled={creating}>Обновить</button>
                </div>
              ) : (
                <div className="pre" style={{ marginTop: 12 }}>
                  Услуга создана. Выберите способ оплаты ниже.
                </div>
              )}

              {/* ====== Оплата (показываем, но НЕ поллим пока не нажмут “Оплатить”) ====== */}
              {created && shouldShowPay ? (
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
                                  Оплатить {fmtMoney0(calc.toPayRounded > 0 ? calc.toPayRounded : 1, currency)}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                        <button
                          className="btn"
                          onClick={() => {
                            setWaiting(true)
                            setWaitMsg('Проверяем оплату и статус услуги…')
                            pollOnce()
                          }}
                        >
                          Я оплатил — проверить
                        </button>
                        <button className="btn" onClick={() => window.location.assign('/services')}>
                          Перейти в услуги
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {created && !shouldShowPay ? (
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