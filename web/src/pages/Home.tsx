import { Link } from 'react-router-dom'
import { useMe } from '../app/auth/useMe'

function Money({ amount, currency }: { amount: number; currency: string }) {
  const formatted =
    currency === 'RUB'
      ? new Intl.NumberFormat('ru-RU').format(amount) + ' ₽'
      : new Intl.NumberFormat('ru-RU').format(amount) + ` ${currency}`
  return <>{formatted}</>
}

export function Home() {
  const { me, loading, error, refetch } = useMe() as any

  // TODO: позже подменим на реальный URL биллинга/miniapp
  const PAYMENT_URL = (import.meta as any).env?.VITE_PAYMENT_URL || ''

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
            <h1 className="h1">Shpun</h1>
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
            <h1 className="h1">Shpun</h1>
            <p className="p">Ошибка загрузки профиля.</p>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn--primary" onClick={() => refetch?.()}>
                Повторить
              </button>
              <Link className="btn" to="/app/profile">
                Профиль
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // me contract (current MVP)
  const profile = me?.profile
  const balance = me?.balance
  const services = me?.services

  const activeCount = services?.active?.length ?? 0
  const blockedCount = services?.blocked?.length ?? 0
  const expiredCount = services?.expired?.length ?? 0
  const attentionCount = blockedCount + expiredCount

  return (
    <div className="section">
      {/* Hero */}
      <div className="card">
        <div className="card__body">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div>
              <h1 className="h1">
                Привет{profile?.displayName ? `, ${profile.displayName}` : ''} 👋
              </h1>
              <p className="p">SDN System — управление балансом и услугами.</p>
            </div>

            <button className="btn" onClick={() => refetch?.()} title="Обновить">
              ⟳ Обновить
            </button>
          </div>

          <div className="kv">
            <div className="kv__item">
              <div className="kv__k">Баланс</div>
              <div className="kv__v">
                {balance ? <Money amount={balance.amount} currency={balance.currency} /> : '—'}
              </div>
            </div>

            <div className="kv__item">
              <div className="kv__k">Активные услуги</div>
              <div className="kv__v">{activeCount}</div>
            </div>

            <div className="kv__item">
              <div className="kv__k">Требуют внимания</div>
              <div className="kv__v">{attentionCount}</div>
            </div>
          </div>

          {attentionCount > 0 && (
            <div className="pre" style={{ marginTop: 14 }}>
              Есть услуги, которые требуют внимания: заблокированные или истёкшие. Открой “Услуги” и проверь статусы.
            </div>
          )}

          <div className="row" style={{ marginTop: 14 }}>
            {/* Payment placeholder (we won't rush payments) */}
            <button className="btn btn--primary" onClick={openPayment}>
              Пополнить
            </button>

            <Link className="btn" to="/app/services">
              Услуги
            </Link>
            <Link className="btn" to="/app/profile">
              Профиль
            </Link>
          </div>
        </div>
      </div>

      {/* Payment placeholder card */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>
              Оплата
            </div>
            <p className="p">
              Сейчас оплата живёт в Telegram mini app. В Shpun App мы подключим её после интеграции с биллингом
              (и, возможно, подтянем историю платежей).
            </p>

            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn" onClick={openPayment}>
                Открыть оплату
              </button>
              <Link className="btn" to="/app/profile">
                Настройки/профиль
              </Link>
            </div>

            {!PAYMENT_URL && (
              <div className="pre" style={{ marginTop: 14 }}>
                Заглушка: чтобы включить кнопку, позже зададим <b>VITE_PAYMENT_URL</b> (url миниаппа/биллинга).
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Services summary */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div>
                <div className="h1" style={{ fontSize: 18 }}>
                  Сводка по услугам
                </div>
                <p className="p">Быстрое состояние. Детали — в разделе “Услуги”.</p>
              </div>
              <Link className="btn" to="/app/services">
                Открыть
              </Link>
            </div>

            <div className="kv">
              <div className="kv__item">
                <div className="kv__k">Активные</div>
                <div className="kv__v">{activeCount}</div>
              </div>
              <div className="kv__item">
                <div className="kv__k">Заблокированные</div>
                <div className="kv__v">{blockedCount}</div>
              </div>
              <div className="kv__item">
                <div className="kv__k">Истёкшие</div>
                <div className="kv__v">{expiredCount}</div>
              </div>
            </div>

            {activeCount === 0 && blockedCount === 0 && expiredCount === 0 && (
              <div className="pre" style={{ marginTop: 14 }}>
                Пока нет услуг. Когда подключим SHM — тут появятся “Заказать / Продлить” и реальные статусы.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Debug (optional, keep for MVP) */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>
              Текущие данные (MVP)
            </div>
            <p className="p">Это временно — пока идём к SHM /me.</p>
            <pre className="pre">{JSON.stringify(me, null, 2)}</pre>
          </div>
        </div>
      </div>
    </div>
  )
}
