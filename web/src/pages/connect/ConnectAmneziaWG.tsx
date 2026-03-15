import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { apiFetch } from '../../shared/api/client'
import { useI18n } from '../../shared/i18n'
import { toast } from '../../shared/ui/toast'

type Props = {
  usi: number
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

const APK_LINK =
  'https://github.com/amnezia-vpn/amneziawg-android/releases/latest'

function detectOS(): Platform {
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera || ''
  const isAndroid = /android/i.test(ua)
  const isAppleTouch =
    /\bMac\b/.test(ua) && (navigator as any).maxTouchPoints > 1
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
    String(
      resp?.configName ??
        resp?.filename ??
        resp?.fileName ??
        resp?.name ??
        ''
    ).trim() || 'vpn.conf'

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

function tr(template: string, params: Record<string, string | number>) {
  return Object.entries(params).reduce(
    (acc, [key, value]) => acc.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value)),
    template
  )
}

export default function ConnectAmneziaWG({ usi }: Props) {
  const { t } = useI18n()

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
      const r = (await apiFetch(
        `/services/${encodeURIComponent(String(usi))}/connect/amneziawg`,
        { method: 'GET' }
      )) as any

      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) {
        throw new Error(String(r.error || r.message))
      }

      const picked = pickConfig(r)
      if (!picked.text) throw new Error('profile_missing')

      setConfigText(picked.text)
      setConfigName(picked.name || `vpn${usi}.conf`)

      if (!didToastReadyRef.current) {
        didToastReadyRef.current = true
        toast.success(t('connectAmneziaWG.toast.ready.title', 'Профиль готов'), {
          description: t(
            'connectAmneziaWG.toast.ready.desc',
            'Теперь его можно импортировать в AmneziaWG.'
          ),
        })
      }
    } catch (e: any) {
      setConfigText('')

      const msg =
        e?.message ||
        t(
          'connectAmneziaWG.error.load_failed',
          'Не удалось загрузить профиль'
        )

      setError(msg)

      toast.error(
        t(
          'connectAmneziaWG.toast.prepare_failed.title',
          'Не удалось подготовить профиль'
        ),
        {
          description:
            msg === 'profile_missing'
              ? t(
                  'connectAmneziaWG.toast.prepare_failed.profile_missing',
                  'Профиль пока недоступен. Попробуйте чуть позже.'
                )
              : String(msg),
        }
      )
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

    if (loading) {
      return tr(
        t(
          'connectAmneziaWG.top_hint.loading',
          'Готовим подключение для {platform}…'
        ),
        { platform: pName }
      )
    }

    if (error) {
      return tr(
        t(
          'connectAmneziaWG.top_hint.error',
          'Не удалось подготовить подключение для {platform}.'
        ),
        { platform: pName }
      )
    }

    return tr(
      t(
        'connectAmneziaWG.top_hint.ready',
        'Устройство: {platform}. Ниже — установка приложения и импорт готового профиля.'
      ),
      { platform: pName }
    )
  }, [platform, loading, error, t])

  async function openQr() {
    if (!configText) return

    try {
      const dataUrl = await QRCode.toDataURL(configText, {
        margin: 2,
        width: 360,
      })

      setQrDataUrl(dataUrl)
      setQrOpen(true)

      toast.info(t('connectAmneziaWG.toast.qr_ready.title', 'QR-код готов'), {
        description: t(
          'connectAmneziaWG.toast.qr_ready.desc',
          'Откройте AmneziaWG и импортируйте профиль по QR-коду.'
        ),
      })
    } catch (e: any) {
      toast.error(
        t(
          'connectAmneziaWG.toast.qr_failed.title',
          'Не удалось показать QR-код'
        ),
        {
          description: String(
            e?.message ||
              t(
                'connectAmneziaWG.toast.qr_failed.desc',
                'Попробуйте ещё раз.'
              )
          ),
        }
      )
    }
  }

  function downloadConf() {
    if (!configText) return

    downloadTextFile(configName || `vpn${usi}.conf`, configText)

    toast.success(
      t('connectAmneziaWG.toast.download.title', 'Файл скачивается'),
      {
        description: t(
          'connectAmneziaWG.toast.download.desc',
          'Конфиг .conf появится в загрузках.'
        ),
      }
    )
  }

  async function copyConf() {
    if (!configText) return

    const ok = await copyToClipboard(configText)

    if (ok) {
      toast.success(
        t('connectAmneziaWG.toast.copy_ok.title', 'Конфиг скопирован'),
        {
          description: t(
            'connectAmneziaWG.toast.copy_ok.desc',
            'Теперь его можно вставить в приложение или форму импорта.'
          ),
        }
      )
      return
    }

    toast.error(
      t(
        'connectAmneziaWG.toast.copy_failed.title',
        'Не удалось скопировать конфиг'
      ),
      {
        description: t(
          'connectAmneziaWG.toast.copy_failed.desc',
          'Браузер запретил копирование. Попробуйте другой способ.'
        ),
      }
    )
  }

  const main2Label = t(
    'connectAmneziaWG.step2.download_conf',
    'Скачать конфиг (.conf)'
  )

  const storeLabel =
    platform === 'android'
      ? t('connectAmneziaWG.store.google_play', 'Google Play')
      : platform === 'ios' || platform === 'mac'
      ? t('connectAmneziaWG.store.app_store', 'App Store')
      : t(
          'connectAmneziaWG.store.download_page',
          'страницу скачивания'
        )

  return (
    <div className="cawg">
      <div className="pre" style={{ marginTop: 0 }}>
        {ready
          ? t('connectAmneziaWG.status.ready', '✅ Профиль готов. ')
          : error
          ? t(
              'connectAmneziaWG.status.not_ready',
              '⚠️ Профиль пока недоступен. '
            )
          : t('connectAmneziaWG.status.loading', '… ')}
        {topHint}
      </div>

      {!loading && error ? (
        <div className="pre" style={{ marginTop: 10 }}>
          {String(error)}
          <div style={{ marginTop: 10 }}>
            <button className="btn" onClick={load} type="button">
              {t('connectAmneziaWG.retry', 'Повторить')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="row cawg__rowTop">
        <div className="p cawg__label">
          {t('connectAmneziaWG.device.label', 'Устройство:')}
        </div>

        <button
          className="btn cawg__deviceBtn"
          type="button"
          onClick={() => setPlatformPickerOpen(true)}
          disabled={loading}
          aria-label={t(
            'connectAmneziaWG.device.pick_aria',
            'Выбор устройства'
          )}
        >
          {chip === 'auto'
            ? tr(
                t(
                  'connectAmneziaWG.device.current',
                  '✨ Текущее ({platform})'
                ),
                { platform: platformLabel(autoPlatform) }
              )
            : platformLabel(platform)}{' '}
          <span aria-hidden>▾</span>
        </button>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <div className="services-cat__title">
            {t(
              'connectAmneziaWG.step1.title',
              '1) Установите приложение'
            )}
          </div>

          <p className="p" style={{ opacity: 0.82, marginTop: 6 }}>
            {t('connectAmneziaWG.step1.sub', 'Установите ')}
            <b>AmneziaWG</b>
            {tr(
              t(
                'connectAmneziaWG.step1.sub_for',
                ' для {platform}.'
              ),
              { platform: platformLabel(platform) }
            )}
          </p>

          <div className="actions actions--2" style={{ marginTop: 10 }}>
            <button
              className="btn btn--primary"
              onClick={() => openLinkSafe(APP_LINKS[platform])}
              disabled={loading}
              type="button"
            >
              {tr(
                t(
                  'connectAmneziaWG.step1.open_store',
                  'Открыть {store}'
                ),
                { store: storeLabel }
              )}
            </button>

            {platform === 'android' ? (
              <button
                className="btn"
                onClick={() => openLinkSafe(APK_LINK)}
                disabled={loading}
                type="button"
              >
                {t(
                  'connectAmneziaWG.step1.download_apk',
                  'Скачать APK'
                )}
              </button>
            ) : (
              <button
                className="btn"
                onClick={() => openLinkSafe(APP_LINKS[platform])}
                disabled={loading}
                type="button"
              >
                {t(
                  'connectAmneziaWG.step1.download_direct',
                  'Скачать напрямую'
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <div className="services-cat__title">
            {t('connectAmneziaWG.step2.title', '2) Добавьте профиль')}
          </div>

          <p className="p" style={{ opacity: 0.82, marginTop: 6 }}>
            {t('connectAmneziaWG.step2.sub_1', 'Скачайте ')}
            <b>.conf</b>
            {t(
              'connectAmneziaWG.step2.sub_2',
              ' и импортируйте файл в '
            )}
            <b>AmneziaWG</b>.{' '}
            <span style={{ display: 'inline-block', marginLeft: 6 }}>
              {t(
                'connectAmneziaWG.step2.more_hint',
                '(QR-код и копирование — в разделе «Другие способы».)'
              )}
            </span>
          </p>

          <div className="actions actions--2" style={{ marginTop: 10 }}>
            <button
              className="btn btn--primary"
              onClick={downloadConf}
              disabled={!ready}
              type="button"
              title={
                !ready
                  ? t(
                      'connectAmneziaWG.step2.not_ready_title',
                      'Профиль ещё не готов'
                    )
                  : undefined
              }
            >
              {loading
                ? t('connectAmneziaWG.wait', 'Подождите…')
                : main2Label}
            </button>

            <button
              className="btn"
              onClick={() => setMoreOpen((v) => !v)}
              disabled={!ready}
              type="button"
            >
              {moreOpen
                ? t(
                    'connectAmneziaWG.step2.hide_more',
                    'Скрыть способы'
                  )
                : t(
                    'connectAmneziaWG.step2.show_more',
                    'Другие способы'
                  )}
            </button>
          </div>

          {moreOpen && ready ? (
            <div style={{ marginTop: 10 }}>
              <div className="pre" style={{ opacity: 0.95 }}>
                <div className="actions actions--1" style={{ marginTop: 0 }}>
                  <button
                    className="btn btn--soft so__btnFull"
                    type="button"
                    onClick={openQr}
                  >
                    {t(
                      'connectAmneziaWG.step2.show_qr',
                      'Показать QR-код'
                    )}
                  </button>
                </div>

                <div className="actions actions--1" style={{ marginTop: 10 }}>
                  <button
                    className="btn btn--soft so__btnFull"
                    type="button"
                    onClick={copyConf}
                  >
                    {t(
                      'connectAmneziaWG.step2.copy_conf',
                      'Скопировать конфиг'
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {platformPickerOpen ? (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setPlatformPickerOpen(false)}
        >
          <div
            className="card overlay__card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card__body">
              <div
                className="row so__spaceBetween"
                style={{ alignItems: 'center' }}
              >
                <div className="overlay__title">
                  {t(
                    'connectAmneziaWG.device.modal_title',
                    'Выберите устройство'
                  )}
                </div>

                <button
                  className="btn"
                  type="button"
                  onClick={() => setPlatformPickerOpen(false)}
                  aria-label={t('connectAmneziaWG.close', 'Закрыть')}
                >
                  ✕
                </button>
              </div>

              <div className="kv so__mt12">
                <button
                  className={`kv__item cawg__pickItem ${
                    chip === 'auto' ? 'is-active' : ''
                  }`}
                  type="button"
                  onClick={() => {
                    setChip('auto')
                    setPlatformPickerOpen(false)
                  }}
                >
                  <div className="row so__spaceBetween">
                    <div className="kv__k" style={{ fontWeight: 700 }}>
                      {t(
                        'connectAmneziaWG.device.current_short',
                        '✨ Текущее'
                      )}
                    </div>
                    <span className="badge">{platformLabel(autoPlatform)}</span>
                  </div>
                </button>

                {(['android', 'ios', 'windows', 'mac', 'linux'] as Platform[]).map(
                  (p) => (
                    <button
                      key={p}
                      className={`kv__item cawg__pickItem ${
                        chip === p ? 'is-active' : ''
                      }`}
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
                  )
                )}
              </div>

              <div className="actions actions--1 so__mt12">
                <button
                  className="btn so__btnFull"
                  type="button"
                  onClick={() => setPlatformPickerOpen(false)}
                >
                  {t('connectAmneziaWG.close', 'Закрыть')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {qrOpen ? (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setQrOpen(false)}
        >
          <div
            className="card overlay__card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card__body">
              <div
                className="row so__spaceBetween"
                style={{ alignItems: 'center' }}
              >
                <div className="overlay__title">
                  {t('connectAmneziaWG.qr.title', 'QR-код профиля')}
                </div>

                <button
                  className="btn"
                  type="button"
                  onClick={() => setQrOpen(false)}
                  aria-label={t('connectAmneziaWG.close', 'Закрыть')}
                >
                  ✕
                </button>
              </div>

              <p className="p so__mt8" style={{ opacity: 0.82 }}>
                {t(
                  'connectAmneziaWG.qr.sub',
                  'В AmneziaWG выберите импорт по QR-коду и наведите камеру.'
                )}
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
                    alt={t(
                      'connectAmneziaWG.qr.alt',
                      'QR-код конфигурации'
                    )}
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
                <button
                  className="btn btn--primary so__btnFull"
                  onClick={() => setQrOpen(false)}
                  type="button"
                >
                  {t('connectAmneziaWG.close', 'Закрыть')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}