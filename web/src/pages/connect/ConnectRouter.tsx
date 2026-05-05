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

const S = {
  secLabel: { fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.35)", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 6 } as React.CSSProperties,
  divider:  { height: "0.5px", background: "rgba(255,255,255,0.07)", margin: "10px 0" } as React.CSSProperties,
  btnPrimary:{ padding: "9px 12px", borderRadius: 9, fontSize: 12, fontWeight: 800, background: "linear-gradient(135deg,#7c5cff,#4dd7ff)", border: "none", color: "#050a14", cursor: "pointer", width: "100%" } as React.CSSProperties,
  btnSec:    { padding: "8px 12px", borderRadius: 9, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,0.07)", border: "0.5px solid rgba(255,255,255,0.13)", color: "rgba(255,255,255,0.75)", cursor: "pointer", width: "100%" } as React.CSSProperties,
  btnDanger: { padding: "8px 12px", borderRadius: 9, fontSize: 12, fontWeight: 700, background: "rgba(255,77,109,0.10)", border: "0.5px solid rgba(255,77,109,0.25)", color: "#ff4d6d", cursor: "pointer", width: "100%" } as React.CSSProperties,
  grid2:     { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 } as React.CSSProperties,
  grid1:     { display: "grid", gridTemplateColumns: "1fr", gap: 6 } as React.CSSProperties,
}

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

  const first       = routers?.[0]
  const shownClean  = String(first?.clean_code || first?.cleanCode || '').trim()
  const shownCode   = String(first?.code || first?.router_code || '').trim()
  const shownPretty = useMemo(() => { const base = shownClean || shownCode; return base ? toPretty9(base) : '' }, [shownClean, shownCode])
 
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

  const canBind = !busy && !hasBound && toClean8(code).length === 8
  const inputValue = toPretty9(code)

  return (
    <div className="cr">

      {/* Загрузка */}
      {loading && (
        <div className="cr__loading">
          ⏳ {t('router.loading')}
        </div>
      )}

      {/* Ошибка */}
      {error && (
        <div className="cr__error">
          ⚠️ {error}
        </div>
      )}

      {!loading && (
        <>
          {/* Статус привязки */}
          {hasBound ? (
            <div className="cr__boundCard">
              <div className="cr__boundTitle">
                ✅ {t('router.bound')} <b>{shownPretty || '—'}</b>
              </div>
              {!!fmtTs(first?.created_at)  && <div className="cr__boundMeta">{t('router.bound_at')} {fmtTs(first!.created_at)}</div>}
              {!!fmtTs(first?.last_seen_at) && <div className="cr__boundMeta">{t('router.last_seen')} {fmtTs(first!.last_seen_at)}</div>}
            </div>
          ) : (
            /* Форма привязки */
            <>
              <div className="cr__hint">
                {t('router.hint')}
              </div>
              <input
                value={inputValue}
                onChange={(e) => { setError(null); setCode(e.target.value) }}
                onBlur={() => setCode((cur) => toPretty9(cur))}
                placeholder={t('router.input_placeholder')}
                className="input"
                disabled={busy}
                inputMode="text" lang="en"
                autoCapitalize="none" autoCorrect="off"
                spellCheck={false} autoComplete="off"
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

          {/* Настройки конфига — только если привязан */}
          {hasBound && (
            <>
              <div style={S.divider} />

              {/* Протокол */}
              <div style={S.secLabel}>{t('router.config.protocol')}</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                {(['ss', 'vless'] as RouterProtocol[]).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setSelectedProtocol(p)}
                    disabled={configSaving || configLoading}
                    style={{
                      flex: 1, padding: "7px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                      border: "0.5px solid",
                      borderColor: selectedProtocol === p ? "rgba(124,92,255,0.40)" : "rgba(255,255,255,0.10)",
                      background: selectedProtocol === p ? "rgba(124,92,255,0.15)" : "rgba(255,255,255,0.04)",
                      color: selectedProtocol === p ? "#a78bff" : "rgba(255,255,255,0.50)",
                      cursor: "pointer",
                    }}
                  >
                    {protocolLabel(p)}
                  </button>
                ))}
              </div>

              {configLoading && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.40)", marginBottom: 8 }}>⏳ {t('router.loading')}</div>}
              {configError   && <div style={{ fontSize: 12, color: "#ff4d6d", marginBottom: 8 }}>⚠️ {configError}</div>}

              {!configLoading && routerLinks.length > 0 && (
                <>
                  {/* Локация */}
                  <div style={S.secLabel}>{t('router.config.location')}</div>
                  <div ref={locationRef} style={{ marginBottom: 10 }}>
                    <button
                      type="button"
                      onClick={() => setLocationOpen(v => !v)}
                      disabled={configSaving || locations.length === 0}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "9px 11px", borderRadius: 9,
                        background: "rgba(0,0,0,0.25)", border: "0.5px solid rgba(255,255,255,0.12)",
                        color: "#e8eaf0", fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 4,
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {selectedLocation?.locationLabel || t('router.config.location')}
                      </span>
                      <span style={{ marginLeft: 10, opacity: 0.5, flexShrink: 0 }}>{locationOpen ? '▴' : '▾'}</span>
                    </button>
                    {savedLocation && (
                      <div style={{ fontSize: 10, color: "rgba(43,227,143,0.80)", marginBottom: 6 }}>
                        ✅ Активно: {savedLocation.locationLabel} · {protocolLabel(savedLocation.protocol)}
                      </div>
                    )}
                    {locationOpen && (
                      <div style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 6, maxHeight: 240, overflowY: "auto" }}>
                        {locations.map((item) => {
                          const active = item.raw === selectedLinkRaw
                          const saved  = item.raw === savedLinkRaw
                          return (
                            <button
                              key={item.raw} type="button"
                              onClick={() => { setSelectedLinkRaw(item.raw); setLocationOpen(false) }}
                              disabled={configSaving}
                              style={{
                                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                                padding: "8px 10px", borderRadius: 8, marginBottom: 3,
                                background: active ? "rgba(124,92,255,0.12)" : "transparent",
                                border: `0.5px solid ${active ? "rgba(124,92,255,0.32)" : "rgba(255,255,255,0.06)"}`,
                                color: "#e8eaf0", fontSize: 12, cursor: "pointer", textAlign: "left",
                              }}
                            >
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.locationLabel}</span>
                              <span style={{ marginLeft: 10, flexShrink: 0, opacity: active ? 1 : 0.3 }}>{saved ? '✓' : active ? '•' : ''}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <div style={{ ...S.grid2, marginBottom: 8 }}>
                    <button style={{ ...S.btnPrimary, opacity: canSaveConfig ? 1 : 0.5 }} onClick={() => void saveConfig()} disabled={!canSaveConfig} type="button">
                      {configSaving ? t('router.config.saving') : `💾 ${t('router.config.save')}`}
                    </button>
                    <button style={S.btnDanger} onClick={() => void unbind()} disabled={busy || configSaving} type="button">
                      🔓 {busy ? t('connect.wait') : t('router.unbind')}
                    </button>
                  </div>

                  <div style={S.grid1}>
                    <button style={{ ...S.btnSec, fontSize: 11 }} onClick={() => void load({ silent: false })} disabled={busy || configSaving} type="button">
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
  )
}
