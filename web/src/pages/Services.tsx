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
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'RUB', maximumFractionDigits: 0 }).format(v)
  } catch {
    return `${v} ${cur || 'RUB'}`
  }
}

function ServiceCard({ s }: { s: ApiServiceItem }) {
  const until = s.expireAt ? fmtDate(s.expireAt) : ''
  const left = s.daysLeft

  const hint =
    s.status === 'active' && left != null
      ? left >= 0 ? `Осталось ~${left} дн.` : 'Срок истёк'
      : s.status === 'not_paid'
      ? 'Требуется оплата'
      : s.status === 'blocked'
      ? 'Нужны действия'
      : s.status === 'pending'
      ? 'Подождите немного'
      : ''

  return (
    <div className="kv__item" style={{ position: 'relative' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
        <div className="kv__k">{statusLabel(s.status)}</div>
        <span className="badge" style={{ opacity: 0.95 }}>
          {s.category ? s.category : 'service'}
        </span>
      </div>

      <div className="kv__v" style={{ lineHeight: 1.15 }}>
        {s.title}
      </div>

      {s.descr ? (
        <div className="p" style={{ marginTop: 8, fontSize: 12 }}>
          {s.descr}
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 10, justifyContent: 'space-between', gap: 10 }}>
        <div className="badge">
          {fmtMoney(s.price, s.currency)} / {s.periodMonths || 1}м
        </div>

        {until ? (
          <div className="p" style={{ margin: 0, fontSize: 12 }}>
            До: <span style={{ color: 'rgba(255,255,255,0.82)', fontWeight: 800 }}>{until}</span>
          </div>
        ) : (
          <div className="p" style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
            Без даты окончания
          </div>
        )}
      </div>

      {hint ? (
        <div className="p" style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
          {hint}
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

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await apiFetch('/services', { method: 'GET' }) as ApiServicesResponse
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
    const active = items.filter((x) => x.status === 'active')
    const pending = items.filter((x) => x.status === 'pending')
    const notPaid = items.filter((x) => x.status === 'not_paid')
    const blocked = items.filter((x) => x.status === 'blocked')
    const other = items.filter((x) => x.status === 'removed' || x.status === 'error' || x.status === 'init')

    // сортировка активных по ближайшему истечению
    active.sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999))

    return { active, pending, notPaid, blocked, other }
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
            <p className="p">Ошибка загрузки данных: <span style={{ color: 'rgba(255,255,255,0.82)' }}>{error}</span></p>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn--primary" onClick={load}>Повторить</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const s = summary

  return (
    <div className="section">
      {/* Header */}
      <div className="card">
        <div className="card__body">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 className="h1">Услуги</h1>
              <p className="p">
                Состояние ваших подключений. Управление (продление/оплата/смена тарифа) добавим следующим шагом.
              </p>
            </div>

            <button className="btn" onClick={load} title="Обновить">
              ⟳ Обновить
            </button>
          </div>

          {/* Summary */}
          <div className="kv">
            <div className="kv__item">
              <div className="kv__k">Активные</div>
              <div className="kv__v">{s?.active ?? groups.active.length}</div>
            </div>
            <div className="kv__item">
              <div className="kv__k">Требуют внимания</div>
              <div className="kv__v">{(s?.blocked ?? groups.blocked.length) + (s?.notPaid ?? groups.notPaid.length)}</div>
            </div>
            <div className="kv__item">
              <div className="kv__k">В месяц</div>
              <div className="kv__v">{fmtMoney(s?.monthlyCost ?? 0, s?.currency ?? 'RUB')}</div>
            </div>
          </div>

          {(s?.expiringSoon ?? 0) > 0 ? (
            <div className="pre" style={{ marginTop: 14 }}>
              Есть услуги, которые скоро истекают (≤ 7 дней): <b>{s?.expiringSoon}</b>. Мы добавим быстрые действия “Продлить / Оплатить” в ближайших итерациях.
            </div>
          ) : null}
        </div>
      </div>

      {/* Sections */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>Активные</div>
            <p className="p">Работают прямо сейчас.</p>

            {groups.active.length === 0 ? (
              <div className="pre" style={{ marginTop: 14 }}>Активных услуг пока нет.</div>
            ) : (
              <div className="kv">
                {groups.active.map((x) => <ServiceCard key={x.userServiceId} s={x} />)}
              </div>
            )}
          </div>
        </div>
      </div>

      {(groups.pending.length > 0 || groups.notPaid.length > 0) ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="h1" style={{ fontSize: 18 }}>Требуют действий</div>
              <p className="p">Подключение / неоплата — обычно решается оплатой или ожиданием завершения.</p>

              <div className="kv">
                {groups.notPaid.map((x) => <ServiceCard key={x.userServiceId} s={x} />)}
                {groups.pending.map((x) => <ServiceCard key={x.userServiceId} s={x} />)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {groups.blocked.length > 0 ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="h1" style={{ fontSize: 18 }}>Заблокированные</div>
              <p className="p">Обычно это из-за баланса или ограничений.</p>

              <div className="kv">
                {groups.blocked.map((x) => <ServiceCard key={x.userServiceId} s={x} />)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {groups.other.length > 0 ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="h1" style={{ fontSize: 18 }}>История / прочее</div>
              <p className="p">Завершённые и служебные статусы.</p>

              <div className="kv">
                {groups.other.map((x) => <ServiceCard key={x.userServiceId} s={x} />)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Debug (не мешает, но спрятано) */}
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
