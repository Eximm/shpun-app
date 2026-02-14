import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiFetch } from '../shared/api/client'

type TgWebApp = {
  initData?: string
  ready?: () => void
  expand?: () => void
  openTelegramLink?: (url: string) => void
  openLink?: (url: string, options?: any) => void
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

function buildTelegramOpenUrl(): string {
  const bot = (import.meta as any).env?.VITE_TG_BOT_USERNAME as string | undefined
  const app = (import.meta as any).env?.VITE_TG_APP_SHORTNAME as string | undefined
  const startapp = ((import.meta as any).env?.VITE_TG_STARTAPP as string | undefined) || ''

  if (!bot) return 'https://t.me/'

  if (app) {
    const u = new URL(`https://t.me/${bot}/${app}`)
    if (startapp) u.searchParams.set('startapp', startapp)
    return u.toString()
  }

  return `https://t.me/${bot}`
}

function openInTelegram() {
  const url = buildTelegramOpenUrl()
  const tg = getTelegramWebApp()

  try {
    if (tg?.openTelegramLink) return tg.openTelegramLink(url)
    if (tg?.openLink) return tg.openLink(url)
  } catch {
    // ignore
  }

  window.location.href = url
}

type Mode = 'telegram' | 'web'

type AuthOk = {
  ok: true
  login?: string
  user_id?: number
  next?: 'set_password' | 'cabinet'
}

export function Login() {
  const nav = useNavigate()
  const loc: any = useLocation()

  const tgInitData = useMemo(() => getTelegramInitData(), [])
  const mode: Mode = tgInitData ? 'telegram' : 'web'

  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Password fallback (для тех, кто уже выставил пароль)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')

  const autoLoginStarted = useRef(false)
  const canPasswordLogin = login.trim().length > 0 && password.length > 0

  function goAfterAuth(r?: Partial<AuthOk>) {
    const next = r?.next || 'cabinet'
    const loginFromApi = String(r?.login ?? '').trim()

    if (next === 'set_password') {
      nav('/app/set-password', { replace: true, state: { login: loginFromApi } })
      return
    }

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
      // парольный логин сразу в кабинет
      goAfterAuth({ next: 'cabinet' })
    } catch (e: any) {
      setErr(e?.message || 'Password login failed')
    } finally {
      setLoading(false)
    }
  }

  async function telegramLogin() {
    const initData = getTelegramInitData()
    if (!initData) {
      setErr('Open this app inside Telegram to sign in.')
      return
    }

    setLoading(true)
    setErr(null)
    try {
      const r = await apiFetch<AuthOk>('/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ initData })
      })

      // ВАЖНО: теперь решаем следующий шаг по "next"
      goAfterAuth(r)
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

    // Telegram-first: авто-логин один раз
    if (mode === 'telegram' && !autoLoginStarted.current) {
      autoLoginStarted.current = true
      telegramLogin()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div className="auth__head">
            <div>
              <h1 className="h1">Sign in</h1>

              {mode === 'telegram' ? (
                <p className="p">
                  We&apos;ll sign you in via <b>Telegram</b>. After that, we&apos;ll ask you to set a password and show your login.
                </p>
              ) : (
                <p className="p">
                  Sign in works via <b>Telegram</b>. Open this app from our bot to continue.
                </p>
              )}
            </div>

            <span className="badge">
              {mode === 'telegram' ? 'Telegram WebApp' : 'Web mode'}
            </span>
          </div>

          {mode === 'web' && (
            <>
              <div className="auth__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={openInTelegram}
                >
                  Open in Telegram
                </button>

                <button
                  type="button"
                  className="btn"
                  onClick={() => window.location.reload()}
                >
                  Refresh
                </button>
              </div>

              <div className="auth__divider">
                <span>already set a password?</span>
              </div>

              <details className="auth__details">
                <summary className="auth__detailsSummary">Sign in with password</summary>

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
              </details>
            </>
          )}

          {mode === 'telegram' && (
            <>
              <div className="auth__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={telegramLogin}
                  disabled={loading}
                >
                  {loading ? 'Signing in…' : 'Continue with Telegram'}
                </button>

                <button
                  type="button"
                  className="btn"
                  onClick={() => window.location.reload()}
                  disabled={loading}
                >
                  Reload
                </button>
              </div>

              <div className="auth__divider">
                <span>more methods later</span>
              </div>

              <div className="auth__providers">
                <button
                  className="btn auth__provider"
                  onClick={telegramLogin}
                  disabled={loading}
                  title="Login via Telegram"
                  type="button"
                >
                  <span className="auth__providerIcon">✈️</span>
                  <span className="auth__providerText">
                    Telegram
                    <span className="auth__providerHint">Fast login in WebApp</span>
                  </span>
                  <span className="auth__providerRight">→</span>
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
            </>
          )}

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
