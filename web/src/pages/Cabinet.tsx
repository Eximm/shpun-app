// web/src/pages/Cabinet.tsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMe } from '../app/auth/useMe'
import { apiFetch } from '../shared/api/client'

type ServiceStatus =
  | 'active'
  | 'blocked'
  | 'pending'
  | 'not_paid'
  | 'removed'
  | 'error'
  | 'init'
  | string

type ServiceItem = {
  userServiceId: number
  serviceId: number
  title: string
  descr: string
  category: string
  status: ServiceStatus
  statusRaw: string
  createdAt: string | null
  expireAt: string | null
  daysLeft: number | null
  price: number
  periodMonths: number
  currency: string
}

type ServicesResponse = {
  ok: true
  items: ServiceItem[]
  summary: {
    total: number
    active: number
    blocked: number
    pending: number
    notPaid: number
    expiringSoon: number
    monthlyCost: number
    currency: string
  }
}

type ActivityPay = {
  id: number
  amount: number
  currency: string
  createdAt: string | null
  paySystem: string | null
}

type ActivityWithdraw = {
  id: number
  amount: number
  currency: string
  createdAt: string | null
  endDate: string | null
  serviceId: number
  userServiceId: number
}

type ActivityResponse = {
  ok: true
  pays: ActivityPay[]
  withdraws: ActivityWithdraw[]
}

function fmtMoney(n: unknown) {
  const num = typeof n === 'number' ? n : Number(n ?? 0)
  if (!Number.isFinite(num)) return '0'
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(num)
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
}

function chipByServiceStatus(s: ServiceStatus) {
  switch (s) {
    case 'active': return { label: 'Active', cls: 'chip chip--ok' }
    case 'pending': return { label: 'Processing', cls: 'chip chip--warn' }
    case 'not_paid': return { label: 'Not paid', cls: 'chip chip--bad' }
    case 'blocked': return { label: 'Blocked', cls: 'chip chip--bad' }
    case 'error': return { label: 'Error', cls: 'chip chip--bad' }
    case 'removed': return { label: 'Removed', cls: 'chip' }
    case 'init': return { label: 'Init', cls: 'chip' }
    default: return { label: s || '—', cls: 'chip' }
  }
}

export function Cabinet() {
  const { me, loading, error, refetch } = useMe()
  const nav = useNavigate()

  const [loggingOut, setLoggingOut] = useState(false)
  const [services, setServices] = useState<ServicesResponse | null>(null)
  const [activity, setActivity] = useState<ActivityResponse | null>(null)
  const [extrasLoading, setExtrasLoading] = useState(false)

  async function logout() {
    setLoggingOut(true)
    try {
      await apiFetch('/logout', { method: 'POST' })
      nav('/login', { replace: true })
    } finally {
      setLoggingOut(false)
    }
  }

  async function loadExtras() {
    setExtrasLoading(true)
    try {
      const svc = await apiFetch<ServicesResponse>('/services')
      if (svc?.ok) setServices(svc)

      // activity — не ломаем кабинет, если вдруг временно упадёт
      try {
        const act = await apiFetch<ActivityResponse>('/activity')
        if (act?.ok) setActivity(act)
        else setActivity(null)
      } catch {
        setActivity(null)
      }
    } finally {
      setExtrasLoading(false)
    }
  }

  useEffect(() => {
    if (!me?.ok) return
    loadExtras()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.profile?.id])

  const summary = services?.summary
  const items = services?.items ?? []

  const displayName = me?.profile?.displayName ?? 'Account'
  const login = me?.profile?.login ?? '—'
  const balance = me?.balance?.amount ?? 0
  const bonus = me?.bonus ?? 0
  const discount = me?.discount ?? 0
  const passwordSet = !!me?.profile?.passwordSet
  const lastLogin = me?.profile?.lastLogin ?? null

  const accountState = useMemo(() => {
    if (!summary) return { cls: 'chip chip--soft', text: 'Loading status…' }
    if (summary.notPaid > 0) return { cls: 'chip chip--bad', text: 'Payment required' }
    if (summary.active > 0) return { cls: 'chip chip--ok', text: 'Active' }
    if (summary.total > 0) return { cls: 'chip chip--warn', text: 'No active services' }
    return { cls: 'chip chip--warn', text: 'Choose a plan to start' }
  }, [summary])

  const nearestExpire = useMemo(() => {
    const candidates = items
      .filter(s => s.expireAt && (s.status === 'active' || s.status === 'pending'))
      .slice()
      .sort((a, b) => {
        const ta = a.expireAt ? new Date(a.expireAt).getTime() : Number.POSITIVE_INFINITY
        const tb = b.expireAt ? new Date(b.expireAt).getTime() : Number.POSITIVE_INFINITY
        return ta - tb
      })
    return candidates[0] ?? null
  }, [items])

  if (loading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="skeleton h1" style={{ width: 220 }} />
            <div className="skeleton p" style={{ width: 340, marginTop: 10 }} />
            <div className="skeleton" style={{ height: 140, marginTop: 14 }} />
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
            <h1 className="h1">Can’t connect</h1>
            <p className="p">We couldn’t load your account data.</p>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn--primary" onClick={() => refetch()}>
                Retry
              </button>
              <button className="btn btn--danger" onClick={logout} disabled={loggingOut}>
                {loggingOut ? 'Logging out…' : 'Logout'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!me?.ok) return <div className="section">No profile data.</div>

  const pays = activity?.pays ?? []
  const withdraws = activity?.withdraws ?? []

  return (
    <div className="section">
      {/* HERO */}
      <div className="card">
        <div className="card__body">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div className="kicker">Shpun App</div>
              <h1 className="h1" style={{ marginTop: 6 }}>
                {displayName}
              </h1>
              <p className="p" style={{ marginTop: 6, opacity: 0.9 }}>
                Balance, services and recent activity — all in one place.
              </p>

              <div className="row" style={{ marginTop: 12, gap: 10, flexWrap: 'wrap' }}>
                <span className={accountState.cls}>{accountState.text}</span>
                <span className="chip chip--soft">Login: {login}</span>
                <span className="chip chip--soft">Last login: {fmtDate(lastLogin)}</span>
                <span className={passwordSet ? 'chip chip--ok' : 'chip chip--warn'}>
                  Password: {passwordSet ? 'set' : 'not set'}
                </span>
                {nearestExpire ? (
                  <span className="chip chip--warn">
                    Next expiry: {fmtDate(nearestExpire.expireAt)}
                    {nearestExpire.daysLeft !== null ? ` · ${nearestExpire.daysLeft}d` : ''}
                  </span>
                ) : null}
              </div>

              <div className="row" style={{ marginTop: 14, gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn--primary" onClick={() => nav('/app/services')}>
                  My services
                </button>
                <button className="btn" onClick={() => nav('/app/payments')}>
                  Top up
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    refetch()
                    loadExtras()
                  }}
                  disabled={extrasLoading}
                >
                  {extrasLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>

            <button className="btn btn--danger" onClick={logout} disabled={loggingOut}>
              {loggingOut ? 'Logging out…' : 'Logout'}
            </button>
          </div>
        </div>
      </div>

      {/* WALLET */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__body">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 className="h2">Wallet</h2>
            <span className="muted">Discount {discount}%</span>
          </div>

          <div className="money">
            <div className="money__value">{fmtMoney(balance)}</div>
            <div className="money__meta">
              Bonus: <b>{fmtMoney(bonus)}</b>
            </div>
          </div>
        </div>
      </div>

      {/* SERVICES PREVIEW */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__body">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 className="h2">Services</h2>
            <span className="muted">
              Active {summary?.active ?? 0} · Issues {(summary?.blocked ?? 0) + (summary?.notPaid ?? 0)} · Total{' '}
              {summary?.total ?? 0}
            </span>
          </div>

          {items.length ? (
            <div className="list" style={{ marginTop: 10 }}>
              {items.slice(0, 4).map((s) => {
                const ui = chipByServiceStatus(s.status)
                return (
                  <div key={String(s.userServiceId)} className="list__item">
                    <div className="list__main">
                      <div className="list__title">{s.title}</div>
                      <div className="list__sub">
                        Expire: <b>{fmtDate(s.expireAt)}</b>
                        {s.daysLeft !== null ? (
                          <>
                            <span className="dot" />{' '}
                            {s.daysLeft >= 0 ? `${s.daysLeft} days left` : `${Math.abs(s.daysLeft)} days overdue`}
                          </>
                        ) : null}
                        {typeof s.price === 'number' ? (
                          <>
                            <span className="dot" /> {fmtMoney(s.price)} / {s.periodMonths || 1} mo
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="list__side">
                      <span className={ui.cls}>{ui.label}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="p" style={{ marginTop: 10, opacity: 0.9 }}>
              You don’t have active services yet. Choose a plan to get started.
            </p>
          )}

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => nav('/app/services')}>
              Open services
            </button>
          </div>
        </div>
      </div>

      {/* RECENT ACTIVITY */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__body">
          <h2 className="h2">Recent activity</h2>

          <div className="grid2" style={{ marginTop: 10 }}>
            <div className="mini">
              <div className="mini__title">Payments</div>
              {pays.length ? (
                <div className="mini__list">
                  {pays.slice(0, 3).map((p) => (
                    <div key={p.id} className="mini__row">
                      <div className="mini__main">
                        <div className="mini__strong">{fmtMoney(p.amount)}</div>
                        <div className="mini__muted">
                          {fmtDate(p.createdAt)} · {p.paySystem ?? '—'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mini__empty">No payments yet</div>
              )}
            </div>

            <div className="mini">
              <div className="mini__title">Charges</div>
              {withdraws.length ? (
                <div className="mini__list">
                  {withdraws.slice(0, 3).map((w) => (
                    <div key={w.id} className="mini__row">
                      <div className="mini__main">
                        <div className="mini__strong">{fmtMoney(w.amount)}</div>
                        <div className="mini__muted">
                          {fmtDate(w.createdAt)} · until {fmtDate(w.endDate)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mini__empty">No charges</div>
              )}
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => nav('/app/payments')}>
              Open payments
            </button>
          </div>
        </div>
      </div>

      {/* SECURITY */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__body">
          <h2 className="h2">Security</h2>
          <p className="p" style={{ opacity: 0.9 }}>
            Keep your account safe. Password login and passkeys will live here.
          </p>

          <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <button
              className={passwordSet ? 'btn' : 'btn btn--primary'}
              onClick={() => nav('/app/password')}
            >
              {passwordSet ? 'Change password' : 'Set password'}
            </button>
            <button className="btn" disabled>
              Passkeys (soon)
            </button>
            <button className="btn" disabled>
              OTP (soon)
            </button>
          </div>
        </div>
      </div>

      {import.meta.env.DEV ? (
        <details style={{ marginTop: 18 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Dev: raw</summary>
          <pre className="pre">{JSON.stringify({ me, services, activity }, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  )
}
