import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../shared/api/client'

// ✅ toasts + mood (типизированные ключи — только из payments-mood)
import { toast } from '../../shared/ui/toast'
import { getMood } from '../../shared/payments-mood'

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
    // если статус непонятный, но код есть — считаем, что привязан (чтобы не скрывать существующую связку)
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

      // ✅ не спамим тостом на mount
      if (!silent) {
        toast.info('Обновлено', {
          description: getMood('payment_checking', { seed: String(usi) }) ?? 'Статус роутера обновлён.',
        })
      }
    } catch (e: any) {
      const msg = e?.message || 'Не удалось загрузить состояние роутера'
      setError(msg)
      setRouters([])

      if (!silent) {
        toast.error('Не удалось обновить', { description: msg })
      }
    } finally {
      setLoading(false)
    }
  }

  async function bind() {
    const pretty = toPretty9(code)
    const clean = toClean8(code)

    if (!clean) return
    if (clean.length !== 8) {
      const msg = 'Код должен быть в формате XXXX-XXXX (латинские буквы и цифры).'
      setError(msg)
      toast.error('Неверный код', { description: msg })
      return
    }

    setBusy(true)
    setError(null)

    toast.info('Привязываем роутер', {
      description: getMood('payment_checking', { seed: String(usi) }) ?? 'Пара секунд…',
    })

    try {
      const r = (await apiFetch(
        `/services/${encodeURIComponent(String(usi))}/router/bind`,
        {
          method: 'POST',
          body: { code: pretty },
        } as any
      )) as any

      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) {
        throw new Error(String(r.error || r.message))
      }

      setCode('')
      await load({ silent: true })
      onDone?.()

      toast.success('Роутер привязан', {
        description: getMood('payment_success', { seed: String(usi) }) ?? 'Готово.',
      })
    } catch (e: any) {
      const msg = e?.message || 'Не удалось привязать роутер'
      setError(msg)
      toast.error('Не удалось привязать', { description: msg })
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
      description: getMood('payment_checking', { seed: String(usi) }) ?? 'Пара секунд…',
    })

    try {
      const r = (await apiFetch(
        `/services/${encodeURIComponent(String(usi))}/router/unbind`,
        {
          method: 'POST',
          body: { code: clean },
        } as any
      )) as any

      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) {
        throw new Error(String(r.error || r.message))
      }

      await load({ silent: true })
      onDone?.()

      toast.success('Роутер отвязан', {
        description: getMood('payment_success', { seed: String(usi) }) ?? 'Готово.',
      })
    } catch (e: any) {
      const msg = e?.message || 'Не удалось отвязать роутер'
      setError(msg)
      toast.error('Не удалось отвязать', { description: msg })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    // ✅ первичная загрузка без тостов
    load({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usi])

  const inputValue = toPretty9(code)
  const cleanLen = toClean8(code).length
  const canBind = !busy && !hasBound && cleanLen === 8

  const statusToneClass =
    st.tone === 'good' ? 'cr__badge--good' : st.tone === 'bad' ? 'cr__badge--bad' : 'cr__badge--muted'

  const actionsCols = 'cr__actionsGrid--2'

  return (
    <div className="cr">
      <div className="p cr__hintTop">Введите код с экрана роутера, чтобы привязать устройство к этой услуге.</div>

      {loading ? <div className="p">Загрузка состояния…</div> : null}

      {error ? <div className="pre cr__mt10">{error}</div> : null}

      {!loading ? (
        <div className="pre cr__mt10 cr__state">
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
      ) : null}

      {!hasBound ? (
        <div className="cr__form">
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

      <div className={`cr__actionsGrid ${actionsCols} cr__mt12`}>
        {!hasBound ? (
          <button className="btn btn--primary cr__btnFull" onClick={bind} disabled={!canBind}>
            {busy ? 'Подождите…' : 'Привязать роутер'}
          </button>
        ) : (
          <button className="btn btn--danger cr__btnFull" onClick={unbind} disabled={busy}>
            {busy ? 'Подождите…' : 'Отвязать роутер'}
          </button>
        )}

        <button className="btn cr__btnFull" onClick={() => load({ silent: false })} disabled={busy}>
          Обновить
        </button>
      </div>

      {hasBound ? (
        <div className="cr__note cr__mt10">Один роутер может быть привязан к услуге одновременно.</div>
      ) : (
        <div className="cr__note cr__mt10">
          Формат кода: <b>XXXX-XXXX</b> (только латинские буквы и цифры).
        </div>
      )}
    </div>
  )
}