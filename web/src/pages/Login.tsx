import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiFetch } from '../shared/api/client'

type TgWebApp = {
  initData?: string
  ready?: () => void
  expand?: () => void
}

function getTelegramWebApp(): TgWebApp | null {
  const tg = (window as any)?.Telegram?.WebApp as TgWebApp | undefined
  return tg ?? null
}

function getTelegramInitData(): string | null {
  const tg = getTelegramWebApp()
  const initData = tg?.initData
  return initData && initData.length > 0 ? initData : null
}

export function Login() {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Login/password (always available)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')

  const nav = useNavigate()
  const loc: any = useLocation()

  const tgInitData = useMemo(() => getTelegramInitData(), [])
  const isTelegram = !!tgInitData
  const autoLoginStarted = useRef(false)

  async function finishLogin() {
    nav(loc?.state?.from || '/app/cabinet', { replace: true })
  }

  async function passwordLogin() {
    setLoading(true)
    setErr(null)
    try {
      await apiFetch('/auth/password', {
        method: 'POST',
        body: JSON.stringify({ login, password })
      })
      await finishLogin()
    } catch (e: any) {
      setErr(e?.message || 'Password login failed')
    } finally {
      setLoading(false)
    }
  }

  async function telegramLogin() {
    const initData = getTelegramInitData()
    if (!initData) {
      setErr('Open this page inside Telegram WebApp to login via Telegram.')
      return
    }

    setLoading(true)
    setErr(null)
    try {
      await apiFetch('/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ initData })
      })
      await finishLogin()
    } catch (e: any) {
      setErr(e?.message || 'Telegram login failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const tg = getTelegramWebApp()
    tg?.ready?.()
    tg?.expand?.()

    // Auto-login in Telegram (once), but keep password form visible anyway
    if (!autoLoginStarted.current && getTelegramInitData()) {
      autoLoginStarted.current = true
      telegramLogin()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <h1 className="h1">Sign in</h1>
          <p className="p">
            You can sign in with your <b>login &amp; password</b>. If opened inside Telegram, you can also use <b>Telegram login</b>.
          </p>

          {/* Always show login/password */}
          <div style={{ marginTop: 14 }}>
            <div className="row" style={{ gap: 10, alignItems: 'stretch' }}>
              <input
                className="input"
                placeholder="Login"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="username"
                disabled={loading}
                style={{ flex: 1 }}
              />
              <input
                className="input"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
                disabled={loading}
                style={{ flex: 1 }}
              />
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn btn--primary"
                onClick={passwordLogin}
                disabled={loading || !login || !password}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>

              <span className="badge">Password login</span>
            </div>
          </div>

          {/* Telegram option */}
          <div style={{ marginTop: 14 }}>
            <div className="row">
              <button
                className="btn"
                onClick={telegramLogin}
                disabled={loading || !isTelegram}
                title={!isTelegram ? 'Open inside Telegram WebApp' : ''}
              >
                Login via Telegram
              </button>
              {isTelegram ? (
                <span className="badge">Telegram WebApp detected</span>
              ) : (
                <span className="badge">Telegram login unavailable here</span>
              )}
            </div>
          </div>

          {err && (
            <div className="card" style={{ marginTop: 14, boxShadow: 'none' }}>
              <div className="card__body">
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Error</div>
                <div style={{ color: 'var(--muted)' }}>{err}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
