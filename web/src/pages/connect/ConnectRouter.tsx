import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../shared/api/client'

type ApiRouterItem = {
  code?: string
  clean_code?: string
  status?: string
  created_at?: number
  last_seen_at?: number

  // допускаем другие варианты полей (на всякий)
  cleanCode?: string
  createdAt?: number
  lastSeenAt?: number
  router_code?: string
}

type Props = {
  usi: number
  service: { title: string; status: string; statusRaw: string }
  onDone?: () => void
}

function fmtTs(ts?: number) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString()
}

function normOne(x: any): ApiRouterItem | null {
  if (!x || typeof x !== 'object') return null
  return {
    code: x.code ?? x.router_code ?? x.routerCode ?? undefined,
    clean_code: x.clean_code ?? x.cleanCode ?? undefined,
    status: x.status ?? x.state ?? undefined,
    created_at: x.created_at ?? x.createdAt ?? undefined,
    last_seen_at: x.last_seen_at ?? x.lastSeenAt ?? undefined,
  }
}

function extractRouters(resp: any): ApiRouterItem[] {
  const r = resp ?? {}

  // самые частые варианты
  const arr =
    r.routers ??
    r.items ??
    r.data ??
    r.list ??
    r.result ??
    null

  if (Array.isArray(arr)) {
    return arr.map(normOne).filter(Boolean) as ApiRouterItem[]
  }

  // иногда приходит один объект
  const one =
    r.router ??
    r.binding ??
    r.bound ??
    r.item ??
    (r.data && !Array.isArray(r.data) ? r.data : null)

  const n = normOne(one)
  return n ? [n] : []
}

export default function ConnectRouter({ usi, onDone }: Props) {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [routers, setRouters] = useState<ApiRouterItem[]>([])
  const [code, setCode] = useState('')

  const first = routers?.[0]
  const shownCode = String(first?.clean_code || first?.code || '').trim()
  const shownStatus = String(first?.status || '').trim()

  const hasBound = useMemo(() => {
    if (!first) return false
    const st = String(first.status || '').toLowerCase()
    // bound/active/ok считаем привязанным
    if (st === 'bound' || st === 'active' || st === 'ok') return true
    // явные не-привязанные
    if (st === 'unbound' || st === 'removed' || st === 'none' || st === 'new') return false
    // если статус пустой, но есть код — скорее всего привязан
    if (!st && shownCode) return true
    // прочее — считаем привязанным, чтобы не скрывать существующую связку
    return !!shownCode
  }, [first, shownCode])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/router`, {
        method: 'GET',
      })) as any

      // если бэк отдаёт ok:false/0 — покажем ошибку
      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) {
        throw new Error(String(r.error || r.message))
      }

      const list = extractRouters(r)
      setRouters(list)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить состояние роутера')
      setRouters([])
    } finally {
      setLoading(false)
    }
  }

  async function bind() {
    const v = String(code || '').trim()
    if (!v) return
    setBusy(true)
    setError(null)
    try {
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/router/bind`, {
        method: 'POST',
        body: { code: v },
      } as any)) as any

      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) {
        throw new Error(String(r.error || r.message))
      }

      setCode('')
      await load()
      onDone?.()
    } catch (e: any) {
      setError(e?.message || 'Не удалось привязать роутер')
    } finally {
      setBusy(false)
    }
  }

  async function unbind() {
    const v = String(first?.clean_code || first?.code || '').trim()
    if (!v) return
    setBusy(true)
    setError(null)
    try {
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/router/unbind`, {
        method: 'POST',
        body: { code: v },
      } as any)) as any

      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) {
        throw new Error(String(r.error || r.message))
      }

      await load()
      onDone?.()
    } catch (e: any) {
      setError(e?.message || 'Не удалось отвязать роутер')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usi])

  return (
    <div>
      <div className="p" style={{ marginTop: 0 }}>
        Введите код с экрана роутера, чтобы привязать устройство к этой услуге.
      </div>

      {loading ? <div className="p">Загрузка состояния…</div> : null}

      {error ? (
        <div className="pre" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}

      {!loading ? (
        <div className="pre" style={{ marginTop: 10 }}>
          {first ? (
            <>
              <div>
                Привязан роутер: <b>{shownCode || '—'}</b>
              </div>
              <div>
                Статус: <b>{shownStatus || 'unknown'}</b>
              </div>
              {first.created_at ? (
                <div>
                  Привязан: <b>{fmtTs(first.created_at)}</b>
                </div>
              ) : null}
              {first.last_seen_at ? (
                <div>
                  Последний контакт: <b>{fmtTs(first.last_seen_at)}</b>
                </div>
              ) : null}
            </>
          ) : (
            <>Роутер ещё не привязан.</>
          )}
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 12, gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Код с экрана роутера"
          className="input"
          style={{ minWidth: 240 }}
          disabled={busy || hasBound}
        />
        <button className="btn btn--primary" onClick={bind} disabled={busy || hasBound || !String(code).trim()}>
          {busy ? 'Подождите…' : 'Привязать роутер'}
        </button>

        {first ? (
          <button className="btn" onClick={unbind} disabled={busy || !hasBound}>
            Отвязать
          </button>
        ) : null}

        <button className="btn" onClick={load} disabled={busy}>
          Обновить
        </button>
      </div>

      {hasBound ? (
        <div style={{ marginTop: 10, opacity: 0.82, fontSize: 12 }}>
          Один роутер может быть привязан к услуге одновременно.
        </div>
      ) : null}
    </div>
  )
}