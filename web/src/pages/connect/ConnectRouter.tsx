import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../shared/api/client'
import { toast } from '../../shared/ui/toast'

type ApiRouterItem = {
  code?: string
  clean_code?: string
  status?: string
  created_at?: number
  last_seen_at?: number

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
  const arr = r.routers ?? r.items ?? r.data ?? r.list ?? r.result ?? null
  if (Array.isArray(arr)) return arr.map(normOne).filter(Boolean) as ApiRouterItem[]
  const one = r.router ?? r.binding ?? r.bound ?? r.item ?? (r.data && !Array.isArray(r.data) ? r.data : null)
  const n = normOne(one)
  return n ? [n] : []
}

function toClean8(raw: string) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)
}

function toPretty9(raw: string) {
  const c = toClean8(raw)
  if (!c) return ''
  if (c.length <= 4) return c
  return c.slice(0, 4) + '-' + c.slice(4)
}

function statusView(status?: string) {
  const s = String(status || '').trim().toLowerCase()
  if (!s) return { label: 'unknown', tone: 'muted' as const }
  if (s === 'bound' || s === 'active' || s === 'ok') return { label: s, tone: 'good' as const }
  if (s === 'unbound' || s === 'removed' || s === 'none' || s === 'new') return { label: s, tone: 'muted' as const }
  if (s === 'error' || s === 'fail' || s === 'failed') return { label: s, tone: 'bad' as const }
  return { label: s, tone: 'muted' as const }
}

export default function ConnectRouter({ usi, onDone }: Props) {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [routers, setRouters] = useState<ApiRouterItem[]>([])
  const [code, setCode] = useState('')

  const first = routers?.[0]
  const shownClean = String(first?.clean_code || first?.cleanCode || '').trim()
  const shownCode = String(first?.code || first?.router_code || '').trim()

  const shownPretty = useMemo(() => {
    const base = shownClean || shownCode
    return base ? toPretty9(base) : ''
  }, [shownClean, shownCode])

  const st = useMemo(() => statusView(first?.status), [first?.status])

  const hasBound = useMemo(() => {
    if (!first) return false
    const normalized = String(first.status || '').toLowerCase()
    if (normalized === 'bound' || normalized === 'active' || normalized === 'ok') return true
    if (normalized === 'unbound' || normalized === 'removed' || normalized === 'none' || normalized === 'new') return false
    return !!(shownClean || shownCode)
  }, [first, shownClean, shownCode])

  async function load(opts?: { silent?: boolean }) {
    const silent = !!opts?.silent
    setLoading(true)
    setError(null)

    try {
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/router`, {
        method: 'GET',
      })) as any

      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) {
        throw new Error(String(r.error || r.message))
      }

      setRouters(extractRouters(r))

      if (!silent) {
        toast.info('Статус обновлён', {
          description: 'Состояние роутера обновлено.',
        })
      }
    } catch (e: any) {
      const msg = e?.message || 'Не удалось загрузить состояние роутера'
      setError(msg)
      setRouters([])

      if (!silent) {
        toast.error('Не удалось обновить статус', {
          description: msg,
        })
      }
    } finally {
      setLoading(false)
    }
  }

  async function bind() {
    const clean = toClean8(code)

    if (!clean) return
    if (clean.length !== 8) {
      const msg = 'Код должен быть в формате XXXX-XXXX: только латинские буквы и цифры.'
      setError(msg)
      toast.error('Неверный код', { description: msg })
      return
    }

    setBusy(true)
    setError(null)

    toast.info('Привязываем роутер', {
      description: 'Это займёт пару секунд.',
    })

    try {
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/router/bind`, {
        method: 'POST',
        body: { code: clean },
      } as any)) as any

      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) {
        throw new Error(String(r.error || r.message))
      }

      setCode('')
      await load({ silent: true })
      onDone?.()

      toast.success('Роутер привязан', {
        description: 'Теперь он подключён к этой услуге.',
      })
    } catch (e: any) {
      const msg = e?.message || 'Не удалось привязать роутер'
      setError(msg)
      toast.error('Не удалось привязать роутер', { description: msg })
    } finally {
      setBusy(false)
    }
  }

  async function unbind() {
    const v = String(first?.clean_code || first?.cleanCode || first?.code || first?.router_code || '').trim()
    const clean = toClean8(v)
    if (!clean) return

    setBusy(true)
    setError(null)

    toast.info('Отвязываем роутер', {
      description: 'Это займёт пару секунд.',
    })

    try {
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/router/unbind`, {
        method: 'POST',
        body: { code: clean },
      } as any)) as any

      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) {
        throw new Error(String(r.error || r.message))
      }

      await load({ silent: true })
      onDone?.()

      toast.success('Роутер отвязан', {
        description: 'Теперь можно привязать другой роутер.',
      })
    } catch (e: any) {
      const msg = e?.message || 'Не удалось отвязать роутер'
      setError(msg)
      toast.error('Не удалось отвязать роутер', { description: msg })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    load({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usi])

  const inputValue = toPretty9(code)
  const cleanLen = toClean8(code).length
  const canBind = !busy && !hasBound && cleanLen === 8

  const statusToneClass =
    st.tone === 'good' ? 'cr__badge--good' : st.tone === 'bad' ? 'cr__badge--bad' : 'cr__badge--muted'

  const primaryButtonText = busy
    ? 'Подождите…'
    : hasBound
      ? 'Отвязать роутер'
      : 'Привязать роутер'

  return (
    <div className="cm cr">
      <div className="pre">
        Введите код с экрана роутера, чтобы привязать устройство к этой услуге.
      </div>

      {loading ? (
        <div className="section">
          <div className="p">Загрузка состояния…</div>
        </div>
      ) : null}

      {error ? (
        <div className="pre cr__mt10">
          {error}
        </div>
      ) : null}

      {!loading ? (
        <div className="card section">
          <div className="card__body">
            <div className="section">
              <div className="pre cr__state">
                <div className="cr__stateMain">
                  {hasBound ? (
                    <>
                      <div>
                        ✅ Роутер привязан: <b>{shownPretty || '—'}</b>
                      </div>

                      {first?.created_at ? (
                        <div className="cr__meta cr__mt6">
                          Привязан: <b>{fmtTs(first.created_at)}</b>
                        </div>
                      ) : null}

                      {first?.last_seen_at ? (
                        <div className="cr__meta">
                          Последний контакт: <b>{fmtTs(first.last_seen_at)}</b>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div>Роутер ещё не привязан.</div>
                  )}
                </div>

                {first ? (
                  <span className={`cr__badge ${statusToneClass}`} title="Статус привязки">
                    <span className="cr__badgeK">status</span>
                    <b className="cr__badgeV">{st.label}</b>
                  </span>
                ) : null}
              </div>
            </div>

            {!hasBound ? (
              <div className="section">
                <input
                  value={inputValue}
                  onChange={(e) => {
                    setError(null)
                    setCode(e.target.value)
                  }}
                  onBlur={() => setCode((cur) => toPretty9(cur))}
                  placeholder="Например: N8JD-6TQ4"
                  className="input cr__input"
                  disabled={busy}
                  inputMode="text"
                  lang="en"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="off"
                  pattern="[A-Za-z0-9-]*"
                />
              </div>
            ) : null}

            <div className="section">
              <div className="actions actions--2">
                {!hasBound ? (
                  <button className="btn btn--primary so__btnFull" onClick={bind} disabled={!canBind} type="button">
                    {primaryButtonText}
                  </button>
                ) : (
                  <button className="btn btn--danger so__btnFull" onClick={unbind} disabled={busy} type="button">
                    {primaryButtonText}
                  </button>
                )}

                <button
                  className="btn so__btnFull"
                  onClick={() => load({ silent: false })}
                  disabled={busy}
                  type="button"
                >
                  Обновить
                </button>
              </div>
            </div>

            <div className="section">
              <div className="pre">
                {hasBound ? (
                  <>Один роутер может быть привязан к услуге одновременно.</>
                ) : (
                  <>
                    Формат кода: <b>XXXX-XXXX</b> (только латинские буквы и цифры).
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}