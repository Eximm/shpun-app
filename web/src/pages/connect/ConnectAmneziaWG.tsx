import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { apiFetch } from '../../shared/api/client'
import { toast } from '../../shared/ui/toast'
import { RU, EN, type Lang } from '../../shared/i18n/dict'

type Props = {
  usi: number
  service: { title: string; status: string; statusRaw: string }
  onDone?: () => void
}

type Platform = 'android' | 'ios' | 'windows' | 'mac' | 'linux'
type Chip = 'auto' | Platform

const APP_LINKS: Record<Platform, string> = {
  windows: 'https://github.com/amnezia-vpn/amneziawg-windows-client/releases',
  mac: 'https://apps.apple.com/app/amneziawg/id6478942365',
  ios: 'https://apps.apple.com/app/amneziawg/id6478942365',
  android: 'https://play.google.com/store/apps/details?id=org.amnezia.awg',
  linux: 'https://docs.amnezia.org/documentation/installing-app-on-linux/',
}

const APK_LINK = 'https://github.com/amnezia-vpn/amneziawg-android/releases/latest'

function detectLang(): Lang {
  try {
    const saved = String(localStorage.getItem('lang') || '').trim().toLowerCase()
    if (saved === 'ru' || saved === 'en') return saved
  } catch {
    // ignore
  }

  const docLang = String(document?.documentElement?.lang || '').trim().toLowerCase()
  if (docLang === 'ru' || docLang === 'en') return docLang as Lang

  const navLang = String(navigator.language || '').toLowerCase()
  return navLang.startsWith('ru') ? 'ru' : 'en'
}

function formatText(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''))
}

function useDict() {
  const lang = useMemo(() => detectLang(), [])
  const dict = lang === 'ru' ? RU : EN

  function t(key: string, vars?: Record<string, string | number>) {
    return formatText(dict[key] || key, vars)
  }

  return { t }
}

function detectOS(): Platform {
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera || ''
  const isAndroid = /android/i.test(ua)
  const isAppleTouch = /\bMac\b/.test(ua) && (navigator as any).maxTouchPoints > 1
  const isiOS = /iPad|iPhone|iPod/.test(ua) || isAppleTouch

  if (isAndroid) return 'android'
  if (isiOS) return 'ios'
  if (/Win/i.test(ua)) return 'windows'
  if (/\bMac\b/i.test(ua)) return 'mac'
  if (/Linux/i.test(ua)) return 'linux'
  return 'windows'
}

function platformLabel(p: Platform) {
  if (p === 'android') return 'Android'
  if (p === 'ios') return 'iOS'
  if (p === 'windows') return 'Windows'
  if (p === 'mac') return 'macOS'
  return 'Linux'
}

function openLinkSafe(url: string) {
  try {
    const tg: any = (window as any).Telegram?.WebApp
    if (tg && typeof tg.openLink === 'function') {
      tg.openLink(url)
      return
    }
  } catch {
    // ignore
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

function normalizeProfileText(text: string) {
  let t = String(text ?? '')
  if (!t) return ''
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
  return t.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.top = '-1000px'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

function pickConfig(resp: any): { text: string; name: string } {
  const name =
    String(resp?.configName ?? resp?.filename ?? resp?.fileName ?? resp?.name ?? '').trim() || 'vpn.conf'

  const raw =
    resp?.configText ??
    resp?.profile_text ??
    resp?.profileText ??
    resp?.profile ??
    resp?.text ??
    ''

  const text = normalizeProfileText(String(raw ?? ''))
  return { text, name }
}

export default function ConnectAmneziaWG({ usi }: Props) {
  const { t } = useDict()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [configText, setConfigText] = useState('')
  const [configName, setConfigName] = useState(`vpn${usi}.conf`)

  const autoPlatform = useMemo(() => detectOS(), [])
  const [chip, setChip] = useState<Chip>('auto')
  const platform: Platform = chip === 'auto' ? autoPlatform : chip

  const [platformPickerOpen, setPlatformPickerOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  const [qrOpen, setQrOpen] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')

  const didToastReadyRef = useRef(false)

  async function load() {
    setLoading(true)
    setError(null)

    try {
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/connect/amneziawg`, {
        method: 'GET',
      })) as any

      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) {
        throw new Error(String(r.error || r.message))
      }

      const picked = pickConfig(r)
      if (!picked.text) throw new Error('profile_missing')

      setConfigText(picked.text)
      setConfigName(picked.name || `vpn${usi}.conf`)

      if (!didToastReadyRef.current) {
        didToastReadyRef.current = true
        toast.success(t('connectAmneziaWG.status.ready').trim(), {
          description: t('connectAmneziaWG.top_hint.ready', { platform: platformLabel(platform) }),
        })
      }
    } catch (e: any) {
      setConfigText('')
      const msg = e?.message || 'profile_load_failed'
      setError(msg)

      toast.error(t('connect.sub_prepare_error'), {
        description:
          msg === 'profile_missing'
            ? t('connect.sub_prepare_error_desc')
            : String(msg),
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    didToastReadyRef.current = false
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usi])

  const ready = !loading && !error && !!configText

  const topHint = useMemo(() => {
    const pName = platformLabel(platform)
    if (loading) return t('connectAmneziaWG.top_hint.loading', { platform: pName })
    if (error) return t('connectAmneziaWG.top_hint.error', { platform: pName })
    return t('connectAmneziaWG.top_hint.ready', { platform: pName })
  }, [platform, loading, error, t])

  async function openQr() {
    if (!configText) return

    try {
      const dataUrl = await QRCode.toDataURL(configText, { margin: 2, width: 360 })
      setQrDataUrl(dataUrl)
      setQrOpen(true)

      toast.info(t('connectAmneziaWG.qr.title'), {
        description: t('connectAmneziaWG.qr.sub'),
      })
    } catch (e: any) {
      toast.error(t('connectAmneziaWG.qr.title'), {
        description: String(e?.message || t('connect.sub_prepare_error_desc')),
      })
    }
  }

  function downloadConf() {
    if (!configText) return
    downloadTextFile(configName || `vpn${usi}.conf`, configText)

    toast.success(t('connectAmneziaWG.step2.download_conf'), {
      description: t('connect.import_text'),
    })
  }

  async function copyConf() {
    if (!configText) return
    const ok = await copyToClipboard(configText)

    if (ok) {
      toast.success(t('connectAmneziaWG.step2.copy_conf'), {
        description: t('connect.import_text'),
      })
    } else {
      toast.error(t('connectAmneziaWG.toast.copy_failed.title'), {
        description: t('connectAmneziaWG.toast.copy_failed.desc'),
      })
    }
  }

  const storeLabel =
    platform === 'android'
      ? t('connectAmneziaWG.store.google_play')
      : platform === 'ios' || platform === 'mac'
        ? t('connectAmneziaWG.store.app_store')
        : t('connectAmneziaWG.store.download_page')

  return (
    <div className="cm">
      <div className="pre">
        {ready
          ? t('connectAmneziaWG.status.ready')
          : error
            ? t('connectAmneziaWG.status.not_ready')
            : t('connectAmneziaWG.status.loading')}{' '}
        {topHint}
      </div>

      {!loading && error ? (
        <div className="pre">
          {String(error)}

          <div className="actions actions--1">
            <button className="btn" onClick={load} type="button">
              {t('connectAmneziaWG.retry')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="section">
        <div className="row cawg__rowTop">
          <div className="p cawg__label">{t('connectAmneziaWG.device.label')}</div>

          <button
            className="btn cawg__deviceBtn"
            type="button"
            onClick={() => setPlatformPickerOpen(true)}
            disabled={loading}
            aria-label={t('connectAmneziaWG.device.pick_aria')}
          >
            {chip === 'auto'
              ? t('connectAmneziaWG.device.current', { platform: platformLabel(autoPlatform) })
              : platformLabel(platform)}{' '}
            <span aria-hidden>▾</span>
          </button>
        </div>
      </div>

      <div className="card section">
        <div className="card__body">
          <div className="section">
            <div className="pre">
              <b>{t('connectAmneziaWG.step1.title')}</b>
              <br />
              {t('connectAmneziaWG.step1.sub')}
              <b>AmneziaWG</b>
              {t('connectAmneziaWG.step1.sub_for', { platform: platformLabel(platform) })}
            </div>

            <div className="actions actions--2">
              <button
                className="btn btn--primary"
                onClick={() => openLinkSafe(APP_LINKS[platform])}
                disabled={loading}
                type="button"
              >
                {t('connectAmneziaWG.step1.open_store', { store: storeLabel })}
              </button>

              {platform === 'android' ? (
                <button
                  className="btn btn--accent"
                  onClick={() => openLinkSafe(APK_LINK)}
                  disabled={loading}
                  type="button"
                >
                  {t('connectAmneziaWG.step1.download_apk')}
                </button>
              ) : (
                <button
                  className="btn btn--accent"
                  onClick={() => openLinkSafe(APP_LINKS[platform])}
                  disabled={loading}
                  type="button"
                >
                  {t('connectAmneziaWG.step1.download_direct')}
                </button>
              )}
            </div>
          </div>

          <div className="section">
            <div className="pre">
              <b>{t('connectAmneziaWG.step2.title')}</b>
              <br />
              {t('connectAmneziaWG.step2.sub_1')}
              <b>.conf</b>
              {t('connectAmneziaWG.step2.sub_2')}
              <b>AmneziaWG</b>. {t('connectAmneziaWG.step2.more_hint')}
            </div>

            <div className="actions actions--1">
              <button
                className="btn btn--primary so__btnFull"
                onClick={downloadConf}
                disabled={!ready}
                type="button"
                title={!ready ? t('connectAmneziaWG.step2.not_ready_title') : undefined}
              >
                {loading ? t('connectAmneziaWG.wait') : t('connectAmneziaWG.step2.download_conf')}
              </button>
            </div>
          </div>

          <div className="section">
            <div className="pre">
              <b>{t('connectAmneziaWG.step2.show_more')}</b>
              <br />
              {t('connectAmneziaWG.step2.more_hint')}
            </div>

            <div className="actions actions--1">
              <button
                className="btn btn--accent so__btnFull"
                onClick={() => setMoreOpen((v) => !v)}
                disabled={!ready}
                type="button"
              >
                {moreOpen
                  ? `▴ ${t('connectAmneziaWG.step2.hide_more')}`
                  : `▾ ${t('connectAmneziaWG.step2.show_more')}`}
              </button>
            </div>
          </div>
        </div>
      </div>

      {moreOpen && ready ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="section">
                <div className="pre">
                  <b>📱 {t('connectAmneziaWG.step2.show_qr')}</b>
                  <br />
                  {t('connectAmneziaWG.qr.sub')}
                </div>

                <div className="actions actions--1">
                  <button className="btn btn--primary so__btnFull" type="button" onClick={openQr}>
                    📱 {t('connectAmneziaWG.step2.show_qr')}
                  </button>
                </div>
              </div>

              <div className="section">
                <div className="pre">
                  <b>📋 {t('connectAmneziaWG.step2.copy_conf')}</b>
                  <br />
                  {t('connectAmneziaWG.toast.copy_failed.desc')}
                </div>

                <div className="actions actions--1">
                  <button className="btn btn--primary so__btnFull" type="button" onClick={copyConf}>
                    📋 {t('connectAmneziaWG.step2.copy_conf')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {platformPickerOpen ? (
        <div className="overlay" role="dialog" aria-modal="true" onClick={() => setPlatformPickerOpen(false)}>
          <div className="card overlay__card" onClick={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="row so__spaceBetween">
                <div className="overlay__title">{t('connectAmneziaWG.device.modal_title')}</div>

                <button
                  className="btn"
                  type="button"
                  onClick={() => setPlatformPickerOpen(false)}
                  aria-label={t('connectAmneziaWG.close')}
                >
                  ✕
                </button>
              </div>

              <div className="kv so__mt12">
                <button
                  className={`kv__item cawg__pickItem ${chip === 'auto' ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => {
                    setChip('auto')
                    setPlatformPickerOpen(false)
                  }}
                >
                  <div className="row so__spaceBetween">
                    <div className="kv__k">{t('connectAmneziaWG.device.current_short')}</div>
                    <span className="badge">{platformLabel(autoPlatform)}</span>
                  </div>
                </button>

                {(['android', 'ios', 'windows', 'mac', 'linux'] as Platform[]).map((p) => (
                  <button
                    key={p}
                    className={`kv__item cawg__pickItem ${chip === p ? 'is-active' : ''}`}
                    type="button"
                    onClick={() => {
                      setChip(p)
                      setPlatformPickerOpen(false)
                    }}
                  >
                    <div className="row so__spaceBetween">
                      <div className="kv__k">{platformLabel(p)}</div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="actions actions--1 so__mt12">
                <button className="btn so__btnFull" type="button" onClick={() => setPlatformPickerOpen(false)}>
                  {t('connectAmneziaWG.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {qrOpen ? (
        <div className="overlay" role="dialog" aria-modal="true" onClick={() => setQrOpen(false)}>
          <div className="card overlay__card" onClick={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="row so__spaceBetween">
                <div className="overlay__title">{t('connectAmneziaWG.qr.title')}</div>

                <button
                  className="btn"
                  type="button"
                  onClick={() => setQrOpen(false)}
                  aria-label={t('connectAmneziaWG.close')}
                >
                  ✕
                </button>
              </div>

              <p className="p so__mt8">{t('connectAmneziaWG.qr.sub')}</p>

              <div className="helperMedia so__mt12">
                {qrDataUrl ? (
                  <img
                    className="helperMedia__img"
                    src={qrDataUrl}
                    alt={t('connectAmneziaWG.qr.alt')}
                    loading="lazy"
                    decoding="async"
                    width={360}
                  />
                ) : null}
              </div>
              <div className="actions actions--1 so__mt12">
                <button className="btn btn--primary so__btnFull" onClick={() => setQrOpen(false)} type="button">
                  {t('connectAmneziaWG.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}