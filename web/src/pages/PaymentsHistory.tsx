import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../shared/api/client'

type ActivityResp = any

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

export function PaymentsHistory() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [raw, setRaw] = useState<ActivityResp | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const r = await apiFetch<ActivityResp>('/activity', { method: 'GET' })
      setRaw(r ?? null)
    } catch (e: any) {
      setRaw(null)
      setErr(e?.message || 'Failed to load activity')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const { pays, withdraws } = useMemo(() => {
    const root = raw ?? {}
    const paysArr = pickArray(root, ['pays', 'pay', 'payments', 'items'])
      .concat(pickArray(root?.data ?? {}, ['pays', 'pay', 'payments']))
    const wArr = pickArray(root, ['withdraws', 'withdraw', 'withdrawals'])
      .concat(pickArray(root?.data ?? {}, ['withdraws', 'withdraw', 'withdrawals']))
    return { pays: paysArr, withdraws: wArr }
  }, [raw])

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div className="home-block-head">
            <div>
              <div className="h1">🧾 История операций</div>
              <div className="p" style={{ marginTop: 6 }}>
                Пополнения и списания по аккаунту
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
            <Link className="btn" to="/payments/receipts">
              Квитанции
            </Link>
          </div>

          {err ? (
            <div className="pre" style={{ marginTop: 12 }}>
              Ошибка: {String(err)}
            </div>
          ) : null}
        </div>
      </div>

      {/* Pays */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>
              Пополнения
            </div>
            <div className="p" style={{ marginTop: 6 }}>
              {loading ? 'Загрузка…' : pays?.length ? `Записей: ${pays.length}` : 'Пока нет операций'}
            </div>

            <div className="list" style={{ marginTop: 10 }}>
              {loading ? (
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">Загружаем…</div>
                    <div className="list__sub">Подождите</div>
                  </div>
                </div>
              ) : pays?.length ? (
                pays.map((x: any, idx: number) => {
                  const dt = pickStr(x, ['created_at', 'createdAt', 'date', 'ts'])
                  const status = pickStr(x, ['status', 'state'], '')
                  const amount = pickNum(x, ['amount', 'sum', 'value'], 0)
                  const title =
                    pickStr(x, ['title', 'name', 'type'], 'Пополнение') +
                    (amount ? ` · ${fmtMoney(amount, 'RUB')}` : '')
                  const subParts = [
                    dt ? `Дата: ${fmtDate(dt)}` : null,
                    status ? `Статус: ${status}` : null,
                  ].filter(Boolean)
                  return (
                    <div className="list__item" key={`pay-${idx}`}>
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
                    <div className="list__title">Нет пополнений</div>
                    <div className="list__sub">Сделайте оплату — и она появится здесь</div>
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

      {/* Withdraws */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>
              Списания
            </div>
            <div className="p" style={{ marginTop: 6 }}>
              {loading ? 'Загрузка…' : withdraws?.length ? `Записей: ${withdraws.length}` : 'Пока нет операций'}
            </div>

            <div className="list" style={{ marginTop: 10 }}>
              {loading ? (
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">Загружаем…</div>
                    <div className="list__sub">Подождите</div>
                  </div>
                </div>
              ) : withdraws?.length ? (
                withdraws.map((x: any, idx: number) => {
                  const dt = pickStr(x, ['created_at', 'createdAt', 'date', 'ts'])
                  const status = pickStr(x, ['status', 'state'], '')
                  const amount = pickNum(x, ['amount', 'sum', 'value'], 0)
                  const title =
                    pickStr(x, ['title', 'name', 'type'], 'Списание') +
                    (amount ? ` · ${fmtMoney(amount, 'RUB')}` : '')
                  const subParts = [
                    dt ? `Дата: ${fmtDate(dt)}` : null,
                    status ? `Статус: ${status}` : null,
                  ].filter(Boolean)
                  return (
                    <div className="list__item" key={`w-${idx}`}>
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
                    <div className="list__title">Нет списаний</div>
                    <div className="list__sub">Когда будут списания — они появятся здесь</div>
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

export default PaymentsHistory