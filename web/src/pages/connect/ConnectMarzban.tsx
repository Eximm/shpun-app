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
  service: { title: string; status: string; statusRaw: string; category?: string };
  onDone?: () => void;
};

type Platform = "android" | "ios" | "windows" | "mac" | "linux";
type Chip = "auto" | Platform;
type RuntimeMode = "telegram-miniapp" | "browser" | "standalone-app";
type ClientKind = "happ" | "v2ray" | "hiddify";
type DeepLinkFallback = {
  title: string;
  desc: string;
  href: string;
  copyText: string;
};

type SubscriptionDevice = {
  id: string;
  platform: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  createdAt: string;
  updatedAt: string;
};

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

const HIDDIFY_LINKS: ClientLinks = {
  android: { title: "Hiddify", market: "https://play.google.com/store/apps/details?id=app.hiddify.com", direct: "https://github.com/hiddify/hiddify-next/releases/latest", storeLabelKey: "connectAmneziaWG.store.google_play" },
  ios: { title: "Hiddify", market: "https://apps.apple.com/app/hiddify-proxy-vpn/id6596777532", storeLabelKey: "connectAmneziaWG.store.app_store" },
  windows: { title: "Hiddify", market: "https://github.com/hiddify/hiddify-next/releases/latest", direct: "https://github.com/hiddify/hiddify-next/releases/latest", storeLabelKey: "connectAmneziaWG.store.download_page" },
  mac: { title: "Hiddify", market: "https://apps.apple.com/app/hiddify-proxy-vpn/id6596777532", direct: "https://github.com/hiddify/hiddify-next/releases/latest", storeLabelKey: "connectAmneziaWG.store.app_store" },
  linux: { title: "Hiddify", market: "https://github.com/hiddify/hiddify-next/releases/latest", direct: "https://github.com/hiddify/hiddify-next/releases/latest", storeLabelKey: "connectAmneziaWG.store.download_page" },
};

const CLIENTS: Record<ClientKind, {
  title: string;
  icon: string;
  noteKey: string;
  importTextKey: string;
  links: ClientLinks;
}> = {
  happ: {
    title: "Happ",
    icon: "\u2B50",
    noteKey: "connectMarzban.client.happ_note",
    importTextKey: "connectMarzban.happ.import_text",
    links: HAPP_LINKS,
  },
  v2ray: {
    title: "v2RayTun",
    icon: "\u{1F501}",
    noteKey: "connectMarzban.client.v2ray_note",
    importTextKey: "connectMarzban.v2ray.import_text",
    links: V2RAYTUN_LINKS,
  },
  hiddify: {
    title: "Hiddify",
    icon: "\u{1F9E9}",
    noteKey: "connectMarzban.client.hiddify_note",
    importTextKey: "connectMarzban.hiddify.import_text",
    links: HIDDIFY_LINKS,
  },
};

const PLATFORM_ICONS: Record<Platform, string> = {
  android: "\u{1F916}",
  ios: "\u{1F4F1}",
  windows: "\u{1F5A5}\uFE0F",
  mac: "\u{1F4BB}",
  linux: "\u{1F427}",
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
    if (detectOS() === "ios") {
      window.location.href = url;
      return true;
    }
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch { /* ignore */ } }, 300);
    return true;
  } catch {
    onFail?.();
    return false;
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

function buildV2RayTunImportLink(url: string, platform: Platform, runtime: RuntimeMode) {
  const safeUrl = url.replace(/#/g, "%23");
  return platform === "android" && runtime !== "telegram-miniapp"
    ? `intent://import/${safeUrl}#Intent;scheme=v2raytun;package=com.v2raytun.android;end`
    : `v2raytun://import/${url}`;
}

function buildHiddifyImportLink(url: string, platform: Platform, runtime: RuntimeMode) {
  const encodedUrl = encodeURIComponent(url);
  const native = `hiddify://install-config?url=${encodedUrl}`;
  return platform === "android" && runtime !== "telegram-miniapp"
    ? `intent://install-config?url=${encodedUrl}#Intent;scheme=hiddify;package=app.hiddify.com;end`
    : native;
}

function buildClientImportLink(client: ClientKind, url: string, platform: Platform, runtime: RuntimeMode) {
  if (client === "happ") return buildHappImportLink(url, platform, runtime);
  if (client === "v2ray") return buildV2RayTunImportLink(url, platform, runtime);
  return buildHiddifyImportLink(url, platform, runtime);
}

function serviceVariant(category?: string): "flex" | "flex_plus" | "marzban" {
  const c = String(category || "").trim().toLowerCase();
  if (c === "remnawave-wl") return "flex_plus";
  if (c === "remnawave") return "flex";
  return "marzban";
}

function deviceTitle(device: SubscriptionDevice) {
  return device.deviceModel?.trim() || device.platform?.trim() || "Device";
}

function deviceDetails(device: SubscriptionDevice) {
  return [device.platform, device.osVersion].map((value) => value?.trim()).filter(Boolean).join(" \u2022 ");
}

function shortHwid(hwid: string) {
  const clean = String(hwid || "").trim();
  if (clean.length <= 14) return clean;
  return `${clean.slice(0, 7)}\u2026${clean.slice(-5)}`;
}

export default function ConnectMarzban({ usi, service }: Props) {
  const { t } = useI18n();

  const bridgeDeepLink = useMemo(() => getHappBridgeDeepLink(), []);
  const variant = serviceVariant(service?.category);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const autoPlatform = useMemo(() => detectOS(), []);
  const runtime = useMemo(() => detectRuntime(), []);

  const [chip, setChip] = useState<Chip>("auto");
  const platform: Platform = chip === "auto" ? autoPlatform : chip;

  const [platformPickerOpen, setPlatformPickerOpen] = useState(false);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [client, setClient] = useState<ClientKind>("happ");

  const [subscriptionUrl, setSubscriptionUrl] = useState("");
  const [subscriptionUrlMirror, setSubscriptionUrlMirror] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedMirror, setCopiedMirror] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [deepLinkFallback, setDeepLinkFallback] = useState<DeepLinkFallback | null>(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState("");
  const [devices, setDevices] = useState<SubscriptionDevice[]>([]);
  const [deviceLimit, setDeviceLimit] = useState<number | null>(null);
  const [deletingDevice, setDeletingDevice] = useState<SubscriptionDevice | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const selectedClient = CLIENTS[client];
  const selectedLinks = selectedClient.links[platform];

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
      const readyDesc =
        variant === "flex_plus" ? t("connectFlexPlus.ready_desc")
        : variant === "flex" ? t("connectFlex.ready_desc")
        : getMood("subscription_ready") ?? t("connect.sub_ready_desc");
      toast.success(t("connect.ready"), { description: readyDesc });
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

  function openWithVisibleFallback(fallback: DeepLinkFallback) {
    setDeepLinkFallback(fallback);
    window.setTimeout(() => {
      try { window.location.href = fallback.href; } catch { /* ignore */ }
    }, 0);
  }

  async function openImport(useMirror = false, client: ClientKind = "happ") {
    const target = useMirror ? (subscriptionUrlMirror ?? "") : subscriptionUrl;
    if (!ready || !target) return;

    if (client === "happ") {
      const href = buildHappImportLink(target, platform, runtime);
      if (platform === "ios") {
        openWithVisibleFallback({
          title: t("connectMarzban.fallback.happ_title"),
          desc: t("connectMarzban.fallback.happ_desc"),
          href,
          copyText: target,
        });
        return;
      }
      if (runtime === "telegram-miniapp" && openViaTelegramBridge(target)) {
        toast.info(t("connect.open_client"), { description: t("connectMarzban.happ.import_text") });
        return;
      }
      const opened = tryOpenScheme(href, runtime, () => {
        toast.info(t("connect.open_client"), { description: t("connect.more_methods") });
      });
      if (opened) toast.info(t("connect.open_client"), { description: t("connectMarzban.happ.import_text") });
      return;
    }

    const href = buildClientImportLink(client, target, platform, runtime);
    const opened = tryOpenScheme(href, runtime, () => {
      toast.info(t("connect.open_client"), { description: t("connect.more_methods") });
    });
    if (opened && platform !== "ios") toast.info(t("connect.open_client"), { description: t(CLIENTS[client].importTextKey) });
  }

  async function openQr() {
    const target = subscriptionUrl;
    if (!target) return;
    const title = t("connect.qr_title");
    const text = t("connectMarzban.manual.qr_text");
    try {
      const dataUrl = await QRCode.toDataURL(target, {
        errorCorrectionLevel: "L",
        margin: 4,
        width: 420,
        color: { dark: "#000000", light: "#ffffff" },
      });
      setQrDataUrl(dataUrl);
      setQrOpen(true);
      toast.info(title, { description: text });
    } catch {
      toast.error(title, { description: t("connect.sub_prepare_error_desc") });
    }
  }

  async function copySub(useMirror = false) {
    const target = useMirror ? (subscriptionUrlMirror ?? "") : subscriptionUrl;
    if (!target) return;
    const ok = await copyToClipboard(target);
    if (useMirror) { setCopiedMirror(ok); if (ok) setTimeout(() => setCopiedMirror(false), 1500); }
    else { setCopied(ok); if (ok) setTimeout(() => setCopied(false), 1500); }
    ok
      ? toast.success(t("connect.copied"), { description: t("connectMarzban.manual.copy_ok_desc") })
      : toast.error(t("connect.copy_link"), { description: t("connect.sub_prepare_error_desc") });
  }

  function openClientStore(client: ClientKind) {
    openLinkSafe(CLIENTS[client].links[platform].market);
  }

  function openClientDirect(client: ClientKind) {
    const links = CLIENTS[client].links[platform];
    if (!links.direct) return;
    openLinkSafe(links.direct);
  }

  async function loadDevices() {
    setDevicesLoading(true);
    setDevicesError("");
    try {
      const response = await apiFetch<{
        devices?: SubscriptionDevice[];
        limit?: number | null;
      }>(`/services/${encodeURIComponent(String(usi))}/devices`);
      setDevices(Array.isArray(response?.devices) ? response.devices : []);
      setDeviceLimit(typeof response?.limit === "number" ? response.limit : null);
    } catch (error: any) {
      setDevicesError(String(error?.message || t("connectMarzban.devices.load_error")));
    } finally {
      setDevicesLoading(false);
    }
  }

  function openDevices() {
    setDevicesOpen(true);
    setDeletingDevice(null);
    void loadDevices();
  }

  async function deleteDevice() {
    if (!deletingDevice || deletePending) return;
    setDeletePending(true);
    try {
      await apiFetch(`/services/${encodeURIComponent(String(usi))}/devices`, {
        method: "DELETE",
        body: { hwid: deletingDevice.id },
      });
      const removedId = deletingDevice.id;
      setDevices((current) => current.filter((device) => device.id !== removedId));
      setDeletingDevice(null);
      toast.success(t("connectMarzban.devices.deleted"), {
        description: t("connectMarzban.devices.deleted_desc"),
      });
    } catch (error: any) {
      toast.error(t("connectMarzban.devices.delete_error"), {
        description: String(error?.message || t("connectMarzban.devices.try_again")),
      });
    } finally {
      setDeletePending(false);
    }
  }

  if (bridgeDeepLink) {
    return (
      <div className="cm">
        <div className="card">
          <div className="card__body">
            <div className="pre" style={{ borderColor: "rgba(77,215,255,0.22)", background: "rgba(77,215,255,0.05)" }}>
              <b>{"\u041e\u0442\u043a\u0440\u044b\u0432\u0430\u0435\u043c Happ."}</b> {"\u0415\u0441\u043b\u0438 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u043d\u0435 \u043e\u0442\u043a\u0440\u044b\u043b\u043e\u0441\u044c \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438, \u043d\u0430\u0436\u043c\u0438\u0442\u0435 \u043a\u043d\u043e\u043f\u043a\u0443 \u043d\u0438\u0436\u0435."}
            </div>
            <div className="actions actions--1" style={{ marginTop: 12 }}>
              <a className="btn btn--primary" href={bridgeDeepLink}>
                {"\u041e\u0442\u043a\u0440\u044b\u0442\u044c Happ"}
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
        <span>{loading ? "\u23F3" : error ? "\u26A0\uFE0F" : "\u2705"}</span>
        <span>{loading ? t("connect.loading") : error ? t("connect.error") : t("connect.ready")}</span>
      </div>

      {!loading && error && (
        <div className="actions actions--1" style={{ marginTop: 8 }}>
          <button className="btn btn--primary" onClick={() => void load()} type="button">
            {"\u{1F504}"} {t("connectAmneziaWG.retry")}
          </button>
        </div>
      )}

      {deepLinkFallback && (
        <div className="card cm__openFallback">
          <div className="card__body">
            <div className="cm__extraSectionTitle">{deepLinkFallback.title}</div>
            <div className="cm__extraSectionSub">{deepLinkFallback.desc}</div>
            <div className="actions actions--2 cm__extraSectionActions">
              <a
                className="btn btn--primary"
                href={deepLinkFallback.href}
                onClick={(e) => {
                  e.preventDefault();
                  try { window.location.href = deepLinkFallback.href; } catch { /* ignore */ }
                }}
              >
                {t("connectMarzban.fallback.open_happ")}
              </a>
              <button className="btn" type="button" onClick={() => void copyToClipboard(deepLinkFallback.copyText).then((ok) => {
                ok
                  ? toast.success(t("connect.copied"), { description: t("connect.import_text") })
                  : toast.error(t("connect.copy_link"), { description: t("connect.sub_prepare_error_desc") });
              })}>
                {t("connect.copy_link")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="cm__selectorGrid">
        <div className="cm__selectorItem">
          <span className="p cawg__label">{t("connectAmneziaWG.device.label")}</span>
          <button className="btn cawg__deviceBtn cm__selectorBtn" type="button" onClick={() => setPlatformPickerOpen(true)} disabled={loading}>
            {PLATFORM_ICONS[platform]}{" "}
            {chip === "auto"
              ? t("connectAmneziaWG.device.current").replace("{platform}", platformLabel(autoPlatform))
              : platformLabel(platform)}
            {" "}<span aria-hidden="true">{"\u25BE"}</span>
          </button>
        </div>

        <div className="cm__selectorItem">
          <span className="p cawg__label">{t("connectMarzban.client.label")}</span>
          <button className="btn cawg__deviceBtn cm__selectorBtn" type="button" onClick={() => setClientPickerOpen(true)} disabled={loading}>
            {selectedClient.icon} {selectedClient.title}
            {client === "happ" && <span className="chip chip--ok">{t("connectMarzban.client.recommended")}</span>}
            {" "}<span aria-hidden="true">{"\u25BE"}</span>
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <div className="pre" style={{ borderColor: "rgba(124,92,255,0.22)", background: "rgba(124,92,255,0.05)" }}>
            <b>{t("connect.step1.label")}</b> {t("connect.step_install_desc").replace("{client}", selectedLinks.title).replace("{platform}", platformLabel(platform))}
          </div>
          {selectedLinks.direct ? (
            <div className="actions actions--2">
              <button className="btn btn--primary" type="button" onClick={() => openClientStore(client)}>
                {"\u{1F4F2}"} {t("connect.open_store")} {t(selectedLinks.storeLabelKey)}
              </button>
              <button className="btn" type="button" onClick={() => openClientDirect(client)}>
                {"\u2B07\uFE0F"} {platform === "android" ? t("connectAmneziaWG.step1.download_apk") : t("connect.download_direct")}
              </button>
            </div>
          ) : (
            <div className="actions actions--1">
              <button className="btn btn--primary" type="button" onClick={() => openClientStore(client)}>
                {"\u{1F4F2}"} {t("connect.open_store")} {t(selectedLinks.storeLabelKey)}
              </button>
            </div>
          )}

          <div className="cm__clientNote">
            <span>{selectedClient.icon}</span>
            <span>{t(selectedClient.noteKey)}</span>
          </div>

          <div className="pre" style={{ marginTop: 12, borderColor: "rgba(77,215,255,0.22)", background: "rgba(77,215,255,0.05)" }}>
            <b>{t("connect.step2.label")}</b> {t("connect.step_import_desc")}
          </div>
          <div className="actions actions--1">
            <button className="btn btn--primary" onClick={() => void openImport(false, client)} disabled={!ready} type="button">
              {loading ? `\u23F3 ${t("connect.wait")}` : `\u26A1 ${t("connect.add_sub")} ${selectedLinks.title}`}
            </button>
          </div>
        </div>
      </div>

      {subscriptionUrlMirror && ready && (
        <div className="cm__priorityCard cm__priorityCard--mirror">
          <div className="cm__priorityHead">
            <span className="cm__priorityIcon">{"\u2194"}</span>
            <div>
              <div className="cm__priorityTitle">{t("connectMarzban.mirror.title")}</div>
              <div className="cm__prioritySub">{t("connectMarzban.mirror.sub")}</div>
            </div>
          </div>
          <div className="actions actions--1 cm__priorityActions">
            <button className="btn btn--primary" onClick={() => void openImport(true, client)} type="button">
              {"\u{1F504}"} {t("connectMarzban.mirror.cta")} {selectedLinks.title}
            </button>
          </div>
        </div>
      )}

      {ready && (
        <div className="card cm__devicesCard">
          <div className="card__body cm__devicesCardBody">
            <div className="cm__devicesIntro">
              <span className="cm__devicesIntroIcon" aria-hidden="true">{"\u{1F4F1}"}</span>
              <div>
                <div className="cm__extraTitle">{t("connectMarzban.devices.title")}</div>
                <div className="cm__extraSub">{t("connectMarzban.devices.desc")}</div>
              </div>
            </div>
            <button className="btn" type="button" onClick={openDevices}>
              {t("connectMarzban.devices.manage")}
            </button>
          </div>
        </div>
      )}

      {platformPickerOpen && createPortal(
        <div className="modal" role="dialog" aria-modal="true" onMouseDown={() => setPlatformPickerOpen(false)}>
          <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="modal__head">
                <div className="modal__title">{t("connectAmneziaWG.device.modal_title")}</div>
                <button className="btn modal__close" type="button" onClick={() => setPlatformPickerOpen(false)} aria-label={t("common.close")}>{"\u00D7"}</button>
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

      {clientPickerOpen && createPortal(
        <div className="modal" role="dialog" aria-modal="true" onMouseDown={() => setClientPickerOpen(false)}>
          <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="modal__head">
                <div className="modal__title">{t("connectMarzban.client.modal_title")}</div>
                <button className="btn modal__close" type="button" onClick={() => setClientPickerOpen(false)} aria-label={t("common.close")}>{"\u00D7"}</button>
              </div>
              <div className="modal__content">
                <div className="kv">
                  {(["happ", "v2ray", "hiddify"] as ClientKind[]).map((kind) => {
                    const item = CLIENTS[kind];
                    return (
                      <button key={kind} className={`kv__item cawg__pickItem cm__clientPickItem${client === kind ? " is-active" : ""}`} type="button"
                        onClick={() => { setClient(kind); setClientPickerOpen(false); }}>
                        <div className="cm__clientPick">
                          <div>
                            <div className="kv__k">{item.icon} {item.title}</div>
                            <div className="kv__v">{t(item.noteKey)}</div>
                          </div>
                          {kind === "happ" && <span className="chip chip--ok">{t("connectMarzban.client.recommended")}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {ready && (
                  <div className="cm__modalManual">
                    <div className="cm__extraTitle">{t("connect.more_methods")}</div>
                    <div className="cm__extraSub">{t("connectMarzban.manual.desc")}</div>
                    <div className="actions actions--2 cm__extraSectionActions">
                      <button className="btn" type="button" onClick={() => void copySub(false)}>
                        {copied ? `\u2705 ${t("connect.copied")}` : `\u{1F4CB} ${t("connect.copy_link")}`}
                      </button>
                      <button className="btn" type="button" onClick={() => void openQr()}>
                        {"\u{1F4F1}"} {t("connect.show_qr")}
                      </button>
                    </div>
                    {subscriptionUrlMirror && (
                      <div className="actions actions--1 cm__extraSectionActions">
                        <button className="btn" type="button" onClick={() => void copySub(true)}>
                          {copiedMirror ? `\u2705 ${t("connect.copied")}` : `\u{1F4CB} ${t("connect.copy_link")} (${t("connectMarzban.mirror.short")})`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {devicesOpen && createPortal(
        <div className="modal" role="dialog" aria-modal="true" onMouseDown={() => !deletePending && setDevicesOpen(false)}>
          <div className="card modal__card cm__devicesModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="modal__head">
                <div>
                  <div className="modal__title">{t("connectMarzban.devices.modal_title")}</div>
                  <div className="cm__extraSub">
                    {deviceLimit
                      ? t("connectMarzban.devices.counter").replace("{count}", String(devices.length)).replace("{limit}", String(deviceLimit))
                      : t("connectMarzban.devices.counter_no_limit").replace("{count}", String(devices.length))}
                  </div>
                </div>
                <button className="btn modal__close" type="button" onClick={() => setDevicesOpen(false)}
                  disabled={deletePending} aria-label={t("common.close")}>{"\u00D7"}</button>
              </div>

              <div className="modal__content">
                {devicesLoading && <div className="pre">{"\u23F3"} {t("connect.loading")}</div>}

                {!devicesLoading && devicesError && (
                  <div className="cm__devicesError">
                    <div>{devicesError}</div>
                    <button className="btn" type="button" onClick={() => void loadDevices()}>
                      {"\u21BB"} {t("connectAmneziaWG.retry")}
                    </button>
                  </div>
                )}

                {!devicesLoading && !devicesError && devices.length === 0 && (
                  <div className="pre">{t("connectMarzban.devices.empty")}</div>
                )}

                {!devicesLoading && !devicesError && devices.length > 0 && (
                  <div className="cm__deviceList">
                    {devices.map((device) => (
                      <div className="cm__deviceItem" key={device.id}>
                        <div className="cm__deviceIcon" aria-hidden="true">{"\u{1F4F1}"}</div>
                        <div className="cm__deviceInfo">
                          <div className="cm__deviceTitle">{deviceTitle(device)}</div>
                          {deviceDetails(device) && <div className="cm__deviceMeta">{deviceDetails(device)}</div>}
                          <div className="cm__deviceMeta">
                            {t("connectMarzban.devices.last_seen")}{" "}
                            {new Date(device.updatedAt).toLocaleString()}
                            {" \u2022 "}{shortHwid(device.id)}
                          </div>
                        </div>
                        <button className="btn cm__deviceDelete" type="button"
                          onClick={() => setDeletingDevice(device)}
                          aria-label={t("connectMarzban.devices.remove")}>
                          {"\u{1F5D1}"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {deletingDevice && (
                  <div className="cm__deviceConfirm">
                    <div className="cm__deviceConfirmTitle">{t("connectMarzban.devices.confirm_title")}</div>
                    <div className="cm__extraSub">
                      {t("connectMarzban.devices.confirm_desc").replace("{device}", deviceTitle(deletingDevice))}
                    </div>
                    <div className="actions actions--2 cm__extraSectionActions">
                      <button className="btn" type="button" onClick={() => setDeletingDevice(null)} disabled={deletePending}>
                        {t("common.cancel")}
                      </button>
                      <button className="btn btn--danger" type="button" onClick={() => void deleteDevice()} disabled={deletePending}>
                        {deletePending ? t("connect.wait") : t("connectMarzban.devices.remove")}
                      </button>
                    </div>
                  </div>
                )}
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
                <div className="modal__title">{"\u{1F4F1}"} {t("connect.qr_title")}</div>
                <button className="btn modal__close" type="button" onClick={() => setQrOpen(false)} aria-label={t("common.close")}>{"\u00D7"}</button>
              </div>
              <div className="modal__content">
                <p className="p">{t("connectMarzban.manual.qr_text")}</p>
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
