import { useNavigate } from 'react-router-dom'
import { useMe } from '../app/auth/useMe'
import { apiFetch } from '../shared/api/client'

export function Profile() {
  const nav = useNavigate()
  const { me, loading, error, refetch } = useMe() as any

  // TODO: позже подставим реальный URL миниаппа/биллинга
  const PAYMENT_URL = (import.meta as any).env?.VITE_PAYMENT_URL || ''

  async function logout() {
    try {
      await apiFetch('/api/logout', { method: 'POST' })
    } finally {
      nav('/login', { replace: true })
    }
  }

  function openPayment() {
    if (!PAYMENT_URL) {
      alert('Оплата будет подключена после интеграции с биллингом. Сейчас это заглушка.')
      return
    }
    window.open(PAYMENT_URL, '_blank', 'noopener,noreferrer')
  }

  if (loading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Профиль</h1>
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
            <h1 className="h1">Профиль</h1>
            <p className="p">Ошибка загрузки данных.</p>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn--primary" onClick={() => refetch?.()}>
                Повторить
              </button>
              <button className="btn btn--danger" onClick={logout}>
                Выйти
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const profile = me?.profile
  const balance = me?.balance

  return (
    <div className="section">
      {/* Header card */}
      <div className="card">
        <div className="card__body">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h1 className="h1">Профиль</h1>
              <p className="p">Аккаунт и настройки SDN System.</p>
            </div>

            <button className="btn" onClick={() => refetch?.()} title="Обновить">
              ⟳ Обновить
            </button>
          </div>

          <div className="kv">
            <div className="kv__item">
              <div className="kv__k">Пользователь</div>
              <div className="kv__v">{profile?.displayName || '—'}</div>
            </div>

            <div className="kv__item">
              <div className="kv__k">ID</div>
              <div className="kv__v">{profile?.id ?? '—'}</div>
            </div>

            <div className="kv__item">
              <div className="kv__k">Баланс</div>
              <div className="kv__v">
                {balance ? `${balance.amount} ${balance.currency}` : '—'}
              </div>
            </div>
          </div>

          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn" onClick={openPayment}>
              Открыть оплату
            </button>
            <button className="btn btn--danger" onClick={logout}>
              Выйти
            </button>
          </div>

          {!PAYMENT_URL && (
            <div className="pre" style={{ marginTop: 14 }}>
              Заглушка: позже зададим <b>VITE_PAYMENT_URL</b> и кнопка “Открыть оплату” поведёт в miniapp/биллинг.
            </div>
          )}
        </div>
      </div>

      {/* Auth methods */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>Авторизация</div>
            <p className="p">
              Сейчас вход через Telegram. Позже добавим email/пароль и привязку OAuth (Google/Yandex).
            </p>

            <div className="kv">
              <div className="kv__item">
                <div className="kv__k">Telegram</div>
                <div className="kv__v">Подключено</div>
                <div className="p" style={{ marginTop: 8, fontSize: 12 }}>
                  Управление привязкой появится после SHM интеграции.
                </div>
              </div>

              <div className="kv__item">
                <div className="kv__k">Email</div>
                <div className="kv__v">Скоро</div>
                <div className="p" style={{ marginTop: 8, fontSize: 12 }}>
                  Включим как альтернативный способ входа.
                </div>
              </div>

              <div className="kv__item">
                <div className="kv__k">OAuth</div>
                <div className="kv__v">Скоро</div>
                <div className="p" style={{ marginTop: 8, fontSize: 12 }}>
                  Google / Yandex — как связанные методы.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Debug */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>Данные (MVP)</div>
            <p className="p">Пока это mock из /api/me. После SHM будет реальный профиль.</p>
            <pre className="pre">{JSON.stringify(me, null, 2)}</pre>
          </div>
        </div>
      </div>
    </div>
  )
}
