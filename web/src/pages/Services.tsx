import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../shared/api/client'

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

type ApiSummary = {
  total: number
  active: number
  blocked: number
  pending: number
  notPaid: number
  expiringSoon: number
  monthlyCost: number
  currency: string
}

type ApiServicesResponse = {
  ok: true
  items: ApiServiceItem[]
  summary: ApiSummary
}

type ServiceKind = 'amneziawg' | 'marzban' | 'marzban_router' | 'unknown'

function go(url: string) {
  window.location.assign(url)
}

function detectKind(category?: string): ServiceKind {
  if (!category) return 'unknown'
  if (category.startsWith('vpn-')) return 'amneziawg'
  if (category === 'marzban') return 'marzban'
  if (category === 'marzban-r') return 'marzban_router'
  return 'unknown'
}

function kindTitle(k: ServiceKind) {
  switch (k) {
    case 'amneziawg': return 'AmneziaWG'
    case 'marzban': return 'Marzban (все устройства)'
    case 'marzban_router': return 'Marzban (роутеры)'
    default: return 'Другое'
  }
}

function kindDescr(k: ServiceKind) {
  switch (k) {
    case 'amneziawg': return 'VPN-протокол AmneziaWG.'
    case 'marzban': return 'Подписка Marzban для всех устройств.'
    case 'marzban_router': return 'Подписка Marzban для роутеров.'
    default: return 'Прочие услуги.'
  }
}

function statusLabel(s: UiStatus) {
  switch (s) {
    case 'active': return 'Активна'
    case 'pending': return 'Подключается'
    case 'not_paid': return 'Не оплачена'
    case 'blocked': return 'Заблокирована'
    case 'removed': return 'Завершена'
    case 'error': return 'Ошибка'
    case 'init': return 'Инициализация'
    default: return 'Статус'
  }
}

function fmtDate(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
}

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

function hintText(s: ApiServiceItem) {
  const left = s.daysLeft
  if (s.status === 'active' && left != null) return left >= 0 ? `Осталось ~${left} дн.` : 'Срок истёк'
  if (s.status === 'not_paid') return 'Требуется оплата'
  if (s.status === 'blocked') return 'Нужны действия'
  if (s.status === 'pending') return 'Подождите немного'
  if (s.status === 'init') return 'Инициализация услуги'
  if (s.status === 'error') return 'Проверьте статус или обратитесь в поддержку'
  return ''
}

function statusSortWeight(s: UiStatus) {
  switch (s) {
    case 'active': return 0
    case 'pending': return 1
    case 'not_paid': return 2
    case 'blocked': return 3
    case 'init': return 4
    case 'error': return 5
    case 'removed': return 6
    default: return 99
  }
}

function ServiceCard({
  s,
  expanded,
  onToggle,
  onRefresh,
}: {
  s: ApiServiceItem
  expanded: boolean
  onToggle: () => void
  onRefresh: () => void
}) {
  const until = s.expireAt ? fmtDate(s.expireAt) : ''
  const kind = detectKind(s.category)
  const hint = hintText(s)

  const connectUrl = `/services/${s.userServiceId}/connect/${kind}`
  const orderUrl = `/services/order`
  const payUrl = `/payments?reason=service&usi=${encodeURIComponent(String(s.userServiceId))}`
  const supportUrl = `/support?topic=service&usi=${encodeURIComponent(String(s.userServiceId))}`

  return (
    <div className="kv__item svc">
      <button type="button" className="svc__btn" onClick={onToggle} aria-expanded={expanded}>
        <div className="svc__row">
          <div className="svc__left">
            <div className="svc__status">{statusLabel(s.status)}</div>
            <div className="svc__title">{s.title}</div>
            <div className="svc__sub">
              {until ? <>До: <b>{until}</b></> : 'Без даты окончания'}
            </div>
          </div>

          <div className="svc__right">
            <span className="badge">{kindTitle(kind)}</span>
            <span className="badge">
              {fmtMoney(s.price, s.currency)} / {s.periodMonths || 1}м
            </span>
            <div className="svc__hint">{hint || '\u00A0'}</div>
          </div>
        </div>

        <div className="svc__toggle">
          <b>{expanded ? '▲' : '▼'}</b> Действия
        </div>
      </button>

      {expanded ? (
        <div className="svc__details">
          {/* actions grid already exists in index.css */}
          {s.status === 'active' ? (
            <div className="actions actions--2">
              <button className="btn btn--primary" onClick={() => go(connectUrl)}>Подключение</button>
              <button className="btn" onClick={() => go(orderUrl)}>Заказать ещё</button>
            </div>
          ) : null}

          {s.status === 'not_paid' ? (
            <div className="actions actions--2">
              <button className="btn btn--primary" onClick={() => go(payUrl)}>Оплатить / пополнить</button>
              <button className="btn" onClick={() => go(orderUrl)}>Выбрать тариф</button>
            </div>
          ) : null}

          {(s.status === 'pending' || s.status === 'init') ? (
            <div className="actions actions--1">
              <button className="btn btn--primary" onClick={onRefresh}>Обновить статус</button>
            </div>
          ) : null}

          {s.status === 'blocked' ? (
            <div className="actions actions--2">
              <button className="btn btn--primary" onClick={() => go(payUrl)}>Пополнить / оплатить</button>
              <button className="btn" onClick={() => go(supportUrl)}>В поддержку</button>
            </div>
          ) : null}

          {s.status === 'error' ? (
            <div className="actions actions--2">
              <button className="btn btn--primary" onClick={onRefresh}>Обновить</button>
              <button className="btn" onClick={() => go(supportUrl)}>В поддержку</button>
            </div>
          ) : null}

          {s.status === 'removed' ? (
            <div className="actions actions--1">
              <button className="btn btn--primary" onClick={() => go(orderUrl)}>Заказать снова</button>
            </div>
          ) : null}

          <div className="pre">
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Данные услуги</div>
            <div>usi: <b>{s.userServiceId}</b></div>
            <div>service_id: <b>{s.serviceId}</b></div>
            <div>category: <b>{s.category || '—'}</b></div>
            <div>status: <b>{s.status}</b> ({s.statusRaw || '—'})</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function Services() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ApiServiceItem[]>([])
  const [summary, setSummary] = useState<ApiSummary | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = (await apiFetch('/services', { method: 'GET' })) as ApiServicesResponse
      setItems(r.items || [])
      setSummary(r.summary || null)
    } catch (e: any) {
      setError(e?.message || 'Failed to load services')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const groups = useMemo(() => {
    const byKind: Record<ServiceKind, ApiServiceItem[]> = {
      amneziawg: [],
      marzban: [],
      marzban_router: [],
      unknown: [],
    }

    for (const it of items) byKind[detectKind(it.category)].push(it)

    const sortFn = (a: ApiServiceItem, b: ApiServiceItem) => {
      const wa = statusSortWeight(a.status)
      const wb = statusSortWeight(b.status)
      if (wa !== wb) return wa - wb
      return (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999)
    }

    ;(Object.keys(byKind) as ServiceKind[]).forEach((k) => byKind[k].sort(sortFn))
    return byKind
  }, [items])

  if (loading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Услуги</h1>
            <p className="p">Загрузка…</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Услуги</h1>
            <p className="p">
              Ошибка загрузки данных:{' '}
              <span style={{ color: 'rgba(255,255,255,0.82)' }}>{error}</span>
            </p>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn--primary" onClick={load}>Повторить</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const s = summary
  const fallbackActive = items.filter((x) => x.status === 'active').length
  const fallbackAttention = items.filter((x) => x.status === 'blocked' || x.status === 'not_paid').length

  const Section = ({ kind }: { kind: ServiceKind }) => {
    const arr = groups[kind]
    if (!arr || arr.length === 0) return null

    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="services-cat__head">
              <div>
                <div className="services-cat__title">{kindTitle(kind)}</div>
                <p className="p" style={{ marginTop: 6 }}>{kindDescr(kind)}</p>
              </div>
              <span className="badge">{arr.length}</span>
            </div>

            <div className="kv">
              {arr.map((x) => (
                <ServiceCard
                  key={x.userServiceId}
                  s={x}
                  expanded={expandedId === x.userServiceId}
                  onToggle={() => setExpandedId((cur) => (cur === x.userServiceId ? null : x.userServiceId))}
                  onRefresh={load}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="section">
      {/* Compact header */}
      <div className="card">
        <div className="card__body">
          <div className="services-head">
            <h1 className="services-head__title">Услуги</h1>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn--primary" onClick={() => go('/services/order')}>Заказать</button>
              <button className="btn" onClick={load} title="Обновить">⟳</button>
            </div>
          </div>

          <div className="services-head__meta">
            <span className="badge">Активные: <b>{s?.active ?? fallbackActive}</b></span>
            <span className="badge">Внимание: <b>{(s?.blocked ?? 0) + (s?.notPaid ?? 0) || fallbackAttention}</b></span>
            <span className="badge">В месяц: <b>{fmtMoney(s?.monthlyCost ?? 0, s?.currency ?? 'RUB')}</b></span>
          </div>

          {(s?.expiringSoon ?? 0) > 0 ? (
            <div className="pre">
              Есть услуги, которые скоро истекают (≤ 7 дней): <b>{s?.expiringSoon}</b>.
            </div>
          ) : null}
        </div>
      </div>

      <Section kind="amneziawg" />
      <Section kind="marzban" />
      <Section kind="marzban_router" />
      <Section kind="unknown" />

      <div className="section">
        <details className="card" style={{ boxShadow: 'none' }}>
          <summary className="card__body" style={{ cursor: 'pointer', userSelect: 'none' }}>
            <span style={{ fontWeight: 900 }}>Данные (debug)</span>
            <span style={{ color: 'var(--muted)', marginLeft: 10 }}>сырой ответ /api/services</span>
          </summary>
          <div className="card__body" style={{ paddingTop: 0 }}>
            <pre className="pre">{JSON.stringify({ summary, items }, null, 2)}</pre>
          </div>
        </details>
      </div>
    </div>
  )
}