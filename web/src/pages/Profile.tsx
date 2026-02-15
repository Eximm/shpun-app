import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMe } from '../app/auth/useMe'
import { apiFetch } from '../shared/api/client'
import { useI18n } from '../shared/i18n'

function copyToClipboard(text: string) {
  if (!text) return
  try {
    navigator.clipboard?.writeText(text)
  } catch {
    // ignore
  }
}

function formatDate(v?: string | null) {
  const s = String(v ?? '').trim()
  if (!s) return '—'
  return s
}

export function Profile() {
  const nav = useNavigate()
  const { me, loading, error, refetch } = useMe() as any
  const { lang, setLang, t } = useI18n()

  const PAYMENT_URL = (import.meta as any).env?.VITE_PAYMENT_URL || ''

  const profile = me?.profile
  const balance = me?.balance

  const loginText = useMemo(() => {
    const l =
      String(profile?.login ?? profile?.username ?? '').trim() ||
      (profile?.id != null ? `@${profile.id}` : '')
    return l
  }, [profile?.login, profile?.username, profile?.id])

  const [copied, setCopied] = useState(false)

  async function logout() {
    try {
      await apiFetch('/logout', { method: 'POST' })
    } finally {
      nav('/login', { replace: true })
    }
  }

  function openPayment() {
    if (!PAYMENT_URL) {
      alert(t('profile.payment_stub'))
      return
    }
    window.open(PAYMENT_URL, '_blank', 'noopener,noreferrer')
  }

  function goChangePassword() {
    // Важно: state легко теряется, поэтому режим передаём через URL.
    // intent=change => это добровольная смена пароля, НЕ онбординг.
    // redirect => куда вернуться после успешной смены.
    nav('/app/set-password?intent=change&redirect=/app/profile')
  }

  function doCopyLogin() {
    if (!loginText) return
    copyToClipboard(loginText)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  if (loading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t('profile.title')}</h1>
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
            <h1 className="h1">{t('profile.title')}</h1>
            <p className="p">Ошибка загрузки данных.</p>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn--primary" onClick={() => refetch?.()}>
                Повторить
              </button>
              <button className="btn btn--danger" onClick={logout}>
                {t('profile.logout')}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const bonus = me?.bonus
  const discount = me?.discount
  const created = profile?.created ?? me?.meRaw?.created
  const lastLogin = profile?.lastLogin ?? me?.meRaw?.last_login
  const passwordSet = profile?.passwordSet ?? null

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h1 className="h1">{t('profile.title')}</h1>
              <p className="p">{t('profile.subtitle')}</p>
            </div>

            <button className="btn" onClick={() => refetch?.()} title={t('profile.refresh')}>
              {t('profile.refresh')}
            </button>
          </div>

          <div className="kv">
            <div className="kv__item">
              <div className="kv__k">{t('profile.user')}</div>
              <div className="kv__v">{profile?.displayName || '—'}</div>
            </div>

            <div className="kv__item">
              <div className="kv__k">{t('profile.login')}</div>
              <div className="kv__v" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span>{loginText || '—'}</span>
                {loginText && (
                  <button
                    type="button"
                    className="btn"
                    onClick={doCopyLogin}
                    title="Copy login"
                    style={{ padding: '6px 10px' }}
                  >
                    {copied ? t('profile.copied') : t('profile.copy')}
                  </button>
                )}
              </div>
            </div>

            <div className="kv__item">
              <div className="kv__k">{t('profile.id')}</div>
              <div className="kv__v">{profile?.id ?? '—'}</div>
            </div>

            <div className="kv__item">
              <div className="kv__k">{t('profile.balance')}</div>
              <div className="kv__v">{balance ? `${balance.amount} ${balance.currency}` : '—'}</div>
            </div>

            <div className="kv__item">
              <div className="kv__k">{t('profile.bonus')}</div>
              <div className="kv__v">{bonus != null ? String(bonus) : '—'}</div>
            </div>

            <div className="kv__item">
              <div className="kv__k">{t('profile.discount')}</div>
              <div className="kv__v">{discount != null ? `${discount}%` : '—'}</div>
            </div>

            <div className="kv__item">
              <div className="kv__k">{t('profile.created')}</div>
              <div className="kv__v">{formatDate(created)}</div>
            </div>

            <div className="kv__item">
              <div className="kv__k">{t('profile.last_login')}</div>
              <div className="kv__v">{formatDate(lastLogin)}</div>
            </div>
          </div>

          <div
            style={{
              marginTop: 14,
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 10,
            }}
          >
            <button className="btn btn--primary" onClick={openPayment} style={{ width: '100%' }}>
              {t('profile.open_payment')}
            </button>

            <button className="btn" onClick={goChangePassword} style={{ width: '100%' }}>
              {t('profile.change_password')}
            </button>

            <button
              className="btn btn--danger"
              onClick={logout}
              style={{ width: '100%', gridColumn: '1 / -1' }}
            >
              {t('profile.logout')}
            </button>
          </div>

          {!PAYMENT_URL && (
            <div className="pre" style={{ marginTop: 14 }}>
              {t('profile.payment_stub_hint')}
            </div>
          )}

          {passwordSet !== null && (
            <div className="pre" style={{ marginTop: 12 }}>
              Password set: <b>{passwordSet ? 'yes' : 'no'}</b>
            </div>
          )}
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>
              {t('profile.settings.title')}
            </div>
            <p className="p">{t('profile.settings.subtitle')}</p>

            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn" disabled={true} title="Coming soon">
                {t('profile.settings.notifications_soon')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>
              {t('profile.lang.title')}
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <button
                type="button"
                className={`btn ${lang === 'ru' ? 'btn--primary' : ''}`}
                onClick={() => setLang('ru')}
              >
                {t('profile.lang.ru')}
              </button>

              <button
                type="button"
                className={`btn ${lang === 'en' ? 'btn--primary' : ''}`}
                onClick={() => setLang('en')}
              >
                {t('profile.lang.en')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>
              {t('profile.auth.title')}
            </div>
            <p className="p">{t('profile.auth.subtitle')}</p>

            <div className="kv">
              <div className="kv__item">
                <div className="kv__k">{t('profile.auth.telegram')}</div>
                <div className="kv__v">{t('profile.auth.telegram.on')}</div>
                <div className="p" style={{ marginTop: 8, fontSize: 12 }}>
                  {t('profile.auth.oauth_hint')}
                </div>
              </div>

              <div className="kv__item">
                <div className="kv__k">{t('profile.auth.email')}</div>
                <div className="kv__v">{t('profile.auth.soon')}</div>
              </div>

              <div className="kv__item">
                <div className="kv__k">{t('profile.auth.oauth')}</div>
                <div className="kv__v">{t('profile.auth.soon')}</div>
                <div className="p" style={{ marginTop: 8, fontSize: 12 }}>
                  {t('profile.auth.oauth_hint')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>
              {t('profile.debug.title')}
            </div>
            <p className="p">{t('profile.debug.subtitle')}</p>
            <pre className="pre">{JSON.stringify(me, null, 2)}</pre>
          </div>
        </div>
      </div>
    </div>
  )
}
