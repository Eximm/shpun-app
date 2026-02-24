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

const CLIENT_LINKS = {
  android: {
    market: 'https://play.google.com/store/apps/details?id=app.hiddify.com',
    apk: 'https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-Android-arm64.apk',
    title: 'Hiddify',
  },
  ios: {
    market: 'https://apps.apple.com/ru/app/v2raytun/id6476628951?platform=iphone',
    title: 'V2rayTun',
  },
  windows: {
    market: 'https://github.com/hiddify/hiddify-app/releases',
    title: 'Hiddify',
  },
  mac: {
    market: 'https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-MacOS.dmg',
    title: 'Hiddify',
  },
  linux: {
    market: 'https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-Linux-x64.AppImage',
    title: 'Hiddify',
  },
} as const

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
    // если внутри Telegram WebApp
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

async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      alert('Ссылка скопирована ✅')
      return
    }
  } catch {
    // ignore
  }
  // fallback
  prompt('Скопируйте ссылку вручную:', text)
}

export default function ConnectMarzban({ usi }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const autoPlatform = useMemo(() => detectOS(), [])
  const [chip, setChip] = useState<Chip>('auto')

  const platform: Platform = chip === 'auto' ? autoPlatform : chip

  const [subscriptionUrl, setSubscriptionUrl] = useState<string>('')
  const [qrOpen, setQrOpen] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = (await apiFetch(`/services/${encodeURIComponent(String(usi))}/connect/marzban`, {
        method: 'GET',
      })) as any

      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) {
        throw new Error(String(r.error || r.message))
      }

      const url = String(r?.subscription_url ?? r?.subscriptionUrl ?? '').trim()
      if (!url) throw new Error('subscription_url_missing')
      setSubscriptionUrl(url)
    } catch (e: any) {
      setSubscriptionUrl('')
      setError(e?.message || 'Не удалось загрузить ссылку подписки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usi])

  // 2 главных кнопки: (1) скачать клиент (2) подключить
  const clientTitle = CLIENT_LINKS[platform].title
  const downloadUrl = CLIENT_LINKS[platform].market

  const connectAction = useMemo(() => {
    // android/ios: deep link import
    if (!subscriptionUrl) return { label: 'Подключить', onClick: () => {}, disabled: true as const }

    if (platform === 'android') {
      const href = `hiddify://install-sub/?url=${encodeURIComponent(subscriptionUrl)}`
      return {
        label: 'Добавить подписку',
        onClick: () => openLinkSafe(href),
        disabled: false as const,
      }
    }

    if (platform === 'ios') {
      const href = `v2ray://install-sub/?url=${encodeURIComponent(subscriptionUrl)}`
      return {
        label: 'Добавить подписку',
        onClick: () => openLinkSafe(href),
        disabled: false as const,
      }
    }

    // desktop: copy
    return {
      label: 'Скопировать ссылку',
      onClick: () => copyText(subscriptionUrl),
      disabled: false as const,
    }
  }, [platform, subscriptionUrl])

  const topHint = useMemo(() => {
    const pName = platformLabel(platform)
    if (loading) return `Готовим подключение для: ${pName}…`
    if (error) return `Не удалось подготовить подключение для: ${pName}.`
    if (isMobile(platform)) {
      return `Устройство: ${pName}. Обычно достаточно: 1) установить клиент 2) добавить подписку.`
    }
    return `Устройство: ${pName}. Обычно достаточно: 1) установить клиент 2) вставить ссылку подписки.`
  }, [platform, loading, error])

  async function openQr() {
    if (!subscriptionUrl) return
    try {
      const dataUrl = await QRCode.toDataURL(subscriptionUrl, { margin: 1, width: 320 })
      setQrDataUrl(dataUrl)
      setQrOpen(true)
    } catch {
      alert('Не удалось построить QR-код')
    }
  }

  const chips: Array<{ id: Chip; label: string; icon: string }> = [
    { id: 'auto', label: 'Текущее', icon: '✨' },
    { id: 'android', label: 'Android', icon: '🤖' },
    { id: 'ios', label: 'iOS', icon: '🧩' },
    { id: 'windows', label: 'Windows', icon: '🖥️' },
    { id: 'mac', label: 'macOS', icon: '💻' },
    { id: 'linux', label: 'Linux', icon: '🐧' },
  ]

  return (
    <div className="cm">
      <div className="pre" style={{ marginTop: 0 }}>
        ✅ Подписка готова. {topHint}
      </div>

      {error ? (
        <div className="pre" style={{ marginTop: 10 }}>
          {String(error)}
          <div style={{ marginTop: 10 }}>
            <button className="btn" onClick={load}>
              Повторить
            </button>
          </div>
        </div>
      ) : null}

      <div className="p" style={{ marginTop: 10 }}>
        Выберите устройство:
      </div>

      <div className="device-row" style={{ marginTop: 8 }}>
        {chips.map((c) => (
          <button
            key={c.id}
            className={`device-chip ${chip === c.id ? 'active' : ''}`}
            onClick={() => setChip(c.id)}
            type="button"
            disabled={loading}
          >
            <span className="icon">{c.icon}</span>
            <span>{c.label}</span>
          </button>
        ))}
      </div>

      <div className="cr__actionsGrid cr__actionsGrid--2" style={{ marginTop: 12 }}>
        <button
          className="btn cr__btnFull"
          onClick={() => openLinkSafe(downloadUrl)}
          disabled={loading}
          type="button"
        >
          Скачать {clientTitle}
        </button>

        <button
          className="btn btn--primary cr__btnFull"
          onClick={connectAction.onClick}
          disabled={loading || connectAction.disabled}
          type="button"
        >
          {loading ? 'Подождите…' : connectAction.label}
        </button>
      </div>

      {/* альтернативный способ — маленькой ссылкой */}
      {!error && !loading && subscriptionUrl ? (
        <div className="p" style={{ marginTop: 10 }}>
          Нужен другой способ?{' '}
          <button className="btn btn--link" type="button" onClick={openQr}>
            Показать QR-код
          </button>
        </div>
      ) : null}

      {platform === 'android' ? (
        <div className="p" style={{ marginTop: 6, opacity: 0.85 }}>
          Нет Google Play?{' '}
          <button className="btn btn--link" type="button" onClick={() => openLinkSafe(CLIENT_LINKS.android.apk)}>
            Скачать APK
          </button>
        </div>
      ) : null}

      {/* QR modal */}
      {qrOpen ? (
        <div className="modal" role="dialog" aria-modal="true" onClick={() => setQrOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">QR-код подписки</div>
            <div className="modal-sub">Откройте клиент на другом устройстве и импортируйте через QR.</div>
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