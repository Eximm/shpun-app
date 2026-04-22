// FILE: web/src/pages/connect/ConnectAmneziaWG.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { apiFetch } from "../../shared/api/client";
import { getMood } from "../../shared/payments-mood";
import { toast } from "../../shared/ui/toast";
import { useI18n } from "../../shared/i18n";

/* ─── Types ─────────────────────────────────────────────────────────────── */

type Props = {
  usi: number;
  service: { title: string; status: string; statusRaw: string };
  onDone?: () => void;
};

type Platform = "android" | "ios" | "windows" | "mac" | "linux";
type Chip     = "auto" | Platform;

/* ─── Constants ──────────────────────────────────────────────────────────── */

const APP_LINKS: Record<Platform, string> = {
  windows: "https://github.com/amnezia-vpn/amneziawg-windows-client/releases",
  mac:     "https://apps.apple.com/app/amneziawg/id6478942365",
  ios:     "https://apps.apple.com/app/amneziawg/id6478942365",
  android: "https://play.google.com/store/apps/details?id=org.amnezia.awg",
  linux:   "https://docs.amnezia.org/documentation/installing-app-on-linux/",
};

const APK_LINK = "https://github.com/amnezia-vpn/amneziawg-android/releases/latest";

const PLATFORM_ICONS: Record<Platform, string> = {
  android: "🤖", ios: "🍎", windows: "🪟", mac: "🍏", linux: "🐧",
};

/* ─── Utils ─────────────────────────────────────────────────────────────── */

function detectOS(): Platform {
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera || "";
  const isAppleTouch = /\bMac\b/.test(ua) && (navigator as any).maxTouchPoints > 1;
  if (/android/i.test(ua))                         return "android";
  if (/iPad|iPhone|iPod/.test(ua) || isAppleTouch) return "ios";
  if (/Win/i.test(ua))                             return "windows";
  if (/\bMac\b/i.test(ua))                        return "mac";
  if (/Linux/i.test(ua))                           return "linux";
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
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.top = "-1000px";
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta); return ok;
    } catch { return false; }
  }
}

function pickConfig(resp: any): { text: string; name: string } {
  const name = String(resp?.configName ?? resp?.filename ?? resp?.fileName ?? resp?.name ?? "").trim() || "vpn.conf";
  const raw  = resp?.configText ?? resp?.profile_text ?? resp?.profileText ?? resp?.profile ?? resp?.text ?? "";
  return { text: normalizeProfileText(String(raw ?? "")), name };
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function ConnectAmneziaWG({ usi }: Props) {
  const { t } = useI18n();

  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
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

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await apiFetch(`/services/${encodeURIComponent(String(usi))}/connect/amneziawg`, { method: "GET" }) as any;
      if (r?.ok === false && (r.error || r.message)) throw new Error(String(r.error || r.message));
      const picked = pickConfig(r);
      if (!picked.text) throw new Error("profile_missing");
      setConfigText(picked.text);
      setConfigName(picked.name || `vpn${usi}.conf`);
      if (!didToastReadyRef.current) {
        didToastReadyRef.current = true;
        toast.success("🔑 Конфиг готов!", { description: getMood("subscription_ready") ?? "Скачайте и импортируйте в AmneziaWG." });
      }
    } catch (e: any) {
      setConfigText("");
      const msg = e?.message || "profile_load_failed";
      setError(msg);
      toast.error(t("connectAmneziaWG.toast.prepare_failed.title"), {
        description: msg === "profile_missing" ? t("connectAmneziaWG.toast.prepare_failed.profile_missing") : String(msg),
      });
    } finally { setLoading(false); }
  }

  useEffect(() => {
    didToastReadyRef.current = false;
    void load();
  }, [usi]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openQr() {
    if (!configText) return;
    try {
      const dataUrl = await QRCode.toDataURL(configText, { margin: 2, width: 360 });
      setQrDataUrl(dataUrl); setQrOpen(true);
      toast.info("📱 QR готов", { description: "Отсканируйте в AmneziaWG." });
    } catch {
      toast.error("😬 QR не создался", { description: "Попробуйте скачать конфиг вместо QR." });
    }
  }

  function downloadConf() {
    if (!configText) return;
    downloadTextFile(configName || `vpn${usi}.conf`, configText);
    toast.success("⬇️ Конфиг скачан", { description: "Импортируйте файл в AmneziaWG." });
  }

  async function copyConf() {
    if (!configText) return;
    const ok = await copyToClipboard(configText);
    ok
      ? toast.success(getMood("copied") ?? "📋 Скопировано", { description: "Вставьте в AmneziaWG → Добавить туннель." })
      : toast.error("😬 Не скопировалось", { description: "Попробуйте скачать конфиг." });
  }

  const storeLabel = platform === "android"
    ? t("connectAmneziaWG.store.google_play")
    : platform === "ios" || platform === "mac"
      ? t("connectAmneziaWG.store.app_store")
      : t("connectAmneziaWG.store.download_page");

  return (
    <div className="cm">

      {/* Статус-бар */}
      <div className="pre" style={{
        borderColor: ready ? "rgba(43,227,143,0.28)" : error ? "rgba(255,77,109,0.28)" : "rgba(77,215,255,0.20)",
        background:  ready ? "rgba(43,227,143,0.06)"  : error ? "rgba(255,77,109,0.06)"  : "rgba(77,215,255,0.05)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span>{loading ? "⏳" : error ? "⚠️" : "✅"}</span>
        <span>
          {(loading
            ? t("connectAmneziaWG.top_hint.loading", "Готовим подключение для {platform}…")
            : error
              ? t("connectAmneziaWG.top_hint.error",   "Не удалось подготовить подключение.")
              : t("connectAmneziaWG.top_hint.ready",   "Конфиг готов · Устройство: {platform}")
          ).replace("{platform}", platformLabel(platform))}
        </span>
      </div>

      {!loading && error && (
        <div className="actions actions--1" style={{ marginTop: 8 }}>
          <button className="btn btn--primary" onClick={() => void load()} type="button">
            🔄 {t("connectAmneziaWG.retry")}
          </button>
        </div>
      )}

      {/* Выбор устройства */}
      <div className="row cawg__rowTop">
        <span className="p cawg__label">{t("connectAmneziaWG.device.label")}</span>
        <button
          className="btn cawg__deviceBtn" type="button"
          onClick={() => setPlatformPickerOpen(true)} disabled={loading}
        >
          {PLATFORM_ICONS[platform]}{" "}
          {chip === "auto"
            ? t("connectAmneziaWG.device.current", "Текущее ({platform})").replace("{platform}", platformLabel(autoPlatform))
            : platformLabel(platform)}
          {" "}▾
        </button>
      </div>

      {/* Основные шаги */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">

          {/* Шаг 1 */}
          <div className="pre" style={{ borderColor: "rgba(124,92,255,0.22)", background: "rgba(124,92,255,0.05)" }}>
            <b>Шаг 1.</b> {t("connectAmneziaWG.step1.sub")} <b>AmneziaWG</b>
            {t("connectAmneziaWG.step1.sub_for", " для {platform}.").replace("{platform}", platformLabel(platform))}
          </div>
          <div className="actions actions--2">
            <button className="btn btn--primary" onClick={() => openLinkSafe(APP_LINKS[platform])} disabled={loading} type="button">
              📲 {t("connectAmneziaWG.step1.open_store", "Открыть {store}").replace("{store}", storeLabel)}
            </button>
            {platform === "android" ? (
              <button className="btn" onClick={() => openLinkSafe(APK_LINK)} disabled={loading} type="button">
                ⬇️ {t("connectAmneziaWG.step1.download_apk")}
              </button>
            ) : (
              <button className="btn" onClick={() => openLinkSafe(APP_LINKS[platform])} disabled={loading} type="button">
                ⬇️ {t("connectAmneziaWG.step1.download_direct")}
              </button>
            )}
          </div>

          {/* Шаг 2 */}
          <div className="pre" style={{ marginTop: 12, borderColor: "rgba(77,215,255,0.22)", background: "rgba(77,215,255,0.05)" }}>
            <b>Шаг 2.</b> {t("connectAmneziaWG.step2.sub_1")} <b>.conf</b>
            {t("connectAmneziaWG.step2.sub_2")} <b>AmneziaWG</b>.
          </div>
          <div className="actions actions--1">
            <button
              className="btn btn--primary"
              onClick={downloadConf}
              disabled={!ready}
              type="button"
            >
              {loading ? `⏳ ${t("connectAmneziaWG.wait")}` : `⬇️ ${t("connectAmneziaWG.step2.download_conf")}`}
            </button>
          </div>

          <div className="actions actions--1">
            <button className="btn" onClick={() => setMoreOpen((v) => !v)} disabled={!ready} type="button">
              {moreOpen ? `▴ ${t("connectAmneziaWG.step2.hide_more")}` : `▾ ${t("connectAmneziaWG.step2.show_more")}`}
            </button>
          </div>

          {moreOpen && ready && (
            <div className="actions actions--2" style={{ marginTop: 8 }}>
              <button className="btn btn--primary" type="button" onClick={() => void openQr()}>
                📱 {t("connectAmneziaWG.step2.show_qr")}
              </button>
              <button className="btn btn--primary" type="button" onClick={() => void copyConf()}>
                📋 {t("connectAmneziaWG.step2.copy_conf")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Пикер платформы */}
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
                    className={`kv__item cawg__pickItem${chip === "auto" ? " is-active" : ""}`}
                    type="button"
                    onClick={() => { setChip("auto"); setPlatformPickerOpen(false); }}
                  >
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="kv__k">{t("connectAmneziaWG.device.current_short")}</span>
                      <span className="chip">{PLATFORM_ICONS[autoPlatform]} {platformLabel(autoPlatform)}</span>
                    </div>
                  </button>
                  {(["android", "ios", "windows", "mac", "linux"] as Platform[]).map((p) => (
                    <button
                      key={p}
                      className={`kv__item cawg__pickItem${chip === p ? " is-active" : ""}`}
                      type="button"
                      onClick={() => { setChip(p); setPlatformPickerOpen(false); }}
                    >
                      <span className="kv__k">{PLATFORM_ICONS[p]} {platformLabel(p)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* QR модалка */}
      {qrOpen && createPortal(
        <div className="modal" role="dialog" aria-modal="true" onMouseDown={() => setQrOpen(false)}>
          <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="modal__head">
                <div className="modal__title">📱 {t("connectAmneziaWG.qr.title")}</div>
                <button className="btn modal__close" type="button" onClick={() => setQrOpen(false)} aria-label={t("common.close")}>✕</button>
              </div>
              <div className="modal__content">
                <p className="p">{t("connectAmneziaWG.qr.sub")}</p>
                <div className="helperMedia" style={{ marginTop: 12, background: "#fff", borderRadius: 12, padding: 8 }}>
                  {qrDataUrl && <img className="helperMedia__img" src={qrDataUrl} alt={t("connectAmneziaWG.qr.alt")} loading="lazy" decoding="async" width={320} />}
                </div>
                <div className="actions actions--1" style={{ marginTop: 14 }}>
                  <button className="btn btn--primary" onClick={() => setQrOpen(false)} type="button">{t("common.close")}</button>
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