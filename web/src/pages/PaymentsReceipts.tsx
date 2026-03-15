import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../shared/api/client'
import { useI18n } from '../shared/i18n'

type ReceiptsResp = any

function fmtDate(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

function fmtMoney(n: number, cur = 'RUB') {
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

function pickArray(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k]
    if (Array.isArray(v)) return v
  }
  return []
}

function pickStr(obj: any, keys: string[], def = '') {
  for (const k of keys) {
    const v = obj?.[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return def
}

function pickNum(obj: any, keys: string[], def = 0) {
  for (const k of keys) {
    const v = obj?.[k]
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return def
}

function normalizeReceiptStatus(rawStatus: string, t: (key: string, fallback?: string) => string) {
  const s = String(rawStatus || '').trim().toLowerCase()

  if (!s) return ''
  if (s === 'pending' || s === 'processing' || s === 'review') {
    return t('paymentsReceipts.status.review', 'На проверке')
  }
  if (s === 'sent' || s === 'uploaded' || s === 'submitted') {
    return t('paymentsReceipts.status.sent', 'Отправлено')
  }
  if (s === 'ok' || s === 'done' || s === 'approved' || s === 'accepted' || s === 'success') {
    return t('paymentsReceipts.status.accepted', 'Принято')
  }
  if (s === 'error' || s === 'failed' || s === 'rejected' || s === 'declined') {
    return t('paymentsReceipts.status.error', 'Есть проблема')
  }

  return rawStatus
}

export function PaymentsReceipts() {
  const { t } = useI18n()

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [raw, setRaw] = useState<ReceiptsResp | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const r = await apiFetch<ReceiptsResp>('/payments/receipts', { method: 'GET' })
      setRaw(r ?? null)
    } catch (e: any) {
      setRaw(null)
      setErr(e?.message || t('paymentsReceipts.error.load_failed', 'Не удалось загрузить квитанции.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const items =
    pickArray(raw, ['items', 'receipts']).concat(pickArray(raw?.data ?? {}, ['items', 'receipts'])) ?? []

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div className="home-block-head">
            <div>
              <div className="h1">{t('paymentsReceipts.title', '🧾 Отправленные квитанции')}</div>
              <div className="p paymentsReceipts__mt6">
                {t('paymentsReceipts.subtitle', 'Здесь сохраняются квитанции, которые вы отправили на проверку.')}
              </div>
            </div>
            <Link className="btn" to="/payments">
              {t('paymentsReceipts.back', 'Назад')}
            </Link>
          </div>

          <div className="actions actions--2 paymentsReceipts__mt12">
            <button className="btn" onClick={load} disabled={loading}>
              {t('paymentsReceipts.refresh', '⟳ Обновить')}
            </button>
            <Link className="btn" to="/payments/history">
              {t('paymentsReceipts.history', 'История операций')}
            </Link>
          </div>

          {err ? (
            <div className="pre paymentsReceipts__mt12">
              {t('paymentsReceipts.error.prefix', 'Ошибка')}: {String(err)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="p paymentsReceipts__mt0">
              {loading
                ? t('paymentsReceipts.loading', 'Загрузка…')
                : items?.length
                  ? t('paymentsReceipts.total', 'Всего: {count}').replace('{count}', String(items.length))
                  : t('paymentsReceipts.empty.short', 'Пока квитанций нет')}
            </div>

            <div className="list paymentsReceipts__mt10">
              {loading ? (
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">{t('paymentsReceipts.loading_items', 'Загружаем…')}</div>
                    <div className="list__sub">{t('paymentsReceipts.loading_wait', 'Подождите немного')}</div>
                  </div>
                </div>
              ) : items.length ? (
                items.map((x: any, idx: number) => {
                  const amount = pickNum(x, ['amount', 'sum', 'value'], 0)
                  const created = pickStr(x, ['createdAt', 'created_at', 'date', 'ts'], '')
                  const fileName = pickStr(x, ['fileName', 'filename', 'name', 'file'], '')
                  const statusRaw = pickStr(x, ['tgStatus', 'status', 'state'], '')
                  const status = normalizeReceiptStatus(statusRaw, t)
                  const error = pickStr(x, ['tgError', 'error'], '')

                  const title =
                    (amount ? fmtMoney(amount, 'RUB') : t('paymentsReceipts.item.fallback', 'Квитанция')) +
                    (fileName ? ` · ${fileName}` : '')

                  const subParts = [
                    created ? `${t('paymentsReceipts.item.date', 'Дата')}: ${fmtDate(created)}` : null,
                    status ? `${t('paymentsReceipts.item.status', 'Статус')}: ${status}` : null,
                    error ? `${t('paymentsReceipts.item.error', 'Комментарий')}: ${error}` : null,
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
                    <div className="list__title">
                      {t('paymentsReceipts.empty.title', 'Вы ещё не отправляли квитанции')}
                    </div>
                    <div className="list__sub">
                      {t(
                        'paymentsReceipts.empty.sub',
                        'Когда вы отправите квитанцию после перевода, она появится здесь.',
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {(import.meta as any)?.env?.DEV && raw ? (
              <div className="pre paymentsReceipts__mt12">
                <b>{t('paymentsReceipts.dev.raw', 'Raw (dev only):')}</b>
                <div className="paymentsReceipts__sp8" />
                {JSON.stringify(raw, null, 2)}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export default PaymentsReceipts