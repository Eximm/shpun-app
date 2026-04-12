// web/src/pages/connect/ConnectAmneziaWG.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { apiFetch } from "../../shared/api/client";
import { toast } from "../../shared/ui/toast";
import { useI18n } from "../../shared/i18n";

/* ─── Types ─────────────────────────────────────────────────────────────── */

type Props = {
  usi: number;
  service: { title: string; status: string; statusRaw: string };
  onDone?: () => void;
};

type Platform = "android" | "ios" | "windows" | "mac" | "linux";
type Chip = "auto" | Platform;

/* ─── Constants ──────────────────────────────────────────────────────────── */

const APP_LINKS: Record<Platform, string> = {
  windows: "https://github.com/amnezia-vpn/amneziawg-windows-client/releases",
  mac:     "https://apps.apple.com/app/amneziawg/id6478942365",
  ios:     "https://apps.apple.com/app/amneziawg/id6478942365",
  android: "https://play.google.com/store/apps/details?id=org.amnezia.awg",
  linux:   "https://docs.amnezia.org/documentation/installing-app-on-linux/",
};

const APK_LINK = "https://github.com/amnezia-vpn/amneziawg-android/releases/latest";

/* ─── Utils ─────────────────────────────────────────────────────────────── */

function detectOS(): Platform {
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera || "";
  const isAppleTouch = /\bMac\b/.test(ua) && (navigator as any).maxTouchPoints > 1;
  if (/android/i.test(ua))              return "android";
  if (/iPad|iPhone|iPod/.test(ua) || isAppleTouch) return "ios";
  if (/Win/i.test(ua))                  return "windows";
  if (/\bMac\b/i.test(ua))             return "mac";
  if (/Linux/i.test(ua))               return "linux";
  return "windows";
}

function platformLabel(p: Platform) {
  const labels: Record<Platform, string> = {
    android: "Android", ios: "iOS", windows: "Windows", mac: "macOS", linux: "Linux",
  };
  return labels[p];
}

function openLinkSafe(url: string) {
  try {
    const tg = (window as any).Telegram?.WebApp;
    if (tg && typeof tg.openLink === "function") { tg.openLink(url); return; }
  } catch { /* ignore */ }
  window.open(url, "_blank", "noopener,noreferrer");
}

function normalizeProfileText(text: string) {
  let t = String(text ?? "");
  if (!t) return "";
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return t.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/octet-stream" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.top = "-1000px";
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }
}

function pickConfig(resp: any): { text: string; name: string } {
  const name = String(
    resp?.configName ?? resp?.filename ?? resp?.fileName ?? resp?.name ?? ""
  ).trim() || "vpn.conf";
  const raw  = resp?.configText ?? resp?.profile_text ?? resp?.profileText ?? resp?.profile ?? resp?.text ?? "";
  return { text: normalizeProfileText(String(raw ?? "")), name };
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function ConnectAmneziaWG({ usi }: Props) {
  const { t } = useI18n();

  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [configText, setConfigText] = useState("");
  const [configName, setConfigName] = useState(`vpn${usi}.conf`);

  const autoPlatform = useMemo(() => detectOS(), []);
  const [chip, setChip] = useState<Chip>("auto");
  const platform: Platform = chip === "auto" ? autoPlatform : chip;

  const [platformPickerOpen, setPlatformPickerOpen] = useState(false);
  const [moreOpen,           setMoreOpen]           = useState(false);
  const [qrOpen,             setQrOpen]             = useState(false);
  const [qrDataUrl,          setQrDataUrl]          = useState("");

  const didToastReadyRef = useRef(false);

  const ready = !loading && !error && !!configText;

  // ── Load ──────────────────────────────────────────────────────────────────
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch(`/services/${encodeURIComponent(String(usi))}/connect/amneziawg`, {
        method: "GET",
      }) as any;

      if (r?.ok === false && (r.error || r.message)) throw new Error(String(r.error || r.message));

      const picked = pickConfig(r);
      if (!picked.text) throw new Error("profile_missing");

      setConfigText(picked.text);
      setConfigName(picked.name || `vpn${usi}.conf`);

      if (!didToastReadyRef.current) {
        didToastReadyRef.current = true;
        toast.success(t("connectAmneziaWG.toast.ready.title"), {
          description: t("connectAmneziaWG.toast.ready.desc"),
        });
      }
    } catch (e: any) {
      setConfigText("");
      const msg = e?.message || "profile_load_failed";
      setError(msg);
      toast.error(t("connectAmneziaWG.toast.prepare_failed.title"), {
        description: msg === "profile_missing"
          ? t("connectAmneziaWG.toast.prepare_failed.profile_missing")
          : String(msg),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    didToastReadyRef.current = false;
    void load();
  }, [usi]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ───────────────────────────────────────────────────────────────
  async function openQr() {
    if (!configText) return;
    try {
      const dataUrl = await QRCode.toDataURL(configText, { margin: 2, width: 360 });
      setQrDataUrl(dataUrl);
      setQrOpen(true);
      toast.info(t("connectAmneziaWG.toast.qr_ready.title"), {
        description: t("connectAmneziaWG.toast.qr_ready.desc"),
      });
    } catch (e: any) {
      toast.error(t("connectAmneziaWG.toast.qr_failed.title"), {
        description: t("connectAmneziaWG.toast.qr_failed.desc"),
      });
    }
  }

  function downloadConf() {
    if (!configText) return;
    downloadTextFile(configName || `vpn${usi}.conf`, configText);
    toast.success(t("connectAmneziaWG.toast.download.title"), {
      description: t("connectAmneziaWG.toast.download.desc"),
    });
  }

  async function copyConf() {
    if (!configText) return;
    const ok = await copyToClipboard(configText);
    if (ok) {
      toast.success(t("connectAmneziaWG.toast.copy_ok.title"), {
        description: t("connectAmneziaWG.toast.copy_ok.desc"),
      });
    } else {
      toast.error(t("connectAmneziaWG.toast.copy_failed.title"), {
        description: t("connectAmneziaWG.toast.copy_failed.desc"),
      });
    }
  }

  const storeLabel = platform === "android"
    ? t("connectAmneziaWG.store.google_play")
    : platform === "ios" || platform === "mac"
      ? t("connectAmneziaWG.store.app_store")
      : t("connectAmneziaWG.store.download_page");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="cm">

      {/* Status hint */}
      <div className="pre">
        {ready
          ? t("connectAmneziaWG.status.ready")
          : error
            ? t("connectAmneziaWG.status.not_ready")
            : t("connectAmneziaWG.status.loading")}
        {(loading
          ? t("connectAmneziaWG.top_hint.loading", "Готовим подключение для {platform}…")
          : error
            ? t("connectAmneziaWG.top_hint.error", "Не удалось подготовить подключение для {platform}.")
            : t("connectAmneziaWG.top_hint.ready", "Устройство: {platform}.")
        ).replace("{platform}", platformLabel(platform))}
      </div>

      {/* Error + retry */}
      {!loading && error && (
        <div className="pre" style={{ marginTop: 10 }}>
          {String(error)}
          <div className="actions actions--1">
            <button className="btn" onClick={() => void load()} type="button">
              {t("connectAmneziaWG.retry")}
            </button>
          </div>
        </div>
      )}

      {/* Device selector */}
      <div className="row" style={{ marginTop: 12, alignItems: "center", justifyContent: "space-between" }}>
        <span className="p" style={{ margin: 0 }}>{t("connectAmneziaWG.device.label")}</span>
        <button
          className="btn cawg__deviceBtn"
          type="button"
          onClick={() => setPlatformPickerOpen(true)}
          disabled={loading}
          aria-label={t("connectAmneziaWG.device.pick_aria")}
        >
          {chip === "auto"
            ? t("connectAmneziaWG.device.current", "✨ Текущее ({platform})").replace("{platform}", platformLabel(autoPlatform))
            : platformLabel(platform)}
          {" "}<span aria-hidden>▾</span>
        </button>
      </div>

      {/* Steps — одна карточка как в оригинале */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">

          {/* Step 1 */}
          <div className="pre">
            <b>{t("connectAmneziaWG.step1.title")}</b><br />
            {t("connectAmneziaWG.step1.sub")}<b>AmneziaWG</b>
            {t("connectAmneziaWG.step1.sub_for", " для {platform}.").replace("{platform}", platformLabel(platform))}
          </div>
          <div className="actions actions--2">
            <button
              className="btn btn--primary"
              onClick={() => openLinkSafe(APP_LINKS[platform])}
              disabled={loading}
              type="button"
            >
              {t("connectAmneziaWG.step1.open_store", "Открыть {store}").replace("{store}", storeLabel)}
            </button>
            {platform === "android" ? (
              <button className="btn" onClick={() => openLinkSafe(APK_LINK)} disabled={loading} type="button">
                {t("connectAmneziaWG.step1.download_apk")}
              </button>
            ) : (
              <button className="btn" onClick={() => openLinkSafe(APP_LINKS[platform])} disabled={loading} type="button">
                {t("connectAmneziaWG.step1.download_direct")}
              </button>
            )}
          </div>

          {/* Step 2 */}
          <div className="pre" style={{ marginTop: 12 }}>
            <b>{t("connectAmneziaWG.step2.title")}</b><br />
            {t("connectAmneziaWG.step2.sub_1")}<b>.conf</b>
            {t("connectAmneziaWG.step2.sub_2")}<b>AmneziaWG</b>.
          </div>
          <div className="actions actions--1">
            <button
              className="btn btn--primary"
              onClick={downloadConf}
              disabled={!ready}
              type="button"
              title={!ready ? t("connectAmneziaWG.step2.not_ready_title") : undefined}
            >
              {loading ? t("connectAmneziaWG.wait") : t("connectAmneziaWG.step2.download_conf")}
            </button>
          </div>

          {/* Other methods toggle */}
          <div className="actions actions--1">
            <button className="btn" onClick={() => setMoreOpen((v) => !v)} disabled={!ready} type="button">
              {moreOpen
                ? `▴ ${t("connectAmneziaWG.step2.hide_more")}`
                : `▾ ${t("connectAmneziaWG.step2.show_more")}`}
            </button>
          </div>

          {moreOpen && ready && (
            <div className="actions actions--2" style={{ marginTop: 8 }}>
              <button className="btn btn--primary" type="button" onClick={openQr}>
                📱 {t("connectAmneziaWG.step2.show_qr")}
              </button>
              <button className="btn btn--primary" type="button" onClick={copyConf}>
                📋 {t("connectAmneziaWG.step2.copy_conf")}
              </button>
            </div>
          )}

        </div>
      </div>

      {/* Platform picker modal */}
      {platformPickerOpen && createPortal(
        <div className="modal" role="dialog" aria-modal="true" onMouseDown={() => setPlatformPickerOpen(false)}>
          <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="modal__head">
                <div className="modal__title">{t("connectAmneziaWG.device.modal_title")}</div>
                <button className="btn modal__close" type="button" onClick={() => setPlatformPickerOpen(false)} aria-label={t("common.close")}>✕</button>
              </div>
              <div className="modal__content">
                <div className="kv">
                  <button
                    className={`kv__item cawg__pickItem ${chip === "auto" ? "is-active" : ""}`}
                    type="button"
                    onClick={() => { setChip("auto"); setPlatformPickerOpen(false); }}
                  >
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="kv__k">{t("connectAmneziaWG.device.current_short")}</span>
                      <span className="chip">{platformLabel(autoPlatform)}</span>
                    </div>
                  </button>
                  {(["android", "ios", "windows", "mac", "linux"] as Platform[]).map((p) => (
                    <button
                      key={p}
                      className={`kv__item cawg__pickItem ${chip === p ? "is-active" : ""}`}
                      type="button"
                      onClick={() => { setChip(p); setPlatformPickerOpen(false); }}
                    >
                      <span className="kv__k">{platformLabel(p)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* QR modal */}
      {qrOpen && createPortal(
        <div className="modal" role="dialog" aria-modal="true" onMouseDown={() => setQrOpen(false)}>
          <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="modal__head">
                <div className="modal__title">{t("connectAmneziaWG.qr.title")}</div>
                <button className="btn modal__close" type="button" onClick={() => setQrOpen(false)} aria-label={t("common.close")}>✕</button>
              </div>
              <div className="modal__content">
                <p className="p">{t("connectAmneziaWG.qr.sub")}</p>
                <div className="helperMedia" style={{ marginTop: 12 }}>
                  {qrDataUrl && (
                    <img
                      className="helperMedia__img"
                      src={qrDataUrl}
                      alt={t("connectAmneziaWG.qr.alt")}
                      loading="lazy"
                      decoding="async"
                      width={360}
                    />
                  )}
                </div>
                <div className="actions actions--1">
                  <button className="btn btn--primary" onClick={() => setQrOpen(false)} type="button">
                    {t("common.close")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}