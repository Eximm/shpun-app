import { useEffect, useMemo, useRef, useState } from 'react'
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
type AccordionKey = 'hiddify' | 'v2ray' | 'manual'

type ClientLinks = Record<
  Platform,
  { title: string; market: string; direct?: string; storeLabel: string }
>

const V2RAYTUN_LINKS: ClientLinks = {
  android: {
    title: 'v2RayTun',
    market: 'https://play.google.com/store/apps/details?id=com.v2raytun.android',
    direct: 'https://github.com/DigneZzZ/v2raytun/releases/latest',
    storeLabel: 'Google Play',
  },
  ios: {
    title: 'v2RayTun',
    market: 'https://apps.apple.com/us/app/v2raytun/id6476628951',
    storeLabel: 'App Store',
  },
  windows: {
    title: 'v2RayTun',
    market: 'https://v2raytun.com/',
    storeLabel: 'официальный сайт',
  },
  mac: {
    title: 'v2RayTun',
    market: 'https://apps.apple.com/us/app/v2raytun/id6476628951',
    storeLabel: 'App Store',
  },
  linux: {
    title: 'v2RayTun',
    market: 'https://v2raytun.com/',
    storeLabel: 'официальный сайт',
  },
}

const HIDDIFY_LINKS: ClientLinks = {
  android: {
    title: 'Hiddify',
    market: 'https://play.google.com/store/apps/details?id=app.hiddify.com',
    direct: 'https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-Android-arm64.apk',
    storeLabel: 'Google Play',
  },
  ios: {
    title: 'Hiddify',
    market: 'https://apps.apple.com/us/app/hiddify-proxy-vpn/id6596777532',
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

function isIOSPlatform(p: Platform) {
  return p === 'ios'
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

function tryOpenScheme(url: string, opts?: { fallbackToast?: string }) {
  const fallbackToast =
    opts?.fallbackToast || 'Если приложение не открылось, используйте ручной импорт по ссылке или QR.'

  let hidden = false
  const onVisibilityChange = () => {
    if (document.hidden) hidden = true
  }

  document.addEventListener('visibilitychange', onVisibilityChange, { once: true })

  try {
    window.location.href = url
  } catch {
    // ignore
  }

  setTimeout(() => {
    if (hidden) return
    try {
      const a = document.createElement('a')
      a.href = url
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      setTimeout(() => {
        try {
          document.body.removeChild(a)
        } catch {
          // ignore
        }
      }, 250)
    } catch {
      // ignore
    }
  }, 250)

  setTimeout(() => {
    if (hidden) return
    try {
      const iframe = document.createElement('iframe')
      iframe.style.display = 'none'
      iframe.src = url
      document.body.appendChild(iframe)
      setTimeout(() => {
        try {
          document.body.removeChild(iframe)
        } catch {
          // ignore
        }
      }, 1000)
    } catch {
      // ignore
    }
  }, 550)

  setTimeout(() => {
    if (!hidden) {
      toast.info('Не получилось открыть приложение', {
        description: fallbackToast,
      })
    }
  }, 1300)
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

function buildV2RayTunImportLink(subscriptionUrl: string) {
  return `v2raytun://import/${subscriptionUrl}`
}

function buildHiddifyImportLink(subscriptionUrl: string) {
  return `hiddify://install-sub/?url=${encodeURIComponent(subscriptionUrl)}`
}

function Accordion(props: {
  title: string
  subtitle: string
  opened: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="card"
      style={{
        marginTop: 10,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={props.onToggle}
        className="kv__item"
        style={{
          width: '100%',
          textAlign: 'left',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          padding: 14,
        }}
      >
        <div className="row so__spaceBetween" style={{ alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700 }}>{props.title}</div>
            <div className="p" style={{ opacity: 0.72, marginTop: 4 }}>
              {props.subtitle}
            </div>
          </div>

          <span className="badge" aria-hidden>
            {props.opened ? '▴' : '▾'}
          </span>
        </div>
      </button>

      {props.opened ? (
        <div
          className="card__body"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {props.children}
        </div>
      ) : null}
    </div>
  )
}

export default function ConnectMarzban({ usi }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const autoPlatform = useMemo(() => detectOS(), [])
  const [chip, setChip] = useState<Chip>('auto')
  const platform: Platform = chip === 'auto' ? autoPlatform : chip

  const [platformPickerOpen, setPlatformPickerOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const [openAccordions, setOpenAccordions] = useState<Record<AccordionKey, boolean>>({
    hiddify: true,
    v2ray: false,
    manual: false,
  })

  const userTouchedAccordionsRef = useRef(false)

  const [subscriptionUrl, setSubscriptionUrl] = useState('')
  const [copied, setCopied] = useState(false)

  const [qrOpen, setQrOpen] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')

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

  useEffect(() => {
    if (userTouchedAccordionsRef.current) return

    setOpenAccordions({
      hiddify: true,
      v2ray: false,
      manual: platform === 'ios',
    })
  }, [platform])

  const ready = !loading && !error && !!subscriptionUrl

  const primaryClient = HIDDIFY_LINKS[platform]
  const secondaryClient = V2RAYTUN_LINKS[platform]

  const hiddifyAutoImportHref = ready ? buildHiddifyImportLink(subscriptionUrl) : ''
  const v2rayAutoImportHref = ready ? buildV2RayTunImportLink(subscriptionUrl) : ''

  const topHint = useMemo(() => {
    const pName = platformLabel(platform)

    if (loading) return `Готовим подключение для: ${pName}…`
    if (error) return `Не удалось подготовить подключение для: ${pName}.`

    if (platform === 'ios') {
      return `Устройство: ${pName}. Рекомендуем Hiddify. Если автоимпорт не сработает внутри Telegram, ниже есть ручной импорт по ссылке и QR.`
    }

    if (platform === 'android') {
      return `Устройство: ${pName}. Рекомендуем Hiddify — обычно подписка импортируется туда быстрее.`
    }

    return `Устройство: ${pName}. Рекомендуемый клиент — Hiddify, также доступен альтернативный вариант.`
  }, [platform, loading, error])

  function toggleAccordion(key: AccordionKey) {
    userTouchedAccordionsRef.current = true
    setOpenAccordions((prev) => ({ ...prev, [key]: !prev[key] }))
  }

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

  function openHiddifyAutoImport() {
    if (!ready || !hiddifyAutoImportHref) return

    tryOpenScheme(hiddifyAutoImportHref, {
      fallbackToast: isIOSPlatform(platform)
        ? 'Если Hiddify не открылся внутри Telegram, сначала установите приложение, затем попробуйте ещё раз или используйте ручной импорт ниже.'
        : 'Если Hiddify не открылся, используйте ручной импорт по ссылке или QR.',
    })

    toast.info('Пытаемся открыть Hiddify', {
      description: 'Если приложение установлено, подписка добавится автоматически.',
    })
  }

  function openV2RayAutoImport() {
    if (!ready || !v2rayAutoImportHref) return

    tryOpenScheme(v2rayAutoImportHref, {
      fallbackToast: isIOSPlatform(platform)
        ? 'На iOS v2RayTun может открываться нестабильно. Лучше использовать Hiddify или ручной импорт.'
        : 'Если v2RayTun не открылся, используйте ручной импорт по ссылке или QR.',
    })

    toast.info('Пытаемся открыть v2RayTun', {
      description: 'Если приложение установлено, подписка будет передана в клиент.',
    })
  }

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

      <div className="row cawg__rowTop" style={{ marginTop: 12 }}>
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
          <div className="services-cat__title">Быстрое подключение</div>

          <p className="p" style={{ opacity: 0.82, marginTop: 6 }}>
            Основной клиент — <b>{primaryClient.title}</b>.
            {platform === 'android'
              ? ' Обычно подписка добавляется быстрее. При отсутствии Google Play можно использовать прямую загрузку.'
              : platform === 'ios'
                ? ' На iPhone и iPad рекомендуем начать с него. Если автоимпорт внутри Telegram не сработает, ниже есть ручной вариант.'
                : ' Это рекомендуемый вариант для подключения.'}
          </p>

          <div className="actions actions--2" style={{ marginTop: 10 }}>
            <button
              className="btn btn--primary"
              onClick={() => openLinkSafe(primaryClient.market)}
              disabled={loading}
              type="button"
            >
              Скачать Hiddify
            </button>

            <button
              className="btn btn--primary"
              onClick={openHiddifyAutoImport}
              disabled={!ready}
              type="button"
              title={!ready ? 'Подписка ещё не готова' : undefined}
            >
              {loading ? 'Подождите…' : 'Добавить подписку'}
            </button>
          </div>

          {ready ? (
            <div className="actions actions--1" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => setAdvancedOpen((v) => !v)} type="button">
                {advancedOpen ? 'Скрыть дополнительные варианты' : 'Другие варианты'}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {advancedOpen && ready ? (
        <>
          <Accordion
            title="Hiddify — основной клиент"
            subtitle="Рекомендуемый способ подключения для большинства устройств."
            opened={openAccordions.hiddify}
            onToggle={() => toggleAccordion('hiddify')}
          >
            <p className="p" style={{ opacity: 0.82, marginTop: 0 }}>
              Установите <b>Hiddify</b> для {platformLabel(platform)} и добавьте в него подписку.
              {platform === 'android' && primaryClient.direct
                ? ' Если Google Play недоступен, используйте прямую загрузку APK.'
                : ''}
            </p>

            <div className="actions actions--2" style={{ marginTop: 10 }}>
              <button
                className="btn btn--primary"
                onClick={() => openLinkSafe(primaryClient.market)}
                type="button"
              >
                Открыть {primaryClient.storeLabel}
              </button>

              <button className="btn" onClick={openHiddifyAutoImport} type="button">
                Открыть в Hiddify
              </button>
            </div>

            {primaryClient.direct ? (
              <div className="actions actions--1" style={{ marginTop: 10 }}>
                <button
                  className="btn so__btnFull"
                  type="button"
                  onClick={() => primaryClient.direct && openLinkSafe(primaryClient.direct)}
                >
                  {platform === 'android' ? 'Скачать Hiddify APK' : 'Скачать Hiddify напрямую'}
                </button>
              </div>
            ) : null}
          </Accordion>

          <Accordion
            title="v2RayTun — альтернативный клиент"
            subtitle="Запасной вариант, если Hiddify не подходит."
            opened={openAccordions.v2ray}
            onToggle={() => toggleAccordion('v2ray')}
          >
            <p className="p" style={{ opacity: 0.82, marginTop: 0 }}>
              Можно использовать <b>{secondaryClient.title}</b> как альтернативный клиент.
              {platform === 'ios'
                ? ' На iOS автооткрытие может работать менее стабильно, чем у Hiddify.'
                : platform === 'android'
                  ? ' Обычно импорт туда занимает больше времени, чем в Hiddify.'
                  : ''}
            </p>

            <div className="actions actions--2" style={{ marginTop: 10 }}>
              <button
                className="btn"
                onClick={() => openLinkSafe(secondaryClient.market)}
                type="button"
              >
                Скачать v2RayTun
              </button>

              <button className="btn" onClick={openV2RayAutoImport} type="button">
                Попробовать открыть в v2RayTun
              </button>
            </div>

            {secondaryClient.direct ? (
              <div className="actions actions--1" style={{ marginTop: 10 }}>
                <button
                  className="btn so__btnFull"
                  type="button"
                  onClick={() => secondaryClient.direct && openLinkSafe(secondaryClient.direct)}
                >
                  {platform === 'android' ? 'Скачать APK' : 'Скачать напрямую'}
                </button>
              </div>
            ) : null}
          </Accordion>

          <Accordion
            title="Ручное подключение"
            subtitle="Если автоимпорт не сработал, используйте ссылку подписки или QR."
            opened={openAccordions.manual}
            onToggle={() => toggleAccordion('manual')}
          >
            <p className="p" style={{ opacity: 0.82, marginTop: 0 }}>
              {platform === 'ios'
                ? 'Для iPhone ручной импорт — надёжный запасной вариант.'
                : 'Этот способ подойдёт, если приложение не открылось автоматически.'}
            </p>

            <div className="actions actions--1" style={{ marginTop: 10 }}>
              <button className="btn btn--soft so__btnFull" type="button" onClick={copySub}>
                {copied ? '✅ Ссылка скопирована' : 'Скопировать ссылку подписки'}
              </button>
            </div>

            <div className="actions actions--1" style={{ marginTop: 10 }}>
              <button className="btn so__btnFull" type="button" onClick={openQr}>
                Показать QR-код
              </button>
            </div>
          </Accordion>
        </>
      ) : null}

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