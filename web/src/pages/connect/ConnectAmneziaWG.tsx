import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { apiFetch } from '../../shared/api/client'

// ✅ toasts + mood (типизированные ключи — только из payments-mood)
import { toast } from '../../shared/ui/toast'
import { getMood } from '../../shared/payments-mood'

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
  // важно: не text/plain, иначе iOS/Telegram WebView может приписать .txt
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
  const [qrDataUrl, setQrDataUrl] = useState<string>('')

  // ✅ prevent “profile ready” toast from repeating
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

      // ✅ small toast once
      if (!didToastReadyRef.current) {
        didToastReadyRef.current = true
        toast.success('Профиль готов', {
          description: getMood('payment_success', { seed: String(usi) }) ?? 'Можно импортировать в AmneziaWG.',
        })
      }
    } catch (e: any) {
      setConfigText('')
      const msg = e?.message || 'Не удалось загрузить конфигурацию'
      setError(msg)

      toast.error('Не удалось подготовить профиль', {
        description: msg === 'profile_missing' ? 'Профиль пока недоступен. Попробуйте чуть позже.' : String(msg),
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
    if (loading) return `Готовим подключение для: ${pName}…`
    if (error) return `Не удалось подготовить подключение для: ${pName}.`
    return `Устройство: ${pName}. Шаги ниже помогут установить приложение и импортировать профиль (.conf).`
  }, [platform, loading, error])

  async function openQr() {
    if (!configText) return
    try {
      const dataUrl = await QRCode.toDataURL(configText, { margin: 2, width: 360 })
      setQrDataUrl(dataUrl)
      setQrOpen(true)

      toast.info('QR-код готов', {
        description: getMood('payment_checking', { seed: String(usi) }) ?? 'Откройте AmneziaWG и импортируйте по QR.',
      })
    } catch (e: any) {
      toast.error('Не удалось построить QR', {
        description: String(e?.message || 'Попробуйте ещё раз.'),
      })
    }
  }

  function downloadConf() {
    if (!configText) return
    downloadTextFile(configName || `vpn${usi}.conf`, configText)

    toast.success('Скачивание началось', {
      description: getMood('payment_success', { seed: String(usi) }) ?? 'Файл .conf сохранится в загрузках.',
    })
  }

  async function copyConf() {
    if (!configText) return
    const ok = await copyToClipboard(configText)
    if (ok) {
      toast.success('Скопировано', {
        description: getMood('payment_success', { seed: String(usi) }) ?? 'Профиль в буфере обмена.',
      })
    } else {
      toast.error('Не удалось скопировать', {
        description: 'Браузер запретил копирование. Попробуйте другой способ.',
      })
    }
  }

  // Step 2: основной способ всегда — скачать .conf (для всех устройств)
  const main2Label = 'Скачать конфиг (.conf)'
  const main2Action = downloadConf

  const storeLabel =
    platform === 'android'
      ? 'Google Play'
      : platform === 'ios' || platform === 'mac'
        ? 'App Store'
        : 'страницу скачивания'

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

      {/* device picker */}
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

      {/* Step 1 */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <div className="services-cat__title">1) Установите приложение</div>

          <p className="p" style={{ opacity: 0.82, marginTop: 6 }}>
            Установите <b>AmneziaWG</b> для {platformLabel(platform)}.
          </p>

          <div className="actions actions--2" style={{ marginTop: 10 }}>
            <button
              className="btn btn--primary"
              onClick={() => openLinkSafe(APP_LINKS[platform])}
              disabled={loading}
              type="button"
            >
              Открыть {storeLabel}
            </button>

            {platform === 'android' ? (
              <button className="btn" onClick={() => openLinkSafe(APK_LINK)} disabled={loading} type="button">
                Скачать APK
              </button>
            ) : (
              <button className="btn" onClick={() => openLinkSafe(APP_LINKS[platform])} disabled={loading} type="button">
                Скачать напрямую
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Step 2 */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <div className="services-cat__title">2) Добавьте профиль</div>

          <p className="p" style={{ opacity: 0.82, marginTop: 6 }}>
            Скачайте <b>.conf</b> и импортируйте файл в <b>AmneziaWG</b>.{' '}
            <span style={{ display: 'inline-block', marginLeft: 6 }}>(QR и копирование — в «Другие способы».)</span>
          </p>

          <div className="actions actions--2" style={{ marginTop: 10 }}>
            <button
              className="btn btn--primary"
              onClick={main2Action}
              disabled={!ready}
              type="button"
              title={!ready ? 'Профиль ещё не готов' : undefined}
            >
              {loading ? 'Подождите…' : main2Label}
            </button>

            <button className="btn" onClick={() => setMoreOpen((v) => !v)} disabled={!ready} type="button">
              {moreOpen ? 'Скрыть способы' : 'Другие способы'}
            </button>
          </div>

          {/* More ways */}
          {moreOpen && ready ? (
            <div style={{ marginTop: 10 }}>
              <div className="pre" style={{ opacity: 0.95 }}>
                <div className="actions actions--1" style={{ marginTop: 0 }}>
                  <button className="btn btn--soft so__btnFull" type="button" onClick={openQr}>
                    Показать QR
                  </button>
                </div>

                <div className="actions actions--1" style={{ marginTop: 10 }}>
                  <button className="btn btn--soft so__btnFull" type="button" onClick={copyConf}>
                    Скопировать конфиг
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* picker overlay */}
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

      {/* QR overlay */}
      {qrOpen ? (
        <div className="overlay" role="dialog" aria-modal="true" onClick={() => setQrOpen(false)}>
          <div className="card overlay__card" onClick={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="row so__spaceBetween" style={{ alignItems: 'center' }}>
                <div className="overlay__title">QR-код профиля</div>

                <button className="btn" type="button" onClick={() => setQrOpen(false)} aria-label="Закрыть">
                  ✕
                </button>
              </div>

              <p className="p so__mt8" style={{ opacity: 0.82 }}>
                В AmneziaWG выберите импорт по QR и наведите камеру.
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