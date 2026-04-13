// web/src/pages/PaymentsReceipts.tsx

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../shared/api/client'
import { useI18n } from '../shared/i18n'

/* ─── Utils ─────────────────────────────────────────────────────────────── */

function fmtDate(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
}

function fmtMoney(n: number, cur = 'RUB') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Number(n || 0))
  } catch { return `${Number(n || 0)} ${cur}`; }
}

function pickArray(obj: any, keys: string[]): any[] {
  for (const k of keys) { const v = obj?.[k]; if (Array.isArray(v)) return v; }
  return []
}

function pickStr(obj: any, keys: string[], def = '') {
  for (const k of keys) { const v = obj?.[k]; if (typeof v === 'string' && v.trim()) return v; }
  return def
}

function pickNum(obj: any, keys: string[], def = 0) {
  for (const k of keys) { const v = obj?.[k]; const n = Number(v); if (Number.isFinite(n)) return n; }
  return def
}

function normalizeStatus(raw: string, t: (k: string) => string) {
  const s = String(raw || '').trim().toLowerCase()
  if (!s) return ''
  if (['pending', 'processing', 'review'].includes(s))             return t('paymentsReceipts.status.review')
  if (['sent', 'uploaded', 'submitted'].includes(s))               return t('paymentsReceipts.status.sent')
  if (['ok', 'done', 'approved', 'accepted', 'success'].includes(s)) return t('paymentsReceipts.status.accepted')
  if (['error', 'failed', 'rejected', 'declined'].includes(s))    return t('paymentsReceipts.status.error')
  return raw
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export function PaymentsReceipts() {
  const { t } = useI18n()

  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState<string | null>(null)
  const [raw,     setRaw]     = useState<any>(null)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const r = await apiFetch<any>('/payments/receipts', { method: 'GET' })
      setRaw(r ?? null)
    } catch (e: any) {
      setRaw(null)
      setErr(e?.message || t('paymentsReceipts.error.load_failed'))
    } finally { setLoading(false) }
  }

  useEffect(() => { void load(); }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const items = [
    ...pickArray(raw, ['items', 'receipts']),
    ...pickArray(raw?.data ?? {}, ['items', 'receipts']),
  ]

  /* ── Render ────────────────────────────────────────────────────────────── */
  return (
    <div className="section">

      {/* Шапка */}
      <div className="card">
        <div className="card__body">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1 className="h1">{t('paymentsReceipts.title')}</h1>
              <p className="p" style={{ marginTop: 4 }}>{t('paymentsReceipts.subtitle')}</p>
            </div>
            <Link className="btn" to="/payments">{t('paymentsReceipts.back')}</Link>
          </div>

          <div className="actions actions--2" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => void load()} disabled={loading} type="button">
              {t('paymentsReceipts.refresh')}
            </button>
            <Link className="btn" to="/payments/history">{t('paymentsReceipts.history')}</Link>
          </div>

          {err && <div className="pre" style={{ marginTop: 12 }}>{err}</div>}
        </div>
      </div>

      {/* Список */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <p className="p">
              {loading
                ? t('paymentsReceipts.loading')
                : items.length
                  ? t('paymentsReceipts.total').replace('{count}', String(items.length))
                  : t('paymentsReceipts.empty.short')}
            </p>

            <div className="list" style={{ marginTop: 10 }}>
              {loading ? (
                <><div className="skeleton h1" /><div className="skeleton p" /></>
              ) : items.length ? (
                items.map((x: any, idx: number) => {
                  const amount    = pickNum(x, ['amount', 'sum', 'value'])
                  const created   = pickStr(x, ['createdAt', 'created_at', 'date', 'ts'])
                  const fileName  = pickStr(x, ['fileName', 'filename', 'name', 'file'])
                  const statusRaw = pickStr(x, ['tgStatus', 'status', 'state'])
                  const status    = normalizeStatus(statusRaw, t)
                  const error     = pickStr(x, ['tgError', 'error'])

                  const title = (amount ? fmtMoney(amount, 'RUB') : t('paymentsReceipts.item.fallback'))
                    + (fileName ? ` · ${fileName}` : '')

                  const subParts = [
                    created ? `${t('paymentsReceipts.item.date')}: ${fmtDate(created)}` : null,
                    status  ? `${t('paymentsReceipts.item.status')}: ${status}` : null,
                    error   ? `${t('paymentsReceipts.item.error')}: ${error}` : null,
                  ].filter(Boolean)

                  return (
                    <div className="list__item" key={`r-${idx}`}>
                      <div className="list__main">
                        <div className="list__title">{title}</div>
                        <div className="list__sub">{subParts.length ? subParts.join(' · ') : '—'}</div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">{t('paymentsReceipts.empty.title')}</div>
                    <div className="list__sub">{t('paymentsReceipts.empty.sub')}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

export default PaymentsReceipts