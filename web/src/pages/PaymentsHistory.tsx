// web/src/pages/PaymentsHistory.tsx

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../shared/api/client'
import { useI18n } from '../shared/i18n'

/* ─── Types ─────────────────────────────────────────────────────────────── */

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
}

const PREVIEW_ROWS = 5

/* ─── Utils ─────────────────────────────────────────────────────────────── */

function fmtDate(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
}

function fmtMoney(n: any, cur = 'RUB') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Number(n || 0))
  } catch { return `${Number(n || 0)} ${cur}`; }
}

function nNum(v: any): number { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function compactId(v: any) { return String(v ?? '').trim() || '—'; }

/* ─── Pager ──────────────────────────────────────────────────────────────── */

function Pager({ page, hasMore, disabled, onPrev, onNext }: {
  page: number; hasMore: boolean; disabled?: boolean; onPrev: () => void; onNext: () => void;
}) {
  return (
    <div className="actions actions--2 miniPage__pager">
      <button className="btn" onClick={onPrev} disabled={disabled || page <= 1} type="button">←</button>
      <button className="btn" onClick={onNext} disabled={disabled || !hasMore} type="button">→</button>
    </div>
  )
}

/* ─── CollapseToggle ─────────────────────────────────────────────────────── */

function CollapseToggle({ shownAll, total, preview, disabled, onToggle, t }: {
  shownAll: boolean; total: number; preview: number; disabled?: boolean;
  onToggle: () => void; t: (key: string) => string;
}) {
  if (total <= preview) return null
  const hidden = Math.max(0, total - preview)
  return (
    <div className="miniPage__collapse">
      <button className="btn miniPage__collapseBtn" onClick={onToggle} disabled={disabled} type="button">
        {shownAll
          ? t('paymentsHistory.collapse.hide')
          : t('paymentsHistory.collapse.show_more').replace('{count}', String(hidden))}
      </button>
    </div>
  )
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export function PaymentsHistory() {
  const { t } = useI18n()

  const [err,              setErr]              = useState<string | null>(null)
  const [paysLoading,      setPaysLoading]      = useState(true)
  const [withdrawsLoading, setWithdrawsLoading] = useState(true)
  const [paysPage,         setPaysPage]         = useState(1)
  const [withdrawsPage,    setWithdrawsPage]    = useState(1)
  const [paysResp,         setPaysResp]         = useState<PagedResp<Pay> | null>(null)
  const [withdrawsResp,    setWithdrawsResp]    = useState<PagedResp<Withdraw> | null>(null)
  const [paysExpanded,     setPaysExpanded]     = useState(false)
  const [withdrawsExpanded, setWithdrawsExpanded] = useState(false)

  async function loadPays(page: number) {
    setPaysLoading(true)
    try {
      const r = await apiFetch<PagedResp<Pay>>(`/payments/pays?page=${page}`, { method: 'GET' })
      setPaysResp(r ?? null)
    } catch { setPaysResp(null); throw new Error(); }
    finally { setPaysLoading(false) }
  }

  async function loadWithdraws(page: number) {
    setWithdrawsLoading(true)
    try {
      const r = await apiFetch<PagedResp<Withdraw>>(`/payments/withdraws?page=${page}`, { method: 'GET' })
      setWithdrawsResp(r ?? null)
    } catch { setWithdrawsResp(null); throw new Error(); }
    finally { setWithdrawsLoading(false) }
  }

  async function loadAll(nextPays = paysPage, nextWithdraws = withdrawsPage) {
    setErr(null)
    try {
      await Promise.all([loadPays(nextPays), loadWithdraws(nextWithdraws)])
      setPaysExpanded(false)
      setWithdrawsExpanded(false)
    } catch {
      setErr(t('paymentsHistory.error.load_failed'))
    }
  }

  useEffect(() => { void loadAll(1, 1); }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pays      = useMemo(() => Array.isArray(paysResp?.items)      ? paysResp!.items      : [], [paysResp])
  const withdraws = useMemo(() => Array.isArray(withdrawsResp?.items) ? withdrawsResp!.items : [], [withdrawsResp])
  const paysView      = useMemo(() => paysExpanded      ? pays      : pays.slice(0, PREVIEW_ROWS),      [pays,      paysExpanded])
  const withdrawsView = useMemo(() => withdrawsExpanded ? withdraws : withdraws.slice(0, PREVIEW_ROWS), [withdraws, withdrawsExpanded])

  const busy = paysLoading || withdrawsLoading

  const pageInfo = (resp: PagedResp<any> | null, page: number, view: any[]) =>
    t('paymentsHistory.page_info')
      .replace('{page}',  String(resp?.page ?? page))
      .replace('{shown}', String(view.length))
      .replace('{total}', String(resp?.items?.length ?? 0))

  /* ── Render ────────────────────────────────────────────────────────────── */
  return (
    <div className="section miniPage payments-history-page">

      {/* Шапка */}
      <div className="card miniPage__hero">
        <div className="card__body">
          <div className="miniPage__head">
            <div>
              <h1 className="h1">{t('paymentsHistory.title')}</h1>
              <p className="p miniPage__subtitle">{busy ? t('paymentsHistory.loading') : pageInfo(paysResp, paysPage, paysView)}</p>
            </div>
            <Link className="btn miniPage__back" to="/payments">{t('paymentsHistory.back')}</Link>
          </div>
          <div className="actions actions--2 miniPage__actions">
            <button className="btn" onClick={() => void loadAll()} disabled={busy} type="button">
              {t('paymentsHistory.refresh')}
            </button>
            <Link className="btn" to="/payments/receipts">{t('paymentsHistory.receipts')}</Link>
          </div>
          {err && <div className="pre" style={{ marginTop: 12 }}>{err}</div>}
        </div>
      </div>

      {/* Пополнения */}
      <div className="miniPage__section">
        <div className="card miniPage__panel">
          <div className="card__body">
            <h1 className="h1">{t('paymentsHistory.topups.title')}</h1>
            <p className="p miniPage__sectionText">
              {paysLoading ? t('paymentsHistory.loading') : pays.length ? pageInfo(paysResp, paysPage, paysView) : t('paymentsHistory.empty.short')}
            </p>

            <div className="list miniPage__list">
              {paysLoading ? (
                <><div className="skeleton h1" /><div className="skeleton p" /></>
              ) : paysView.length ? (
                paysView.map((x, idx) => (
                  <div className="list__item miniPage__item miniPage__item--income" key={`pay-${x?.id ?? idx}`}>
                    <div className="list__main">
                      <div className="list__title">
                        <span style={{ color: 'var(--color-ok)' }}>+ {fmtMoney(x?.money, 'RUB')}</span>
                        <span style={{ opacity: 0.4, margin: '0 6px' }}>·</span>
                        <span style={{ opacity: 0.7 }}>{fmtDate(x?.date)}</span>
                      </div>
                      <div className="list__sub">{t('paymentsHistory.topups.system')}: {x?.pay_system_id || '—'}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="list__item miniPage__item miniPage__empty">
                  <div className="list__main">
                    <div className="list__title">{t('paymentsHistory.topups.empty.title')}</div>
                    <div className="list__sub">{t('paymentsHistory.topups.empty.sub')}</div>
                  </div>
                </div>
              )}
            </div>

            <CollapseToggle shownAll={paysExpanded} total={pays.length} preview={PREVIEW_ROWS}
              disabled={paysLoading} onToggle={() => setPaysExpanded((v) => !v)} t={t} />

            <Pager
              page={paysResp?.page ?? paysPage}
              hasMore={!!paysResp?.hasMore}
              disabled={paysLoading}
              onPrev={() => {
                const next = Math.max(1, (paysResp?.page ?? paysPage) - 1)
                setPaysPage(next)
                void loadAll(next, withdrawsResp?.page ?? withdrawsPage)
              }}
              onNext={() => {
                const next = (paysResp?.page ?? paysPage) + 1
                setPaysPage(next)
                void loadAll(next, withdrawsResp?.page ?? withdrawsPage)
              }}
            />
          </div>
        </div>
      </div>

      {/* Списания */}
      <div className="miniPage__section">
        <div className="card miniPage__panel">
          <div className="card__body">
            <h1 className="h1">{t('paymentsHistory.withdrawals.title')}</h1>
            <p className="p miniPage__sectionText">
              {withdrawsLoading ? t('paymentsHistory.loading') : withdraws.length ? pageInfo(withdrawsResp, withdrawsPage, withdrawsView) : t('paymentsHistory.empty.short')}
            </p>

            <div className="list miniPage__list">
              {withdrawsLoading ? (
                <><div className="skeleton h1" /><div className="skeleton p" /></>
              ) : withdrawsView.length ? (
                withdrawsView.map((x, idx) => {
                  const wid      = x?.withdraw_id ?? idx
                  const total    = nNum(x?.total)
                  const cost     = nNum(x?.cost)
                  const discount = nNum(x?.discount)
                  const bonus    = nNum(x?.bonus)
                  const months   = x?.months != null ? Number(x.months) : null
                  const qnt      = x?.qnt != null ? Number(x.qnt) : null
                  const serviceId = x?.service_id != null ? Number(x.service_id) : null
                  const usi      = x?.user_service_id != null ? Number(x.user_service_id) : null
                  const period   = months && qnt ? `${months}м × ${qnt}` : months ? `${months}м` : qnt ? `× ${qnt}` : ''

                  const subParts = [
                    `${t('paymentsHistory.withdrawals.id')}: ${compactId(wid)}`,
                    serviceId ? `${t('paymentsHistory.withdrawals.service')}: ${serviceId}` : null,
                    usi       ? `${t('paymentsHistory.withdrawals.usi')}: ${usi}` : null,
                    period    ? `${t('paymentsHistory.withdrawals.period')}: ${period}` : null,
                    x?.end_date ? `${t('paymentsHistory.withdrawals.until')}: ${fmtDate(x.end_date)}` : null,
                  ].filter(Boolean)

                  const moneyParts = [
                    cost     ? `${t('paymentsHistory.withdrawals.cost')}: ${fmtMoney(cost, 'RUB')}` : null,
                    discount ? `${t('paymentsHistory.withdrawals.discount')}: ${fmtMoney(discount, 'RUB')}` : null,
                    bonus    ? `${t('paymentsHistory.withdrawals.bonus')}: ${fmtMoney(bonus, 'RUB')}` : null,
                  ].filter(Boolean)

                  return (
                    <div className="list__item miniPage__item miniPage__item--expense" key={`w-${wid}-${idx}`}>
                      <div className="list__main">
                        <div className="list__title">
                          <span style={{ color: 'var(--color-danger)' }}>− {fmtMoney(total, 'RUB')}</span>
                          <span style={{ opacity: 0.4, margin: '0 6px' }}>·</span>
                          <span style={{ opacity: 0.7 }}>{fmtDate(x?.withdraw_date)}</span>
                        </div>
                        <div className="list__sub">
                          {subParts.join(' · ')}
                          {moneyParts.length ? ` · ${moneyParts.join(' · ')}` : ''}
                        </div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="list__item miniPage__item miniPage__empty">
                  <div className="list__main">
                    <div className="list__title">{t('paymentsHistory.withdrawals.empty.title')}</div>
                    <div className="list__sub">{t('paymentsHistory.withdrawals.empty.sub')}</div>
                  </div>
                </div>
              )}
            </div>

            <CollapseToggle shownAll={withdrawsExpanded} total={withdraws.length} preview={PREVIEW_ROWS}
              disabled={withdrawsLoading} onToggle={() => setWithdrawsExpanded((v) => !v)} t={t} />

            <Pager
              page={withdrawsResp?.page ?? withdrawsPage}
              hasMore={!!withdrawsResp?.hasMore}
              disabled={withdrawsLoading}
              onPrev={() => {
                const next = Math.max(1, (withdrawsResp?.page ?? withdrawsPage) - 1)
                setWithdrawsPage(next)
                void loadAll(paysResp?.page ?? paysPage, next)
              }}
              onNext={() => {
                const next = (withdrawsResp?.page ?? withdrawsPage) + 1
                setWithdrawsPage(next)
                void loadAll(paysResp?.page ?? paysPage, next)
              }}
            />
          </div>
        </div>
      </div>

    </div>
  )
}

export default PaymentsHistory
