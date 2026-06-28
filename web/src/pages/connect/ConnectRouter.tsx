// FILE: web/src/pages/connect/ConnectRouter.tsx

import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../shared/api/client'
import { getMood } from '../../shared/payments-mood'
import { toast } from '../../shared/ui/toast'
import { useI18n } from '../../shared/i18n'

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

function fmtTs(ts?: number): string {
  if (!ts || ts <= 0) return ''
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
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

function toPretty9(raw: string) {
  const c = toClean8(raw)
  if (!c) return ''
  if (c.length <= 4) return c
  return c.slice(0, 4) + '-' + c.slice(4)
}

function errMessage(e: any, fallback: string) {
  return String(e?.message || fallback || '').trim() || fallback
}

const S = {
  divider: { height: '0.5px', background: 'rgba(255,255,255,0.07)', margin: '10px 0' } as React.CSSProperties,
  info: {
    padding: '10px 11px',
    borderRadius: 10,
    border: '0.5px solid rgba(77,215,255,0.18)',
    background: 'rgba(77,215,255,0.06)',
    marginBottom: 10,
  } as React.CSSProperties,
  infoTitle: { fontSize: 12, fontWeight: 850, color: 'rgba(255,255,255,0.88)', marginBottom: 4 } as React.CSSProperties,
  infoText: { fontSize: 12, lineHeight: 1.45, color: 'rgba(255,255,255,0.62)' } as React.CSSProperties,
  btnSec: {
    padding: '8px 12px',
    borderRadius: 9,
    fontSize: 12,
    fontWeight: 700,
    background: 'rgba(255,255,255,0.07)',
    border: '0.5px solid rgba(255,255,255,0.13)',
    color: 'rgba(255,255,255,0.75)',
    cursor: 'pointer',
    width: '100%',
  } as React.CSSProperties,
  btnDanger: {
    padding: '8px 12px',
    borderRadius: 9,
    fontSize: 12,
    fontWeight: 700,
    background: 'rgba(255,77,109,0.10)',
    border: '0.5px solid rgba(255,77,109,0.25)',
    color: '#ff4d6d',
    cursor: 'pointer',
    width: '100%',
  } as React.CSSProperties,
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 } as React.CSSProperties,
}

export default function ConnectRouter({ usi, onDone }: Props) {
  const { t } = useI18n()
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
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/router`, { method: 'GET' })) as any
      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) throw new Error(String(r.error || r.message))
      setRouters(extractRouters(r))
      if (!silent) {
        toast.success(t('router.toast.refreshed.title'), {
          description: getMood('service_status_updated') ?? t('router.toast.refreshed.desc'),
        })
      }
    } catch (e: any) {
      const msg = errMessage(e, t('router.load_error'))
      setError(msg)
      setRouters([])
      if (!silent) toast.error(t('router.status_error'), { description: msg })
    } finally {
      setLoading(false)
    }
  }

  async function bind() {
    const clean = toClean8(code)
    if (!clean) return
    if (clean.length !== 8) {
      const msg = t('router.code_invalid_desc')
      setError(msg)
      toast.error(t('router.code_invalid'), { description: msg })
      return
    }

    setBusy(true)
    setError(null)
    try {
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/router/bind`, {
        method: 'POST',
        body: { code: clean },
      })) as any
      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) throw new Error(String(r.error || r.message))
      setCode('')
      await load({ silent: true })
      onDone?.()
      toast.success(getMood('router_bound') ?? t('router.toast.bound.title'), {
        description: `${t('router.toast.code')}: ${toPretty9(clean)}`,
      })
    } catch (e: any) {
      const msg = errMessage(e, t('router.bind_error'))
      setError(msg)
      toast.error(t('router.bind_error'), { description: msg })
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
    try {
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/router/unbind`, {
        method: 'POST',
        body: { code: clean },
      })) as any
      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) throw new Error(String(r.error || r.message))
      await load({ silent: true })
      onDone?.()
      toast.success(getMood('router_unbound') ?? t('router.toast.unbound.title'), {
        description: t('router.toast.unbound.desc'),
      })
    } catch (e: any) {
      const msg = errMessage(e, t('router.unbind_error'))
      setError(msg)
      toast.error(t('router.unbind_error'), { description: msg })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void load({ silent: true }) }, [usi]) // eslint-disable-line react-hooks/exhaustive-deps

  const canBind = !busy && !hasBound && toClean8(code).length === 8
  const inputValue = toPretty9(code)

  return (
    <div className="cr">
      {loading && (
        <div className="cr__loading">
          ⏳ {t('router.loading')}
        </div>
      )}

      {error && (
        <div className="cr__error">
          ⚠️ {error}
        </div>
      )}

      {!loading && (
        <>
          {hasBound ? (
            <>
              <div className="cr__boundCard">
                <div className="cr__boundTitle">
                  ✅ {t('router.bound')} <b>{shownPretty || '—'}</b>
                </div>
                <div className="cr__boundMeta">
                  {!!fmtTs(first?.created_at) && <span>{t('router.bound_at')} {fmtTs(first!.created_at)}</span>}
                  {!!fmtTs(first?.last_seen_at) && <span>{t('router.last_seen')} {fmtTs(first!.last_seen_at)}</span>}
                </div>
              </div>

              <div style={S.divider} />

              <div style={S.info}>
                <div style={S.infoTitle}>{t('router.widget_servers.title')}</div>
                <div style={S.infoText}>{t('router.widget_servers.desc')}</div>
              </div>

              <div style={S.grid2}>
                <button style={S.btnDanger} onClick={() => void unbind()} disabled={busy} type="button">
                  🔓 {busy ? t('connect.wait') : t('router.unbind')}
                </button>
                <button style={S.btnSec} onClick={() => void load({ silent: false })} disabled={busy} type="button">
                  🔄 {t('services.refresh')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="cr__hint">
                {t('router.hint')}
              </div>
              <input
                value={inputValue}
                onChange={(e) => { setError(null); setCode(e.target.value) }}
                onBlur={() => setCode((cur) => toPretty9(cur))}
                placeholder={t('router.input_placeholder')}
                className="input cr__input"
                disabled={busy}
                inputMode="text"
                lang="en"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
              />
              <div className="cr__actionsGrid cr__actionsGrid--2">
                <button className="btn btn--primary cr__btnFull" style={{ opacity: canBind ? 1 : 0.5 }} onClick={() => void bind()} disabled={!canBind} type="button">
                  🔗 {busy ? t('connect.wait') : t('router.bind')}
                </button>
                <button className="btn cr__btnFull" onClick={() => void load({ silent: false })} disabled={busy} type="button">
                  🔄 {t('services.refresh')}
                </button>
              </div>
              <div className="cr__codeFormat">{t('router.code_format')}</div>
            </>
          )}
        </>
      )}

      <button
        className="btn cr__btnFull cr__guide"
        onClick={() => window.location.assign('/help/router')}
        type="button"
      >
        📖 {t('router.instruction')}
      </button>
    </div>
  )
}
