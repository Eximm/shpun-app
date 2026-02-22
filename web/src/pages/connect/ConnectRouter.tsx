import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../shared/api/client'

type ApiRouterItem = {
  code?: string
  clean_code?: string
  status?: string
  created_at?: number
  last_seen_at?: number
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

export default function ConnectRouter({ usi, onDone }: Props) {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [routers, setRouters] = useState<ApiRouterItem[]>([])
  const [code, setCode] = useState('')

  const hasBound = useMemo(() => {
    const r = routers?.[0]
    if (!r) return false
    const st = String(r.status || '').toLowerCase()
    return st !== 'unbound' && st !== 'removed' && st !== 'none'
  }, [routers])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/router`, {
        method: 'GET',
      })) as any
      setRouters(Array.isArray(r?.routers) ? r.routers : [])
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить состояние роутера')
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
      await apiFetch(`/services/${encodeURIComponent(String(usi))}/router/bind`, {
        method: 'POST',
        body: { code: v },
      } as any)
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
    const current = routers?.[0]
    const v = String(current?.clean_code || current?.code || '').trim()
    if (!v) return
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/services/${encodeURIComponent(String(usi))}/router/unbind`, {
        method: 'POST',
        body: { code: v },
      } as any)
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
          {routers?.length ? (
            <>
              <div>
                Привязан роутер: <b>{routers[0]?.clean_code || routers[0]?.code || '—'}</b>
              </div>
              <div>
                Статус: <b>{String(routers[0]?.status || 'unknown')}</b>
              </div>
              {routers[0]?.created_at ? (
                <div>
                  Привязан: <b>{fmtTs(routers[0]?.created_at)}</b>
                </div>
              ) : null}
              {routers[0]?.last_seen_at ? (
                <div>
                  Последний контакт: <b>{fmtTs(routers[0]?.last_seen_at)}</b>
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

        {routers?.length ? (
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