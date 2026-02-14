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

  const canPasswordLogin = login.trim().length > 0 && password.length > 0

  async function finishLogin() {
    nav(loc?.state?.from || '/app/cabinet', { replace: true })
  }

  async function passwordLogin() {
    if (!canPasswordLogin) return

    setLoading(true)
    setErr(null)
    try {
      await apiFetch('/auth/password', {
        method: 'POST',
        body: JSON.stringify({ login: login.trim(), password })
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
          <div className="auth__head">
            <div>
              <h1 className="h1">Sign in</h1>
              <p className="p">
                Use <b>login &amp; password</b>. If you opened Shpun inside Telegram — you can sign in with <b>Telegram</b>.
              </p>
            </div>

            <span className="badge">
              {isTelegram ? 'Telegram WebApp detected' : 'Web mode'}
            </span>
          </div>

          {/* Password form */}
          <form
            className="auth__form"
            onSubmit={(e) => {
              e.preventDefault()
              passwordLogin()
            }}
          >
            <div className="auth__grid">
              <label className="field">
                <span className="field__label">Login</span>
                <input
                  className="input"
                  placeholder="e.g. @142912013"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  autoComplete="username"
                  disabled={loading}
                  inputMode="text"
                />
              </label>

              <label className="field">
                <span className="field__label">Password</span>
                <input
                  className="input"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete="current-password"
                  disabled={loading}
                />
              </label>
            </div>

            <div className="auth__actions">
              <button
                type="submit"
                className="btn btn--primary"
                disabled={loading || !canPasswordLogin}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>

              <button
                type="button"
                className="btn"
                disabled={true}
                title="Coming soon"
              >
                Forgot password
              </button>
            </div>
          </form>

          <div className="auth__divider">
            <span>or continue with</span>
          </div>

          {/* Providers (beautiful now, real later) */}
          <div className="auth__providers">
            <button
              className="btn auth__provider"
              onClick={telegramLogin}
              disabled={loading || !isTelegram}
              title={!isTelegram ? 'Open inside Telegram WebApp' : 'Login via Telegram'}
              type="button"
            >
              <span className="auth__providerIcon">✈️</span>
              <span className="auth__providerText">
                Telegram
                <span className="auth__providerHint">
                  {isTelegram ? 'Fast login in WebApp' : 'Available in Telegram'}
                </span>
              </span>
              <span className="auth__providerRight">{isTelegram ? '→' : '🔒'}</span>
            </button>

            <button
              className="btn auth__provider"
              disabled={true}
              title="Coming soon"
              type="button"
            >
              <span className="auth__providerIcon">🟦</span>
              <span className="auth__providerText">
                Google
                <span className="auth__providerHint">Coming soon</span>
              </span>
              <span className="auth__providerRight">🔒</span>
            </button>

            <button
              className="btn auth__provider"
              disabled={true}
              title="Coming soon"
              type="button"
            >
              <span className="auth__providerIcon">🟨</span>
              <span className="auth__providerText">
                Yandex
                <span className="auth__providerHint">Coming soon</span>
              </span>
              <span className="auth__providerRight">🔒</span>
            </button>
          </div>

          {err && (
            <div className="auth__error">
              <div className="auth__errorTitle">Error</div>
              <div className="auth__errorText">{err}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
