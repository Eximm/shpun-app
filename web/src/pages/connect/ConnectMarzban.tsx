// FILE: web/src/pages/connect/ConnectMarzban.tsx

import { useEffect, useMemo, useState } from "react";
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

type Platform    = "android" | "ios" | "windows" | "mac" | "linux";
type Chip        = "auto" | Platform;
type RuntimeMode = "telegram-miniapp" | "browser" | "standalone-app";
type ClientKind  = "hiddify" | "v2ray";

type ClientLinks = Record<Platform, {
  title: string; market: string; direct?: string; storeLabelKey: string;
}>;

/* ─── Client links ───────────────────────────────────────────────────────── */

const V2RAYTUN_LINKS: ClientLinks = {
  android: { title: "v2RayTun", market: "https://play.google.com/store/apps/details?id=com.v2raytun.android", direct: "https://github.com/DigneZzZ/v2raytun/releases/latest", storeLabelKey: "connectAmneziaWG.store.google_play" },
  ios:     { title: "v2RayTun", market: "https://apps.apple.com/us/app/v2raytun/id6476628951", storeLabelKey: "connectAmneziaWG.store.app_store" },
  windows: { title: "v2RayTun", market: "https://v2raytun.com/", storeLabelKey: "connectAmneziaWG.store.download_page" },
  mac:     { title: "v2RayTun", market: "https://apps.apple.com/us/app/v2raytun/id6476628951", storeLabelKey: "connectAmneziaWG.store.app_store" },
  linux:   { title: "v2RayTun", market: "https://v2raytun.com/", storeLabelKey: "connectAmneziaWG.store.download_page" },
};

const HIDDIFY_LINKS: ClientLinks = {
  android: { title: "Hiddify", market: "https://play.google.com/store/apps/details?id=app.hiddify.com", direct: "https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-Android-arm64.apk", storeLabelKey: "connectAmneziaWG.store.google_play" },
  ios:     { title: "Hiddify", market: "https://apps.apple.com/us/app/hiddify-proxy-vpn/id6596777532", storeLabelKey: "connectAmneziaWG.store.app_store" },
  windows: { title: "Hiddify", market: "https://github.com/hiddify/hiddify-app/releases", storeLabelKey: "connectAmneziaWG.store.download_page" },
  mac:     { title: "Hiddify", market: "https://github.com/hiddify/hiddify-app/releases", direct: "https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-MacOS.dmg", storeLabelKey: "connectAmneziaWG.store.download_page" },
  linux:   { title: "Hiddify", market: "https://github.com/hiddify/hiddify-app/releases", direct: "https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-Linux-x64.AppImage", storeLabelKey: "connectAmneziaWG.store.download_page" },
};

const PLATFORM_ICONS: Record<Platform, string> = {
  android: "🤖", ios: "🍎", windows: "🪟", mac: "🍏", linux: "🐧",
};

const V2RAY_TRAFFIC_RULES_URL = "v2raytun://open-traffic-rules?id=d1eda856-3617-447c-b0e9-56da2afe755f";

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

function detectRuntime(): RuntimeMode {
  const tg = (window as any).Telegram?.WebApp;
  if (tg) return "telegram-miniapp";
  if (window.matchMedia?.("(display-mode: standalone)")?.matches || (window.navigator as any).standalone === true) return "standalone-app";
  return "browser";
}

function platformLabel(p: Platform) {
  const labels: Record<Platform, string> = { android: "Android", ios: "iOS", windows: "Windows", mac: "macOS", linux: "Linux" };
  return labels[p];
}

function openLinkSafe(url: string) {
  try {
    const tg = (window as any).Telegram?.WebApp;
    if (tg && typeof tg.openLink === "function") { tg.openLink(url); return; }
  } catch { /* ignore */ }
  window.open(url, "_blank", "noopener,noreferrer");
}

function closeTelegramMiniAppSoon(delay = 150) {
  setTimeout(() => {
    try { const tg = (window as any).Telegram?.WebApp; if (tg?.close) tg.close(); } catch { /* ignore */ }
  }, delay);
}

function tryOpenScheme(url: string, runtime: RuntimeMode, onFail?: () => void) {
  try {
    const a = document.createElement("a");
    a.href = url; a.rel = "noopener noreferrer"; a.style.display = "none";
    if (runtime === "telegram-miniapp") a.target = "_blank";
    document.body.appendChild(a); a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch { /* ignore */ } }, 300);
    if (runtime === "telegram-miniapp") closeTelegramMiniAppSoon(150);
  } catch { onFail?.(); }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.top = "-1000px";
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand("copy"); document.body.removeChild(ta); return ok;
    } catch { return false; }
  }
}

function buildHiddifyImportLink(url: string, platform: Platform) {
  return platform === "android"
    ? `intent://install-sub/?url=${encodeURIComponent(url)}#Intent;scheme=hiddify;package=app.hiddify.com;end`
    : `hiddify://install-sub/?url=${encodeURIComponent(url)}`;
}

function buildV2RayTunImportLink(url: string, platform: Platform) {
  const safeUrl = url.replace(/#/g, "%23");
  return platform === "android"
    ? `intent://import/${safeUrl}#Intent;scheme=v2raytun;package=com.v2raytun.android;end`
    : `v2raytun://import/${url}`;
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function ConnectMarzban({ usi }: Props) {
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const autoPlatform = useMemo(() => detectOS(), []);
  const runtime      = useMemo(() => detectRuntime(), []);

  const [chip, setChip] = useState<Chip>("auto");
  const platform: Platform = chip === "auto" ? autoPlatform : chip;

  const [platformPickerOpen, setPlatformPickerOpen] = useState(false);
  const [advancedOpen,       setAdvancedOpen]       = useState(false);

  const [subscriptionUrl,       setSubscriptionUrl]       = useState("");
  const [subscriptionUrlMirror, setSubscriptionUrlMirror] = useState<string | null>(null);
  const [copied,                setCopied]                = useState(false);
  const [copiedMirror,          setCopiedMirror]          = useState(false);
  const [qrOpen,                setQrOpen]                = useState(false);
  const [qrDataUrl,             setQrDataUrl]             = useState("");
  const [rulesQrOpen,           setRulesQrOpen]           = useState(false);
  const [rulesQrDataUrl,        setRulesQrDataUrl]        = useState("");

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await apiFetch(`/services/${encodeURIComponent(String(usi))}/connect/marzban`, { method: "GET" }) as any;
      if (r?.ok === false && (r.error || r.message)) throw new Error(String(r.error || r.message));
      const url = String(r?.subscription_url ?? r?.subscriptionUrl ?? "").trim();
      if (!url) throw new Error("subscription_url_missing");
      setSubscriptionUrl(url);
      const mirror = String(r?.subscription_url_mirror ?? r?.subscriptionUrlMirror ?? "").trim();
      setSubscriptionUrlMirror(mirror || null);
      toast.success(t("connect.ready") || "Подписка готова", { description: getMood("subscription_ready") ?? "Импортируйте в v2RayTun." });
    } catch (e: any) {
      setSubscriptionUrl(""); setSubscriptionUrlMirror(null);
      const msg = e?.message || t("connect.load_failed");
      setError(msg);
      toast.error(t("connect.sub_prepare_error"), {
        description: msg === "subscription_url_missing" ? t("connect.sub_prepare_error_desc") : String(msg),
      });
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [usi]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = !loading && !error && !!subscriptionUrl;

  const v2rayImportHref       = ready ? buildV2RayTunImportLink(subscriptionUrl, platform) : "";
  const v2rayMirrorImportHref = ready && subscriptionUrlMirror ? buildV2RayTunImportLink(subscriptionUrlMirror, platform) : "";

  function openImport(useMirror = false) {
    const href = useMirror ? v2rayMirrorImportHref : v2rayImportHref;
    if (!ready || !href) return;
    tryOpenScheme(href, runtime, () => {
      toast.info(t("connect.open_client"), { description: t("connect.more_methods") });
    });
    toast.info(t("connect.open_client"), { description: t("connect.import_text") });
  }

  async function openQr() {
    if (!subscriptionUrl) return;
    try {
      const dataUrl = await QRCode.toDataURL(subscriptionUrl, { margin: 2, width: 360 });
      setQrDataUrl(dataUrl); setQrOpen(true);
      toast.info(t("connect.qr_title"), { description: t("connect.qr_text") });
    } catch {
      toast.error(t("connect.qr_title"), { description: t("connect.sub_prepare_error_desc") });
    }
  }

  async function copySub(useMirror = false) {
    const target = useMirror ? (subscriptionUrlMirror ?? "") : subscriptionUrl;
    if (!target) return;
    const ok = await copyToClipboard(target);
    if (useMirror) { setCopiedMirror(ok); if (ok) setTimeout(() => setCopiedMirror(false), 1500); }
    else           { setCopied(ok);       if (ok) setTimeout(() => setCopied(false),       1500); }
    ok
      ? toast.success(t("connect.copied"),    { description: t("connect.import_text") })
      : toast.error(t("connect.copy_link"),   { description: t("connect.sub_prepare_error_desc") });
  }

  async function openRulesQr() {
    try {
      const dataUrl = await QRCode.toDataURL(V2RAY_TRAFFIC_RULES_URL, { margin: 2, width: 360 });
      setRulesQrDataUrl(dataUrl); setRulesQrOpen(true);
    } catch {
      toast.error(t("connect.qr_title"), { description: t("connect.sub_prepare_error_desc") });
    }
  }

  function openTrafficRules() {
    tryOpenScheme(V2RAY_TRAFFIC_RULES_URL, runtime, () => {
      toast.info("Откройте v2RayTun вручную", { description: "Перейдите в Настройки → Правила маршрутизации" });
    });
    toast.info("⚡ Применяем маршруты", { description: "Открываем v2RayTun…" });
  }

  function openClientStore(client: ClientKind) {
    openLinkSafe(client === "hiddify" ? HIDDIFY_LINKS[platform].market : V2RAYTUN_LINKS[platform].market);
  }

  function openClientDirect(client: ClientKind) {
    const links = client === "hiddify" ? HIDDIFY_LINKS[platform] : V2RAYTUN_LINKS[platform];
    if (!links.direct) return;
    openLinkSafe(links.direct);
  }

  return (
    <div className="cm">

      {/* Статус-бар */}
      <div className="pre" style={{
        borderColor: ready ? "rgba(43,227,143,0.28)" : error ? "rgba(255,77,109,0.28)" : "rgba(77,215,255,0.20)",
        background:  ready ? "rgba(43,227,143,0.06)"  : error ? "rgba(255,77,109,0.06)"  : "rgba(77,215,255,0.05)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span>{loading ? "⏳" : error ? "⚠️" : "✅"}</span>
        <span>{loading ? t("connect.loading") : error ? t("connect.error") : t("connect.ready")}</span>
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
        <button className="btn cawg__deviceBtn" type="button" onClick={() => setPlatformPickerOpen(true)} disabled={loading}>
          {PLATFORM_ICONS[platform]}{" "}
          {chip === "auto"
            ? t("connectAmneziaWG.device.current", "Текущее ({platform})").replace("{platform}", platformLabel(autoPlatform))
            : platformLabel(platform)}
          {" "}▾
        </button>
      </div>

      {/* Основная карточка */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">

          {/* Шаг 1 — установка */}
          <div className="pre" style={{ borderColor: "rgba(124,92,255,0.22)", background: "rgba(124,92,255,0.05)" }}>
            <b>Шаг 1.</b> {t("connect.step_install_desc").replace("{client}", V2RAYTUN_LINKS[platform].title).replace("{platform}", platformLabel(platform))}
          </div>
          {V2RAYTUN_LINKS[platform].direct ? (
            <div className="actions actions--2">
              <button className="btn btn--primary" type="button" onClick={() => openClientStore("v2ray")}>
                📲 {t("connect.open_store")} {t(V2RAYTUN_LINKS[platform].storeLabelKey)}
              </button>
              <button className="btn" type="button" onClick={() => openClientDirect("v2ray")}>
                ⬇️ {platform === "android" ? t("connectAmneziaWG.step1.download_apk") : t("connect.download_direct")}
              </button>
            </div>
          ) : (
            <div className="actions actions--1">
              <button className="btn btn--primary" type="button" onClick={() => openClientStore("v2ray")}>
                📲 {t("connect.open_store")} {t(V2RAYTUN_LINKS[platform].storeLabelKey)}
              </button>
            </div>
          )}

          {/* Шаг 2 — импорт */}
          <div className="pre" style={{ marginTop: 12, borderColor: "rgba(77,215,255,0.22)", background: "rgba(77,215,255,0.05)" }}>
            <b>Шаг 2.</b> {t("connect.step_import_desc")}
          </div>
          <div className="actions actions--1">
            <button className="btn btn--primary" onClick={() => openImport(false)} disabled={!ready} type="button">
              {loading ? `⏳ ${t("connect.wait")}` : `⚡ ${t("connect.add_sub")}`}
            </button>
          </div>

          {subscriptionUrlMirror && ready && (
            <div className="actions actions--1" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => openImport(true)} type="button">
                🔄 Не открывается? Попробовать через RU-зеркало
              </button>
            </div>
          )}

          <div className="actions actions--1">
            <button className="btn" onClick={() => setAdvancedOpen((v) => !v)} type="button">
              {advancedOpen ? `▴ ${t("connect.hide_methods")}` : `▾ ${t("connect.more_methods")}`}
            </button>
          </div>

          {/* Расширенный блок */}
          {advancedOpen && ready && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>

              <div className="actions actions--2">
                <button className="btn btn--primary" type="button" onClick={() => void copySub(false)}>
                  {copied ? `✅ ${t("connect.copied")}` : `📋 ${t("connect.copy_link")}`}
                </button>
                <button className="btn btn--primary" type="button" onClick={() => void openQr()}>
                  📱 {t("connect.show_qr")}
                </button>
              </div>

              {subscriptionUrlMirror && (
                <div className="actions actions--1">
                  <button className="btn" type="button" onClick={() => void copySub(true)}>
                    {copiedMirror ? `✅ ${t("connect.copied")}` : `📋 ${t("connect.copy_link")} (RU зеркало)`}
                  </button>
                </div>
              )}

              {/* Hiddify */}
              <div className="pre" style={{ borderColor: "rgba(43,227,143,0.22)", background: "rgba(43,227,143,0.05)" }}>
                <b>Hiddify</b> — альтернативный клиент
              </div>
              {HIDDIFY_LINKS[platform].direct ? (
                <div className="actions actions--2">
                  <button className="btn btn--primary" type="button" onClick={() => openClientStore("hiddify")}>
                    📲 {t("connect.open_store")} {t(HIDDIFY_LINKS[platform].storeLabelKey)}
                  </button>
                  <button className="btn" type="button" onClick={() => openClientDirect("hiddify")}>
                    ⬇️ {platform === "android" ? t("connectAmneziaWG.step1.download_apk") : t("connect.download_direct")}
                  </button>
                </div>
              ) : (
                <div className="actions actions--1">
                  <button className="btn btn--primary" type="button" onClick={() => openClientStore("hiddify")}>
                    📲 {t("connect.open_store")} {t(HIDDIFY_LINKS[platform].storeLabelKey)}
                  </button>
                </div>
              )}
              <div className="actions actions--1">
                <button className="btn" type="button" onClick={() => {
                  const href = buildHiddifyImportLink(subscriptionUrl, platform);
                  tryOpenScheme(href, runtime);
                  toast.info(t("connect.open_client"), { description: t("connect.import_text") });
                }} disabled={!ready}>
                  ⚡ {t("connect.add_sub")} в Hiddify
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Маршрутизация v2RayTun */}
      <div style={{
        marginTop: 12, padding: "14px 16px", borderRadius: 16,
        border: "1px solid rgba(77,215,255,0.32)",
        background: "linear-gradient(135deg, rgba(77,215,255,0.08), rgba(124,92,255,0.06))",
        boxShadow: "0 0 24px rgba(77,215,255,0.10)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 20 }}>🗺️</span>
          <div>
            <div style={{ fontWeight: 900, fontSize: 14 }}>Раздельная маршрутизация</div>
            <div style={{ fontSize: 12, color: "rgba(77,215,255,0.85)", marginTop: 2 }}>
              Только РФ-трафик напрямую, остальное — в туннель
            </div>
          </div>
        </div>
        <div className="actions actions--2">
          <button className="btn btn--primary" onClick={openTrafficRules} type="button">
            ⚡ Применить маршруты
          </button>
          <button className="btn" onClick={() => void openRulesQr()} type="button">
            📱 QR-код
          </button>
        </div>
      </div>

      {/* QR маршрутов */}
      {rulesQrOpen && createPortal(
        <div className="modal" role="dialog" aria-modal="true" onMouseDown={() => setRulesQrOpen(false)}>
          <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="modal__head">
                <div className="modal__title">🗺️ Маршруты v2RayTun</div>
                <button className="btn modal__close" type="button" onClick={() => setRulesQrOpen(false)} aria-label={t("common.close")}>✕</button>
              </div>
              <div className="modal__content">
                <p className="p">Отсканируйте QR в v2RayTun для настройки раздельной маршрутизации.</p>
                <div className="helperMedia" style={{ marginTop: 12, background: "#fff", borderRadius: 12, padding: 8 }}>
                  {rulesQrDataUrl && <img className="helperMedia__img" src={rulesQrDataUrl} alt="QR маршрутов" loading="lazy" width={320} />}
                </div>
                <div className="actions actions--1" style={{ marginTop: 14 }}>
                  <button className="btn btn--primary" onClick={() => setRulesQrOpen(false)} type="button">{t("common.close")}</button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

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
                  <button className={`kv__item cawg__pickItem${chip === "auto" ? " is-active" : ""}`} type="button"
                    onClick={() => { setChip("auto"); setPlatformPickerOpen(false); }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="kv__k">{t("connectAmneziaWG.device.current_short")}</span>
                      <span className="chip">{PLATFORM_ICONS[autoPlatform]} {platformLabel(autoPlatform)}</span>
                    </div>
                  </button>
                  {(["android", "ios", "windows", "mac", "linux"] as Platform[]).map((p) => (
                    <button key={p} className={`kv__item cawg__pickItem${chip === p ? " is-active" : ""}`} type="button"
                      onClick={() => { setChip(p); setPlatformPickerOpen(false); }}>
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

      {/* QR подписки */}
      {qrOpen && createPortal(
        <div className="modal" role="dialog" aria-modal="true" onMouseDown={() => setQrOpen(false)}>
          <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="modal__head">
                <div className="modal__title">📱 {t("connect.qr_title")}</div>
                <button className="btn modal__close" type="button" onClick={() => setQrOpen(false)} aria-label={t("common.close")}>✕</button>
              </div>
              <div className="modal__content">
                <p className="p">{t("connect.qr_text")}</p>
                <div className="helperMedia" style={{ marginTop: 12, background: "#fff", borderRadius: 12, padding: 8 }}>
                  {qrDataUrl && <img className="helperMedia__img" src={qrDataUrl} alt={t("connectAmneziaWG.qr.alt")} loading="lazy" width={320} />}
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