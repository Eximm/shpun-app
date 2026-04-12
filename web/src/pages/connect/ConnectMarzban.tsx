// web/src/pages/connect/ConnectMarzban.tsx

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

type Platform     = "android" | "ios" | "windows" | "mac" | "linux";
type Chip         = "auto" | Platform;
type AccordionKey = "hiddify" | "v2ray" | "manual";
type RuntimeMode  = "telegram-miniapp" | "browser" | "standalone-app";
type ClientKind   = "hiddify" | "v2ray";

type ClientLinks = Record<Platform, {
  title: string;
  market: string;
  direct?: string;
  storeLabelKey: string;
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

/* ─── Utils ─────────────────────────────────────────────────────────────── */

function detectOS(): Platform {
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera || "";
  const isAppleTouch = /\bMac\b/.test(ua) && (navigator as any).maxTouchPoints > 1;
  if (/android/i.test(ua))                        return "android";
  if (/iPad|iPhone|iPod/.test(ua) || isAppleTouch) return "ios";
  if (/Win/i.test(ua))                             return "windows";
  if (/\bMac\b/i.test(ua))                        return "mac";
  if (/Linux/i.test(ua))                           return "linux";
  return "windows";
}

function detectRuntime(): RuntimeMode {
  const tg = (window as any).Telegram?.WebApp;
  if (tg) return "telegram-miniapp";
  if (window.matchMedia?.("(display-mode: standalone)")?.matches || (window.navigator as any).standalone === true)
    return "standalone-app";
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
  try { await navigator.clipboard.writeText(text); return true; } catch {
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
  return platform === "android"
    ? `intent://import/${encodeURIComponent(url)}#Intent;scheme=v2raytun;package=com.v2raytun.android;end`
    : `v2raytun://import/${url}`;
}

function installStateKey(usi: number, platform: Platform, client: ClientKind) {
  return `connect_marzban_install_started:${usi}:${platform}:${client}`;
}

function readInstallState(usi: number, platform: Platform, client: ClientKind) {
  try { return localStorage.getItem(installStateKey(usi, platform, client)) === "1"; } catch { return false; }
}

function writeInstallState(usi: number, platform: Platform, client: ClientKind, value: boolean) {
  try {
    if (value) localStorage.setItem(installStateKey(usi, platform, client), "1");
    else localStorage.removeItem(installStateKey(usi, platform, client));
  } catch { /* ignore */ }
}

/* ─── Accordion ──────────────────────────────────────────────────────────── */

function Accordion({ title, subtitle, opened, onToggle, children }: {
  title: string;
  subtitle: string;
  opened: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const cardRef  = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [maxHeight, setMaxHeight] = useState(0);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    setMaxHeight(opened ? el.scrollHeight : 0);
  }, [opened, children]);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (opened) setMaxHeight(el.scrollHeight); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [opened]);

  useEffect(() => {
    if (!opened) return;
    const id = window.setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 180);
    return () => window.clearTimeout(id);
  }, [opened]);

  return (
    <div ref={cardRef} className="card cawg__accCard">
      <button type="button" onClick={onToggle} className="kv__item cawg__accToggle" aria-expanded={opened}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="kv__v">{title}</div>
            <p className="p">{subtitle}</p>
          </div>
          <span className={`badge cawg__accBadge ${opened ? "is-open" : ""}`} aria-hidden>▾</span>
        </div>
      </button>
      <div className={`cawg__accBody ${opened ? "is-open" : ""}`} style={{ maxHeight: `${maxHeight}px` }}>
        <div ref={innerRef} className="card__body cawg__accBodyInner">
          {children}
        </div>
      </div>
    </div>
  );
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
  const [openAccordion,      setOpenAccordion]      = useState<AccordionKey>("hiddify");
  const userTouchedAccordionsRef = useRef(false);

  const [subscriptionUrl, setSubscriptionUrl] = useState("");
  const [copied,          setCopied]          = useState(false);
  const [qrOpen,          setQrOpen]          = useState(false);
  const [qrDataUrl,       setQrDataUrl]       = useState("");

  const [installStarted, setInstallStarted] = useState<Record<ClientKind, boolean>>({
    hiddify: false, v2ray: false,
  });

  // ── Load ──────────────────────────────────────────────────────────────────
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch(`/services/${encodeURIComponent(String(usi))}/connect/marzban`, { method: "GET" }) as any;
      if (r?.ok === false && (r.error || r.message)) throw new Error(String(r.error || r.message));
      const url = String(r?.subscription_url ?? r?.subscriptionUrl ?? "").trim();
      if (!url) throw new Error("subscription_url_missing");
      setSubscriptionUrl(url);
    } catch (e: any) {
      setSubscriptionUrl("");
      const msg = e?.message || t("connect.load_failed");
      setError(msg);
      toast.error(t("connect.sub_prepare_error"), {
        description: msg === "subscription_url_missing" ? t("connect.sub_prepare_error_desc") : String(msg),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [usi]); // eslint-disable-line react-hooks/exhaustive-deps

  const primaryKind: ClientKind = platform === "ios" ? "v2ray" : "hiddify";

  useEffect(() => {
    if (userTouchedAccordionsRef.current) return;
    setOpenAccordion(primaryKind);
  }, [platform, primaryKind]);

  useEffect(() => {
    setInstallStarted({
      hiddify: readInstallState(usi, platform, "hiddify"),
      v2ray:   readInstallState(usi, platform, "v2ray"),
    });
  }, [usi, platform]);

  const ready         = !loading && !error && !!subscriptionUrl;
  const hiddifyClient = HIDDIFY_LINKS[platform];
  const v2rayClient   = V2RAYTUN_LINKS[platform];
  const primaryClient = primaryKind === "hiddify" ? hiddifyClient : v2rayClient;

  const hiddifyAutoImportHref = ready ? buildHiddifyImportLink(subscriptionUrl, platform) : "";
  const v2rayAutoImportHref   = ready ? buildV2RayTunImportLink(subscriptionUrl, platform) : "";

  const topHint = useMemo(() => {
    if (loading) return t("connect.loading");
    if (error)   return t("connect.error");
    return `${t("connect.ready")} ${t("connect.sub_ready_desc")}`;
  }, [loading, error, t]);

  // ── Actions ───────────────────────────────────────────────────────────────
  function toggleAccordion(key: AccordionKey) {
    userTouchedAccordionsRef.current = true;
    setOpenAccordion(key);
  }

  function markInstallStarted(client: ClientKind) {
    writeInstallState(usi, platform, client, true);
    setInstallStarted((prev) => ({ ...prev, [client]: true }));
  }

  function resetInstallStarted(client: ClientKind) {
    writeInstallState(usi, platform, client, false);
    setInstallStarted((prev) => ({ ...prev, [client]: false }));
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

  async function copySub() {
    if (!subscriptionUrl) return;
    const ok = await copyToClipboard(subscriptionUrl);
    setCopied(ok);
    if (ok) {
      setTimeout(() => setCopied(false), 1500);
      toast.success(t("connect.copied"), { description: t("connect.import_text") });
    } else {
      toast.error(t("connect.copy_link"), { description: t("connect.sub_prepare_error_desc") });
    }
  }

  function openAutoImport(client: ClientKind) {
    const href = client === "hiddify" ? hiddifyAutoImportHref : v2rayAutoImportHref;
    if (!ready || !href) return;
    tryOpenScheme(href, runtime, () => {
      toast.info(t("connect.open_client"), { description: t("connect.more_methods") });
    });
    toast.info(t("connect.open_client"), { description: t("connect.import_text") });
  }

  function openClientStore(client: ClientKind) {
    const links = client === "hiddify" ? hiddifyClient : v2rayClient;
    markInstallStarted(client);
    openLinkSafe(links.market);
  }

  function openClientDirect(client: ClientKind) {
    const links = client === "hiddify" ? hiddifyClient : v2rayClient;
    if (!links.direct) return;
    markInstallStarted(client);
    openLinkSafe(links.direct);
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderInstallActions(client: ClientKind) {
    const links = client === "hiddify" ? hiddifyClient : v2rayClient;
    const storeLabel = t(links.storeLabelKey);

    if (links.direct) {
      return (
        <div className="actions actions--2">
          <button className="btn btn--primary" type="button" onClick={() => openClientStore(client)}>
            {t("connect.open_store")} {storeLabel}
          </button>
          <button className="btn" type="button" onClick={() => openClientDirect(client)}>
            {platform === "android" ? t("connectAmneziaWG.step1.download_apk") : t("connect.download_direct")}
          </button>
        </div>
      );
    }

    return (
      <div className="actions actions--1">
        <button className="btn btn--primary" type="button" onClick={() => openClientStore(client)}>
          {t("connect.open_store")} {storeLabel}
        </button>
      </div>
    );
  }

  function renderClientAccordion(client: ClientKind) {
    const links   = client === "hiddify" ? hiddifyClient : v2rayClient;
    const started = installStarted[client];
    const subtitle = t("connect.install_text", "Установите {client} для {platform}.")
      .replace("{client}", links.title)
      .replace("{platform}", platformLabel(platform));

    return (
      <Accordion
        key={client}
        title={links.title}
        subtitle={subtitle}
        opened={openAccordion === client}
        onToggle={() => toggleAccordion(client)}
      >
        <div style={{ marginBottom: 10 }}>
          <div className="pre">
            <b>{t("connect.step_install")}</b><br />
            {t("connect.step_install_desc", "Установите {client} для {platform}.")
              .replace("{client}", links.title)
              .replace("{platform}", platformLabel(platform))}
          </div>
          {renderInstallActions(client)}
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="pre">
            <b>{t("connect.step_import")}</b><br />
            {t("connect.step_import_desc")}
          </div>
          <div className="actions actions--1">
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => openAutoImport(client)}
              disabled={!ready}
            >
              {loading ? t("connect.wait") : t("connect.add_sub")}
            </button>
          </div>
        </div>

        {started && (
          <div className="actions actions--1" style={{ marginTop: 8 }}>
            <button className="btn" type="button" onClick={() => resetInstallStarted(client)}>
              {t("connect.step_install")}
            </button>
          </div>
        )}
      </Accordion>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="cm">

      {/* Status */}
      <div className="pre">
        {ready ? "✅ " : error ? "⚠️ " : "… "}{topHint}
      </div>

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

      {/* Main steps card */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">

          {/* Step 1 */}
          <div className="pre">
            <b>{t("connect.step_install")}</b><br />
            {t("connect.step_install_desc", "Установите {client} для {platform}.")
              .replace("{client}", primaryClient.title)
              .replace("{platform}", platformLabel(platform))}
          </div>
          {renderInstallActions(primaryKind)}

          {/* Step 2 */}
          <div className="pre" style={{ marginTop: 12 }}>
            <b>{t("connect.step_import")}</b><br />
            {t("connect.step_import_desc")}
          </div>
          <div className="actions actions--1">
            <button
              className="btn btn--primary"
              onClick={() => openAutoImport(primaryKind)}
              disabled={!ready}
              type="button"
            >
              {loading ? t("connect.wait") : t("connect.add_sub")}
            </button>
          </div>

          {/* Other methods toggle */}
          <div className="actions actions--1">
            <button className="btn" onClick={() => setAdvancedOpen((v) => !v)} type="button">
              {advancedOpen
                ? `▴ ${t("connect.hide_methods")}`
                : `▾ ${t("connect.more_methods")}`}
            </button>
          </div>

        </div>
      </div>

      {/* Advanced accordion */}
      {advancedOpen && ready && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          {renderClientAccordion(primaryKind === "hiddify" ? "v2ray" : "hiddify")}

          <Accordion
            title={t("connect.more_methods")}
            subtitle={t("connect.methods_desc")}
            opened={openAccordion === "manual"}
            onToggle={() => toggleAccordion("manual")}
          >
            <div className="actions actions--1">
              <button className="btn btn--primary" type="button" onClick={copySub}>
                {copied ? `✅ ${t("connect.copied")}` : `📋 ${t("connect.copy_link")}`}
              </button>
            </div>
            <div className="actions actions--1" style={{ marginTop: 8 }}>
              <button className="btn btn--primary" type="button" onClick={openQr}>
                📱 {t("connect.show_qr")}
              </button>
            </div>
          </Accordion>
        </div>
      )}

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
                <div className="modal__title">{t("connect.qr_title")}</div>
                <button className="btn modal__close" type="button" onClick={() => setQrOpen(false)} aria-label={t("common.close")}>✕</button>
              </div>
              <div className="modal__content">
                <p className="p">{t("connect.qr_text")}</p>
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