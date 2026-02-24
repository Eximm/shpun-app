import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../shared/api/client'

// ✅ toast + typed mood (only allowed keys)
import { toast } from '../shared/ui/toast'
import { getMood } from '../shared/payments-mood'

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
      return 'Marzban'
    case 'marzban_router':
      return 'Router VPN'
    default:
      return 'Другое'
  }
}

/** Описание — как в боте */
function kindDescr(k: ServiceKind) {
  switch (k) {
    case 'marzban':
      return 'Подписка для телефонов, ПК и планшетов.'
    case 'marzban_router':
      return 'Отдельные подписки для роутеров (Shpun Router / OpenWrt).'
    case 'amneziawg':
      return 'Простой ключ для одного сервера.'
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

/** мягкий оттенок по статусу */
function statusTint(s: UiStatus) {
  switch (s) {
    case 'active':
      return { bg: 'rgba(34,197,94,.08)', border: 'rgba(34,197,94,.28)', stripe: 'rgba(34,197,94,.45)' }
    case 'pending':
    case 'init':
      return { bg: 'rgba(59,130,246,.08)', border: 'rgba(59,130,246,.28)', stripe: 'rgba(59,130,246,.45)' }
    case 'not_paid':
      return { bg: 'rgba(245,158,11,.08)', border: 'rgba(245,158,11,.28)', stripe: 'rgba(245,158,11,.45)' }
    case 'blocked':
      return { bg: 'rgba(245,158,11,.10)', border: 'rgba(245,158,11,.32)', stripe: 'rgba(245,158,11,.55)' }
    case 'error':
      return { bg: 'rgba(239,68,68,.08)', border: 'rgba(239,68,68,.28)', stripe: 'rgba(239,68,68,.50)' }
    case 'removed':
      return { bg: 'rgba(148,163,184,.06)', border: 'rgba(148,163,184,.22)', stripe: 'rgba(148,163,184,.28)' }
    default:
      return { bg: 'rgba(255,255,255,.02)', border: 'rgba(148,163,184,.22)', stripe: 'rgba(148,163,184,.22)' }
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
  if (s === 'active') return false
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

          <div className="p">Если вы сомневаетесь — лучше сначала проверьте статус услуги или обратитесь в поддержку.</div>
        </div>
      </div>
    </div>
  )
}

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
      </div>

      <div className="svc__connectBody">
        <Suspense fallback={<div className="p">Загрузка…</div>}>
          {kind === 'amneziawg' ? (
            <ConnectAmneziaWG usi={service.userServiceId} service={service} onDone={onDone} />
          ) : null}

          {kind === 'marzban' ? <ConnectMarzban usi={service.userServiceId} service={service} onDone={onDone} /> : null}

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

  const payUrl = `/payments?reason=service&usi=${encodeURIComponent(String(s.userServiceId))}`
  const supportUrl = `/support?topic=service&usi=${encodeURIComponent(String(s.userServiceId))}`

  const allowDelete = canDeleteStatus(s.status)
  const allowStop = canStopStatus(s.status)

  const canShowConnect = kind !== 'unknown' && s.status === 'active'

  const compactMeta = (() => {
    const parts: React.ReactNode[] = []
    if (until) parts.push(<>До: <b>{until}</b></>)
    if (hint) parts.push(<>{hint}</>)
    if (parts.length === 0) return '—'
    return (
      <>
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <span className="svc__dot">·</span> : null}
            <span className="svc__metaItem">{p}</span>
          </React.Fragment>
        ))}
      </>
    )
  })()

  const tint = statusTint(s.status)

  return (
    <div
      className="kv__item svc svc--compact"
      style={{
        background: `linear-gradient(180deg, ${tint.bg}, rgba(0,0,0,0))`,
        borderColor: tint.border,
        boxShadow: `inset 3px 0 0 ${tint.stripe}`,
      }}
    >
      <button type="button" className="svc__btn" onClick={onToggle} aria-expanded={expanded}>
        <div className="svc__row">
          <div className="svc__left">
            <div className="svc__status">{statusLabel(s.status)}</div>
            <div className="svc__title">
              #{s.userServiceId} — {s.title}
            </div>
            <div className="svc__sub svc__sub--compact">{compactMeta}</div>
          </div>

          <div className="svc__right">
            <span className="badge">
              {fmtMoney(s.price, s.currency)} / {s.periodMonths || 1}м
            </span>
          </div>
        </div>

        <div className="svc__toggle">
          <b>{expanded ? '▲' : '▼'}</b> Действия
        </div>
      </button>

      {expanded ? (
        <div className="svc__details">
          {s.status === 'active' ? (
            <div className="actions actions--1">
              <button
                className="btn btn--primary"
                onClick={onToggleConnect}
                disabled={!canShowConnect}
                title={!canShowConnect ? 'Подключение доступно только для активной услуги' : 'Открыть подключение'}
              >
                {connectOpen ? 'Скрыть подключение' : 'Подключение'}
              </button>
            </div>
          ) : null}

          {s.status === 'not_paid' ? (
            <div className="actions actions--2">
              <button className="btn btn--primary" onClick={() => go(payUrl)}>
                Оплатить / пополнить
              </button>
              <button className="btn" onClick={onRefresh}>
                Обновить
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

const STORAGE_KEY = 'services.groups.v1'

function readGroupsState(): Record<ServiceKind, boolean> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return null

    const pick = (k: ServiceKind, def: boolean) => (typeof obj[k] === 'boolean' ? obj[k] : def)

    return {
      amneziawg: pick('amneziawg', false),
      marzban: pick('marzban', false),
      marzban_router: pick('marzban_router', false),
      unknown: pick('unknown', false),
    }
  } catch {
    return null
  }
}

function saveGroupsState(v: Record<ServiceKind, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
  } catch {
    // ignore
  }
}

function normStatus(s: any): UiStatus {
  const v = String(s || '').toLowerCase()
  if (
    v === 'active' ||
    v === 'blocked' ||
    v === 'pending' ||
    v === 'not_paid' ||
    v === 'removed' ||
    v === 'error' ||
    v === 'init'
  ) {
    return v as UiStatus
  }
  return 'error'
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

  const [openGroups, setOpenGroups] = useState<Record<ServiceKind, boolean>>(() => {
    return (
      readGroupsState() ?? {
        amneziawg: false,
        marzban: false,
        marzban_router: false,
        unknown: false,
      }
    )
  })

  useEffect(() => {
    saveGroupsState(openGroups)
  }, [openGroups])

  // ✅ track status transitions (no first-render spam)
  const prevStatusesRef = useRef<Map<number, UiStatus> | null>(null)
  const statusInitRef = useRef(false)

  async function load(opts?: { silent?: boolean; toastOnSuccess?: boolean }) {
    const silent = !!opts?.silent
    const toastOnSuccess = !!opts?.toastOnSuccess

    if (!silent) {
      setLoading(true)
    }
    setError(null)

    try {
      const r = (await apiFetch('/services', { method: 'GET' })) as ApiServicesResponse
      const newItems = r.items || []

      setItems(newItems)
      setSummary(r.summary || null)

      if (toastOnSuccess) {
        toast.info('Обновлено', {
          description: getMood('payment_checking', { seed: String(newItems.length) }) ?? 'Статусы услуг обновлены.',
        })
      }
    } catch (e: any) {
      const msg = e?.message || 'Failed to load services'
      setError(msg)
      if (!silent) toast.error('Не удалось обновить', { description: msg })
    } finally {
      if (!silent) setLoading(false)
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

    const usi = stopTarget.userServiceId

    try {
      await stopService(usi)
      setStopTarget(null)
      setExpandedId(usi)

      toast.success('Заблокировано', {
        description: getMood('payment_success', { seed: String(usi) }) ?? 'Услуга заблокирована.',
      })

      await load({ silent: true })
    } catch (e: any) {
      const msg = e?.message || 'Не удалось заблокировать услугу. Попробуйте ещё раз или обратитесь в поддержку.'
      setStopError(msg)
      toast.error('Не удалось заблокировать', { description: msg })
    } finally {
      setStopBusy(false)
    }
  }

  async function onConfirmDelete() {
    if (!deleteTarget || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError(null)

    const usi = deleteTarget.userServiceId

    try {
      await deleteService(usi)
      setDeleteTarget(null)
      setExpandedId((cur) => (cur === usi ? null : cur))
      setConnectOpenId((cur) => (cur === usi ? null : cur))

      toast.success('Услуга удалена', {
        description: getMood('payment_success', { seed: String(usi) }) ?? 'Готово. Услуга удалена из списка.',
      })

      await load({ silent: true })
    } catch (e: any) {
      const msg = e?.message || 'Не удалось удалить услугу. Попробуйте ещё раз или обратитесь в поддержку.'
      setDeleteError(msg)
      toast.error('Не удалось удалить', { description: msg })
    } finally {
      setDeleteBusy(false)
    }
  }

  useEffect(() => {
    // первичная загрузка — без тостов
    load({ silent: false, toastOnSuccess: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // status transition toasts
  useEffect(() => {
    const cur = new Map<number, UiStatus>()
    for (const it of items || []) cur.set(it.userServiceId, normStatus(it.status))

    if (!statusInitRef.current) {
      prevStatusesRef.current = cur
      statusInitRef.current = true
      return
    }

    const prev = prevStatusesRef.current || new Map<number, UiStatus>()

    for (const it of items || []) {
      const id = it.userServiceId
      const before = prev.get(id)
      const after = cur.get(id)

      if (!before || !after || before === after) continue

      const title = it.title ? it.title : `Услуга #${id}`
      const seed = String(id)

      if (after === 'blocked') {
        toast.error(title, { description: 'Услуга заблокирована. Нужны действия.' })
      } else if (after === 'not_paid') {
        toast.info(title, { description: 'Требуется оплата.' })
      } else if (
        after === 'active' &&
        (before === 'pending' || before === 'not_paid' || before === 'blocked' || before === 'init')
      ) {
        toast.success(title, {
          description: getMood('payment_success', { seed }) ?? 'Услуга активирована.',
        })
      } else if (after === 'removed') {
        toast.success(title, {
          description: getMood('payment_success', { seed }) ?? 'Услуга завершена.',
        })
      }
    }

    prevStatusesRef.current = cur
  }, [items])

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
              <button className="btn btn--primary" onClick={() => load({ silent: false, toastOnSuccess: false })}>
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

  const toggleGroup = (kind: ServiceKind) => {
    setOpenGroups((cur) => ({ ...cur, [kind]: !cur[kind] }))
  }

  const Section = ({ kind }: { kind: ServiceKind }) => {
    const arr = groups[kind]
    if (!arr || arr.length === 0) return null

    const open = !!openGroups[kind]

    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <button
              type="button"
              className="services-cat__head services-cat__head--toggle"
              onClick={() => toggleGroup(kind)}
              aria-expanded={open}
            >
              <div className="services-cat__headLeft">
                <div className="services-cat__titleRow">
                  <div className="services-cat__title">{kindTitle(kind)}</div>
                  <span className="services-cat__chev" aria-hidden>
                    {open ? '▲' : '▼'}
                  </span>
                </div>
                <p className="p">{kindDescr(kind)}</p>
              </div>

              <span className="badge">{arr.length}</span>
            </button>

            {open ? (
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
                    onRefresh={() => load({ silent: false, toastOnSuccess: false })}
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
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div className="services-top">
            <div className="services-top__left">
              <div className="services-top__title">Услуги</div>
              <div className="services-top__sub">Список ключей и статусы.</div>
            </div>
          </div>

          <div className="services-head__meta services-head__meta--wide">
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

          <div className="services-head__actions">
            <button className="btn btn--primary services-head__cta" onClick={() => go('/services/order')}>
              Заказать
            </button>

            <button
              className="btn services-head__cta"
              onClick={() => load({ silent: false, toastOnSuccess: true })}
              title="Обновить статусы"
            >
              Обновить
            </button>
          </div>
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