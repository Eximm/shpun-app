// web/src/pages/PaymentsHistory.tsx

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../shared/api/client'
import { useI18n } from '../shared/i18n'

type Pay = {
  id: number
  date?: string
  money?: number
  pay_system_id?: string
}

type Withdraw = {
  withdraw_id: number
  withdraw_date?: string
  end_date?: string
  cost?: number
  discount?: number
  bonus?: number
  total?: number
  months?: number
  qnt?: number
  service_id?: number
  user_service_id?: number
}

type PagedResp<T> = {
  ok: boolean
  items: T[]
  page: number
  limit: number
  hasMore: boolean
  error?: string
  raw?: any
}

const PREVIEW_ROWS = 5

function fmtDate(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

function fmtMoney(n: any, cur = 'RUB') {
  const v = Number(n || 0)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: 0,
    }).format(v)
  } catch {
    return `${v} ${cur}`
  }
}

function nNum(v: any): number {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

function compactId(v: any) {
  const s = String(v ?? '').trim()
  return s ? s : '—'
}

function Pager(props: {
  page: number
  hasMore: boolean
  disabled?: boolean
  onPrev: () => void
  onNext: () => void
}) {
  const { page, hasMore, disabled, onPrev, onNext } = props
  return (
    <div className="actions actions--2 paymentsHist__pager">
      <button className="btn" onClick={onPrev} disabled={disabled || page <= 1}>
        ←
      </button>
      <button className="btn" onClick={onNext} disabled={disabled || !hasMore}>
        →
      </button>
    </div>
  )
}

function CollapseToggle(props: {
  shownAll: boolean
  total: number
  preview: number
  disabled?: boolean
  onToggle: () => void
  t: (key: string, fallback?: string) => string
}) {
  const { shownAll, total, preview, disabled, onToggle, t } = props
  if (total <= preview) return null

  const hidden = Math.max(0, total - preview)

  return (
    <div className="paymentsHist__collapseRow">
      <button className="btn paymentsHist__collapseBtn" onClick={onToggle} disabled={disabled}>
        {shownAll
          ? t('paymentsHistory.collapse.hide', 'Свернуть')
          : t('paymentsHistory.collapse.show_more', `Показать ещё ${hidden}`).replace('{count}', String(hidden))}
      </button>
    </div>
  )
}

export function PaymentsHistory() {
  const { t } = useI18n()

  const [err, setErr] = useState<string | null>(null)

  const [paysLoading, setPaysLoading] = useState(true)
  const [withdrawsLoading, setWithdrawsLoading] = useState(true)

  const [paysPage, setPaysPage] = useState(1)
  const [withdrawsPage, setWithdrawsPage] = useState(1)

  const [paysResp, setPaysResp] = useState<PagedResp<Pay> | null>(null)
  const [withdrawsResp, setWithdrawsResp] = useState<PagedResp<Withdraw> | null>(null)

  const [paysExpanded, setPaysExpanded] = useState(false)
  const [withdrawsExpanded, setWithdrawsExpanded] = useState(false)

  async function loadPays(page: number) {
    setPaysLoading(true)
    try {
      const r = await apiFetch<PagedResp<Pay>>(`/payments/pays?page=${page}`, { method: 'GET' })
      setPaysResp(r ?? null)
    } catch (e: any) {
      setPaysResp(null)
      throw e
    } finally {
      setPaysLoading(false)
    }
  }

  async function loadWithdraws(page: number) {
    setWithdrawsLoading(true)
    try {
      const r = await apiFetch<PagedResp<Withdraw>>(`/payments/withdraws?page=${page}`, { method: 'GET' })
      setWithdrawsResp(r ?? null)
    } catch (e: any) {
      setWithdrawsResp(null)
      throw e
    } finally {
      setWithdrawsLoading(false)
    }
  }

  async function loadAll(nextPaysPage = paysPage, nextWithdrawsPage = withdrawsPage) {
    setErr(null)
    try {
      await Promise.all([loadPays(nextPaysPage), loadWithdraws(nextWithdrawsPage)])
      setPaysExpanded(false)
      setWithdrawsExpanded(false)
    } catch (e: any) {
      setErr(e?.message || t('paymentsHistory.error.load_failed', 'Не удалось загрузить историю операций.'))
    }
  }

  useEffect(() => {
    loadAll(1, 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pays = useMemo(() => (Array.isArray(paysResp?.items) ? paysResp!.items : []), [paysResp])
  const withdraws = useMemo(() => (Array.isArray(withdrawsResp?.items) ? withdrawsResp!.items : []), [withdrawsResp])

  const paysView = useMemo(
    () => (paysExpanded ? pays : pays.slice(0, PREVIEW_ROWS)),
    [pays, paysExpanded]
  )

  const withdrawsView = useMemo(
    () => (withdrawsExpanded ? withdraws : withdraws.slice(0, PREVIEW_ROWS)),
    [withdraws, withdrawsExpanded]
  )

  const busy = paysLoading || withdrawsLoading

  return (
    <div className="section paymentsHist">
      <div className="card">
        <div className="card__body">
          <div className="home-block-head">
            <div>
              <div className="h1">{t('paymentsHistory.title', '🧾 История операций')}</div>
            </div>
            <Link className="btn" to="/payments">
              {t('paymentsHistory.back', 'Назад')}
            </Link>
          </div>

          <div className="actions actions--2 paymentsHist__mt12">
            <button className="btn" onClick={() => loadAll()} disabled={busy}>
              {t('paymentsHistory.refresh', '⟳ Обновить')}
            </button>
            <Link className="btn" to="/payments/receipts">
              {t('paymentsHistory.receipts', 'Отправленные квитанции')}
            </Link>
          </div>

          {err ? (
            <div className="pre paymentsHist__mt12">
              {t('paymentsHistory.error.prefix', 'Ошибка')}: {String(err)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1 paymentsHist__h18">{t('paymentsHistory.topups.title', 'Пополнения')}</div>
            <div className="p paymentsHist__mt6">
              {paysLoading
                ? t('paymentsHistory.loading', 'Загрузка…')
                : pays.length
                ? t('paymentsHistory.page_info', 'Страница: {page} · Показано: {shown}/{total}')
                    .replace('{page}', String(paysResp?.page ?? paysPage))
                    .replace('{shown}', String(paysView.length))
                    .replace('{total}', String(pays.length))
                : t('paymentsHistory.empty.short', 'Пока пусто')}
            </div>

            <div className="list paymentsHist__mt10">
              {paysLoading ? (
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">{t('paymentsHistory.loading_items', 'Загружаем…')}</div>
                    <div className="list__sub">{t('paymentsHistory.loading_wait', 'Подождите немного')}</div>
                  </div>
                </div>
              ) : paysView.length ? (
                paysView.map((x: any, idx: number) => {
                  const money = nNum(x?.money)
                  const dt = x?.date ? String(x.date) : ''
                  const ps = x?.pay_system_id ? String(x.pay_system_id) : '—'
                  const id = x?.id ?? idx

                  return (
                    <div className="list__item" key={`pay-${id}-${idx}`}>
                      <div className="list__main">
                        <div className="list__title">
                          <span className="paymentsHist__plus">+ {fmtMoney(money, 'RUB')}</span>
                          <span className="paymentsHist__dot" />
                          <span className="paymentsHist__date">{fmtDate(dt)}</span>
                        </div>
                        <div className="list__sub">
                          {t('paymentsHistory.topups.system', 'Способ оплаты')}: {ps}
                        </div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">{t('paymentsHistory.topups.empty.title', 'Пополнений пока не было')}</div>
                    <div className="list__sub">{t('paymentsHistory.topups.empty.sub', 'Когда появятся новые пополнения, они будут здесь.')}</div>
                  </div>
                </div>
              )}
            </div>

            <CollapseToggle
              shownAll={paysExpanded}
              total={pays.length}
              preview={PREVIEW_ROWS}
              disabled={paysLoading}
              onToggle={() => setPaysExpanded((v) => !v)}
              t={t}
            />

            <Pager
              page={paysResp?.page ?? paysPage}
              hasMore={!!paysResp?.hasMore}
              disabled={paysLoading}
              onPrev={async () => {
                const next = Math.max(1, (paysResp?.page ?? paysPage) - 1)
                setPaysPage(next)
                await loadAll(next, withdrawsResp?.page ?? withdrawsPage)
              }}
              onNext={async () => {
                const next = (paysResp?.page ?? paysPage) + 1
                setPaysPage(next)
                await loadAll(next, withdrawsResp?.page ?? withdrawsPage)
              }}
            />
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1 paymentsHist__h18">{t('paymentsHistory.withdrawals.title', 'Списания')}</div>
            <div className="p paymentsHist__mt6">
              {withdrawsLoading
                ? t('paymentsHistory.loading', 'Загрузка…')
                : withdraws.length
                ? t('paymentsHistory.page_info', 'Страница: {page} · Показано: {shown}/{total}')
                    .replace('{page}', String(withdrawsResp?.page ?? withdrawsPage))
                    .replace('{shown}', String(withdrawsView.length))
                    .replace('{total}', String(withdraws.length))
                : t('paymentsHistory.empty.short', 'Пока пусто')}
            </div>

            <div className="list paymentsHist__mt10">
              {withdrawsLoading ? (
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">{t('paymentsHistory.loading_items', 'Загружаем…')}</div>
                    <div className="list__sub">{t('paymentsHistory.loading_wait', 'Подождите немного')}</div>
                  </div>
                </div>
              ) : withdrawsView.length ? (
                withdrawsView.map((x: any, idx: number) => {
                  const wid = x?.withdraw_id ?? idx
                  const dt = x?.withdraw_date ? String(x.withdraw_date) : ''
                  const end = x?.end_date ? String(x.end_date) : ''
                  const total = nNum(x?.total)
                  const cost = nNum(x?.cost)
                  const discount = nNum(x?.discount)
                  const bonus = nNum(x?.bonus)
                  const months = x?.months != null ? Number(x.months) : null
                  const qnt = x?.qnt != null ? Number(x.qnt) : null
                  const serviceId = x?.service_id != null ? Number(x.service_id) : null
                  const usi = x?.user_service_id != null ? Number(x.user_service_id) : null

                  const period =
                    months && qnt ? `${months}м × ${qnt}` : months ? `${months}м` : qnt ? `× ${qnt}` : ''

                  const subParts = [
                    `${t('paymentsHistory.withdrawals.id', 'ID')}: ${compactId(wid)}`,
                    serviceId ? `${t('paymentsHistory.withdrawals.service', 'Услуга')}: ${serviceId}` : null,
                    usi ? `${t('paymentsHistory.withdrawals.usi', 'USI')}: ${usi}` : null,
                    period ? `${t('paymentsHistory.withdrawals.period', 'Период')}: ${period}` : null,
                    end ? `${t('paymentsHistory.withdrawals.until', 'До')}: ${fmtDate(end)}` : null,
                  ].filter(Boolean)

                  const moneyParts = [
                    cost ? `${t('paymentsHistory.withdrawals.cost', 'Стоимость')}: ${fmtMoney(cost, 'RUB')}` : null,
                    discount ? `${t('paymentsHistory.withdrawals.discount', 'Скидка')}: ${fmtMoney(discount, 'RUB')}` : null,
                    bonus ? `${t('paymentsHistory.withdrawals.bonus', 'Бонусы')}: ${fmtMoney(bonus, 'RUB')}` : null,
                  ].filter(Boolean)

                  return (
                    <div className="list__item" key={`w-${wid}-${idx}`}>
                      <div className="list__main">
                        <div className="list__title">
                          <span className="paymentsHist__minus">− {fmtMoney(total, 'RUB')}</span>
                          <span className="paymentsHist__dot" />
                          <span className="paymentsHist__date">{fmtDate(dt)}</span>
                        </div>
                        <div className="list__sub">
                          {subParts.length ? subParts.join(' · ') : '—'}
                          {moneyParts.length ? (
                            <>
                              <span className="paymentsHist__sep"> · </span>
                              {moneyParts.join(' · ')}
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">{t('paymentsHistory.withdrawals.empty.title', 'Списаний пока не было')}</div>
                    <div className="list__sub">{t('paymentsHistory.withdrawals.empty.sub', 'Когда появятся списания, они будут здесь.')}</div>
                  </div>
                </div>
              )}
            </div>

            <CollapseToggle
              shownAll={withdrawsExpanded}
              total={withdraws.length}
              preview={PREVIEW_ROWS}
              disabled={withdrawsLoading}
              onToggle={() => setWithdrawsExpanded((v) => !v)}
              t={t}
            />

            <Pager
              page={withdrawsResp?.page ?? withdrawsPage}
              hasMore={!!withdrawsResp?.hasMore}
              disabled={withdrawsLoading}
              onPrev={async () => {
                const next = Math.max(1, (withdrawsResp?.page ?? withdrawsPage) - 1)
                setWithdrawsPage(next)
                await loadAll(paysResp?.page ?? paysPage, next)
              }}
              onNext={async () => {
                const next = (withdrawsResp?.page ?? withdrawsPage) + 1
                setWithdrawsPage(next)
                await loadAll(paysResp?.page ?? paysPage, next)
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default PaymentsHistory