// FILE: web/src/pages/connect/ConnectRouter.tsx

import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../../shared/api/client'
import { getMood } from '../../shared/payments-mood'
import { toast } from '../../shared/ui/toast'
import { useI18n } from '../../shared/i18n'

type ApiRouterItem = {
  code?: string; clean_code?: string; status?: string;
  created_at?: number; last_seen_at?: number;
  cleanCode?: string; createdAt?: number; lastSeenAt?: number; router_code?: string;
}
type RouterProtocol = 'ss' | 'vless'
type RouterLinkItem = { raw: string; protocol: RouterProtocol; locationKey: string; locationLabel: string }
type Props = { usi: number; service: { title: string; status: string; statusRaw: string }; onDone?: () => void }

function fmtTs(ts?: number): string {
  if (!ts || ts <= 0) return ''
  const d = new Date(ts * 1000)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString()
}

function normOne(x: any): ApiRouterItem | null {
  if (!x || typeof x !== 'object') return null
  return { code: x.code ?? x.router_code ?? x.routerCode ?? undefined, clean_code: x.clean_code ?? x.cleanCode ?? undefined, status: x.status ?? x.state ?? undefined, created_at: x.created_at ?? x.createdAt ?? undefined, last_seen_at: x.last_seen_at ?? x.lastSeenAt ?? undefined }
}

function extractRouters(resp: any): ApiRouterItem[] {
  const r = resp ?? {}
  const arr = r.routers ?? r.items ?? r.data ?? r.list ?? r.result ?? null
  if (Array.isArray(arr)) return arr.map(normOne).filter(Boolean) as ApiRouterItem[]
  const one = r.router ?? r.binding ?? r.bound ?? r.item ?? (r.data && !Array.isArray(r.data) ? r.data : null)
  const n = normOne(one)
  return n ? [n] : []
}

function toClean8(raw: string) { return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) }
function toPretty9(raw: string) { const c = toClean8(raw); if (!c) return ''; if (c.length <= 4) return c; return c.slice(0, 4) + '-' + c.slice(4) }

function statusView(status?: string) {
  const s = String(status || '').trim().toLowerCase()
  if (!s) return { label: 'unknown', tone: 'muted' as const }
  if (s === 'bound' || s === 'active' || s === 'ok') return { label: s, tone: 'good' as const }
  if (s === 'unbound' || s === 'removed' || s === 'none' || s === 'new') return { label: s, tone: 'muted' as const }
  if (s === 'error' || s === 'fail' || s === 'failed') return { label: s, tone: 'bad' as const }
  return { label: s, tone: 'muted' as const }
}

function safeDecode(value: string) { try { return decodeURIComponent(value) } catch { return value } }
function normalizeLocationLabel(raw: string) {
  return safeDecode(String(raw || '').trim()).replace(/\bVLESS\b/gi, '').replace(/\bShadowsocks\b/gi, '').replace(/\bSS\b/gi, '').replace(/\s+/g, ' ').trim()
}
function makeLocationKey(raw: string) {
  return safeDecode(String(raw || '').trim()).toLowerCase().replace(/vless/g, '').replace(/shadowsocks/g, '').replace(/ss/g, '').replace(/\s+/g, ' ').trim()
}

function parseRouterLinks(input: string[]): RouterLinkItem[] {
  return input.map((raw) => String(raw || '').trim()).filter((raw) => raw.startsWith('ss://') || raw.startsWith('vless://'))
    .map((raw) => {
      const protocol: RouterProtocol = raw.startsWith('ss://') ? 'ss' : 'vless'
      const hashIdx = raw.indexOf('#')
      const hashPart = hashIdx >= 0 ? raw.slice(hashIdx + 1) : ''
      return { raw, protocol, locationKey: makeLocationKey(hashPart), locationLabel: normalizeLocationLabel(hashPart) || 'Unknown' }
    })
}

function errMessage(e: any, fallback: string) { return String(e?.message || fallback || '').trim() || fallback }
function protocolLabel(protocol: RouterProtocol) { return protocol === 'ss' ? 'Shadowsocks' : 'VLESS' }

export default function ConnectRouter({ usi, onDone }: Props) {
  const { t } = useI18n()
  const [loading,          setLoading]          = useState(true)
  const [busy,             setBusy]             = useState(false)
  const [error,            setError]            = useState<string | null>(null)
  const [routers,          setRouters]          = useState<ApiRouterItem[]>([])
  const [code,             setCode]             = useState('')
  const [configLoading,    setConfigLoading]    = useState(false)
  const [configSaving,     setConfigSaving]     = useState(false)
  const [configError,      setConfigError]      = useState<string | null>(null)
  const [routerLinks,      setRouterLinks]      = useState<RouterLinkItem[]>([])
  const [selectedProtocol, setSelectedProtocol] = useState<RouterProtocol>('vless')
  const [selectedLinkRaw,  setSelectedLinkRaw]  = useState('')
  const [savedLinkRaw,     setSavedLinkRaw]     = useState('')
  const [locationOpen,     setLocationOpen]     = useState(false)
  const locationRef = useRef<HTMLDivElement | null>(null)

  const first      = routers?.[0]
  const shownClean = String(first?.clean_code || first?.cleanCode || '').trim()
  const shownCode  = String(first?.code || first?.router_code || '').trim()
  const shownPretty = useMemo(() => { const base = shownClean || shownCode; return base ? toPretty9(base) : '' }, [shownClean, shownCode])
  const st = useMemo(() => statusView(first?.status), [first?.status])

  const hasBound = useMemo(() => {
    if (!first) return false
    const normalized = String(first.status || '').toLowerCase()
    if (normalized === 'bound' || normalized === 'active' || normalized === 'ok') return true
    if (normalized === 'unbound' || normalized === 'removed' || normalized === 'none' || normalized === 'new') return false
    return !!(shownClean || shownCode)
  }, [first, shownClean, shownCode])

  const locations = useMemo(() => {
    const filtered = routerLinks.filter((item) => item.protocol === selectedProtocol)
    const seen = new Set<string>()
    return filtered.filter((item) => { if (seen.has(item.locationKey)) return false; seen.add(item.locationKey); return true })
  }, [routerLinks, selectedProtocol])

  const selectedLocation = useMemo(() => locations.find((item) => item.raw === selectedLinkRaw) || null, [locations, selectedLinkRaw])
  const savedLocation    = useMemo(() => routerLinks.find((item) => item.raw === savedLinkRaw) || null, [routerLinks, savedLinkRaw])
  const canSaveConfig    = useMemo(() => !configSaving && !!selectedLinkRaw && selectedLinkRaw !== savedLinkRaw && locations.length > 0, [configSaving, selectedLinkRaw, savedLinkRaw, locations.length])

  async function load(opts?: { silent?: boolean }) {
    const silent = !!opts?.silent
    setLoading(true); setError(null)
    try {
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/router`, { method: 'GET' })) as any
      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) throw new Error(String(r.error || r.message))
      setRouters(extractRouters(r))
      if (!silent) toast.success('🔄 Обновили', { description: getMood('service_status_updated') ?? 'Статус актуален.' })
    } catch (e: any) {
      const msg = errMessage(e, t('router.load_error'))
      setError(msg); setRouters([])
      if (!silent) toast.error(t('router.status_error'), { description: msg })
    } finally { setLoading(false) }
  }

  async function loadConfig(opts?: { preserveSelection?: boolean }) {
    if (!hasBound) { setRouterLinks([]); setSelectedLinkRaw(''); setSavedLinkRaw(''); setConfigError(null); setLocationOpen(false); return }
    setConfigLoading(true); setConfigError(null)
    try {
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/router/config`, { method: 'GET' })) as any
      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) throw new Error(String(r.error || r.message))
      const parsed = parseRouterLinks(Array.isArray(r?.links) ? r.links : [])
      setRouterLinks(parsed)
      if (!parsed.length) { setSelectedLinkRaw(''); setSavedLinkRaw(''); return }
      const currentRaw = opts?.preserveSelection && selectedLinkRaw ? selectedLinkRaw : String(r?.selected_link || r?.current_link || r?.active_link || '').trim()
      const found = parsed.find((item) => item.raw === currentRaw) || parsed[0]
      setSelectedProtocol(found.protocol); setSelectedLinkRaw(found.raw); setSavedLinkRaw(found.raw)
    } catch (e: any) {
      const msg = errMessage(e, t('router.config.save_error'))
      setConfigError(msg); setRouterLinks([]); setSelectedLinkRaw(''); setSavedLinkRaw('')
    } finally { setConfigLoading(false) }
  }

  async function bind() {
    const clean = toClean8(code)
    if (!clean) return
    if (clean.length !== 8) { const msg = t('router.code_invalid_desc'); setError(msg); toast.error(t('router.code_invalid'), { description: msg }); return }
    setBusy(true); setError(null)
    try {
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/router/bind`, { method: 'POST', body: { code: clean } })) as any
      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) throw new Error(String(r.error || r.message))
      setCode(''); await load({ silent: true }); await loadConfig(); onDone?.()
      toast.success(getMood('router_bound') ?? '📡 Роутер привязан', { description: `Код: ${toPretty9(clean)}` })
    } catch (e: any) { const msg = errMessage(e, t('router.bind_error')); setError(msg); toast.error(t('router.bind_error'), { description: msg })
    } finally { setBusy(false) }
  }

  async function unbind() {
    const v = String(first?.clean_code || first?.cleanCode || first?.code || first?.router_code || '').trim()
    const clean = toClean8(v)
    if (!clean) return
    setBusy(true); setError(null)
    try {
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/router/unbind`, { method: 'POST', body: { code: clean } })) as any
      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) throw new Error(String(r.error || r.message))
      setRouterLinks([]); setSelectedLinkRaw(''); setSavedLinkRaw(''); setLocationOpen(false)
      await load({ silent: true }); onDone?.()
      toast.success(getMood('router_unbound') ?? '🔓 Роутер отвязан', { description: 'Можно привязать новый.' })
    } catch (e: any) { const msg = errMessage(e, t('router.unbind_error')); setError(msg); toast.error(t('router.unbind_error'), { description: msg })
    } finally { setBusy(false) }
  }

  async function saveConfig() {
    if (!canSaveConfig) return
    setConfigSaving(true); setConfigError(null)
    try {
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/router/config`, { method: 'POST', body: { link: selectedLinkRaw } })) as any
      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) throw new Error(String(r.error || r.message))
      setSavedLinkRaw(selectedLinkRaw); setLocationOpen(false)
      toast.success('💾 Конфиг сохранён', { description: `${selectedLocation?.locationLabel ?? ''} · ${protocolLabel(selectedProtocol)}` })
      await loadConfig({ preserveSelection: true })
    } catch (e: any) { const msg = errMessage(e, t('router.config.save_error')); setConfigError(msg); toast.error(t('router.config.save_error'), { description: msg })
    } finally { setConfigSaving(false) }
  }

  useEffect(() => { load({ silent: true }) }, [usi]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (hasBound) { loadConfig() } else { setRouterLinks([]); setSelectedLinkRaw(''); setSavedLinkRaw(''); setConfigError(null); setLocationOpen(false) }
  }, [hasBound, usi]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!locations.length) { setSelectedLinkRaw(''); setLocationOpen(false); return }
    if (!locations.some((item) => item.raw === selectedLinkRaw)) setSelectedLinkRaw(locations[0].raw)
  }, [locations, selectedLinkRaw])
  useEffect(() => {
    function onClickOutside(e: MouseEvent) { if (!locationRef.current) return; if (!locationRef.current.contains(e.target as Node)) setLocationOpen(false) }
    if (locationOpen) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [locationOpen])

  const statusToneClass = st.tone === 'good' ? 'cr__badge--good' : st.tone === 'bad' ? 'cr__badge--bad' : 'cr__badge--muted'
  const canBind = !busy && !hasBound && toClean8(code).length === 8
  const inputValue = toPretty9(code)

  return (
    <div className="cm cr">
      <div className="card section">
        <div className="card__body">

          {/* Заголовок + статус */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="h2">📡 {t('router.config.title')}</div>
              <p className="p" style={{ marginTop: 4 }}>
                {hasBound ? t('router.config.location') : t('router.hint')}
              </p>
            </div>
            {!loading && first && (
              <span className={`cr__badge ${statusToneClass}`}>
                <span className="cr__badgeK">{t('router.status_short')}</span>
                <b className="cr__badgeV">{st.label}</b>
              </span>
            )}
          </div>

          {loading && <div className="p" style={{ marginTop: 12 }}>⏳ {t('router.loading')}</div>}
          {error   && <div className="pre cr__mt10" style={{ borderColor: 'rgba(255,77,109,0.28)' }}>{error}</div>}

          {!loading && (
            <>
              {/* Статус привязки */}
              <div className="pre" style={{
                marginTop: 12,
                borderColor: hasBound ? 'rgba(43,227,143,0.28)' : 'rgba(255,255,255,0.10)',
                background:  hasBound ? 'rgba(43,227,143,0.05)' : 'rgba(255,255,255,0.02)',
              }}>
                {hasBound ? (
                  <>
                    <div>✅ {t('router.bound')} <b>{shownPretty || '—'}</b></div>
                    {!!fmtTs(first?.created_at)  && <div className="cr__meta cr__mt6">{t('router.bound_at')} <b>{fmtTs(first.created_at)}</b></div>}
                    {!!fmtTs(first?.last_seen_at) && <div className="cr__meta">{t('router.last_seen')} <b>{fmtTs(first.last_seen_at)}</b></div>}
                  </>
                ) : (
                  <>
                    <div>🔌 {t('router.not_bound')}</div>
                    <div className="cr__meta cr__mt6">{t('router.code_format')}</div>
                  </>
                )}
              </div>

              {/* Форма привязки */}
              {!hasBound && (
                <>
                  <div className="field" style={{ marginTop: 12 }}>
                    <label className="field__label">{t('router.input_placeholder')}</label>
                    <input
                      value={inputValue}
                      onChange={(e) => { setError(null); setCode(e.target.value) }}
                      onBlur={() => setCode((cur) => toPretty9(cur))}
                      placeholder={t('router.input_placeholder')}
                      className="input cr__input"
                      disabled={busy}
                      inputMode="text" lang="en"
                      autoCapitalize="none" autoCorrect="off"
                      spellCheck={false} autoComplete="off"
                      pattern="[A-Za-z0-9-]*"
                    />
                  </div>
                  <div className="actions actions--2" style={{ marginTop: 10 }}>
                    <button className="btn btn--primary" onClick={() => void bind()} disabled={!canBind} type="button">
                      🔗 {busy ? t('connect.wait') : t('router.bind')}
                    </button>
                    <button className="btn" onClick={() => void load({ silent: false })} disabled={busy} type="button">
                      🔄 {t('services.refresh')}
                    </button>
                  </div>
                </>
              )}

              {/* Настройка конфига */}
              {hasBound && (
                <>
                  {/* Протокол */}
                  <div className="field" style={{ marginTop: 12 }}>
                    <label className="field__label">{t('router.config.protocol')}</label>
                    <div className="actions actions--2">
                      <button className={`btn${selectedProtocol === 'ss' ? ' btn--primary' : ''}`} onClick={() => setSelectedProtocol('ss')} type="button" disabled={configSaving || configLoading}>
                        {t('router.protocol.ss')}
                      </button>
                      <button className={`btn${selectedProtocol === 'vless' ? ' btn--primary' : ''}`} onClick={() => setSelectedProtocol('vless')} type="button" disabled={configSaving || configLoading}>
                        {t('router.protocol.vless')}
                      </button>
                    </div>
                  </div>

                  {configLoading && <div className="p" style={{ marginTop: 10 }}>⏳ {t('router.loading')}</div>}
                  {configError   && <div className="pre cr__mt10" style={{ borderColor: 'rgba(255,77,109,0.28)' }}>{configError}</div>}

                  {!configLoading && routerLinks.length > 0 && (
                    <>
                      {/* Выбор локации */}
                      <div className="field" style={{ marginTop: 12 }} ref={locationRef}>
                        <label className="field__label">{t('router.config.location')}</label>
                        <button
                          type="button" className="input"
                          onClick={() => setLocationOpen((v) => !v)}
                          disabled={configSaving || locations.length === 0}
                          aria-expanded={locationOpen}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left', cursor: 'pointer' }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {selectedLocation?.locationLabel || t('router.config.location')}
                          </span>
                          <span style={{ marginLeft: 12, opacity: 0.6, flexShrink: 0 }}>{locationOpen ? '▴' : '▾'}</span>
                        </button>
                        {savedLocation && (
                          <div className="p" style={{ marginTop: 6, fontSize: 12 }}>
                            ✅ Активно: {savedLocation.locationLabel} · {protocolLabel(savedLocation.protocol)}
                          </div>
                        )}

                        {locationOpen && (
                          <div className="card" style={{ marginTop: 8, boxShadow: 'none', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                            <div className="card__body" style={{ padding: 8 }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
                                {locations.map((item) => {
                                  const active = item.raw === selectedLinkRaw
                                  const saved  = item.raw === savedLinkRaw
                                  return (
                                    <button
                                      key={item.raw} type="button"
                                      onClick={() => { setSelectedLinkRaw(item.raw); setLocationOpen(false) }}
                                      disabled={configSaving}
                                      className="btn"
                                      style={{ width: '100%', justifyContent: 'space-between', background: active ? 'rgba(124,92,255,0.12)' : 'transparent', borderColor: active ? 'rgba(124,92,255,0.32)' : 'rgba(255,255,255,0.06)', minHeight: 42 }}
                                    >
                                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{item.locationLabel}</span>
                                      <span style={{ marginLeft: 12, opacity: active ? 1 : 0.35, flexShrink: 0 }}>{saved ? '✓' : active ? '•' : ''}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="actions actions--2" style={{ marginTop: 12 }}>
                        <button className="btn btn--primary" onClick={() => void saveConfig()} disabled={!canSaveConfig} type="button">
                          {configSaving ? t('router.config.saving') : `💾 ${t('router.config.save')}`}
                        </button>
                        <button className="btn btn--danger" onClick={() => void unbind()} disabled={busy || configSaving} type="button">
                          🔓 {busy ? t('connect.wait') : t('router.unbind')}
                        </button>
                      </div>

                      <div className="actions actions--1" style={{ marginTop: 8 }}>
                        <button className="btn" onClick={() => void load({ silent: false })} disabled={busy || configSaving} type="button">
                          🔄 {t('services.refresh')}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  )
}