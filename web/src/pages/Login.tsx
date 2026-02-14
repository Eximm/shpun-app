import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiFetch } from '../shared/api/client'
import type { AuthResponse } from '../shared/api/types'
import { useI18n } from '../shared/i18n'

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

/**
 * Надёжный MiniApp deeplink:
 * https://t.me/<bot>/<app>?startapp=<payload>
 *
 * ВАЖНО: всегда ставим startapp (по умолчанию "1"),
 * иначе в некоторых кейсах Telegram может открыть чат вместо MiniApp.
 */
function buildTelegramOpenUrl(): string {
  const bot = (import.meta as any).env?.VITE_TG_BOT_USERNAME as string | undefined
  const app = (import.meta as any).env?.VITE_TG_APP_SHORTNAME as string | undefined
  const startappRaw = (import.meta as any).env?.VITE_TG_STARTAPP as string | undefined
  const startapp = startappRaw && startappRaw.trim().length > 0 ? startappRaw.trim() : '1'

  if (!bot) return 'https://t.me/'

  if (app) {
    const u = new URL(`https://t.me/${bot}/${app}`)
    u.searchParams.set('startapp', startapp) // <- всегда
    return u.toString()
  }

  return `https://t.me/${bot}`
}

/**
 * Открываем MiniApp в Telegram.
 * - В обычном браузере: прямой переход (самый надёжный)
 * - Внутри Telegram WebApp: пробуем tg.openTelegramLink/openLink, потом fallback
 */
function openInTelegram() {
  const url = buildTelegramOpenUrl()
  const tg = getTelegramWebApp()
  const hasInitData = !!tg?.initData && tg.initData.length > 0

  if (!hasInitData) {
    window.location.href = url
    return
  }

  try {
    if (tg?.openTelegramLink) return tg.openTelegramLink(url)
    if (tg?.openLink) return tg.openLink(url)
  } catch {
    // ignore
  }

  window.location.href = url
}

type Mode = 'telegram' | 'web'

export function Login() {
  const { t } = useI18n()
  const nav = useNavigate()
  const loc: any = useLocation()

  // ВАЖНО: определяем режим по наличию Telegram.WebApp, а не по initData на первом рендере
  const mode: Mode = getTelegramWebApp() ? 'telegram' : 'web'

  const [tgInitData, setTgInitData] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Password fallback (для тех, кто уже выставил пароль)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')

  const autoLoginStarted = useRef(false)
  const canPasswordLogin = login.trim().length > 0 && password.length > 0

  function goAfterAuth(r?: AuthResponse) {
    const ok = !!r && (r as any).ok === true
    if (!ok) {
      const msg = (r as any)?.error
      if (msg) setErr(String(msg))
      return
    }

    const next = (r as any).next || 'cabinet'
    const loginFromApi = String((r as any).login ?? '').trim()

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
      const r = await apiFetch<AuthResponse>('/auth/password', {
        method: 'POST',
        body: JSON.stringify({ login: login.trim(), password }),
      })
      goAfterAuth(r)
    } catch (e: any) {
      setErr(e?.message || t('error.password_login_failed'))
    } finally {
      setLoading(false)
    }
  }

  async function telegramLogin() {
    const initData = tgInitData || getTelegramInitData()
    if (!initData) {
      // Мы в Telegram, но initData ещё не пришёл/не подхватился — попросим перезапуск
      setErr(t('error.open_in_tg'))
      return
    }

    setLoading(true)
    setErr(null)
    try {
      const r = await apiFetch<AuthResponse>('/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ initData }),
      })
      goAfterAuth(r)
    } catch (e: any) {
      setErr(e?.message || t('error.telegram_login_failed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const tg = getTelegramWebApp()
    tg?.ready?.()
    tg?.expand?.()

    if (mode === 'telegram') {
      // initData иногда не сразу доступен — подхватываем несколько раз
      const pull = () => setTgInitData(getTelegramInitData())

      pull()
      const t1 = window.setTimeout(pull, 50)
      const t2 = window.setTimeout(pull, 200)
      const t3 = window.setTimeout(pull, 600)

      // Автологин — с небольшой задержкой, чтобы initData успел появиться
      if (!autoLoginStarted.current) {
        autoLoginStarted.current = true
        window.setTimeout(() => {
          telegramLogin()
        }, 120)
      }

      return () => {
        window.clearTimeout(t1)
        window.clearTimeout(t2)
        window.clearTimeout(t3)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div className="auth__head">
            <div>
              <h1 className="h1">{t('login.title')}</h1>

              {mode === 'telegram' ? (
                <p className="p">{t('login.desc.tg')}</p>
              ) : (
                <p className="p">{t('login.desc.web')}</p>
              )}
            </div>

            <span className="badge">{mode === 'telegram' ? t('login.badge.tg') : t('login.badge.web')}</span>
          </div>

          {/* “цеплялка”: что будет внутри */}
          <div className="pre" style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>{t('login.what.title')}</div>
            <div style={{ display: 'grid', gap: 6 }}>
              <div>{t('login.what.1')}</div>
              <div>{t('login.what.2')}</div>
              <div>{t('login.what.3')}</div>
              <div>{t('login.what.4')}</div>
            </div>
          </div>

          {mode === 'web' && (
            <>
              <div className="auth__actions" style={{ marginTop: 12 }}>
                <button type="button" className="btn btn--primary" onClick={openInTelegram}>
                  {t('login.cta.open_tg')}
                </button>

                <button type="button" className="btn" onClick={() => window.location.reload()}>
                  {t('login.cta.refresh')}
                </button>
              </div>

              <div className="pre" style={{ marginTop: 12 }}>
                <b>{t('login.why.title')}</b> {t('login.why.text')}
              </div>

              <div className="auth__divider">
                <span>{t('login.divider.providers')}</span>
              </div>

              <div className="auth__providers">
                <button className="btn auth__provider" onClick={openInTelegram} disabled={loading} type="button">
                  <span className="auth__providerIcon">✈️</span>
                  <span className="auth__providerText">
                    Telegram
                    <span className="auth__providerHint">{t('login.providers.telegram.hint.web')}</span>
                  </span>
                  <span className="auth__providerRight">→</span>
                </button>

                <button className="btn auth__provider" disabled={true} type="button">
                  <span className="auth__providerIcon">🟦</span>
                  <span className="auth__providerText">
                    Google
                    <span className="auth__providerHint">{t('login.providers.google.hint')}</span>
                  </span>
                  <span className="auth__providerRight">🔒</span>
                </button>

                <button className="btn auth__provider" disabled={true} type="button">
                  <span className="auth__providerIcon">🟨</span>
                  <span className="auth__providerText">
                    Yandex
                    <span className="auth__providerHint">{t('login.providers.yandex.hint')}</span>
                  </span>
                  <span className="auth__providerRight">🔒</span>
                </button>
              </div>

              <div className="auth__divider" style={{ marginTop: 14 }}>
                <span>{t('login.divider.password')}</span>
              </div>

              <details className="auth__details">
                <summary className="auth__detailsSummary">{t('login.password.summary')}</summary>

                <form
                  className="auth__form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    passwordLogin()
                  }}
                >
                  <div className="auth__grid">
                    <label className="field">
                      <span className="field__label">{t('login.password.login')}</span>
                      <input
                        className="input"
                        placeholder={t('login.password.login_ph')}
                        value={login}
                        onChange={(e) => setLogin(e.target.value)}
                        autoComplete="username"
                        disabled={loading}
                        inputMode="text"
                      />
                    </label>

                    <label className="field">
                      <span className="field__label">{t('login.password.password')}</span>
                      <input
                        className="input"
                        placeholder={t('login.password.password_ph')}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        type="password"
                        autoComplete="current-password"
                        disabled={loading}
                      />
                    </label>
                  </div>

                  <div className="auth__actions">
                    <button type="submit" className="btn btn--primary" disabled={loading || !canPasswordLogin}>
                      {loading ? t('login.password.submit_loading') : t('login.password.submit')}
                    </button>

                    <button type="button" className="btn" disabled={true} title="Coming soon">
                      {t('login.password.forgot')}
                    </button>
                  </div>

                  <div className="pre" style={{ marginTop: 12 }}>{t('login.password.tip')}</div>
                </form>
              </details>
            </>
          )}

          {mode === 'telegram' && (
            <>
              {/* Главная кнопка — на всю ширину */}
              <div className="auth__actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={telegramLogin}
                  disabled={loading}
                  style={{ width: '100%' }}
                >
                  {loading ? t('login.tg.cta_loading') : t('login.tg.cta')}
                </button>
              </div>

              <div className="pre" style={{ marginTop: 12 }}>
                <b>{t('login.tg.secure.title')}</b> {t('login.tg.secure.text')}
              </div>

              <div className="auth__divider">
                <span>{t('login.divider.providers')}</span>
              </div>

              <div className="auth__providers">
                <button
                  className="btn auth__provider"
                  onClick={telegramLogin}
                  disabled={loading}
                  type="button"
                  style={{ width: '100%' }}
                >
                  <span className="auth__providerIcon">✈️</span>
                  <span className="auth__providerText">
                    Telegram
                    <span className="auth__providerHint">{t('login.providers.telegram.hint.tg')}</span>
                  </span>
                  <span className="auth__providerRight">→</span>
                </button>

                <button className="btn auth__provider" disabled={true} type="button" style={{ width: '100%' }}>
                  <span className="auth__providerIcon">🟦</span>
                  <span className="auth__providerText">
                    Google
                    <span className="auth__providerHint">{t('login.providers.google.hint')}</span>
                  </span>
                  <span className="auth__providerRight">🔒</span>
                </button>

                <button className="btn auth__provider" disabled={true} type="button" style={{ width: '100%' }}>
                  <span className="auth__providerIcon">🟨</span>
                  <span className="auth__providerText">
                    Yandex
                    <span className="auth__providerHint">{t('login.providers.yandex.hint')}</span>
                  </span>
                  <span className="auth__providerRight">🔒</span>
                </button>
              </div>

              <div className="auth__divider" style={{ marginTop: 14 }}>
                <span>{t('login.backup.divider')}</span>
              </div>

              <details className="auth__details">
                <summary className="auth__detailsSummary">{t('login.backup.summary')}</summary>

                <form
                  className="auth__form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    passwordLogin()
                  }}
                >
                  <div className="auth__grid">
                    <label className="field">
                      <span className="field__label">{t('login.password.login')}</span>
                      <input
                        className="input"
                        placeholder={t('login.password.login_ph')}
                        value={login}
                        onChange={(e) => setLogin(e.target.value)}
                        autoComplete="username"
                        disabled={loading}
                        inputMode="text"
                      />
                    </label>

                    <label className="field">
                      <span className="field__label">{t('login.password.password')}</span>
                      <input
                        className="input"
                        placeholder={t('login.password.password_ph')}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        type="password"
                        autoComplete="current-password"
                        disabled={loading}
                      />
                    </label>
                  </div>

                  <div className="auth__actions">
                    <button type="submit" className="btn btn--primary" disabled={loading || !canPasswordLogin}>
                      {loading ? t('login.password.submit_loading') : t('login.password.submit')}
                    </button>

                    <button type="button" className="btn" disabled={true} title="Coming soon">
                      {t('login.password.forgot')}
                    </button>
                  </div>
                </form>
              </details>
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
