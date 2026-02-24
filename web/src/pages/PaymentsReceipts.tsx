import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../shared/api/client'

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

export function PaymentsReceipts() {
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
      setErr(e?.message || 'Failed to load receipts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const items =
    pickArray(raw, ['items', 'receipts']).concat(pickArray(raw?.data ?? {}, ['items', 'receipts'])) ?? []

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div className="home-block-head">
            <div>
              <div className="h1">🧾 Квитанции</div>
              <div className="p" style={{ marginTop: 6 }}>
                Отправленные квитанции (локальная история)
              </div>
            </div>
            <Link className="btn" to="/payments">
              Назад
            </Link>
          </div>

          <div className="actions actions--2" style={{ marginTop: 12 }}>
            <button className="btn" onClick={load} disabled={loading}>
              ⟳ Обновить
            </button>
            <Link className="btn" to="/payments/history">
              История операций
            </Link>
          </div>

          {err ? (
            <div className="pre" style={{ marginTop: 12 }}>
              Ошибка: {String(err)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="p" style={{ marginTop: 0 }}>
              {loading ? 'Загрузка…' : items?.length ? `Всего: ${items.length}` : 'Пока квитанций нет'}
            </div>

            <div className="list" style={{ marginTop: 10 }}>
              {loading ? (
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">Загружаем…</div>
                    <div className="list__sub">Подождите</div>
                  </div>
                </div>
              ) : items.length ? (
                items.map((x: any, idx: number) => {
                  const amount = pickNum(x, ['amount', 'sum', 'value'], 0)
                  const created = pickStr(x, ['createdAt', 'created_at', 'date', 'ts'], '')
                  const fileName = pickStr(x, ['fileName', 'filename', 'name', 'file'], '')
                  const status = pickStr(x, ['tgStatus', 'status', 'state'], '')
                  const error = pickStr(x, ['tgError', 'error'], '')

                  const title =
                    (amount ? fmtMoney(amount, 'RUB') : 'Квитанция') + (fileName ? ` · ${fileName}` : '')
                  const subParts = [
                    created ? `Дата: ${fmtDate(created)}` : null,
                    status ? `Статус: ${status}` : null,
                    error ? `Ошибка: ${error}` : null,
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
                    <div className="list__title">Квитанций пока нет</div>
                    <div className="list__sub">Сделайте перевод на карту и загрузите квитанцию</div>
                  </div>
                </div>
              )}
            </div>

            {(import.meta as any)?.env?.DEV && raw ? (
              <div className="pre" style={{ marginTop: 12 }}>
                <b>Raw (dev only):</b>
                <div style={{ height: 8 }} />
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