// web/src/pages/SetPassword.tsx

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiFetch } from '../shared/api/client'
import type { MeResponse, PasswordSetResponse } from '../shared/api/types'

function pwdScore(p: string) {
  let s = 0
  if (p.length >= 8) s++
  if (/[A-Z]/.test(p)) s++
  if (/[a-z]/.test(p)) s++
  if (/\d/.test(p)) s++
  if (/[^A-Za-z0-9]/.test(p)) s++
  return Math.min(s, 5)
}

export function SetPassword() {
  const nav = useNavigate()
  const loc: any = useLocation()

  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [login, setLogin] = useState<string>('')

  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')

  const score = useMemo(() => pwdScore(password), [password])

  const canSubmit =
    password.trim().length >= 8 &&
    password2.length > 0 &&
    password === password2 &&
    !loading

  // Если login передали из /login — покажем сразу.
  useEffect(() => {
    const stateLogin = String(loc?.state?.login ?? '').trim()
    if (stateLogin) setLogin(stateLogin)
  }, [loc?.state?.login])

  // Если login не передали — подтянем /me (cookie sid уже должен быть)
  useEffect(() => {
    let alive = true

    async function loadMe() {
      if (login) return
      try {
        const me = await apiFetch<MeResponse>('/me', { method: 'GET' })
        if (!me.ok) throw new Error(me.error || 'Not authenticated')

        const l = String(me?.profile?.login ?? '').trim()
        if (alive && l) setLogin(l)
      } catch (e: any) {
        if (!alive) return
        setErr(e?.message || 'Not authenticated')
      }
    }

    loadMe()
    return () => {
      alive = false
    }
  }, [login])

  async function submit() {
    if (!canSubmit) return
    setLoading(true)
    setErr(null)

    try {
      const res = await apiFetch<PasswordSetResponse>('/auth/password/set', {
        method: 'POST',
        body: JSON.stringify({ password }),
      })

      if (!res.ok) throw new Error(res.error || 'Failed to set password')

      // ✅ Правильно: после установки пароля ведём на Главную (Home)
      nav('/app', { replace: true })
    } catch (e: any) {
      setErr(e?.message || 'Failed to set password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div className="auth__head">
            <div>
              <h1 className="h1">Установить пароль</h1>
              <p className="p">
                Вы вошли через <b>Telegram</b>. Создайте пароль — так вы сможете входить и вне Telegram.
              </p>
            </div>

            <span className="badge">Шаг 1 / 1</span>
          </div>

          <div className="kv">
            <div className="kv__item">
              <div className="kv__k">Ваш логин</div>
              <div className="kv__v">{login || '…'}</div>
            </div>
            <div className="kv__item">
              <div className="kv__k">Зачем</div>
              <div className="kv__v">Резервный вход</div>
            </div>
            <div className="kv__item">
              <div className="kv__k">Дальше</div>
              <div className="kv__v">Главная</div>
            </div>
          </div>

          <form
            className="auth__form"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <div className="auth__grid">
              <label className="field">
                <span className="field__label">Новый пароль</span>
                <input
                  className="input"
                  placeholder="Минимум 8 символов"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete="new-password"
                  disabled={loading}
                />
              </label>

              <label className="field">
                <span className="field__label">Повторите пароль</span>
                <input
                  className="input"
                  placeholder="Повторите пароль"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  type="password"
                  autoComplete="new-password"
                  disabled={loading}
                />
              </label>
            </div>

            <div className="pre">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: 'rgba(255,255,255,0.72)', fontWeight: 800 }}>
                  Надёжность
                </span>
                <span style={{ color: 'rgba(255,255,255,0.62)', fontWeight: 800 }}>
                  {score}/5
                </span>
              </div>
              <div style={{ marginTop: 8, color: 'rgba(255,255,255,0.62)', lineHeight: 1.35 }}>
                Совет: 8+ символов, цифры и спецсимволы.
              </div>
            </div>

            <div className="auth__actions">
              <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
                {loading ? 'Сохраняю…' : 'Сохранить пароль'}
              </button>

              <button
                type="button"
                className="btn"
                disabled={loading}
                onClick={() => nav('/login', { replace: true })}
                title="Назад"
              >
                Назад
              </button>
            </div>
          </form>

          {err && (
            <div className="auth__error">
              <div className="auth__errorTitle">Ошибка</div>
              <div className="auth__errorText">{err}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
