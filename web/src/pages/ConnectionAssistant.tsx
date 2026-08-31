import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { EmailVerifyModal } from "./Profile";
import { apiFetch } from "../shared/api/client";
import { clearPendingEmailVerification } from "../shared/emailVerificationState";
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
const EMAIL_KEY = "connection-assistant.email.v1";

function readAssistantEmail(): string {
  try { return String(sessionStorage.getItem(EMAIL_KEY) || "").trim(); }
  catch { return ""; }
}

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

function needsSubscriptionLink(category: string): boolean {
  const normalized = String(category || "").trim().toLowerCase();
  return normalized === "remnawave" || normalized === "remnawave-wl" || normalized === "marzban";
}

function AssistantLanguageSwitch({
  lang,
  onChange,
}: {
  lang: "ru" | "en";
  onChange: (lang: "ru" | "en") => void;
}) {
  return (
    <div className="assistant-lang" aria-label="Language">
      <button type="button" className={lang === "ru" ? "is-active" : ""} onClick={() => onChange("ru")}>RU</button>
      <button type="button" className={lang === "en" ? "is-active" : ""} onClick={() => onChange("en")}>EN</button>
    </div>
  );
}

function AssistantEmailGate({
  email,
  lang,
  setLang,
  onVerified,
  onEmailSaved,
  onBack,
  onLater,
  t,
}: {
  email: string;
  lang: "ru" | "en";
  setLang: (lang: "ru" | "en") => void;
  onVerified: () => void;
  onEmailSaved: () => Promise<void>;
  onBack: () => void;
  onLater: () => void;
  t: (key: string) => string;
}) {
  const initialEmail = email || readAssistantEmail();
  const [currentEmail, setCurrentEmail] = useState(initialEmail);
  const [draft, setDraft] = useState(initialEmail);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState(!initialEmail);
  const [verifyOpen, setVerifyOpen] = useState(Boolean(initialEmail));

  useEffect(() => {
    const nextEmail = email.trim();
    if (!nextEmail || nextEmail === currentEmail) return;
    setCurrentEmail(nextEmail);
    setDraft(nextEmail);
    setEditingEmail(false);
    setVerifyOpen(true);
    try { sessionStorage.setItem(EMAIL_KEY, nextEmail); } catch { /* ignore */ }
  }, [email, currentEmail]);

  async function saveEmail() {
    const clean = draft.trim().toLowerCase();
    if (!clean) { setError(t("profile.email.error.empty")); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setError(t("profile.email.error.invalid"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (clean !== currentEmail) clearPendingEmailVerification();
      await apiFetch("/user/email", { method: "PUT", body: { email: clean } });
      setCurrentEmail(clean);
      setEditingEmail(false);
      try { sessionStorage.setItem(EMAIL_KEY, clean); } catch { /* ignore */ }
      await onEmailSaved();
      setVerifyOpen(true);
    } catch (nextError: unknown) {
      const shaped = nextError as { code?: string; data?: { error?: string } };
      const errorCode = String(shaped?.code || shaped?.data?.error || "");
      setError(
        errorCode === "email_already_used"
          ? t("profile.email.error.already_used")
          : errorCode === "email_disposable"
            ? t("profile.email.error.disposable")
            : errorCode.startsWith("email_")
              ? t("profile.email.error.invalid")
              : t("profile.email.error.save")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="assistant assistant--center assistant--email">
      <AssistantLanguageSwitch lang={lang} onChange={setLang} />
      <div className="assistant__step">{t("assistant.email.eyebrow")}</div>
      <div className="assistant__orb" aria-hidden="true">✉️</div>
      <div className="assistant__title">{t(currentEmail ? "assistant.email.verify_title" : "assistant.email.add_title")}</div>
      <p className="assistant__text">{t(currentEmail ? "assistant.email.verify_text" : "assistant.email.add_text")}</p>

      {currentEmail && !editingEmail ? (
        <div className="assistant-email">
          <div className="assistant-email__address">{currentEmail}</div>
          <button className="btn btn--primary assistant__primary" type="button" onClick={() => setVerifyOpen(true)}>
            {t("profile.email.verify")}
          </button>
        </div>
      ) : (
        <form className="assistant-email" onSubmit={(event) => { event.preventDefault(); void saveEmail(); }}>
          <label className="field__label" htmlFor="assistant-email">Email</label>
          <input
            id="assistant-email"
            className="input assistant-email__input"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={draft}
            onChange={(event) => { setDraft(event.target.value); setError(null); }}
            placeholder={t("assistant.email.placeholder")}
            disabled={saving}
            autoFocus
          />
          {error && <div className="pre assistant-email__error">{error}</div>}
          <button className="btn btn--primary assistant__primary" type="submit" disabled={saving}>
            {saving ? t("profile.email.saving") : t("profile.email.save")}
          </button>
        </form>
      )}

      <div className="assistant-email__exit">
        <button className="btn" type="button" onClick={onBack}>{t("assistant.back")}</button>
        <button className="btn" type="button" onClick={onLater}>{t("assistant.offer.later")}</button>
      </div>

      <EmailVerifyModal
        open={verifyOpen && Boolean(currentEmail)}
        email={currentEmail}
        onClose={() => setVerifyOpen(false)}
        onVerified={() => {
          try { sessionStorage.removeItem(EMAIL_KEY); } catch { /* ignore */ }
          onVerified();
        }}
        onChangeEmail={() => {
          clearPendingEmailVerification();
          setVerifyOpen(false);
          setEditingEmail(true);
          setDraft(currentEmail);
          setError(null);
        }}
        onLater={onLater}
        t={t}
      />
    </div>
  );
}

export function ConnectionAssistant() {
  const { t, lang, setLang } = useI18n();
  const { me, loading: meLoading, refetch: refetchMe } = useMe();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [emailChecked, setEmailChecked] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [subscriptionReadyUsi, setSubscriptionReadyUsi] = useState<number | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    void refetchMe().finally(() => { if (!cancelled) setEmailChecked(true); });
    return () => { cancelled = true; };
  }, [refetchMe]);

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
    if (!current || current.status !== "active" || !needsSubscriptionLink(current.category)) return;
    if (subscriptionReadyUsi === current.userServiceId) return;

    let stopped = false;
    let timer: number | null = null;

    const probe = async () => {
      try {
        const response = await apiFetch<{ subscription_url?: string; subscriptionUrl?: string }>(
          `/services/${encodeURIComponent(String(current.userServiceId))}/connect/marzban`,
          { method: "GET" },
        );
        const subscriptionUrl = String(response?.subscription_url || response?.subscriptionUrl || "").trim();
        if (!stopped && subscriptionUrl) {
          setSubscriptionReadyUsi(current.userServiceId);
          return;
        }
      } catch { /* service is active, but its subscription is still being prepared */ }

      if (!stopped) timer = window.setTimeout(() => void probe(), 2500);
    };

    void probe();
    return () => {
      stopped = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [current, subscriptionReadyUsi]);

  useEffect(() => {
    if (!current || current.status !== "active") return;
    if (needsSubscriptionLink(current.category) && subscriptionReadyUsi !== current.userServiceId) return;
    navigate(`/services?usi=${encodeURIComponent(String(current.userServiceId))}&connect=1&assistant=1`, { replace: true });
  }, [current, navigate, subscriptionReadyUsi]);

  function chooseDevice(device: DeviceKind) {
    const kind = device === "router" ? "marzban_router" : "flex";
    navigate(`/services/order?kind=${encodeURIComponent(kind)}&assistant=1&device=${encodeURIComponent(device)}`);
  }

  function continueAssistant() {
    try { sessionStorage.setItem(SCREEN_KEY, "device"); } catch { /* ignore */ }
    setScreen("device");
  }

  function exitToHome() {
    try { sessionStorage.setItem("landing_destination", "home"); } catch { /* ignore */ }
    navigate("/home");
  }

  function snooze() {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + 24 * 60 * 60 * 1000));
      sessionStorage.removeItem(SCREEN_KEY);
      sessionStorage.setItem("landing_destination", "home");
    } catch { /* ignore */ }
    navigate("/", { replace: true });
  }

  if (loading || meLoading || !emailChecked) {
    return (
      <div className="assistant assistant--center" aria-busy="true">
        <AssistantLanguageSwitch lang={lang} onChange={setLang} />
        <div className="assistant__orb assistant__orb--pulse" aria-hidden="true">✨</div>
        <div className="assistant__title">{t("assistant.loading.title")}</div>
        <p className="assistant__text">{t("assistant.loading.text")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="assistant assistant--center">
        <AssistantLanguageSwitch lang={lang} onChange={setLang} />
        <div className="assistant__orb" aria-hidden="true">🛟</div>
        <div className="assistant__title">{t("assistant.error.title")}</div>
        <p className="assistant__text">{t("assistant.error.text")}</p>
        <button className="btn btn--primary assistant__primary" type="button" onClick={() => void load(false)}>
          {t("assistant.retry")}
        </button>
        <button className="btn assistant__secondary" type="button" onClick={() => navigate("/support?topic=connection-assistant")}>
          {t("assistant.support")}
        </button>
        <button className="btn assistant__secondary" type="button" onClick={exitToHome}>
          {t("assistant.connect.exit")}
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
        <AssistantLanguageSwitch lang={lang} onChange={setLang} />
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
        <button className="btn assistant__secondary" type="button" onClick={exitToHome}>
          {t("assistant.connect.exit")}
        </button>
      </div>
    );
  }

  if (current && isWaiting(current.status)) {
    return (
      <div className="assistant assistant--center" aria-live="polite">
        <AssistantLanguageSwitch lang={lang} onChange={setLang} />
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
        <button className="btn assistant__secondary" type="button" onClick={exitToHome}>
          {t("assistant.connect.exit")}
        </button>
      </div>
    );
  }

  if (current && current.status === "active" && needsSubscriptionLink(current.category) && subscriptionReadyUsi !== current.userServiceId) {
    return (
      <div className="assistant assistant--center assistant--key-wait" aria-live="polite">
        <AssistantLanguageSwitch lang={lang} onChange={setLang} />
        <div className="assistant__step">{t("assistant.wait.eyebrow")}</div>
        <div className="assistant__orb assistant__orb--pulse" aria-hidden="true">🔗</div>
        <div className="assistant__title">{t("assistant.wait.subscription_title")}</div>
        <p className="assistant__text">{t("assistant.wait.subscription_text")}</p>
        <div className="assistant__summary"><span>{current.title}</span><strong>{t("assistant.wait.subscription_status")}</strong></div>
        <button className="btn assistant__secondary" type="button" onClick={exitToHome}>
          {t("assistant.connect.exit")}
        </button>
      </div>
    );
  }

  if (screen === "offer") {
    return (
      <div className="assistant assistant--center">
        <AssistantLanguageSwitch lang={lang} onChange={setLang} />
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

  const needsEmailVerification = Boolean(me?.profile) && me?.profile?.emailVerified !== true;
  if (needsEmailVerification) {
    return (
      <AssistantEmailGate
        email={String(me?.profile?.email || "").trim()}
        lang={lang}
        setLang={setLang}
        onVerified={() => { void refetchMe(); }}
        onEmailSaved={async () => { await refetchMe(); }}
        onBack={() => {
          setScreen("offer");
          try { sessionStorage.removeItem(SCREEN_KEY); } catch { /* ignore */ }
        }}
        onLater={snooze}
        t={t}
      />
    );
  }

  const devices: Array<{ key: DeviceKind; icon: string; title: string; text: string }> = [
    { key: "phone", icon: "📱", title: t("assistant.device.phone"), text: t("assistant.device.phone_text") },
    { key: "computer", icon: "💻", title: t("assistant.device.computer"), text: t("assistant.device.computer_text") },
    { key: "router", icon: "📡", title: t("assistant.device.router"), text: t("assistant.device.router_text") },
  ];

  return (
    <div className="assistant assistant--device-screen">
      <AssistantLanguageSwitch lang={lang} onChange={setLang} />
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
                <span className="assistant-device__title-row">
                  <strong>{device.title}</strong>
                  {recommended && <span className="assistant-device__badge">{t("assistant.device.this_device")}</span>}
                </span>
                <small>{device.text}</small>
              </span>
              <span className="assistant-device__arrow" aria-hidden="true">→</span>
            </button>
          );
        })}
      </div>
      <button className="btn assistant__secondary assistant__back" type="button" onClick={() => { setScreen("offer"); try { sessionStorage.removeItem(SCREEN_KEY); } catch { /* ignore */ } }}>
        {t("assistant.back")}
      </button>
    </div>
  );
}
