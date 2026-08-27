import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../shared/api/client";
import { useI18n } from "../shared/i18n";
import { toastApiError } from "../shared/ui/toast/toastApiError";

type ServiceStatus = "active" | "blocked" | "pending" | "not_paid" | "removed" | "error" | "init";

type ServiceItem = {
  userServiceId: number;
  serviceId: number;
  title: string;
  category: string;
  status: ServiceStatus;
  statusRaw: string;
  price: number;
  currency: string;
};

type ServicesResponse = {
  ok: true;
  items: ServiceItem[];
  summary: { active: number; pending: number; notPaid: number; blocked: number };
};

type DeviceKind = "phone" | "computer" | "router";
type Screen = "offer" | "device";

const SNOOZE_KEY = "connection-assistant.snoozed-until.v1";
const SCREEN_KEY = "connection-assistant.screen.v1";

function statusWeight(status: ServiceStatus): number {
  const weights: Record<ServiceStatus, number> = {
    active: 0,
    pending: 1,
    init: 2,
    not_paid: 3,
    blocked: 4,
    error: 5,
    removed: 6,
  };
  return weights[status] ?? 99;
}

function detectDevice(): DeviceKind {
  const ua = String(navigator.userAgent || "").toLowerCase();
  return /android|iphone|ipad|ipod|mobile/.test(ua) ? "phone" : "computer";
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "RUB",
      maximumFractionDigits: 0,
    }).format(Number(amount || 0));
  } catch {
    return `${amount} ${currency || "RUB"}`;
  }
}

function isWaiting(status: ServiceStatus) {
  return status === "pending" || status === "init";
}

function isPayable(status: ServiceStatus) {
  return status === "not_paid" || status === "blocked";
}

export function ConnectionAssistant() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [screen, setScreen] = useState<Screen>(() => {
    try { return sessionStorage.getItem(SCREEN_KEY) === "device" ? "device" : "offer"; }
    catch { return "offer"; }
  });
  const targetUsi = useMemo(() => Number(new URLSearchParams(window.location.search).get("usi") || "0"), []);
  const detectedDevice = useMemo(detectDevice, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<ServicesResponse>("/services", { method: "GET" });
      setItems(Array.isArray(response.items) ? response.items : []);
    } catch (nextError) {
      setError(nextError);
      if (!silent) toastApiError(nextError, { title: t("assistant.error.title") });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(false); }, [load]);

  const current = useMemo(() => {
    const targeted = Number.isFinite(targetUsi) && targetUsi > 0
      ? items.find((item) => item.userServiceId === targetUsi && item.status !== "removed")
      : null;
    if (targeted) return targeted;
    return items
      .filter((item) => item.status !== "removed")
      .sort((a, b) => statusWeight(a.status) - statusWeight(b.status))[0] ?? null;
  }, [items, targetUsi]);

  useEffect(() => {
    if (!current || !isWaiting(current.status)) return;
    let stopped = false;
    const refresh = () => { if (!stopped) void load(true); };
    const timer = window.setInterval(refresh, 3500);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [current, load]);

  useEffect(() => {
    if (!current || current.status !== "active") return;
    navigate(`/services?usi=${encodeURIComponent(String(current.userServiceId))}&connect=1&assistant=1`, { replace: true });
  }, [current, navigate]);

  function chooseDevice(device: DeviceKind) {
    const kind = device === "router" ? "marzban_router" : "flex";
    navigate(`/services/order?kind=${encodeURIComponent(kind)}&assistant=1&device=${encodeURIComponent(device)}`);
  }

  function continueAssistant() {
    try { sessionStorage.setItem(SCREEN_KEY, "device"); } catch { /* ignore */ }
    setScreen("device");
  }

  function snooze() {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + 24 * 60 * 60 * 1000));
      sessionStorage.removeItem(SCREEN_KEY);
      sessionStorage.setItem("landing_destination", "services");
    } catch { /* ignore */ }
    navigate("/services", { replace: true });
  }

  if (loading) {
    return (
      <div className="assistant assistant--center" aria-busy="true">
        <div className="assistant__orb assistant__orb--pulse" aria-hidden="true">✨</div>
        <div className="assistant__title">{t("assistant.loading.title")}</div>
        <p className="assistant__text">{t("assistant.loading.text")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="assistant assistant--center">
        <div className="assistant__orb" aria-hidden="true">🛟</div>
        <div className="assistant__title">{t("assistant.error.title")}</div>
        <p className="assistant__text">{t("assistant.error.text")}</p>
        <button className="btn btn--primary assistant__primary" type="button" onClick={() => void load(false)}>
          {t("assistant.retry")}
        </button>
        <button className="btn assistant__secondary" type="button" onClick={() => navigate("/support?topic=connection-assistant")}>
          {t("assistant.support")}
        </button>
      </div>
    );
  }

  if (current && isPayable(current.status)) {
    const params = new URLSearchParams({
      reason: "service",
      usi: String(current.userServiceId),
      return: "/assistant",
    });
    if (Number(current.price) > 0) params.set("amount", String(Math.ceil(Number(current.price))));
    return (
      <div className="assistant assistant--center">
        <div className="assistant__step">{t("assistant.resume.eyebrow")}</div>
        <div className="assistant__orb" aria-hidden="true">💳</div>
        <div className="assistant__title">{t("assistant.resume.title")}</div>
        <p className="assistant__text">{t("assistant.resume.text")}</p>
        <div className="assistant__summary">
          <span>{current.title}</span>
          {current.price > 0 && <strong>{money(current.price, current.currency)}</strong>}
        </div>
        <button className="btn btn--primary assistant__primary" type="button" onClick={() => navigate(`/payments?${params.toString()}`)}>
          {t("assistant.resume.pay")}
        </button>
        <button className="btn assistant__secondary" type="button" onClick={() => navigate(`/services?usi=${encodeURIComponent(String(current.userServiceId))}`)}>
          {t("assistant.resume.open")}
        </button>
      </div>
    );
  }

  if (current && isWaiting(current.status)) {
    return (
      <div className="assistant assistant--center" aria-live="polite">
        <div className="assistant__step">{t("assistant.wait.eyebrow")}</div>
        <div className="assistant__orb assistant__orb--pulse" aria-hidden="true">⚙️</div>
        <div className="assistant__title">{t("assistant.wait.title")}</div>
        <p className="assistant__text">{t("assistant.wait.text")}</p>
        <div className="assistant__summary"><span>{current.title}</span><strong>{t("assistant.wait.status")}</strong></div>
        <button className="btn btn--primary assistant__primary" type="button" onClick={() => void load(true)}>
          {t("assistant.retry")}
        </button>
        <button className="btn assistant__secondary" type="button" onClick={() => navigate("/support?topic=connection-assistant")}>
          {t("assistant.support")}
        </button>
      </div>
    );
  }

  if (screen === "offer") {
    return (
      <div className="assistant assistant--center">
        <div className="assistant__step">{t("assistant.offer.eyebrow")}</div>
        <div className="assistant__orb" aria-hidden="true">👋</div>
        <div className="assistant__title">{t("assistant.offer.title")}</div>
        <p className="assistant__text">{t("assistant.offer.text")}</p>
        <div className="assistant__promise" aria-label={t("assistant.offer.promise_label")}>
          <span>1</span><b>{t("assistant.offer.promise_order")}</b>
          <i aria-hidden="true">→</i>
          <span>2</span><b>{t("assistant.offer.promise_pay")}</b>
          <i aria-hidden="true">→</i>
          <span>3</span><b>{t("assistant.offer.promise_connect")}</b>
        </div>
        <button className="btn btn--primary assistant__primary" type="button" onClick={continueAssistant}>
          {t("assistant.offer.accept")}
        </button>
        <button className="btn assistant__secondary" type="button" onClick={snooze}>
          {t("assistant.offer.later")}
        </button>
      </div>
    );
  }

  const devices: Array<{ key: DeviceKind; icon: string; title: string; text: string }> = [
    { key: "phone", icon: "📱", title: t("assistant.device.phone"), text: t("assistant.device.phone_text") },
    { key: "computer", icon: "💻", title: t("assistant.device.computer"), text: t("assistant.device.computer_text") },
    { key: "router", icon: "📡", title: t("assistant.device.router"), text: t("assistant.device.router_text") },
  ];

  return (
    <div className="assistant">
      <div className="assistant__step">{t("assistant.device.eyebrow")}</div>
      <div className="assistant__title">{t("assistant.device.title")}</div>
      <p className="assistant__text">{t("assistant.device.text")}</p>
      <div className="assistant__devices">
        {devices.map((device) => {
          const recommended = device.key === detectedDevice;
          return (
            <button className={`assistant-device${recommended ? " assistant-device--recommended" : ""}`} type="button" key={device.key} onClick={() => chooseDevice(device.key)}>
              <span className="assistant-device__icon" aria-hidden="true">{device.icon}</span>
              <span className="assistant-device__copy">
                <strong>{device.title}</strong>
                <small>{device.text}</small>
              </span>
              {recommended && <span className="assistant-device__badge">{t("assistant.device.this_device")}</span>}
              <span className="assistant-device__arrow" aria-hidden="true">→</span>
            </button>
          );
        })}
      </div>
      <button className="btn assistant__secondary" type="button" onClick={() => { setScreen("offer"); try { sessionStorage.removeItem(SCREEN_KEY); } catch { /* ignore */ } }}>
        {t("assistant.back")}
      </button>
    </div>
  );
}
