// FILE: web/src/pages/connect/ConnectMarzban.tsx

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { apiFetch } from "../../shared/api/client";
import { getMood } from "../../shared/payments-mood";
import { toast } from "../../shared/ui/toast";
import { useI18n } from "../../shared/i18n";

type Props = {
  usi: number;
  service: { title: string; status: string; statusRaw: string };
  onDone?: () => void;
};

type Platform = "android" | "ios" | "windows" | "mac" | "linux";
type Chip = "auto" | Platform;
type RuntimeMode = "telegram-miniapp" | "browser" | "standalone-app";
type ClientKind = "happ" | "v2ray";

type ClientLinks = Record<Platform, {
  title: string;
  market: string;
  direct?: string;
  storeLabelKey: string;
}>;

const HAPP_LINKS: ClientLinks = {
  android: { title: "Happ", market: "https://play.google.com/store/apps/details?id=com.happproxy", direct: "https://github.com/Happ-proxy/happ-android/releases/latest/download/Happ.apk", storeLabelKey: "connectAmneziaWG.store.google_play" },
  ios: { title: "Happ", market: "https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973", storeLabelKey: "connectAmneziaWG.store.app_store" },
  windows: { title: "Happ", market: "https://www.happ.su/main", direct: "https://github.com/Happ-proxy/happ-desktop/releases/latest/download/setup-Happ.x64.exe", storeLabelKey: "connectAmneziaWG.store.download_page" },
  mac: { title: "Happ", market: "https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973", direct: "https://github.com/Happ-proxy/happ-desktop/releases/latest/download/Happ.macOS.universal.dmg", storeLabelKey: "connectAmneziaWG.store.app_store" },
  linux: { title: "Happ", market: "https://www.happ.su/main", direct: "https://github.com/Happ-proxy/happ-desktop/releases/latest/download/Happ.linux.x64.deb", storeLabelKey: "connectAmneziaWG.store.download_page" },
};

const V2RAYTUN_LINKS: ClientLinks = {
  android: { title: "v2RayTun", market: "https://play.google.com/store/apps/details?id=com.v2raytun.android", direct: "https://github.com/DigneZzZ/v2raytun/releases/latest", storeLabelKey: "connectAmneziaWG.store.google_play" },
  ios: { title: "v2RayTun", market: "https://apps.apple.com/us/app/v2raytun/id6476628951", storeLabelKey: "connectAmneziaWG.store.app_store" },
  windows: { title: "v2RayTun", market: "https://v2raytun.com/", direct: "https://github.com/DigneZzZ/v2raytun/releases/download/5.21.68/v2RayTun_Setup.exe", storeLabelKey: "connectAmneziaWG.store.download_page" },
  mac: { title: "v2RayTun", market: "https://apps.apple.com/us/app/v2raytun/id6476628951", storeLabelKey: "connectAmneziaWG.store.app_store" },
  linux: { title: "v2RayTun", market: "https://v2raytun.com/", storeLabelKey: "connectAmneziaWG.store.download_page" },
};

const HAPP_RU_ROUTING_LINK = "happ://routing/add/eyJOYW1lIjoiU2hwdW5fUlVfUm91dGluZyIsIkdsb2JhbFByb3h5IjoidHJ1ZSIsIlJvdXRlT3JkZXIiOiJibG9jay1kaXJlY3QtcHJveHkiLCJSZW1vdGVETlNUeXBlIjoiRG9VIiwiUmVtb3RlRE5TRG9tYWluIjoiaHR0cHM6Ly9jbG91ZGZsYXJlLWRucy5jb20vZG5zLXF1ZXJ5IiwiUmVtb3RlRE5TSVAiOiI3Ny44OC44LjEiLCJEb21lc3RpY0ROU1R5cGUiOiJEb1UiLCJEb21lc3RpY0ROU0RvbWFpbiI6Imh0dHBzOi8vZG5zLmdvb2dsZS9kbnMtcXVlcnkiLCJEb21lc3RpY0ROU0lQIjoiNzcuODguOC44IiwiR2VvaXB1cmwiOiJodHRwczovL2dpdGh1Yi5jb20vTG95YWxzb2xkaWVyL3YycmF5LXJ1bGVzLWRhdC9yZWxlYXNlcy9sYXRlc3QvZG93bmxvYWQvZ2VvaXAuZGF0IiwiR2Vvc2l0ZXVybCI6Imh0dHBzOi8vZ2l0aHViLmNvbS9Mb3lhbHNvbGRpZXIvdjJyYXktcnVsZXMtZGF0L3JlbGVhc2VzL2xhdGVzdC9kb3dubG9hZC9nZW9zaXRlLmRhdCIsIkxhc3RVcGRhdGVkIjoiMTc3NTU4Mzg0MyIsIkRuc0hvc3RzIjp7ImNsb3VkZmxhcmUtZG5zLmNvbSI6IjEuMS4xLjEiLCJkbnMuZ29vZ2xlIjoiOC44LjguOCJ9LCJEaXJlY3RTaXRlcyI6WyJnZW9zaXRlOmNhdGVnb3J5LXJ1IiwiZ2Vvc2l0ZTpjYXRlZ29yeS1nb3YtcnUiLCJnZW9zaXRlOm1haWxydSIsImdlb3NpdGU6dmsiXSwiRGlyZWN0SXAiOlsiMjU1LjI1NS4yNTUuMjU1IiwiZ2VvaXA6cHJpdmF0ZSIsImdlb2lwOnJ1Il0sIlByb3h5U2l0ZXMiOltdLCJQcm94eUlwIjpbXSwiQmxvY2tTaXRlcyI6W10sIkJsb2NrSXAiOltdLCJEb21haW5TdHJhdGVneSI6IkFzSXMiLCJGYWtlRE5TIjoiZmFsc2UiLCJVc2VDaHVua0ZpbGVzIjoidHJ1ZSJ9";

const PLATFORM_ICONS: Record<Platform, string> = {
  android: "🤖",
  ios: "🍎",
  windows: "🪟",
  mac: "🍏",
  linux: "🐧",
};

function detectOS(): Platform {
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera || "";
  const isAppleTouch = /\bMac\b/.test(ua) && (navigator as any).maxTouchPoints > 1;
  if (/android/i.test(ua)) return "android";
  if (/iPad|iPhone|iPod/.test(ua) || isAppleTouch) return "ios";
  if (/Win/i.test(ua)) return "windows";
  if (/\bMac\b/i.test(ua)) return "mac";
  if (/Linux/i.test(ua)) return "linux";
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

function tryOpenScheme(url: string, runtime: RuntimeMode, onFail?: () => void) {
  void runtime;
  try {
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch { /* ignore */ } }, 300);
  } catch {
    onFail?.();
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function buildHappImportLink(url: string, platform: Platform, runtime: RuntimeMode) {
  const safeUrl = url.replace(/#/g, "%23");
  void platform;
  void runtime;
  return `happ://add/${safeUrl}`;
}

function buildHappBridgeLink(url: string) {
  if (!/^https?:$/.test(window.location.protocol)) return "";
  const bridgeUrl = new URL(window.location.href);
  bridgeUrl.searchParams.set("happ_import", url.trim());
  return bridgeUrl.toString();
}

function buildHappDeepLinkBridge(deepLink: string) {
  if (!/^https?:$/.test(window.location.protocol)) return "";
  const bridgeUrl = new URL(window.location.href);
  bridgeUrl.searchParams.set("happ_link", deepLink.trim());
  return bridgeUrl.toString();
}

function getHappBridgeDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const directLink = params.get("happ_link")?.trim();
  if (directLink) return directLink;
  const target = params.get("happ_import")?.trim();
  return target ? buildHappImportLink(target, "android", "browser") : "";
}

function openViaTelegramBridge(url: string) {
  const bridge = buildHappBridgeLink(url);
  if (!bridge) return false;
  try {
    const tg = (window as any).Telegram?.WebApp;
    if (tg && typeof tg.openLink === "function") {
      tg.openLink(bridge, { try_instant_view: false });
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

function openDeepLinkViaTelegramBridge(deepLink: string) {
  const bridge = buildHappDeepLinkBridge(deepLink);
  if (!bridge) return false;
  try {
    const tg = (window as any).Telegram?.WebApp;
    if (tg && typeof tg.openLink === "function") {
      tg.openLink(bridge, { try_instant_view: false });
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

function buildV2RayTunImportLink(url: string, platform: Platform, runtime: RuntimeMode) {
  const safeUrl = url.replace(/#/g, "%23");
  return platform === "android" && runtime !== "telegram-miniapp"
    ? `intent://import/${safeUrl}#Intent;scheme=v2raytun;package=com.v2raytun.android;end`
    : `v2raytun://import/${url}`;
}

export default function ConnectMarzban({ usi }: Props) {
  const { t } = useI18n();

  const bridgeDeepLink = useMemo(() => getHappBridgeDeepLink(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const autoPlatform = useMemo(() => detectOS(), []);
  const runtime = useMemo(() => detectRuntime(), []);

  const [chip, setChip] = useState<Chip>("auto");
  const platform: Platform = chip === "auto" ? autoPlatform : chip;

  const [platformPickerOpen, setPlatformPickerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [subscriptionUrl, setSubscriptionUrl] = useState("");
  const [subscriptionUrlMirror, setSubscriptionUrlMirror] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedMirror, setCopiedMirror] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch(`/services/${encodeURIComponent(String(usi))}/connect/marzban`, { method: "GET" }) as any;
      if (r?.ok === false && (r.error || r.message)) throw new Error(String(r.error || r.message));
      const url = String(r?.subscription_url ?? r?.subscriptionUrl ?? "").trim();
      if (!url) throw new Error("subscription_url_missing");
      setSubscriptionUrl(url);
      const mirror = String(r?.subscription_url_mirror ?? r?.subscriptionUrlMirror ?? "").trim();
      setSubscriptionUrlMirror(mirror || null);
      toast.success(t("connect.ready"), { description: getMood("subscription_ready") ?? t("connect.sub_ready_desc") });
    } catch (e: any) {
      setSubscriptionUrl("");
      setSubscriptionUrlMirror(null);
      const msg = e?.message || t("connect.load_failed");
      setError(msg);
      toast.error(t("connect.sub_prepare_error"), {
        description: msg === "subscription_url_missing" ? t("connect.sub_prepare_error_desc") : String(msg),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (bridgeDeepLink) {
      const timer = window.setTimeout(() => {
        window.location.href = bridgeDeepLink;
      }, 80);
      return () => window.clearTimeout(timer);
    }
    void load();
  }, [usi, bridgeDeepLink]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = !loading && !error && !!subscriptionUrl;

  const v2rayImportHref = ready ? buildV2RayTunImportLink(subscriptionUrl, platform, runtime) : "";
  const v2rayMirrorImportHref = ready && subscriptionUrlMirror ? buildV2RayTunImportLink(subscriptionUrlMirror, platform, runtime) : "";

  async function openImport(useMirror = false, client: ClientKind = "happ") {
    const target = useMirror ? (subscriptionUrlMirror ?? "") : subscriptionUrl;
    if (!ready || !target) return;

    if (client === "happ") {
      if (runtime === "telegram-miniapp" && openViaTelegramBridge(target)) {
        toast.info(t("connect.open_client"), { description: t("connectMarzban.happ.import_text") });
        return;
      }
      tryOpenScheme(buildHappImportLink(target, platform, runtime), runtime, () => {
        toast.info(t("connect.open_client"), { description: t("connect.more_methods") });
      });
      toast.info(t("connect.open_client"), { description: t("connectMarzban.happ.import_text") });
      return;
    }

    const href = useMirror ? v2rayMirrorImportHref : v2rayImportHref;
    if (!href) return;
    tryOpenScheme(href, runtime, () => {
      toast.info(t("connect.open_client"), { description: t("connect.more_methods") });
    });
    toast.info(t("connect.open_client"), { description: t("connectMarzban.v2ray.import_text") });
  }

  async function openQr() {
    if (!subscriptionUrl) return;
    try {
      const dataUrl = await QRCode.toDataURL(subscriptionUrl, {
        margin: 2,
        width: 360,
        color: { dark: "#f8fbff", light: "#07111f" },
      });
      setQrDataUrl(dataUrl);
      setQrOpen(true);
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
    else { setCopied(ok); if (ok) setTimeout(() => setCopied(false), 1500); }
    ok
      ? toast.success(t("connect.copied"), { description: t("connect.import_text") })
      : toast.error(t("connect.copy_link"), { description: t("connect.sub_prepare_error_desc") });
  }

  function openClientStore(client: ClientKind) {
    openLinkSafe(client === "happ" ? HAPP_LINKS[platform].market : V2RAYTUN_LINKS[platform].market);
  }

  function openClientDirect(client: ClientKind) {
    const links = client === "happ" ? HAPP_LINKS[platform] : V2RAYTUN_LINKS[platform];
    if (!links.direct) return;
    openLinkSafe(links.direct);
  }

  function openRuRouting() {
    if (runtime === "telegram-miniapp" && openDeepLinkViaTelegramBridge(HAPP_RU_ROUTING_LINK)) {
      toast.info(t("connectMarzban.routing.open_title"), { description: t("connectMarzban.routing.open_desc") });
      return;
    }
    tryOpenScheme(HAPP_RU_ROUTING_LINK, runtime, () => {
      toast.info(t("connect.open_client"), { description: t("connect.more_methods") });
    });
    toast.info(t("connectMarzban.routing.open_title"), { description: t("connectMarzban.routing.open_desc") });
  }

  if (bridgeDeepLink) {
    return (
      <div className="cm">
        <div className="card">
          <div className="card__body">
            <div className="pre" style={{ borderColor: "rgba(77,215,255,0.22)", background: "rgba(77,215,255,0.05)" }}>
              <b>Открываем Happ.</b> Если приложение не открылось автоматически, нажмите кнопку ниже.
            </div>
            <div className="actions actions--1" style={{ marginTop: 12 }}>
              <a className="btn btn--primary" href={bridgeDeepLink}>
                Открыть Happ
              </a>
              <button className="btn" type="button" onClick={() => void copyToClipboard(bridgeDeepLink).then((ok) => {
                ok
                  ? toast.success(t("connect.copied"), { description: t("connect.import_text") })
                  : toast.error(t("connect.copy_link"), { description: t("connect.sub_prepare_error_desc") });
              })}>
                {t("connect.copy_link")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cm">
      <div className="pre" style={{
        borderColor: ready ? "rgba(43,227,143,0.28)" : error ? "rgba(255,77,109,0.28)" : "rgba(77,215,255,0.20)",
        background: ready ? "rgba(43,227,143,0.06)" : error ? "rgba(255,77,109,0.06)" : "rgba(77,215,255,0.05)",
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

      <div className="row cawg__rowTop">
        <span className="p cawg__label">{t("connectAmneziaWG.device.label")}</span>
        <button className="btn cawg__deviceBtn" type="button" onClick={() => setPlatformPickerOpen(true)} disabled={loading}>
          {PLATFORM_ICONS[platform]}{" "}
          {chip === "auto"
            ? t("connectAmneziaWG.device.current").replace("{platform}", platformLabel(autoPlatform))
            : platformLabel(platform)}
          {" "}▾
        </button>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <div className="pre" style={{ borderColor: "rgba(124,92,255,0.22)", background: "rgba(124,92,255,0.05)" }}>
            <b>{t("connect.step1.label")}</b> {t("connect.step_install_desc").replace("{client}", HAPP_LINKS[platform].title).replace("{platform}", platformLabel(platform))}
          </div>
          {HAPP_LINKS[platform].direct ? (
            <div className="actions actions--2">
              <button className="btn btn--primary" type="button" onClick={() => openClientStore("happ")}>
                📲 {t("connect.open_store")} {t(HAPP_LINKS[platform].storeLabelKey)}
              </button>
              <button className="btn" type="button" onClick={() => openClientDirect("happ")}>
                ⬇️ {platform === "android" ? t("connectAmneziaWG.step1.download_apk") : t("connect.download_direct")}
              </button>
            </div>
          ) : (
            <div className="actions actions--1">
              <button className="btn btn--primary" type="button" onClick={() => openClientStore("happ")}>
                📲 {t("connect.open_store")} {t(HAPP_LINKS[platform].storeLabelKey)}
              </button>
            </div>
          )}

          <div className="pre" style={{ marginTop: 12, borderColor: "rgba(77,215,255,0.22)", background: "rgba(77,215,255,0.05)" }}>
            <b>{t("connect.step2.label")}</b> {t("connect.step_import_desc")}
          </div>
          <div className="actions actions--1">
            <button className="btn btn--primary" onClick={() => void openImport(false, "happ")} disabled={!ready} type="button">
              {loading ? `⏳ ${t("connect.wait")}` : `⚡ ${t("connectMarzban.happ.add_cta")}`}
            </button>
          </div>
        </div>
      </div>

      {subscriptionUrlMirror && ready && (
        <div className="cm__priorityCard cm__priorityCard--mirror">
          <div className="cm__priorityHead">
            <span className="cm__priorityIcon">↔</span>
            <div>
              <div className="cm__priorityTitle">{t("connectMarzban.mirror.title")}</div>
              <div className="cm__prioritySub">{t("connectMarzban.mirror.sub")}</div>
            </div>
          </div>
          <div className="actions actions--1 cm__priorityActions">
            <button className="btn btn--primary" onClick={() => void openImport(true, "happ")} type="button">
              🔄 {t("connectMarzban.mirror.cta")}
            </button>
          </div>
        </div>
      )}

      <div className="actions actions--1" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => setAdvancedOpen((v) => !v)} type="button">
          {advancedOpen ? `▴ ${t("connect.hide_methods")}` : `▾ ${t("connect.more_methods")}`}
        </button>
      </div>

      {advancedOpen && ready && (
        <div className="card cm__extraCard">
          <div className="card__body">
            <div className="cm__extraTitle">{t("connect.extra.title")}</div>
            <div className="cm__extraSub">{t("connectMarzban.extra.sub")}</div>

            <div className="actions actions--2" style={{ marginTop: 12 }}>
              <button className="btn btn--primary" type="button" onClick={() => void copySub(false)}>
                {copied ? `✅ ${t("connect.copied")}` : `📋 ${t("connect.copy_link")}`}
              </button>
              <button className="btn btn--primary" type="button" onClick={() => void openQr()}>
                📱 {t("connect.show_qr")}
              </button>
            </div>

            {subscriptionUrlMirror && (
              <div className="actions actions--1" style={{ marginTop: 8 }}>
                <button className="btn" type="button" onClick={() => void copySub(true)}>
                  {copiedMirror ? `✅ ${t("connect.copied")}` : `📋 ${t("connect.copy_link")} (${t("connectMarzban.mirror.short")})`}
                </button>
              </div>
            )}

            <div className="pre" style={{ marginTop: 12, borderColor: "rgba(77,215,255,0.22)", background: "rgba(77,215,255,0.05)" }}>
              <b>{t("connectMarzban.routing.title")}</b> — {t("connectMarzban.routing.desc")}
            </div>
            <div className="actions actions--1">
              <button className="btn" type="button" onClick={() => openRuRouting()}>
                {t("connectMarzban.routing.cta")}
              </button>
            </div>

            <div className="pre" style={{ marginTop: 12, borderColor: "rgba(43,227,143,0.22)", background: "rgba(43,227,143,0.05)" }}>
              <b>v2RayTun</b> — {t("connectMarzban.v2ray.alt_client")}
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
            <div className="actions actions--1">
              <button className="btn" type="button" onClick={() => void openImport(false, "v2ray")} disabled={!ready}>
                ⚡ {t("connect.add_sub")} {t("connectMarzban.v2ray.to_v2ray")}
              </button>
            </div>
            {subscriptionUrlMirror && (
              <div className="actions actions--1" style={{ marginTop: 8 }}>
                <button className="btn" type="button" onClick={() => void openImport(true, "v2ray")} disabled={!ready}>
                  🔄 {t("connectMarzban.v2ray.mirror_cta")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

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
                <div className="helperMedia helperMedia--qr">
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
