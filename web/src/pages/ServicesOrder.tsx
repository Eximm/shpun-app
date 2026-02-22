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
    // ✅ обновим и тарифы, и me (баланс/бонусы)
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

      // если not_paid или не хватает — сразу тянем способы оплаты
      if (String(r.item?.status || '').toLowerCase() === 'not_paid' || needTopup > 0) {
        await loadPaysystems()
        setWaitMsg('Выберите способ оплаты ниже.')
      } else {
        setWaitMsg('✅ Услуга создана. Можно перейти в раздел услуг.')
      }
    } catch (e: any) {
      setErr(e?.message || 'Failed to create service')
    } finally {
      setCreating(false)
    }
  }

  function startPay(ps: PaySystem) {
    if (!ps?.shm_url) return

    // ✅ платим недостающее, с учётом бонусов
    const toPay = needTopup > 0 ? needTopup : Math.max(1, Math.ceil(nnum(selected?.price, 0) - available))
    safeOpen(`${ps.shm_url}${toPay}`)

    setOverlayOpen(true)
    setWaitMsg('Окно оплаты открыто. Мы перевели вас в раздел услуг — там статус обновится после оплаты.')

    // ✅ ключевой момент: уходим на /services и не “перезагружаемся по кругу” здесь
    window.location.assign('/services')
  }

  async function pollOnce() {
    // ручная проверка — без лупа
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
        return true
      }
    } catch {
      // ignore
    }
    setWaitMsg('Пока не вижу обновления статуса. Попробуйте ещё раз через несколько секунд.')
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
      {overlayOpen ? (
        <div className="overlay" onClick={() => setOverlayOpen(false)}>
          <div className="card overlay__card" onClick={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="overlay__title">Окно оплаты открыто ✅</div>
              <p className="p so__mt8">Завершите оплату во вкладке. Затем откройте “Услуги” — статус обновится.</p>
              <div className="actions actions--1 so__mt12">
                <button className="btn" onClick={() => window.location.assign('/services')}>Перейти в услуги</button>
                <button className="btn" onClick={() => setOverlayOpen(false)}>Закрыть</button>
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
              <div className="p so__mt6">
                Баланс: <b>{fmtMoney(balanceAmount, currency)}</b>
                <span className="dot" />
                Бонусы: <b>{bonus}</b>
                <span className="dot" />
                Доступно: <b>{fmtMoney(available, currency)}</b>
              </div>
            </div>
            <button className="btn" onClick={hardRefresh} title="Обновить">⟳</button>
          </div>

          {waitMsg ? <div className="pre so__mt12">{waitMsg}</div> : null}
          {topError ? <div className="pre so__mt12">Ошибка: {topError}</div> : null}
        </div>
      </div>

      {!kind ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="h1 so__h18">Категории</div>
              <p className="p">Выберите, что подключаем.</p>

              <div className="kv so__mt12">
                {(Object.keys(grouped) as Kind[]).map((k) => (
                  <button key={k} className="kv__item" onClick={() => setKind(k)} type="button">
                    <div className="kv__k">{kindTitle(k)}</div>
                    <div className="kv__v so__mt6">{kindDescr(k)}</div>
                    <div className="row so__mt10">
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
              <div className="row so__spaceBetween">
                <div>
                  <div className="h1 so__h18">{kindTitle(kind)}</div>
                  <p className="p">{kindDescr(kind)}</p>
                </div>
                <button className="btn" onClick={() => setKind(null)}>⇦ Назад</button>
              </div>

              <div className="kv so__mt12">
                {grouped[kind].map((t) => (
                  <button key={t.serviceId} className="kv__item" onClick={() => setSelected(t)} type="button">
                    <div className="row so__spaceBetween">
                      <div className="kv__k">{t.title}</div>
                      <span className="badge">
                        {fmtMoney(t.price, t.currency)} / {t.periodHuman}
                      </span>
                    </div>
                    {t.descr ? <div className="kv__v so__mt6">{t.descr}</div> : null}
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
              <div className="row so__spaceBetween">
                <div>
                  <div className="h1 so__h18">{selected.title}</div>
                  <p className="p">{selected.descr || '—'}</p>
                </div>
                <button className="btn" onClick={resetSelection}>⇦ Назад</button>
              </div>

              {/* Details block: collapsible */}
              <div className={`so__details ${detailsCollapsed ? 'is-collapsed' : ''}`}>
                <div className="kv so__mt12">
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

              {/* Payment block */}
              {created && shouldShowPay ? (
                <div className="so__pay so__mt12">
                  <div className="card so__cardFlat">
                    <div className="card__body">
                      <div className="h1 so__h18">Оплата</div>
                      <p className="p">Выберите способ оплаты. Откроется в новой вкладке и вы перейдёте в “Услуги”.</p>

                      {paySystems.length === 0 ? (
                        <div className="pre">Способы оплаты не найдены.</div>
                      ) : (
                        <div className="kv so__mt12">
                          {paySystems.map((ps, idx) => (
                            <div className="kv__item" key={ps.shm_url || idx}>
                              <div className="row so__spaceBetween">
                                <div className="kv__k">{ps.name || 'Payment method'}</div>
                                <span className="badge">{ps.recurring ? 'recurring' : 'one-time'}</span>
                              </div>

                              <div className="actions actions--1 so__mt10">
                                <button
                                  className="btn btn--primary so__btnFull"
                                  onClick={() => startPay(ps)}
                                  disabled={!ps.shm_url}
                                >
                                  Оплатить {fmtMoney(needTopup > 0 ? needTopup : 1, currency)}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="actions actions--1 so__mt12">
                        <button className="btn so__btnFull" onClick={pollOnce}>Я оплатил — проверить</button>
                        <button className="btn so__btnFull" onClick={() => window.location.assign('/services')}>
                          Перейти в услуги
                        </button>
                      </div>
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