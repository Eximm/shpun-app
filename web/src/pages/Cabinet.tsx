import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMe } from '../app/auth/useMe'
import { apiFetch } from '../shared/api/client'

export function Cabinet() {
  const { me, loading, error, refetch } = useMe() as any
  const [loggingOut, setLoggingOut] = useState(false)
  const nav = useNavigate()

  async function logout() {
    setLoggingOut(true)
    try {
      await apiFetch('/logout', { method: 'POST' })
      nav('/login', { replace: true })
    } finally {
      setLoggingOut(false)
    }
  }

  if (loading) return <div className="section">Loading…</div>

  if (error) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Connection error</h1>
            <p className="p">Failed to load account data.</p>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn--primary" onClick={() => refetch?.()}>
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

  if (!me) return <div className="section">No profile data.</div>

  const user = me
  const balance = user?.balance ?? 0
  const bonus = user?.bonus ?? 0
  const discount = user?.discount ?? 0

  const services = user?.services ?? []
  const active = services.filter((s: any) => s.status === 'ACTIVE')
  const blocked = services.filter((s: any) => s.status === 'BLOCK')

  return (
    <div className="section">

      {/* ACCOUNT CARD */}
      <div className="card">
        <div className="card__body">
          <h1 className="h1">Account</h1>

          <div className="kv">
            <div className="kv__item">
              <div className="kv__k">Login</div>
              <div className="kv__v">{user.login ?? '—'}</div>
            </div>

            <div className="kv__item">
              <div className="kv__k">Balance</div>
              <div className="kv__v">{balance}</div>
            </div>

            <div className="kv__item">
              <div className="kv__k">Bonus</div>
              <div className="kv__v">{bonus}</div>
            </div>

            <div className="kv__item">
              <div className="kv__k">Discount</div>
              <div className="kv__v">{discount}%</div>
            </div>
          </div>

          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => refetch?.()}>
              Refresh
            </button>

            <button className="btn btn--danger" onClick={logout} disabled={loggingOut}>
              {loggingOut ? 'Logging out…' : 'Logout'}
            </button>
          </div>
        </div>
      </div>

      {/* SERVICES CARD */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__body">
          <h2 className="h2">Services</h2>

          <div className="kv">
            <div className="kv__item">
              <div className="kv__k">Active</div>
              <div className="kv__v">{active.length}</div>
            </div>

            <div className="kv__item">
              <div className="kv__k">Blocked</div>
              <div className="kv__v">{blocked.length}</div>
            </div>

            <div className="kv__item">
              <div className="kv__k">Total</div>
              <div className="kv__v">{services.length}</div>
            </div>
          </div>
        </div>
      </div>

      {/* SECURITY CARD (placeholder) */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__body">
          <h2 className="h2">Security</h2>
          <p className="p">
            Password login management and 2FA settings will be available here.
          </p>

          <button className="btn" disabled>
            Configure password (coming soon)
          </button>
        </div>
      </div>

      {/* DEBUG (collapsible) */}
      <details style={{ marginTop: 20 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
          Debug data
        </summary>
        <pre className="pre">{JSON.stringify(me, null, 2)}</pre>
      </details>

    </div>
  )
}
