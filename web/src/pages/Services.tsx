import React, { Suspense, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../shared/api/client'

type UiStatus = 'active' | 'blocked' | 'pending' | 'not_paid' | 'removed' | 'error' | 'init'

type ApiServiceItem = {
  userServiceId: number
  serviceId: number
  title: string
  descr: string
  category: string
  status: UiStatus
  statusRaw: string
  createdAt: string | null
  expireAt: string | null
  daysLeft: number | null
  price: number
  periodMonths: number
  currency: string
}

type ApiSummary = {
  total: number
  active: number
  blocked: number
  pending: number
  notPaid: number
  expiringSoon: number
  monthlyCost: number
  currency: string
}

type ApiServicesResponse = {
  ok: true
  items: ApiServiceItem[]
  summary: ApiSummary
}

type ServiceKind = 'amneziawg' | 'marzban' | 'marzban_router' | 'unknown'

function go(url: string) {
  window.location.assign(url)
}

function detectKind(category?: string): ServiceKind {
  if (!category) return 'unknown'
  if (category.startsWith('vpn-')) return 'amneziawg'
  if (category === 'marzban') return 'marzban'
  if (category === 'marzban-r') return 'marzban_router'
  return 'unknown'
}

function kindTitle(k: ServiceKind) {
  switch (k) {
    case 'amneziawg':
      return 'AmneziaWG'
    case 'marzban':
      return 'Marzban (все устройства)'
    case 'marzban_router':
      return 'Marzban (роутеры)'
    default:
      return 'Другое'
  }
}

function kindDescr(k: ServiceKind) {
  switch (k) {
    case 'amneziawg':
      return 'VPN-протокол AmneziaWG.'
    case 'marzban':
      return 'Подписка Marzban для всех устройств.'
    case 'marzban_router':
      return 'Подписка Marzban для роутеров.'
    default:
      return 'Прочие услуги.'
  }
}

function statusLabel(s: UiStatus) {
  switch (s) {
    case 'active':
      return 'Активна'
    case 'pending':
      return 'Подключается'
    case 'not_paid':
      return 'Не оплачена'
    case 'blocked':
      return 'Заблокирована'
    case 'removed':
      return 'Завершена'
    case 'error':
      return 'Ошибка'
    case 'init':
      return 'Инициализация'
    default:
      return 'Статус'
  }
}

function fmtDate(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
}

function fmtMoney(n: number, cur: string) {
  const v = Number(n || 0)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: cur || 'RUB',
      maximumFractionDigits: 0,
    }).format(v)
  } catch {
    return `${v} ${cur || 'RUB'}`
  }
}

function hintText(s: ApiServiceItem) {
  const left = s.daysLeft
  if (s.status === 'active' && left != null) return left >= 0 ? `Осталось ~${left} дн.` : 'Срок истёк'
  if (s.status === 'not_paid') return 'Требуется оплата'
  if (s.status === 'blocked') return 'Нужны действия'
  if (s.status === 'pending') return 'Подождите немного'
  if (s.status === 'init') return 'Инициализация услуги'
  if (s.status === 'error') return 'Проверьте статус или обратитесь в поддержку'
  return ''
}

function statusSortWeight(s: UiStatus) {
  switch (s) {
    case 'active':
      return 0
    case 'pending':
      return 1
    case 'not_paid':
      return 2
    case 'blocked':
      return 3
    case 'init':
      return 4
    case 'error':
      return 5
    case 'removed':
      return 6
    default:
      return 99
  }
}

function canDeleteStatus(s: UiStatus) {
  if (s === 'pending' || s === 'init') return false
  if (s === 'removed') return false
  if (s === 'active') return false // active удаляем только после stop
  return true
}

function canStopStatus(s: UiStatus) {
  return s === 'active'
}

function deleteConfirmText(s: ApiServiceItem) {
  switch (s.status) {
    case 'not_paid':
      return 'Удалить неоплаченный заказ? Он исчезнет из списка.'
    case 'blocked':
      return 'Удалить услугу? Она исчезнет из списка.'
    case 'error':
      return 'Удалить услугу? Она исчезнет из списка.'
    default:
      return 'Удалить услугу?'
  }
}

function Modal({
  title,
  open,
  children,
  confirmText = 'Подтвердить',
  cancelText = 'Отмена',
  loading,
  error,
  confirmClassName = 'btn btn--primary',
  onClose,
  onConfirm,
}: {
  title: string
  open: boolean
  children: React.ReactNode
  confirmText?: string
  cancelText?: string
  loading?: boolean
  error?: string | null
  confirmClassName?: string
  onClose: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="card modal__card">
        <div className="card__body">
          <div className="modal__head">
            <div className="modal__title">{title}</div>
            <button className="btn modal__close" onClick={onClose} aria-label="Закрыть" disabled={!!loading}>
              ✕
            </button>
          </div>

          <div className="modal__content">{children}</div>

          {error ? <div className="pre">{error}</div> : null}

          <div className="actions actions--2">
            <button className="btn" onClick={onClose} disabled={!!loading}>
              {cancelText}
            </button>

            <button className={confirmClassName} onClick={onConfirm} disabled={!!loading}>
              {loading ? 'Подождите…' : confirmText}
            </button>
          </div>

          <div className="p">
            Если вы сомневаетесь — лучше сначала проверьте статус услуги или обратитесь в поддержку.
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * "Дополнительные страницы" (лениво), которые мы рендерим ВНУТРИ карточки.
 */
const ConnectAmneziaWG = React.lazy(() => import('./connect/ConnectAmneziaWG'))
const ConnectMarzban = React.lazy(() => import('./connect/ConnectMarzban.tsx'))
const ConnectRouter = React.lazy(() => import('./connect/ConnectRouter'))

function ConnectInline({
  kind,
  service,
  onDone,
}: {
  kind: ServiceKind
  service: ApiServiceItem
  onDone?: () => void
}) {
  return (
    <div className="svc__connect">
      <div className="row svc__connectHead">
        <div className="services-cat__title svc__connectTitle">Подключение</div>
        <span className="badge">{kindTitle(kind)}</span>
      </div>

      <div className="svc__connectBody">
        <Suspense fallback={<div className="p">Загрузка…</div>}>
          {kind === 'amneziawg' ? (
            <ConnectAmneziaWG usi={service.userServiceId} service={service} onDone={onDone} />
          ) : null}

          {kind === 'marzban' ? (
            <ConnectMarzban usi={service.userServiceId} service={service} onDone={onDone} />
          ) : null}

          {kind === 'marzban_router' ? (
            <ConnectRouter usi={service.userServiceId} service={service} onDone={onDone} />
          ) : null}

          {kind === 'unknown' ? <div className="pre">Для этого типа услуги пока нет помощника подключения.</div> : null}
        </Suspense>
      </div>
    </div>
  )
}

function ServiceCard({
  s,
  expanded,
  connectOpen,
  onToggle,
  onToggleConnect,
  onRefresh,
  onAskDelete,
  onAskStop,
}: {
  s: ApiServiceItem
  expanded: boolean
  connectOpen: boolean
  onToggle: () => void
  onToggleConnect: () => void
  onRefresh: () => void
  onAskDelete: (s: ApiServiceItem) => void
  onAskStop: (s: ApiServiceItem) => void
}) {
  const until = s.expireAt ? fmtDate(s.expireAt) : ''
  const kind = detectKind(s.category)
  const hint = hintText(s)

  const orderUrl = `/services/order`
  const payUrl = `/payments?reason=service&usi=${encodeURIComponent(String(s.userServiceId))}`
  const supportUrl = `/support?topic=service&usi=${encodeURIComponent(String(s.userServiceId))}`

  const allowDelete = canDeleteStatus(s.status)
  const allowStop = canStopStatus(s.status)

  const canShowConnect = kind !== 'unknown' && s.status === 'active'

  return (
    <div className="kv__item svc">
      <button type="button" className="svc__btn" onClick={onToggle} aria-expanded={expanded}>
        <div className="svc__row">
          <div className="svc__left">
            <div className="svc__status">{statusLabel(s.status)}</div>
            <div className="svc__title">{s.title}</div>
            <div className="svc__sub">{until ? <>До: <b>{until}</b></> : 'Без даты окончания'}</div>
          </div>

          <div className="svc__right">
            <span className="badge">{kindTitle(kind)}</span>
            <span className="badge">
              {fmtMoney(s.price, s.currency)} / {s.periodMonths || 1}м
            </span>
            <div className="svc__hint">{hint || '\u00A0'}</div>
          </div>
        </div>

        <div className="svc__toggle">
          <b>{expanded ? '▲' : '▼'}</b> Действия
        </div>
      </button>

      {expanded ? (
        <div className="svc__details">
          {s.status === 'active' ? (
            <div className="actions actions--2">
              <button
                className="btn btn--primary"
                onClick={onToggleConnect}
                disabled={!canShowConnect}
                title={!canShowConnect ? 'Подключение доступно только для активной услуги' : 'Открыть подключение'}
              >
                {connectOpen ? 'Скрыть подключение' : 'Подключение'}
              </button>
              <button className="btn" onClick={() => go(orderUrl)}>
                Заказать ещё
              </button>
            </div>
          ) : null}

          {s.status === 'not_paid' ? (
            <div className="actions actions--2">
              <button className="btn btn--primary" onClick={() => go(payUrl)}>
                Оплатить / пополнить
              </button>
              <button className="btn" onClick={() => go(orderUrl)}>
                Выбрать тариф
              </button>
            </div>
          ) : null}

          {(s.status === 'pending' || s.status === 'init') ? (
            <div className="actions actions--1">
              <button className="btn btn--primary" onClick={onRefresh}>
                Обновить статус
              </button>
            </div>
          ) : null}

          {s.status === 'blocked' ? (
            <div className="actions actions--2">
              <button className="btn btn--primary" onClick={() => go(payUrl)}>
                Пополнить / оплатить
              </button>
              <button className="btn" onClick={() => go(supportUrl)}>
                В поддержку
              </button>
            </div>
          ) : null}

          {s.status === 'error' ? (
            <div className="actions actions--2">
              <button className="btn btn--primary" onClick={onRefresh}>
                Обновить
              </button>
              <button className="btn" onClick={() => go(supportUrl)}>
                В поддержку
              </button>
            </div>
          ) : null}

          {s.status === 'removed' ? (
            <div className="actions actions--1">
              <button className="btn btn--primary" onClick={() => go(orderUrl)}>
                Заказать снова
              </button>
            </div>
          ) : null}

          {connectOpen && canShowConnect ? <ConnectInline kind={kind} service={s} onDone={onRefresh} /> : null}

          {allowStop ? (
            <div className="actions actions--1">
              <button className="btn" onClick={() => onAskStop(s)} title="Заблокировать услугу">
                🛑 Заблокировать
              </button>
            </div>
          ) : null}

          {allowDelete ? (
            <div className="actions actions--1">
              <button className="btn" onClick={() => onAskDelete(s)} title="Удалить услугу">
                🗑️ Удалить услугу
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function Services() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ApiServiceItem[]>([])
  const [summary, setSummary] = useState<ApiSummary | null>(null)

  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [connectOpenId, setConnectOpenId] = useState<number | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<ApiServiceItem | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [stopTarget, setStopTarget] = useState<ApiServiceItem | null>(null)
  const [stopBusy, setStopBusy] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = (await apiFetch('/services', { method: 'GET' })) as ApiServicesResponse
      setItems(r.items || [])
      setSummary(r.summary || null)
    } catch (e: any) {
      setError(e?.message || 'Failed to load services')
    } finally {
      setLoading(false)
    }
  }

  async function stopService(userServiceId: number) {
    await apiFetch(`/services/${encodeURIComponent(String(userServiceId))}/stop`, { method: 'POST' })
  }

  async function deleteService(userServiceId: number) {
    await apiFetch(`/services/${encodeURIComponent(String(userServiceId))}`, { method: 'DELETE' })
  }

  async function onConfirmStop() {
    if (!stopTarget || stopBusy) return
    setStopBusy(true)
    setStopError(null)
    try {
      const usi = stopTarget.userServiceId
      await stopService(usi)
      setStopTarget(null)
      setExpandedId(usi)
      await load()
    } catch (e: any) {
      setStopError(e?.message || 'Не удалось заблокировать услугу. Попробуйте ещё раз или обратитесь в поддержку.')
    } finally {
      setStopBusy(false)
    }
  }

  async function onConfirmDelete() {
    if (!deleteTarget || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const usi = deleteTarget.userServiceId
      await deleteService(usi)
      setDeleteTarget(null)
      setExpandedId((cur) => (cur === usi ? null : cur))
      setConnectOpenId((cur) => (cur === usi ? null : cur))
      await load()
    } catch (e: any) {
      setDeleteError(e?.message || 'Не удалось удалить услугу. Попробуйте ещё раз или обратитесь в поддержку.')
    } finally {
      setDeleteBusy(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const groups = useMemo(() => {
    const byKind: Record<ServiceKind, ApiServiceItem[]> = {
      amneziawg: [],
      marzban: [],
      marzban_router: [],
      unknown: [],
    }

    for (const it of items) byKind[detectKind(it.category)].push(it)

    const sortFn = (a: ApiServiceItem, b: ApiServiceItem) => {
      const wa = statusSortWeight(a.status)
      const wb = statusSortWeight(b.status)
      if (wa !== wb) return wa - wb
      return (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999)
    }

    ;(Object.keys(byKind) as ServiceKind[]).forEach((k) => byKind[k].sort(sortFn))
    return byKind
  }, [items])

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
            <p className="p">
              Ошибка загрузки данных: <span>{error}</span>
            </p>
            <div className="actions actions--1">
              <button className="btn btn--primary" onClick={load}>
                Повторить
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const s = summary
  const fallbackActive = items.filter((x) => x.status === 'active').length
  const fallbackAttention = items.filter((x) => x.status === 'blocked' || x.status === 'not_paid').length

  const Section = ({ kind }: { kind: ServiceKind }) => {
    const arr = groups[kind]
    if (!arr || arr.length === 0) return null

    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="services-cat__head">
              <div>
                <div className="services-cat__title">{kindTitle(kind)}</div>
                <p className="p">{kindDescr(kind)}</p>
              </div>
              <span className="badge">{arr.length}</span>
            </div>

            <div className="kv">
              {arr.map((x) => (
                <ServiceCard
                  key={x.userServiceId}
                  s={x}
                  expanded={expandedId === x.userServiceId}
                  connectOpen={connectOpenId === x.userServiceId}
                  onToggle={() => {
                    setExpandedId((cur) => (cur === x.userServiceId ? null : x.userServiceId))
                    setConnectOpenId((cur) => (cur === x.userServiceId ? null : cur))
                  }}
                  onToggleConnect={() => {
                    setExpandedId(x.userServiceId)
                    setConnectOpenId((cur) => (cur === x.userServiceId ? null : x.userServiceId))
                  }}
                  onRefresh={load}
                  onAskDelete={(svc) => {
                    setDeleteError(null)
                    setDeleteTarget(svc)
                  }}
                  onAskStop={(svc) => {
                    setStopError(null)
                    setStopTarget(svc)
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div className="services-head">
            <h1 className="services-head__title">Услуги</h1>
            <div className="row">
              <button className="btn btn--primary" onClick={() => go('/services/order')}>
                Заказать
              </button>
              <button className="btn" onClick={load} title="Обновить">
                ⟳
              </button>
            </div>
          </div>

          <div className="services-head__meta">
            <span className="badge">
              Активные: <b>{s?.active ?? fallbackActive}</b>
            </span>
            <span className="badge">
              Внимание: <b>{(s?.blocked ?? 0) + (s?.notPaid ?? 0) || fallbackAttention}</b>
            </span>
            <span className="badge">
              В месяц: <b>{fmtMoney(s?.monthlyCost ?? 0, s?.currency ?? 'RUB')}</b>
            </span>
          </div>

          {(s?.expiringSoon ?? 0) > 0 ? (
            <div className="pre">
              Есть услуги, которые скоро истекают (≤ 7 дней): <b>{s?.expiringSoon}</b>.
            </div>
          ) : null}
        </div>
      </div>

      <Section kind="amneziawg" />
      <Section kind="marzban" />
      <Section kind="marzban_router" />
      <Section kind="unknown" />

      {/* STOP modal */}
      <Modal
        title={stopTarget ? `Заблокировать услугу «${stopTarget.title}»?` : 'Заблокировать услугу?'}
        open={!!stopTarget}
        loading={stopBusy}
        error={stopError}
        onClose={() => {
          if (stopBusy) return
          setStopTarget(null)
          setStopError(null)
        }}
        onConfirm={onConfirmStop}
        confirmText="Заблокировать"
        cancelText="Отмена"
        confirmClassName="btn btn--primary"
      >
        {stopTarget ? (
          <>
            <div className="p">
              <b>Что произойдёт:</b>
            </div>

            <div className="p">
              Мы заблокируем услугу <b>«{stopTarget.title}»</b>. После этого она перестанет работать.
            </div>

            <div className="pre">
              <div>⚠️ Разблокировка самостоятельно недоступна.</div>
              <div>Если потребуется вернуть доступ — только через техподдержку.</div>
            </div>

            <div className="pre">
              <div>
                Статус: <b>{statusLabel(stopTarget.status)}</b>
              </div>
              <div>
                Тип: <b>{kindTitle(detectKind(stopTarget.category))}</b>
              </div>
              <div>
                Тариф: <b>{fmtMoney(stopTarget.price, stopTarget.currency)}</b> / {stopTarget.periodMonths || 1}м
              </div>
              {stopTarget.expireAt ? (
                <div>
                  Действует до: <b>{fmtDate(stopTarget.expireAt)}</b>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </Modal>

      {/* DELETE modal */}
      <Modal
        title={deleteTarget ? `Удалить услугу «${deleteTarget.title}»?` : 'Удалить услугу?'}
        open={!!deleteTarget}
        loading={deleteBusy}
        error={deleteError}
        onClose={() => {
          if (deleteBusy) return
          setDeleteTarget(null)
          setDeleteError(null)
        }}
        onConfirm={onConfirmDelete}
        confirmText="Удалить"
        cancelText="Отмена"
        confirmClassName="btn btn--primary"
      >
        {deleteTarget ? (
          <>
            <div className="p">
              <b>Подтверждение удаления</b>
            </div>

            <div className="p">{deleteConfirmText(deleteTarget)}</div>

            <div className="pre">
              <div>
                Статус: <b>{statusLabel(deleteTarget.status)}</b>
              </div>
              <div>
                Тип: <b>{kindTitle(detectKind(deleteTarget.category))}</b>
              </div>
              <div>
                Тариф: <b>{fmtMoney(deleteTarget.price, deleteTarget.currency)}</b> / {deleteTarget.periodMonths || 1}м
              </div>
              {deleteTarget.expireAt ? (
                <div>
                  Действует до: <b>{fmtDate(deleteTarget.expireAt)}</b>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  )
}