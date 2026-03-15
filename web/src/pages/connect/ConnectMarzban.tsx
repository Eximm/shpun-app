import { useEffect, useMemo, useState } from "react"
import QRCode from "qrcode"
import { apiFetch } from "../../shared/api/client"
import { toast } from "../../shared/ui/toast"
import { useI18n } from "../../shared/i18n"

type Props = {
  usi: number
}

type Platform = "android" | "ios" | "windows" | "mac" | "linux"
type Chip = "auto" | Platform

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
  const ua =
    navigator.userAgent || navigator.vendor || (window as any).opera || ""

  const isAndroid = /android/i.test(ua)
  const isAppleTouch =
    /\bMac\b/.test(ua) && (navigator as any).maxTouchPoints > 1
  const isiOS = /iPad|iPhone|iPod/.test(ua) || isAppleTouch

  if (isAndroid) return "android"
  if (isiOS) return "ios"
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

function isMobile(p: Platform) {
  return p === "android" || p === "ios"
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
    try {
      const ta = document.createElement("textarea")
      ta.value = text
      ta.style.position = "fixed"
      ta.style.top = "-1000px"
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

function buildAutoImportLink(subscriptionUrl: string) {
  return `hiddify://install-sub/?url=${encodeURIComponent(subscriptionUrl)}`
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

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const autoPlatform = useMemo(() => detectOS(), [])
  const [chip, setChip] = useState<Chip>("auto")
  const platform: Platform = chip === "auto" ? autoPlatform : chip

  const [platformPickerOpen, setPlatformPickerOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  const [subscriptionUrl, setSubscriptionUrl] = useState("")
  const [copied, setCopied] = useState(false)

  const [qrOpen, setQrOpen] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState("")

  const client = CLIENT_LINKS[platform]

  async function load() {
    setLoading(true)
    setError(null)

    try {
      const r = (await apiFetch(
        `/services/${encodeURIComponent(String(usi))}/connect/marzban`
      )) as any

      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) {
        throw new Error(String(r.error || r.message))
      }

      const url = String(
        r?.subscription_url ?? r?.subscriptionUrl ?? ""
      ).trim()

      if (!url) throw new Error("subscription_url_missing")

      setSubscriptionUrl(url)
    } catch (e: any) {
      setSubscriptionUrl("")
      setError(e?.message || "load_failed")

      toast.error(
        t("connect.sub_prepare_error", "Could not prepare subscription"),
        {
          description: t(
            "connect.sub_prepare_error_desc",
            "Please try again in a moment."
          ),
        }
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [usi])

  const ready = !loading && !error && !!subscriptionUrl

  const topHint = useMemo(() => {
    const pName = platformLabel(platform)

    if (loading) {
      return tr(
        t(
          "connect.top_hint_loading",
          "Preparing connection for: {platform}…"
        ),
        { platform: pName }
      )
    }

    if (error) {
      return tr(
        t(
          "connect.top_hint_error",
          "Could not prepare connection for: {platform}."
        ),
        { platform: pName }
      )
    }

    if (isMobile(platform)) {
      return tr(
        t(
          "connect.top_hint_ready_mobile",
          "Device: {platform}. The steps below will help you install the app and add the subscription."
        ),
        { platform: pName }
      )
    }

    return tr(
      t(
        "connect.top_hint_ready_desktop",
        "Device: {platform}. The steps below will help you install the app and add the subscription."
      ),
      { platform: pName }
    )
  }, [platform, loading, error, t])

  const importLink = ready ? buildAutoImportLink(subscriptionUrl) : ""

  async function openQr() {
    if (!subscriptionUrl) return

    try {
      const url = await QRCode.toDataURL(subscriptionUrl, {
        margin: 2,
        width: 360,
      })

      setQrDataUrl(url)
      setQrOpen(true)
    } catch {
      toast.error(t("connect.qr_error", "Could not generate QR code"))
    }
  }

  async function copySub() {
    if (!subscriptionUrl) return

    const ok = await copyToClipboard(subscriptionUrl)

    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)

      toast.success(t("connect.copy_link", "Link copied"))
      return
    }

    toast.error(
      t("connect.copy_failed", "Could not copy the link")
    )
  }

  function openAutoImport() {
    if (!ready) return

    openLinkSafe(importLink)

    toast.info(t("connect.open_client", "Opening client"))
  }

  const deviceButtonLabel =
    chip === "auto"
      ? tr(t("connect.device_current", "Current ({platform})"), {
          platform: platformLabel(autoPlatform),
        })
      : platformLabel(platform)

  return (
    <div className="cm">
      <div className="pre" style={{ marginTop: 0 }}>
        {ready
          ? `✅ ${t("connect.sub_ready", "Subscription is ready")}. `
          : error
          ? `⚠️ ${t("connect.sub_not_ready", "Subscription is not ready")}. `
          : `… `}
        {topHint}
      </div>

      {!loading && error ? (
        <div className="pre" style={{ marginTop: 10 }}>
          {t("connect.load_failed", "Could not load subscription")}
          <div style={{ marginTop: 10 }}>
            <button className="btn" onClick={load} type="button">
              {t("common.retry", "Retry")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="row cawg__rowTop">
        <div className="p cawg__label">
          {t("connect.device_label", "Device")}:
        </div>

        <button
          className="btn cawg__deviceBtn"
          type="button"
          onClick={() => setPlatformPickerOpen(true)}
          disabled={loading}
          aria-label={t("connect.device_choose", "Choose device")}
        >
          {chip === "auto" ? "✨ " : ""}
          {deviceButtonLabel} <span aria-hidden>▾</span>
        </button>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <div className="services-cat__title">
            {t("connect.step_install", "1) Install the app")}
          </div>

          <p className="p" style={{ opacity: 0.82, marginTop: 6 }}>
            {tr(
              t("connect.install_text", "Install {client} for {platform}."),
              {
                client: client.title,
                platform: platformLabel(platform),
              }
            )}
          </p>

          <div className="actions actions--2" style={{ marginTop: 10 }}>
            <button
              className="btn btn--primary"
              onClick={() => openLinkSafe(client.market)}
              disabled={loading}
              type="button"
            >
              {tr(t("connect.open_store_named", "Open {storeLabel}"), {
                storeLabel: client.storeLabel,
              })}
            </button>

            {platform === "android" && client.direct ? (
              <button
                className="btn"
                onClick={() => openLinkSafe(client.direct!)}
                disabled={loading}
                type="button"
              >
                {t("connect.download_apk", "Download APK")}
              </button>
            ) : client.direct ? (
              <button
                className="btn"
                onClick={() => openLinkSafe(client.direct!)}
                disabled={loading}
                type="button"
              >
                {t("connect.download_direct", "Direct download")}
              </button>
            ) : (
              <button
                className="btn"
                onClick={() => openLinkSafe(client.market)}
                disabled={loading}
                type="button"
              >
                {t("connect.download_direct", "Direct download")}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <div className="services-cat__title">
            {t("connect.step_import", "2) Add subscription")}
          </div>

          <p className="p" style={{ opacity: 0.82, marginTop: 6 }}>
            {t(
              "connect.import_text",
              "Click “Add subscription” — we will open the app and import the subscription automatically."
            )}
          </p>

          <div className="actions actions--2" style={{ marginTop: 10 }}>
            <button
              className="btn btn--primary"
              onClick={openAutoImport}
              disabled={!ready}
              type="button"
              title={
                !ready
                  ? t("connect.sub_not_ready_yet", "Subscription is not ready yet")
                  : undefined
              }
            >
              {loading
                ? t("connect.wait", "Please wait…")
                : t("connect.add_sub", "Add subscription")}
            </button>

            <button
              className="btn"
              onClick={() => setMoreOpen((v) => !v)}
              disabled={!ready}
              type="button"
            >
              {moreOpen
                ? t("connect.hide_methods", "Hide methods")
                : t("connect.more_methods", "More methods")}
            </button>
          </div>

          {moreOpen && ready ? (
            <div style={{ marginTop: 10 }}>
              <div className="pre" style={{ opacity: 0.95 }}>
                <div className="actions actions--1" style={{ marginTop: 0 }}>
                  <button
                    className="btn btn--soft so__btnFull"
                    type="button"
                    onClick={copySub}
                  >
                    {copied
                      ? t("connect.copied_full", "✅ Link copied")
                      : t(
                          "connect.copy_sub_link",
                          "Copy subscription link"
                        )}
                  </button>
                </div>

                <div className="actions actions--1" style={{ marginTop: 10 }}>
                  <button
                    className="btn so__btnFull"
                    type="button"
                    onClick={openQr}
                  >
                    {t("connect.show_qr", "Show QR")}
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
              <div className="row so__spaceBetween" style={{ alignItems: "center" }}>
                <div className="overlay__title">
                  {t("connect.choose_device_title", "Choose device")}
                </div>

                <button
                  className="btn"
                  type="button"
                  onClick={() => setPlatformPickerOpen(false)}
                  aria-label={t("common.close", "Close")}
                >
                  ✕
                </button>
              </div>

              <div className="kv so__mt12">
                <button
                  className={`kv__item cawg__pickItem ${
                    chip === "auto" ? "is-active" : ""
                  }`}
                  type="button"
                  onClick={() => {
                    setChip("auto")
                    setPlatformPickerOpen(false)
                  }}
                >
                  <div className="row so__spaceBetween">
                    <div className="kv__k" style={{ fontWeight: 700 }}>
                      ✨ {t("connect.current_device", "Current")}
                    </div>
                    <span className="badge">{platformLabel(autoPlatform)}</span>
                  </div>
                </button>

                {(["android", "ios", "windows", "mac", "linux"] as Platform[]).map(
                  (p) => (
                    <button
                      key={p}
                      className={`kv__item cawg__pickItem ${
                        chip === p ? "is-active" : ""
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
                  {t("common.close", "Close")}
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
              <div className="row so__spaceBetween" style={{ alignItems: "center" }}>
                <div className="overlay__title">
                  {t("connect.qr_title", "Subscription QR code")}
                </div>

                <button
                  className="btn"
                  type="button"
                  onClick={() => setQrOpen(false)}
                  aria-label={t("common.close", "Close")}
                >
                  ✕
                </button>
              </div>

              <p className="p so__mt8" style={{ opacity: 0.82 }}>
                {t(
                  "connect.qr_text",
                  "Open the client on another device and import the subscription via QR."
                )}
              </p>

              <div
                className="pre so__mt12"
                style={{
                  display: "flex",
                  justifyContent: "center",
                  padding: 12,
                  overflow: "hidden",
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
                      maxWidth: "100%",
                      height: "auto",
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
                  {t("common.close", "Close")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}