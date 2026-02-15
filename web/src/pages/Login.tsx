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

function readEnv(key: string): string {
  const v = (import.meta as any).env?.[key]
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * Надёжный MiniApp deeplink:
 * https://t.me/<bot>/<app>?startapp=<payload>
 */
function buildTelegramOpenUrlSafe():
  | { ok: true; url: string }
  | { ok: false; error: string; debug?: Record<string, any> } {
  const botRaw = readEnv('VITE_TG_BOT_USERNAME')
  const appRaw = readEnv('VITE_TG_APP_SHORTNAME')
  const startappRaw = readEnv('VITE_TG_STARTAPP')
  const startapp = startappRaw.length > 0 ? startappRaw : '1'

  const bot = botRaw.startsWith('@') ? botRaw.slice(1).trim() : botRaw
  const app = appRaw

  if (!bot) {
    return {
      ok: false,
      error: 'VITE_TG_BOT_USERNAME is empty in this build',
      debug: { botRaw, appRaw, startappRaw },
    }
  }

  if (!app) {
    return { ok: true, url: `https://t.me/${encodeURIComponent(bot)}` }
  }

  const base = `https://t.me/${encodeURIComponent(bot)}/${encodeURIComponent(app)}`
  const url = `${base}?startapp=${encodeURIComponent(startapp)}`
  return { ok: true, url }
}

/**
 * Открываем MiniApp в Telegram.
 * - В обычном браузере/PWA: прямой переход (самый надёжный)
 * - Внутри Telegram WebApp: пробуем tg.openTelegramLink/openLink, потом fallback
 */
function openInTelegramSafe(setErr?: (s: string) => void) {
  const built = buildTelegramOpenUrlSafe()
  if (!built.ok) {
    setErr?.(built.error)
    console.warn('[openInTelegram] bad env:', built.error, built.debug)
    return
  }

  const url = built.url
  const tg = getTelegramWebApp()
  const hasInitData = !!tg?.initData && tg.initData.length > 0

  if (!hasInitData) {
    window.location.assign(url)
    return
  }

  try {
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(url)
      return
    }
    if (tg?.openLink) {
      tg.openLink(url)
      return
    }
  } catch (e) {
    console.warn('[openInTelegram] tg open failed:', e)
  }

  window.location.assign(url)
}

type Mode = 'telegram' | 'web'
type PassMode = 'login' | 'register'

export function Login() {
  const { t } = useI18n()
  const nav = useNavigate()
  const loc: any = useLocation()

  // telegram-mode только если реально есть initData
  const mode: Mode = getTelegramInitData() ? 'telegram' : 'web'

  const [tgInitData, setTgInitData] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Password fallback + registration
  const [passMode, setPassMode] = useState<PassMode>('login')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')

  const autoLoginStarted = useRef(false)

  const canPasswordLogin = login.trim().length > 0 && password.length > 0
  const passwordsMatch = password2.length === 0 ? true : password === password2
  const canPasswordRegister =
    login.trim().length > 0 && password.length > 0 && password2.length > 0 && password === password2

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

  async function passwordRegister() {
    if (!canPasswordRegister) return

    setLoading(true)
    setErr(null)
    try {
      // если у тебя другой путь на API — скажешь, я заменю одним файлом
      const r = await apiFetch<AuthResponse>('/auth/password/register', {
        method: 'POST',
        body: JSON.stringify({ login: login.trim(), password }),
      })
      goAfterAuth(r)
    } catch (e: any) {
      setErr(e?.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  async function telegramLogin() {
    const initData = tgInitData || getTelegramInitData()
    if (!initData) {
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
      const pull = () => setTgInitData(getTelegramInitData())

      pull()
      const t1 = window.setTimeout(pull, 50)
      const t2 = window.setTimeout(pull, 200)
      const t3 = window.setTimeout(pull, 600)

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

  const passwordDetails = (
    <details className="auth__details">
      <summary className="auth__detailsSummary">{t('login.password.summary')}</summary>

      <form
        className="auth__form"
        onSubmit={(e) => {
          e.preventDefault()
          if (passMode === 'login') passwordLogin()
          else passwordRegister()
        }}
      >
        {/* Заголовок */}
        <div style={{ fontWeight: 900, letterSpacing: 0.1, marginBottom: 10 }}>
          {passMode === 'login' ? 'Войти по логину и паролю' : 'Регистрация по логину и паролю'}
        </div>

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
              autoComplete={passMode === 'login' ? 'current-password' : 'new-password'}
              disabled={loading}
            />
          </label>

          {passMode === 'register' && (
            <label className="field">
              <span className="field__label">Повтор пароля</span>
              <input
                className="input"
                placeholder="Введите пароль ещё раз"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                type="password"
                autoComplete="new-password"
                disabled={loading}
              />
            </label>
          )}
        </div>

        {passMode === 'register' && password2.length > 0 && !passwordsMatch && (
          <div className="pre" style={{ marginTop: 12 }}>
            Пароли не совпадают.
          </div>
        )}

        {/* Основная кнопка */}
        <div className="auth__actions">
          <button
            type="submit"
            className="btn btn--primary"
            style={{ width: '100%' }}
            disabled={loading || (passMode === 'login' ? !canPasswordLogin : !canPasswordRegister)}
          >
            {loading
              ? passMode === 'login'
                ? t('login.password.submit_loading')
                : 'Создаём аккаунт…'
              : passMode === 'login'
                ? t('login.password.submit')
                : 'Зарегистрироваться'}
          </button>
        </div>

        {/* Переключатель НИЖЕ основной кнопки, такой же ширины, отделён тонкой линией */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.10)' }}>
          <button
            type="button"
            className="btn"
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.03)',
              borderColor: 'rgba(255,255,255,0.12)',
              fontWeight: 900,
            }}
            disabled={loading}
            onClick={() => {
              setErr(null)
              if (passMode === 'login') {
                setPassMode('register')
              } else {
                setPassMode('login')
                setPassword2('')
              }
            }}
            title={passMode === 'login' ? 'Создать аккаунт' : 'Уже есть аккаунт'}
          >
            {passMode === 'login' ? 'Регистрация' : 'Уже есть аккаунт? Вход'}
          </button>
        </div>

        {/* Подсказки */}
        {passMode === 'login' ? (
          <div className="pre" style={{ marginTop: 12 }}>
            {t('login.password.tip')}
          </div>
        ) : (
          <div className="pre" style={{ marginTop: 12 }}>
            После регистрации можно привязать Telegram внутри приложения.
          </div>
        )}
      </form>
    </details>
  )

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
              {/* Главная CTA — на всю ширину */}
              <div className="auth__actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => openInTelegramSafe(setErr)}
                  style={{ width: '100%' }}
                >
                  {t('login.cta.open_tg')}
                </button>
              </div>

              <div className="pre" style={{ marginTop: 12 }}>
                <b>{t('login.why.title')}</b> {t('login.why.text')}
              </div>

              {/* Провайдеры — как было */}
              <div className="auth__divider">
                <span>{t('login.divider.providers')}</span>
              </div>

              <div className="auth__providers">
                <button
                  className="btn auth__provider"
                  onClick={() => openInTelegramSafe(setErr)}
                  disabled={loading}
                  type="button"
                >
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

              {/* Спойлер с понятной формой */}
              {passwordDetails}
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

              {/* Спойлер с понятной формой */}
              {passwordDetails}
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
