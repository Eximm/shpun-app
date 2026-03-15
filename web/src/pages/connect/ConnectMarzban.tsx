import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { apiFetch } from '../../shared/api/client'
import { toast } from '../../shared/ui/toast'

type Props = {
  usi: number
  service: { title: string; status: string; statusRaw: string }
  onDone?: () => void
}

type Platform = 'android' | 'ios' | 'windows' | 'mac' | 'linux'
type Chip = 'auto' | Platform

const IOS_HIDDIFY_URL = 'https://apps.apple.com/us/app/hiddify-proxy-vpn/id6596777532'

const CLIENT_LINKS: Record<
  Platform,
  { title: string; market: string; direct?: string; storeLabel: string }
> = {
  android: {
    title: 'Hiddify',
    market: 'https://play.google.com/store/apps/details?id=app.hiddify.com',
    direct: 'https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-Android-arm64.apk',
    storeLabel: 'Google Play',
  },
  ios: {
    title: 'Hiddify',
    market: IOS_HIDDIFY_URL,
    storeLabel: 'App Store',
  },
  windows: {
    title: 'Hiddify',
    market: 'https://github.com/hiddify/hiddify-app/releases',
    storeLabel: 'страницу скачивания',
  },
  mac: {
    title: 'Hiddify',
    market: 'https://github.com/hiddify/hiddify-app/releases',
    direct: 'https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-MacOS.dmg',
    storeLabel: 'страницу скачивания',
  },
  linux: {
    title: 'Hiddify',
    market: 'https://github.com/hiddify/hiddify-app/releases',
    direct: 'https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-Linux-x64.AppImage',
    storeLabel: 'страницу скачивания',
  },
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

function buildAutoImportLink(platform: Platform, subscriptionUrl: string) {
  const u = encodeURIComponent(subscriptionUrl)

  if (platform === 'android' || platform === 'ios' || platform === 'windows' || platform === 'mac' || platform === 'linux') {
    return `hiddify://install-sub/?url=${u}`
  }

  return `hiddify://install-sub/?url=${u}`
}

export default function ConnectMarzban({ usi }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const autoPlatform = useMemo(() => detectOS(), [])
  const [chip, setChip] = useState<Chip>('auto')
  const platform: Platform = chip === 'auto' ? autoPlatform : chip

  const [platformPickerOpen, setPlatformPickerOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  const [subscriptionUrl, setSubscriptionUrl] = useState<string>('')

  const [copied, setCopied] = useState(false)

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

      toast.success('Подписка готова', {
        description: 'Её можно добавить в приложение.',
      })
    } catch (e: any) {
      setSubscriptionUrl('')
      const msg = e?.message || 'Не удалось загрузить ссылку подписки'
      setError(msg)

      toast.error('Не удалось подготовить подписку', {
        description:
          msg === 'subscription_url_missing'
            ? 'Ссылка подписки пока недоступна. Попробуйте чуть позже.'
            : String(msg),
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usi])

  const ready = !loading && !error && !!subscriptionUrl

  const topHint = useMemo(() => {
    const pName = platformLabel(platform)
    if (loading) return `Готовим подключение для: ${pName}…`
    if (error) return `Не удалось подготовить подключение для: ${pName}.`
    if (isMobile(platform)) return `Устройство: ${pName}. Шаги ниже помогут установить приложение и добавить подписку.`
    return `Устройство: ${pName}. Шаги ниже помогут установить приложение и добавить подписку.`
  }, [platform, loading, error])

  async function openQr() {
    if (!subscriptionUrl) return
    try {
      const dataUrl = await QRCode.toDataURL(subscriptionUrl, { margin: 2, width: 360 })
      setQrDataUrl(dataUrl)
      setQrOpen(true)

      toast.info('QR-код готов', {
        description: 'Откройте клиент на другом устройстве и импортируйте подписку по QR.',
      })
    } catch (e: any) {
      toast.error('Не удалось показать QR-код', {
        description: String(e?.message || 'Попробуйте ещё раз.'),
      })
    }
  }

  async function copySub() {
    if (!subscriptionUrl) return
    const ok = await copyToClipboard(subscriptionUrl)
    setCopied(ok)
    if (ok) {
      setTimeout(() => setCopied(false), 1500)
      toast.success('Ссылка подписки скопирована', {
        description: 'Теперь её можно вставить в клиент вручную.',
      })
    } else {
      toast.error('Не удалось скопировать ссылку', {
        description: 'Попробуйте ещё раз или используйте QR-код.',
      })
    }
  }

  function openAutoImport() {
    if (!ready || !autoImportHref) return
    openLinkSafe(autoImportHref)

    toast.info('Открываем приложение', {
      description: 'Если Hiddify установлен, подписка добавится автоматически.',
    })
  }

  const client = CLIENT_LINKS[platform]
  const autoImportHref = ready ? buildAutoImportLink(platform, subscriptionUrl) : ''

  return (
    <div className="cm">
      <div className="pre" style={{ marginTop: 0 }}>
        {ready ? '✅ Подписка готова. ' : error ? '⚠️ Подписка не готова. ' : '… '}
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

      <div className="row cawg__rowTop">
        <div className="p cawg__label">Устройство:</div>

        <button
          className="btn cawg__deviceBtn"
          type="button"
          onClick={() => setPlatformPickerOpen(true)}
          disabled={loading}
          aria-label="Выбор устройства"
        >
          {chip === 'auto' ? `✨ Текущее (${platformLabel(autoPlatform)})` : platformLabel(platform)}{' '}
          <span aria-hidden>▾</span>
        </button>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <div className="services-cat__title">1) Установите приложение</div>

          <p className="p" style={{ opacity: 0.82, marginTop: 6 }}>
            Установите <b>{client.title}</b> для {platformLabel(platform)}.
          </p>

          <div className="actions actions--2" style={{ marginTop: 10 }}>
            <button
              className="btn btn--primary"
              onClick={() => openLinkSafe(client.market)}
              disabled={loading}
              type="button"
            >
              Открыть {client.storeLabel}
            </button>

            {platform === 'android' && client.direct ? (
              <button className="btn" onClick={() => openLinkSafe(client.direct!)} disabled={loading} type="button">
                Скачать APK
              </button>
            ) : client.direct ? (
              <button className="btn" onClick={() => openLinkSafe(client.direct!)} disabled={loading} type="button">
                Скачать напрямую
              </button>
            ) : (
              <button className="btn" onClick={() => openLinkSafe(client.market)} disabled={loading} type="button">
                Скачать напрямую
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <div className="services-cat__title">2) Добавьте подписку</div>

          <p className="p" style={{ opacity: 0.82, marginTop: 6 }}>
            Нажмите “Добавить подписку” — мы откроем приложение и импортируем подписку автоматически.
          </p>

          <div className="actions actions--2" style={{ marginTop: 10 }}>
            <button
              className="btn btn--primary"
              onClick={openAutoImport}
              disabled={!ready}
              type="button"
              title={!ready ? 'Подписка ещё не готова' : undefined}
            >
              {loading ? 'Подождите…' : 'Добавить подписку'}
            </button>

            <button className="btn" onClick={() => setMoreOpen((v) => !v)} disabled={!ready} type="button">
              {moreOpen ? 'Скрыть способы' : 'Другие способы'}
            </button>
          </div>

          {moreOpen && ready ? (
            <div style={{ marginTop: 10 }}>
              <div className="pre" style={{ opacity: 0.95 }}>
                <div className="actions actions--1" style={{ marginTop: 0 }}>
                  <button className="btn btn--soft so__btnFull" type="button" onClick={copySub}>
                    {copied ? '✅ Ссылка скопирована' : 'Скопировать ссылку подписки'}
                  </button>
                </div>

                <div className="actions actions--1" style={{ marginTop: 10 }}>
                  <button className="btn so__btnFull" type="button" onClick={openQr}>
                    Показать QR
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {platformPickerOpen ? (
        <div className="overlay" role="dialog" aria-modal="true" onClick={() => setPlatformPickerOpen(false)}>
          <div className="card overlay__card" onClick={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="row so__spaceBetween" style={{ alignItems: 'center' }}>
                <div className="overlay__title">Выберите устройство</div>
                <button className="btn" type="button" onClick={() => setPlatformPickerOpen(false)} aria-label="Закрыть">
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
                    <div className="kv__k" style={{ fontWeight: 700 }}>
                      ✨ Текущее
                    </div>
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
                      <div className="kv__k" style={{ fontWeight: 700 }}>
                        {platformLabel(p)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="actions actions--1 so__mt12">
                <button className="btn so__btnFull" type="button" onClick={() => setPlatformPickerOpen(false)}>
                  Закрыть
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
              <div className="row so__spaceBetween" style={{ alignItems: 'center' }}>
                <div className="overlay__title">QR-код подписки</div>

                <button className="btn" type="button" onClick={() => setQrOpen(false)} aria-label="Закрыть">
                  ✕
                </button>
              </div>

              <p className="p so__mt8" style={{ opacity: 0.82 }}>
                Откройте клиент на другом устройстве и импортируйте подписку через QR.
              </p>

              <div
                className="pre so__mt12"
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  padding: 12,
                  overflow: 'hidden',
                }}
              >
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="QR Code"
                    loading="lazy"
                    decoding="async"
                    style={{
                      width: 360,
                      maxWidth: '100%',
                      height: 'auto',
                      borderRadius: 14,
                    }}
                  />
                ) : null}
              </div>

              <div className="actions actions--1 so__mt12">
                <button className="btn btn--primary so__btnFull" onClick={() => setQrOpen(false)} type="button">
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}