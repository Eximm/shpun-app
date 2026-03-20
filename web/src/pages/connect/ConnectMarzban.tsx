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
type RuntimeMode = 'telegram-miniapp' | 'browser' | 'standalone-app'
type ClientKind = 'hiddify' | 'v2ray'

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

function detectRuntime(): RuntimeMode {
  const tg: any = (window as any).Telegram?.WebApp
  const isTelegramMiniApp = !!tg

  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    (window.navigator as any).standalone === true

  if (isTelegramMiniApp) return 'telegram-miniapp'
  if (isStandalone) return 'standalone-app'
  return 'browser'
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

function closeTelegramMiniAppSoon(delay = 150) {
  setTimeout(() => {
    try {
      const tg: any = (window as any).Telegram?.WebApp
      if (tg && typeof tg.close === 'function') tg.close()
    } catch {
      // ignore
    }
  }, delay)
}

function tryOpenScheme(url: string, runtime: RuntimeMode, opts?: { fallbackToast?: string }) {
  const fallbackToast =
    opts?.fallbackToast || 'Если приложение не открылось, используйте ссылку или QR-код ниже.'

  try {
    const a = document.createElement('a')
    a.href = url
    a.rel = 'noopener noreferrer'
    a.style.display = 'none'

    if (runtime === 'telegram-miniapp') {
      a.target = '_blank'
    }

    document.body.appendChild(a)
    a.click()

    setTimeout(() => {
      try {
        document.body.removeChild(a)
      } catch {
        // ignore
      }
    }, 300)

    if (runtime === 'telegram-miniapp') {
      closeTelegramMiniAppSoon(150)
    }
  } catch {
    toast.info('Не получилось открыть приложение', {
      description: fallbackToast,
    })
  }
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

function buildV2RayTunImportLink(subscriptionUrl: string, platform: Platform) {
  if (platform === 'android') {
    return `intent://import/${encodeURIComponent(subscriptionUrl)}#Intent;scheme=v2raytun;package=com.v2raytun.android;end`
  }
  return `v2raytun://import/${subscriptionUrl}`
}

function buildHiddifyImportLink(subscriptionUrl: string, platform: Platform) {
  if (platform === 'android') {
    return `intent://install-sub/?url=${encodeURIComponent(subscriptionUrl)}#Intent;scheme=hiddify;package=app.hiddify.com;end`
  }
  return `hiddify://install-sub/?url=${encodeURIComponent(subscriptionUrl)}`
}

function Accordion(props: {
  title: string
  subtitle: string
  opened: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const [maxHeight, setMaxHeight] = useState(0)

  useEffect(() => {
    const el = innerRef.current
    if (!el) return

    if (props.opened) {
      setMaxHeight(el.scrollHeight)
    } else {
      setMaxHeight(0)
    }
  }, [props.opened, props.children])

  useEffect(() => {
    const el = innerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const ro = new ResizeObserver(() => {
      if (props.opened) {
        setMaxHeight(el.scrollHeight)
      }
    })

    ro.observe(el)
    return () => ro.disconnect()
  }, [props.opened])

  useEffect(() => {
    if (!props.opened) return

    const id = window.setTimeout(() => {
      cardRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }, 180)

    return () => window.clearTimeout(id)
  }, [props.opened])

  return (
    <div
      ref={cardRef}
      className="card cawg__accCard"
    >
      <button
        type="button"
        onClick={props.onToggle}
        className="kv__item cawg__accToggle"
        aria-expanded={props.opened}
      >
        <div className="row so__spaceBetween" style={{ alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700 }}>{props.title}</div>
            <div className="p" style={{ opacity: 0.72, marginTop: 4 }}>
              {props.subtitle}
            </div>
          </div>

          <span
            className={`badge cawg__accBadge ${props.opened ? 'is-open' : ''}`}
            aria-hidden
          >
            ▾
          </span>
        </div>
      </button>

      <div
        className={`cawg__accBody ${props.opened ? 'is-open' : ''}`}
        style={{ maxHeight: `${maxHeight}px` }}
      >
        <div
          ref={innerRef}
          className="card__body cawg__accBodyInner"
        >
          {props.children}
        </div>
      </div>
    </div>
  )
}

export default function ConnectMarzban({ usi }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const autoPlatform = useMemo(() => detectOS(), [])
  const runtime = useMemo(() => detectRuntime(), [])

  const [chip, setChip] = useState<Chip>('auto')
  const platform: Platform = chip === 'auto' ? autoPlatform : chip

  const [platformPickerOpen, setPlatformPickerOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const [openAccordion, setOpenAccordion] = useState<AccordionKey>('hiddify')
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

      toast.error('Не удалось подготовить подключение', {
        description:
          msg === 'subscription_url_missing'
            ? 'Ссылка пока недоступна. Попробуйте чуть позже.'
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

  const primaryKind: ClientKind = platform === 'ios' ? 'v2ray' : 'hiddify'

  useEffect(() => {
    if (userTouchedAccordionsRef.current) return
    setOpenAccordion(primaryKind)
  }, [platform, runtime, primaryKind])

  const ready = !loading && !error && !!subscriptionUrl

  const hiddifyClient = HIDDIFY_LINKS[platform]
  const v2rayClient = V2RAYTUN_LINKS[platform]

  const primaryClient = primaryKind === 'hiddify' ? hiddifyClient : v2rayClient

  const hiddifyAutoImportHref = ready ? buildHiddifyImportLink(subscriptionUrl, platform) : ''
  const v2rayAutoImportHref = ready ? buildV2RayTunImportLink(subscriptionUrl, platform) : ''

  const topHint = useMemo(() => {
    const pName = platformLabel(platform)

    if (loading) return `Готовим подключение для ${pName}…`
    if (error) return `Не удалось подготовить подключение для ${pName}.`

    if (platform === 'ios') {
      return 'Подписка готова. Для iPhone и iPad рекомендуем v2RayTun.'
    }

    if (platform === 'android') {
      return 'Подписка готова. Для Android рекомендуем Hiddify.'
    }

    return `Подписка готова. Рекомендуемый клиент для ${pName}: ${primaryClient.title}.`
  }, [platform, loading, error, primaryClient.title])

  function toggleAccordion(key: AccordionKey) {
    userTouchedAccordionsRef.current = true
    setOpenAccordion(key)
  }

  async function openQr() {
    if (!subscriptionUrl) return

    try {
      const dataUrl = await QRCode.toDataURL(subscriptionUrl, { margin: 2, width: 360 })
      setQrDataUrl(dataUrl)
      setQrOpen(true)

      toast.info('QR-код готов', {
        description: 'Откройте клиент на другом устройстве и добавьте подписку по QR-коду.',
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
      toast.success('Ссылка скопирована', {
        description: 'Теперь вставьте её в приложение вручную.',
      })
    } else {
      toast.error('Не удалось скопировать ссылку', {
        description: 'Попробуйте ещё раз или используйте QR-код.',
      })
    }
  }

  function openHiddifyAutoImport() {
    if (!ready || !hiddifyAutoImportHref) return

    tryOpenScheme(hiddifyAutoImportHref, runtime, {
      fallbackToast:
        runtime === 'telegram-miniapp'
          ? 'Если приложение не открылось, используйте ссылку или QR-код ниже.'
          : platform === 'ios'
            ? 'Если Hiddify не открылся, используйте ручное подключение ниже.'
            : 'Если Hiddify не открылся, используйте ссылку или QR-код ниже.',
    })

    toast.info('Открываем Hiddify', {
      description:
        runtime === 'telegram-miniapp'
          ? 'Если ничего не произошло, используйте другой способ ниже.'
          : 'Если приложение установлено, подписка добавится автоматически.',
    })
  }

  function openV2RayAutoImport() {
    if (!ready || !v2rayAutoImportHref) return

    tryOpenScheme(v2rayAutoImportHref, runtime, {
      fallbackToast:
        runtime === 'telegram-miniapp'
          ? 'Если приложение не открылось, используйте ссылку или QR-код ниже.'
          : platform === 'ios'
            ? 'Если v2RayTun не открылся, используйте ручное подключение ниже.'
            : 'Если v2RayTun не открылся, используйте ссылку или QR-код ниже.',
    })

    toast.info('Открываем v2RayTun', {
      description:
        runtime === 'telegram-miniapp'
          ? 'Если ничего не произошло, используйте другой способ ниже.'
          : 'Если приложение установлено, подписка будет добавлена автоматически.',
    })
  }

  function openPrimaryAutoImport() {
    if (primaryKind === 'hiddify') {
      openHiddifyAutoImport()
      return
    }
    openV2RayAutoImport()
  }

  const quickInstallLabel =
    primaryKind === 'hiddify' ? 'Скачать Hiddify' : 'Скачать v2RayTun'

  const quickPrimaryDescription = (() => {
    if (platform === 'android') {
      return 'Рекомендуем Hiddify. Обычно это самый простой способ подключения.'
    }
    if (platform === 'ios') {
      return 'Рекомендуем v2RayTun. Если не получится открыть сразу, ниже есть другие способы.'
    }
    return `Рекомендуем ${primaryClient.title} для быстрого подключения.`
  })()

  function renderHiddifyAccordion() {
    return (
      <Accordion
        title={primaryKind === 'hiddify' ? 'Hiddify — рекомендуемый вариант' : 'Hiddify — другой вариант'}
        subtitle={
          primaryKind === 'hiddify'
            ? 'Самый простой способ для большинства устройств.'
            : 'Попробуйте его, если основной вариант не подошёл.'
        }
        opened={openAccordion === 'hiddify'}
        onToggle={() => toggleAccordion('hiddify')}
      >
        <p className="p" style={{ opacity: 0.82, marginTop: 0 }}>
          Установите <b>Hiddify</b> и добавьте в него подписку.
          {platform === 'android' && hiddifyClient.direct
            ? ' Если Google Play недоступен, можно скачать APK напрямую.'
            : platform === 'ios'
              ? ' На iPhone это запасной вариант.'
              : ''}
        </p>

        <div className="actions actions--2" style={{ marginTop: 10 }}>
          <button className="btn btn--primary" onClick={() => openLinkSafe(hiddifyClient.market)} type="button">
            Открыть {hiddifyClient.storeLabel}
          </button>

          <button className="btn btn--primary" onClick={openHiddifyAutoImport} type="button">
            Добавить в Hiddify
          </button>
        </div>

        {hiddifyClient.direct ? (
          <div className="actions actions--1" style={{ marginTop: 10 }}>
            <button
              className="btn so__btnFull"
              type="button"
              onClick={() => hiddifyClient.direct && openLinkSafe(hiddifyClient.direct)}
            >
              {platform === 'android' ? 'Скачать APK' : 'Скачать напрямую'}
            </button>
          </div>
        ) : null}
      </Accordion>
    )
  }

  function renderV2RayAccordion() {
    return (
      <Accordion
        title={primaryKind === 'v2ray' ? 'v2RayTun — рекомендуемый вариант' : 'v2RayTun — другой вариант'}
        subtitle={
          primaryKind === 'v2ray'
            ? 'Лучший вариант для iPhone и iPad.'
            : 'Попробуйте его, если Hiddify не подошёл.'
        }
        opened={openAccordion === 'v2ray'}
        onToggle={() => toggleAccordion('v2ray')}
      >
        <p className="p" style={{ opacity: 0.82, marginTop: 0 }}>
          Установите <b>{v2rayClient.title}</b> и добавьте в него подписку.
          {platform === 'ios'
            ? ' Для iPhone и iPad это основной вариант.'
            : platform === 'android'
              ? ' На Android его можно использовать как альтернативу.'
              : ''}
        </p>

        <div className="actions actions--2" style={{ marginTop: 10 }}>
          <button className="btn btn--primary" onClick={() => openLinkSafe(v2rayClient.market)} type="button">
            Скачать v2RayTun
          </button>

          <button className="btn btn--primary" onClick={openV2RayAutoImport} type="button">
            Добавить в v2RayTun
          </button>
        </div>

        {v2rayClient.direct ? (
          <div className="actions actions--1" style={{ marginTop: 10 }}>
            <button
              className="btn so__btnFull"
              type="button"
              onClick={() => v2rayClient.direct && openLinkSafe(v2rayClient.direct)}
            >
              {platform === 'android' ? 'Скачать APK' : 'Скачать напрямую'}
            </button>
          </div>
        ) : null}
      </Accordion>
    )
  }

  return (
    <div className="cm">
      <div className="pre" style={{ marginTop: 0 }}>
        {ready ? '✅ ' : error ? '⚠️ ' : '… '}
        {topHint}
      </div>

      {!loading && error ? (
        <div className="pre" style={{ marginTop: 10 }}>
          {String(error)}

          <div style={{ marginTop: 10 }}>
            <button className="btn" onClick={load} type="button">
              Попробовать снова
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
          {chip === 'auto' ? `Текущее: ${platformLabel(autoPlatform)}` : platformLabel(platform)}{' '}
          <span aria-hidden>▾</span>
        </button>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <div className="services-cat__title">Быстрое подключение</div>

          <p className="p" style={{ opacity: 0.82, marginTop: 6 }}>
            {quickPrimaryDescription}
          </p>

          <div className="actions actions--2" style={{ marginTop: 10 }}>
            <button
              className="btn btn--primary"
              onClick={() => openLinkSafe(primaryClient.market)}
              disabled={loading}
              type="button"
            >
              {quickInstallLabel}
            </button>

            <button
              className="btn btn--primary"
              onClick={openPrimaryAutoImport}
              disabled={!ready}
              type="button"
              title={!ready ? 'Подключение ещё готовится' : undefined}
            >
              {loading ? 'Подождите…' : 'Добавить подписку'}
            </button>
          </div>

          {ready ? (
            <div className="actions actions--1" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => setAdvancedOpen((v) => !v)} type="button">
                {advancedOpen ? 'Скрыть другие способы' : 'Другие способы'}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {advancedOpen && ready ? (
        <>
          {primaryKind === 'hiddify' ? renderHiddifyAccordion() : renderV2RayAccordion()}
          {primaryKind === 'hiddify' ? renderV2RayAccordion() : renderHiddifyAccordion()}

          <Accordion
            title="Подключить вручную"
            subtitle="Подойдёт, если приложение не открылось автоматически."
            opened={openAccordion === 'manual'}
            onToggle={() => toggleAccordion('manual')}
          >
            <p className="p" style={{ opacity: 0.82, marginTop: 0 }}>
              Скопируйте ссылку подписки или откройте QR-код и добавьте подписку в приложение вручную.
            </p>

            <div className="actions actions--1" style={{ marginTop: 10 }}>
              <button className="btn btn--soft so__btnFull" type="button" onClick={copySub}>
                {copied ? '✅ Ссылка скопирована' : 'Скопировать ссылку'}
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
                      Текущее устройство
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
                Откройте приложение на другом устройстве и добавьте подписку по QR-коду.
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