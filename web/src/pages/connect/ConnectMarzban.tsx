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
type AccordionKey = 'hiddify' | 'v2ray' | 'manual'
type RuntimeMode = 'telegram-miniapp' | 'browser' | 'standalone-app'
type ClientKind = 'hiddify' | 'v2ray'

type ClientLinks = Record<
  Platform,
  { title: string; market: string; direct?: string; storeLabelKey: string }
>

const V2RAYTUN_LINKS: ClientLinks = {
  android: {
    title: 'v2RayTun',
    market: 'https://play.google.com/store/apps/details?id=com.v2raytun.android',
    direct: 'https://github.com/DigneZzZ/v2raytun/releases/latest',
    storeLabelKey: 'connectAmneziaWG.store.google_play',
  },
  ios: {
    title: 'v2RayTun',
    market: 'https://apps.apple.com/us/app/v2raytun/id6476628951',
    storeLabelKey: 'connectAmneziaWG.store.app_store',
  },
  windows: {
    title: 'v2RayTun',
    market: 'https://v2raytun.com/',
    storeLabelKey: 'connectAmneziaWG.store.download_page',
  },
  mac: {
    title: 'v2RayTun',
    market: 'https://apps.apple.com/us/app/v2raytun/id6476628951',
    storeLabelKey: 'connectAmneziaWG.store.app_store',
  },
  linux: {
    title: 'v2RayTun',
    market: 'https://v2raytun.com/',
    storeLabelKey: 'connectAmneziaWG.store.download_page',
  },
}

const HIDDIFY_LINKS: ClientLinks = {
  android: {
    title: 'Hiddify',
    market: 'https://play.google.com/store/apps/details?id=app.hiddify.com',
    direct: 'https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-Android-arm64.apk',
    storeLabelKey: 'connectAmneziaWG.store.google_play',
  },
  ios: {
    title: 'Hiddify',
    market: 'https://apps.apple.com/us/app/hiddify-proxy-vpn/id6596777532',
    storeLabelKey: 'connectAmneziaWG.store.app_store',
  },
  windows: {
    title: 'Hiddify',
    market: 'https://github.com/hiddify/hiddify-app/releases',
    storeLabelKey: 'connectAmneziaWG.store.download_page',
  },
  mac: {
    title: 'Hiddify',
    market: 'https://github.com/hiddify/hiddify-app/releases',
    direct: 'https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-MacOS.dmg',
    storeLabelKey: 'connectAmneziaWG.store.download_page',
  },
  linux: {
    title: 'Hiddify',
    market: 'https://github.com/hiddify/hiddify-app/releases',
    direct: 'https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-Linux-x64.AppImage',
    storeLabelKey: 'connectAmneziaWG.store.download_page',
  },
}

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

function tryOpenScheme(url: string, runtime: RuntimeMode, onFail?: () => void) {
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
    onFail?.()
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

function installStateKey(usi: number, platform: Platform, client: ClientKind) {
  return `connect_marzban_install_started:${usi}:${platform}:${client}`
}

function readInstallState(usi: number, platform: Platform, client: ClientKind) {
  try {
    return localStorage.getItem(installStateKey(usi, platform, client)) === '1'
  } catch {
    return false
  }
}

function writeInstallState(usi: number, platform: Platform, client: ClientKind, value: boolean) {
  try {
    if (value) localStorage.setItem(installStateKey(usi, platform, client), '1')
    else localStorage.removeItem(installStateKey(usi, platform, client))
  } catch {
    // ignore
  }
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
    setMaxHeight(props.opened ? el.scrollHeight : 0)
  }, [props.opened, props.children])

  useEffect(() => {
    const el = innerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const ro = new ResizeObserver(() => {
      if (props.opened) setMaxHeight(el.scrollHeight)
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
    <div ref={cardRef} className="card cawg__accCard">
      <button
        type="button"
        onClick={props.onToggle}
        className="kv__item cawg__accToggle"
        aria-expanded={props.opened}
      >
        <div className="row so__spaceBetween">
          <div>
            <div className="kv__v">{props.title}</div>
            <div className="p">{props.subtitle}</div>
          </div>

          <div className="list__side">
            <span className={`badge cawg__accBadge ${props.opened ? 'is-open' : ''}`} aria-hidden>
              ▾
            </span>
          </div>
        </div>
      </button>

      <div
        className={`cawg__accBody ${props.opened ? 'is-open' : ''}`}
        style={{ maxHeight: `${maxHeight}px` }}
      >
        <div ref={innerRef} className="card__body cawg__accBodyInner">
          {props.children}
        </div>
      </div>
    </div>
  )
}

export default function ConnectMarzban({ usi }: Props) {
  const { t } = useDict()

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

  const [installStarted, setInstallStarted] = useState<Record<ClientKind, boolean>>({
    hiddify: false,
    v2ray: false,
  })

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
      const msg = e?.message || t('connect.load_failed')
      setError(msg)

      toast.error(t('connect.sub_prepare_error'), {
        description:
          msg === 'subscription_url_missing'
            ? t('connect.sub_prepare_error_desc')
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
  }, [platform, primaryKind])

  useEffect(() => {
    setInstallStarted({
      hiddify: readInstallState(usi, platform, 'hiddify'),
      v2ray: readInstallState(usi, platform, 'v2ray'),
    })
  }, [usi, platform])

  const ready = !loading && !error && !!subscriptionUrl

  const hiddifyClient = HIDDIFY_LINKS[platform]
  const v2rayClient = V2RAYTUN_LINKS[platform]
  const primaryClient = primaryKind === 'hiddify' ? hiddifyClient : v2rayClient

  const hiddifyAutoImportHref = ready ? buildHiddifyImportLink(subscriptionUrl, platform) : ''
  const v2rayAutoImportHref = ready ? buildV2RayTunImportLink(subscriptionUrl, platform) : ''

  const topHint = useMemo(() => {
    if (loading) return t('connect.loading')
    if (error) return t('connect.error')
    return `${t('connect.ready')} ${t('connect.sub_ready_desc')}`
  }, [loading, error, t])

  function toggleAccordion(key: AccordionKey) {
    userTouchedAccordionsRef.current = true
    setOpenAccordion(key)
  }

  function markInstallStarted(client: ClientKind) {
    writeInstallState(usi, platform, client, true)
    setInstallStarted((prev) => ({ ...prev, [client]: true }))
  }

  function resetInstallStarted(client: ClientKind) {
    writeInstallState(usi, platform, client, false)
    setInstallStarted((prev) => ({ ...prev, [client]: false }))
  }

  async function openQr() {
    if (!subscriptionUrl) return

    try {
      const dataUrl = await QRCode.toDataURL(subscriptionUrl, { margin: 2, width: 360 })
      setQrDataUrl(dataUrl)
      setQrOpen(true)

      toast.info(t('connect.qr_title'), {
        description: t('connect.qr_text'),
      })
    } catch {
      toast.error(t('connect.qr_title'), {
        description: t('connect.sub_prepare_error_desc'),
      })
    }
  }

  async function copySub() {
    if (!subscriptionUrl) return

    const ok = await copyToClipboard(subscriptionUrl)
    setCopied(ok)

    if (ok) {
      setTimeout(() => setCopied(false), 1500)
      toast.success(t('connect.copied'), {
        description: t('connect.import_text'),
      })
    } else {
      toast.error(t('connect.copy_link'), {
        description: t('connect.sub_prepare_error_desc'),
      })
    }
  }

  function openHiddifyAutoImport() {
    if (!ready || !hiddifyAutoImportHref) return

    tryOpenScheme(hiddifyAutoImportHref, runtime, () => {
      toast.info(t('connect.open_client'), {
        description: t('connect.more_methods'),
      })
    })

    toast.info(t('connect.open_client'), {
      description: t('connect.import_text'),
    })
  }

  function openV2RayAutoImport() {
    if (!ready || !v2rayAutoImportHref) return

    tryOpenScheme(v2rayAutoImportHref, runtime, () => {
      toast.info(t('connect.open_client'), {
        description: t('connect.more_methods'),
      })
    })

    toast.info(t('connect.open_client'), {
      description: t('connect.import_text'),
    })
  }

  function openPrimaryAutoImport() {
    if (primaryKind === 'hiddify') openHiddifyAutoImport()
    else openV2RayAutoImport()
  }

  function openClientStore(client: ClientKind) {
    const links = client === 'hiddify' ? hiddifyClient : v2rayClient
    markInstallStarted(client)
    openLinkSafe(links.market)
  }

  function openClientDirect(client: ClientKind) {
    const links = client === 'hiddify' ? hiddifyClient : v2rayClient
    if (!links.direct) return
    markInstallStarted(client)
    openLinkSafe(links.direct)
  }

  function clientStoreLabel(client: ClientKind) {
    const links = client === 'hiddify' ? hiddifyClient : v2rayClient
    return t(links.storeLabelKey)
  }

  function clientSubtitle(client: ClientKind) {
    const links = client === 'hiddify' ? hiddifyClient : v2rayClient
    return t('connect.install_text', {
      client: links.title,
      platform: platformLabel(platform),
    })
  }

  function stepOneText(clientTitle: string) {
    return `Установите ${clientTitle} для ${platformLabel(platform)} и вернитесь сюда, чтобы импортировать подписку в приложение.`
  }

  function stepTwoText() {
    return 'После установки вернитесь сюда и добавьте подписку в приложение.'
  }

  function otherMethodsText() {
    return 'Можно отсканировать QR или скопировать ссылку для ручного добавления в приложение.'
  }

  function renderInstallActions(client: ClientKind) {
    const links = client === 'hiddify' ? hiddifyClient : v2rayClient

    if (links.direct) {
      return (
        <div className="actions actions--2">
          <button className="btn btn--primary" type="button" onClick={() => openClientStore(client)}>
            {t('connectAmneziaWG.step1.open_store', { store: clientStoreLabel(client) })}
          </button>

          <button className="btn btn--accent" type="button" onClick={() => openClientDirect(client)}>
            {platform === 'android'
              ? t('connectAmneziaWG.step1.download_apk')
              : t('connectAmneziaWG.step1.download_direct')}
          </button>
        </div>
      )
    }

    return (
      <div className="actions actions--1">
        <button className="btn btn--primary" type="button" onClick={() => openClientStore(client)}>
          {t('connectAmneziaWG.step1.open_store', { store: clientStoreLabel(client) })}
        </button>
      </div>
    )
  }

  function renderClientAccordion(client: ClientKind) {
    const links = client === 'hiddify' ? hiddifyClient : v2rayClient
    const started = installStarted[client]
    const opened = openAccordion === client
    const openAutoImport = client === 'hiddify' ? openHiddifyAutoImport : openV2RayAutoImport

    return (
      <Accordion
        title={links.title}
        subtitle={clientSubtitle(client)}
        opened={opened}
        onToggle={() => toggleAccordion(client)}
      >
        <div className="card section">
          <div className="card__body">
            <div className="pre">
              <b>{t('connect.step_install')}</b>
              <br />
              {stepOneText(links.title)}
            </div>

            {renderInstallActions(client)}
          </div>
        </div>

        <div className="card section">
          <div className="card__body">
            <div className="pre">
              <b>{t('connect.step_import')}</b>
              <br />
              {started ? stepTwoText() : stepTwoText()}
            </div>

            <div className="actions actions--1">
              <button
                className="btn btn--primary so__btnFull"
                type="button"
                onClick={openAutoImport}
                disabled={!ready}
                title={!ready ? t('connect.wait') : undefined}
              >
                {loading ? t('connect.wait') : t('connect.add_sub')}
              </button>
            </div>
          </div>
        </div>

        {started ? (
          <div className="actions actions--1">
            <button className="btn so__btnFull" type="button" onClick={() => resetInstallStarted(client)}>
              {t('connect.step_install')}
            </button>
          </div>
        ) : null}
      </Accordion>
    )
  }

  return (
    <div className="cm">
      <div className="pre">
        {ready ? '✅ ' : error ? '⚠️ ' : '… '}
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
              : platformLabel(platform)}
            <span aria-hidden>▾</span>
          </button>
        </div>
      </div>

      <div className="card section">
        <div className="card__body">
          <p className="p">
            {t('connect.install_text', {
              client: primaryClient.title,
              platform: platformLabel(platform),
            })}
          </p>

          <div className="card section">
            <div className="card__body">
              <div className="pre">
                <b>{t('connect.step_install')}</b>
                <br />
                {stepOneText(primaryClient.title)}
              </div>

              {renderInstallActions(primaryKind)}
            </div>
          </div>

          <div className="card section">
            <div className="card__body">
              <div className="pre">
                <b>{t('connect.step_import')}</b>
                <br />
                {stepTwoText()}
              </div>

              <div className="actions actions--1">
                <button
                  className="btn btn--primary so__btnFull"
                  onClick={openPrimaryAutoImport}
                  disabled={!ready}
                  type="button"
                  title={!ready ? t('connect.wait') : undefined}
                >
                  {loading ? t('connect.wait') : t('connect.add_sub')}
                </button>
              </div>

              <div className="section">
                <div className="pre">
                  <b>{t('connect.more_methods')}</b>
                  <br />
                  {otherMethodsText()}
                </div>

                <div className="actions actions--1">
                  <button
                    className="btn btn--accent so__btnFull"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    type="button"
                  >
                    {advancedOpen
                      ? `▴ ${t('connect.hide_methods')}`
                      : `▾ ${t('connect.more_methods')}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {advancedOpen && ready ? (
        <div className="section">
          {primaryKind === 'hiddify' ? renderClientAccordion('hiddify') : renderClientAccordion('v2ray')}
          {primaryKind === 'hiddify' ? renderClientAccordion('v2ray') : renderClientAccordion('hiddify')}

          <Accordion
            title={t('connect.more_methods')}
            subtitle={otherMethodsText()}
            opened={openAccordion === 'manual'}
            onToggle={() => toggleAccordion('manual')}
          >
            <div className="card section">
              <div className="card__body">
                <div className="pre">
                  <b>📋 {t('connect.copy_link')}</b>
                  <br />
                  {'Скопируйте ссылку для ручного добавления в приложение.'}
                </div>

                <div className="actions actions--1">
                  <button className="btn btn--primary so__btnFull" type="button" onClick={copySub}>
                    {copied ? `✅ ${t('connect.copied')}` : `📋 ${t('connect.copy_link')}`}
                  </button>
                </div>
              </div>
            </div>

            <div className="card section">
              <div className="card__body">
                <div className="pre">
                  <b>📱 {t('connect.show_qr')}</b>
                  <br />
                  {'Отсканируйте QR для ручного добавления в приложение.'}
                </div>

                <div className="actions actions--1">
                  <button className="btn btn--primary so__btnFull" type="button" onClick={openQr}>
                    📱 {t('connect.show_qr')}
                  </button>
                </div>
              </div>
            </div>
          </Accordion>
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
                  aria-label={t('services.close')}
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
                  {t('services.close')}
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
                <div className="overlay__title">{t('connect.qr_title')}</div>

                <button className="btn" type="button" onClick={() => setQrOpen(false)} aria-label={t('services.close')}>
                  ✕
                </button>
              </div>

              <p className="p so__mt8">{t('connect.qr_text')}</p>

              <div className="pre so__mt12">
                {qrDataUrl ? (
                  <img
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
                  {t('services.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}