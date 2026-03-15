import { useEffect, useMemo, useState } from "react"
import QRCode from "qrcode"
import { apiFetch } from "../../shared/api/client"
import { toast } from "../../shared/ui/toast"
import { useI18n } from "../../shared/i18n"

type Props = {
  usi: number
}

type Platform = "android" | "ios" | "windows" | "mac" | "linux"

const IOS_HIDDIFY_URL =
  "https://apps.apple.com/us/app/hiddify-proxy-vpn/id6596777532"

const CLIENT_LINKS: Record<
  Platform,
  { title: string; market: string; direct?: string; storeLabel: string }
> = {
  android: {
    title: "Hiddify",
    market:
      "https://play.google.com/store/apps/details?id=app.hiddify.com",
    direct:
      "https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-Android-arm64.apk",
    storeLabel: "Google Play",
  },
  ios: {
    title: "Hiddify",
    market: IOS_HIDDIFY_URL,
    storeLabel: "App Store",
  },
  windows: {
    title: "Hiddify",
    market: "https://github.com/hiddify/hiddify-app/releases",
    storeLabel: "Download page",
  },
  mac: {
    title: "Hiddify",
    market: "https://github.com/hiddify/hiddify-app/releases",
    direct:
      "https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-MacOS.dmg",
    storeLabel: "Download page",
  },
  linux: {
    title: "Hiddify",
    market: "https://github.com/hiddify/hiddify-app/releases",
    direct:
      "https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-Linux-x64.AppImage",
    storeLabel: "Download page",
  },
}

function detectOS(): Platform {
  const ua = navigator.userAgent || ""

  if (/android/i.test(ua)) return "android"
  if (/iPad|iPhone|iPod/.test(ua)) return "ios"
  if (/Win/i.test(ua)) return "windows"
  if (/\bMac\b/i.test(ua)) return "mac"
  if (/Linux/i.test(ua)) return "linux"

  return "windows"
}

function platformLabel(p: Platform) {
  switch (p) {
    case "android":
      return "Android"
    case "ios":
      return "iOS"
    case "windows":
      return "Windows"
    case "mac":
      return "macOS"
    default:
      return "Linux"
  }
}

function openLinkSafe(url: string) {
  try {
    const tg: any = (window as any).Telegram?.WebApp
    if (tg?.openLink) {
      tg.openLink(url)
      return
    }
  } catch {}

  window.open(url, "_blank", "noopener,noreferrer")
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function buildImportLink(url: string) {
  return `hiddify://install-sub/?url=${encodeURIComponent(url)}`
}

function tr(template: string, params: Record<string, string | number>) {
  return Object.entries(params).reduce(
    (acc, [key, value]) =>
      acc.replace(new RegExp(`\\{${key}\\}`, "g"), String(value)),
    template
  )
}

export default function ConnectMarzban({ usi }: Props) {
  const { t } = useI18n()

  const platform = useMemo(() => detectOS(), [])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subscriptionUrl, setSubscriptionUrl] = useState("")

  const [qrOpen, setQrOpen] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState("")

  const [copied, setCopied] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  const client = CLIENT_LINKS[platform]

  async function load() {
    setLoading(true)
    setError(null)

    try {
      const r = (await apiFetch(
        `/services/${encodeURIComponent(String(usi))}/connect/marzban`
      )) as any

      const url = String(
        r?.subscription_url ?? r?.subscriptionUrl ?? ""
      ).trim()

      if (!url) throw new Error()

      setSubscriptionUrl(url)

      toast.success(t("connect.sub_ready", "Subscription is ready"), {
        description: t("connect.sub_ready_desc", "You can now import it into the client."),
      })
    } catch {
      setError("load_failed")

      toast.error(t("connect.sub_prepare_error", "Could not prepare subscription"), {
        description: t("connect.sub_prepare_error_desc", "Please try again in a moment."),
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [usi])

  const ready = !loading && !error && !!subscriptionUrl

  const importLink = ready ? buildImportLink(subscriptionUrl) : ""

  async function openQr() {
    if (!subscriptionUrl) return

    const url = await QRCode.toDataURL(subscriptionUrl, {
      margin: 2,
      width: 360,
    })

    setQrDataUrl(url)
    setQrOpen(true)
  }

  async function copySub() {
    if (!subscriptionUrl) return

    const ok = await copyToClipboard(subscriptionUrl)

    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)

      toast.success(t("connect.copy_link", "Link copied"))
    }
  }

  function openAutoImport() {
    if (!ready) return

    openLinkSafe(importLink)

    toast.info(t("connect.open_client", "Opening client"))
  }

  return (
    <div className="cm">
      <div className="pre">
        {loading && t("connect.loading", "Loading...")}
        {error && t("connect.error", "Error")}
        {ready && t("connect.ready", "Ready")}
      </div>

      {error && (
        <div className="pre">
          {t("connect.load_failed", "Could not load subscription")}
          <div>
            <button className="btn" onClick={load}>
              {t("common.retry", "Retry")}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card__body">
          <div className="services-cat__title">
            {t("connect.step_install", "1. Install app")}
          </div>

          <p className="p">
            {tr(
              t("connect.install_text", "Install {client} for {platform} first."),
              {
                client: client.title,
                platform: platformLabel(platform),
              }
            )}
          </p>

          <div className="actions actions--2">
            <button
              className="btn btn--primary"
              onClick={() => openLinkSafe(client.market)}
              disabled={loading}
            >
              {t("connect.open_store", "Open")} {client.storeLabel}
            </button>

            {client.direct ? (
              <button
                className="btn"
                onClick={() => {
                  if (!client.direct) return
                  openLinkSafe(client.direct)
                }}
              >
                {t("connect.download_direct", "Direct download")}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__body">
          <div className="services-cat__title">
            {t("connect.step_import", "2. Import subscription")}
          </div>

          <p className="p">
            {t("connect.import_text", "Add the subscription to the app using the button below.")}
          </p>

          <div className="actions actions--2">
            <button
              className="btn btn--primary"
              onClick={openAutoImport}
              disabled={!ready}
            >
              {loading ? t("connect.wait", "Please wait") : t("connect.add_sub", "Add subscription")}
            </button>

            <button
              className="btn"
              onClick={() => setMoreOpen((v) => !v)}
              disabled={!ready}
            >
              {moreOpen
                ? t("connect.hide_methods", "Hide other methods")
                : t("connect.more_methods", "More methods")}
            </button>
          </div>

          {moreOpen && ready && (
            <div className="pre">
              <div className="actions actions--1">
                <button className="btn" onClick={copySub}>
                  {copied
                    ? t("connect.copied", "Copied")
                    : t("connect.copy_link", "Copy link")}
                </button>
              </div>

              <div className="actions actions--1">
                <button className="btn" onClick={openQr}>
                  {t("connect.show_qr", "Show QR")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {qrOpen && (
        <div
          className="overlay"
          onClick={() => setQrOpen(false)}
        >
          <div
            className="card overlay__card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card__body">
              <div className="row so__spaceBetween">
                <div className="overlay__title">
                  {t("connect.qr_title", "QR code")}
                </div>

                <button
                  className="btn"
                  onClick={() => setQrOpen(false)}
                >
                  ✕
                </button>
              </div>

              <p className="p">
                {t("connect.qr_text", "Scan this QR code in the client app.")}
              </p>

              <div className="pre">
                {qrDataUrl && (
                  <img
                    src={qrDataUrl}
                    alt="QR"
                    loading="lazy"
                    decoding="async"
                  />
                )}
              </div>

              <div className="actions actions--1">
                <button
                  className="btn btn--primary"
                  onClick={() => setQrOpen(false)}
                >
                  {t("common.close", "Close")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}