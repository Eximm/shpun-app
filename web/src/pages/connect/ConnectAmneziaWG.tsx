import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { apiFetch } from '../../shared/api/client'

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
  linux: 'https://github.com/amnezia-vpn/amneziawg-linux-client/releases',
}

const APK_LINK = 'https://github.com/amnezia-vpn/amneziawg-android/releases/latest'

function detectOS(): Platform {
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera || ''
  const isAndroid = /android/i.test(ua)
  const isAppleTouch = /\bMac\b/.test(ua) && (navigator as any).maxTouchPoints > 1 // iPadOS
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

function isMobile(p: Platform) {
  return p === 'android' || p === 'ios'
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
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1) // BOM
  return t.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [configText, setConfigText] = useState('')
  const [configName, setConfigName] = useState(`vpn${usi}.conf`)

  const autoPlatform = useMemo(() => detectOS(), [])
  const [chip, setChip] = useState<Chip>('auto')
  const platform: Platform = chip === 'auto' ? autoPlatform : chip

  const [qrOpen, setQrOpen] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')

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
    } catch (e: any) {
      setConfigText('')
      setError(e?.message || 'Не удалось загрузить конфигурацию')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usi])

  const topHint = useMemo(() => {
    const pName = platformLabel(platform)
    if (loading) return `Готовим подключение для: ${pName}…`
    if (error) return `Не удалось подготовить подключение для: ${pName}.`
    if (isMobile(platform)) return `Устройство: ${pName}. 1) Установить AmneziaWG  2) Импортировать по QR.`
    return `Устройство: ${pName}. 1) Установить AmneziaWG  2) Импортировать из файла .conf.`
  }, [platform, loading, error])

  async function openQr() {
    if (!configText) return
    try {
      const dataUrl = await QRCode.toDataURL(configText, { margin: 1, width: 320 })
      setQrDataUrl(dataUrl)
      setQrOpen(true)
    } catch {
      alert('Не удалось построить QR-код')
    }
  }

  function downloadConf() {
    if (!configText) return
    downloadTextFile(configName || `vpn${usi}.conf`, configText)
  }

  const main2Label = isMobile(platform) ? 'Показать QR' : 'Скачать конфиг'
  const main2Action = isMobile(platform) ? openQr : downloadConf

  const devices: Array<{ id: Chip; label: string }> = [
    { id: 'auto', label: '✨ Текущее' },
    { id: 'android', label: '🤖 Android' },
    { id: 'ios', label: '📱 iOS' },
    { id: 'windows', label: '🖥️ Windows' },
    { id: 'mac', label: '💻 macOS' },
    { id: 'linux', label: '🐧 Linux' },
  ]

  const ready = !loading && !error && !!configText

  return (
    <div className="cawg">
      <div className="pre" style={{ marginTop: 0 }}>
        {ready ? '✅ Профиль готов. ' : error ? '⚠️ Профиль не готов. ' : '… '}
        {topHint}
      </div>

      {!loading && error ? (
        <div className="pre" style={{ marginTop: 10 }}>
          {String(error)}
          <div style={{ marginTop: 10 }}>
            <button className="btn" onClick={load} type="button">
              Повторить
            </button>
          </div>
        </div>
      ) : null}

      <div className="p" style={{ marginTop: 12 }}>Выберите устройство:</div>

      <div className="cr__actionsGrid cr__actionsGrid--2" style={{ marginTop: 8 }}>
        {devices.map((d) => {
          const active = chip === d.id
          return (
            <button
              key={d.id}
              className={`btn cr__btnFull ${active ? 'btn--primary' : ''}`}
              onClick={() => setChip(d.id)}
              disabled={loading}
              type="button"
            >
              {d.label}
            </button>
          )
        })}
      </div>

      <div className="cr__actionsGrid cr__actionsGrid--2" style={{ marginTop: 12 }}>
        <button className="btn cr__btnFull" onClick={() => openLinkSafe(APP_LINKS[platform])} disabled={loading} type="button">
          Скачать AmneziaWG
        </button>

        <button className="btn btn--primary cr__btnFull" onClick={main2Action} disabled={!ready} type="button">
          {loading ? 'Подождите…' : main2Label}
        </button>
      </div>

      {ready ? (
        <div className="p" style={{ marginTop: 10 }}>
          Другой способ:{' '}
          <button className="btn btn--link" type="button" onClick={isMobile(platform) ? downloadConf : openQr}>
            {isMobile(platform) ? 'Скачать конфиг' : 'Показать QR'}
          </button>
        </div>
      ) : null}

      {platform === 'android' ? (
        <div className="p" style={{ marginTop: 6, opacity: 0.85 }}>
          Нет Google Play?{' '}
          <button className="btn btn--link" type="button" onClick={() => openLinkSafe(APK_LINK)}>
            Открыть APK releases
          </button>
        </div>
      ) : null}

      {qrOpen ? (
        <div className="modal" role="dialog" aria-modal="true" onClick={() => setQrOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">QR-код профиля</div>
            <div className="modal-sub">В AmneziaWG выберите импорт по QR и наведите камеру.</div>
            {qrDataUrl ? <img src={qrDataUrl} alt="QR Code" loading="lazy" decoding="async" /> : null}
            <button className="btn btn-secondary" onClick={() => setQrOpen(false)} type="button">
              Закрыть
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}