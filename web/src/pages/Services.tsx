import { useMe } from '../app/auth/useMe'

type ServiceItem = {
  id?: string | number
  name?: string
  title?: string
  status?: string
  expiresAt?: string
  until?: string
}

function ServiceCard({ s }: { s: ServiceItem }) {
  const title = s.title || s.name || 'Услуга'
  const status = s.status || ''
  const until = s.expiresAt || s.until || ''

  return (
    <div className="kv__item">
      <div className="kv__k">{status ? status : 'Статус'}</div>
      <div className="kv__v">{title}</div>
      {until ? (
        <div className="p" style={{ marginTop: 8, fontSize: 12 }}>
          До: <span style={{ color: 'rgba(255,255,255,0.82)' }}>{until}</span>
        </div>
      ) : null}
    </div>
  )
}

function Section({
  title,
  subtitle,
  items,
  emptyText,
}: {
  title: string
  subtitle: string
  items: ServiceItem[]
  emptyText: string
}) {
  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="h1" style={{ fontSize: 18 }}>{title}</div>
              <p className="p">{subtitle}</p>
            </div>

            <button className="btn" disabled title="После интеграции с биллингом">
              Управлять
            </button>
          </div>

          {items.length === 0 ? (
            <div className="pre" style={{ marginTop: 14 }}>
              {emptyText}
            </div>
          ) : (
            <div className="kv">
              {items.map((s, idx) => (
                <ServiceCard key={(s.id as any) ?? idx} s={s} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function Services() {
  const { me, loading, error, refetch } = useMe() as any

  if (loading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Услуги</h1>
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
            <h1 className="h1">Услуги</h1>
            <p className="p">Ошибка загрузки данных.</p>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn--primary" onClick={() => refetch?.()}>
                Повторить
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const services = me?.services
  const active: ServiceItem[] = services?.active ?? []
  const blocked: ServiceItem[] = services?.blocked ?? []
  const expired: ServiceItem[] = services?.expired ?? []

  return (
    <div className="section">
      {/* Header */}
      <div className="card">
        <div className="card__body">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h1 className="h1">Услуги</h1>
              <p className="p">Состояние ваших подключений. Управление появится после интеграции с биллингом.</p>
            </div>

            <button className="btn" onClick={() => refetch?.()} title="Обновить">
              ⟳ Обновить
            </button>
          </div>

          <div className="kv">
            <div className="kv__item">
              <div className="kv__k">Активные</div>
              <div className="kv__v">{active.length}</div>
            </div>
            <div className="kv__item">
              <div className="kv__k">Заблокированные</div>
              <div className="kv__v">{blocked.length}</div>
            </div>
            <div className="kv__item">
              <div className="kv__k">Истёкшие</div>
              <div className="kv__v">{expired.length}</div>
            </div>
          </div>

          {(blocked.length + expired.length) > 0 ? (
            <div className="pre" style={{ marginTop: 14 }}>
              Есть услуги, которые требуют внимания. После подключения биллинга здесь появятся быстрые действия: “Продлить” и “Оплатить”.
            </div>
          ) : null}
        </div>
      </div>

      <Section
        title="Активные"
        subtitle="Работают прямо сейчас."
        items={active}
        emptyText="Активных услуг пока нет."
      />

      <Section
        title="Заблокированные"
        subtitle="Обычно это из-за окончания баланса или ограничений."
        items={blocked}
        emptyText="Заблокированных услуг нет — отлично."
      />

      <Section
        title="Истёкшие"
        subtitle="Услуги, срок действия которых закончился."
        items={expired}
        emptyText="Истёкших услуг нет."
      />

      {/* Debug */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>Данные (MVP)</div>
            <p className="p">Пока это mock из /api/me. После SHM будет реальный список.</p>
            <pre className="pre">{JSON.stringify(services, null, 2)}</pre>
          </div>
        </div>
      </div>
    </div>
  )
}
