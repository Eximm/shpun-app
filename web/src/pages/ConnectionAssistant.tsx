import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
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
const EMAIL_CODE_SENT_KEY = "email_verify:sent_at";
const EMAIL_CODE_COOLDOWN_MS = 60_000;

function emailCooldownLeft() {
  try {
    const sentAt = Number(localStorage.getItem(EMAIL_CODE_SENT_KEY) || "0");
    return Math.max(0, Math.ceil((sentAt + EMAIL_CODE_COOLDOWN_MS - Date.now()) / 1000));
  } catch {
    return 0;
  }
}

function rememberEmailCodeSent() {
  try { localStorage.setItem(EMAIL_CODE_SENT_KEY, String(Date.now())); } catch { /* ignore */ }
}

function clearEmailCodeSent() {
  try { localStorage.removeItem(EMAIL_CODE_SENT_KEY); } catch { /* ignore */ }
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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

function AssistantEmailVerification({
  email,
  lang,
  setLang,
  onVerified,
  onBack,
  onLater,
  t,
}: {
  email: string;
  lang: "ru" | "en";
  setLang: (lang: "ru" | "en") => void;
  onVerified: () => Promise<void>;
  onBack: () => void;
  onLater: () => void;
  t: (key: string) => string;
}) {
  const [currentEmail, setCurrentEmail] = useState(email);
  const [editing, setEditing] = useState(!email);
  const [draft, setDraft] = useState(email);
  const [sent, setSent] = useState(Boolean(email) && emailCooldownLeft() > 0);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(emailCooldownLeft());
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sent) return;
    const update = () => setCooldown(emailCooldownLeft());
    update();
    const timer = window.setInterval(update, 1000);
    window.setTimeout(() => codeRef.current?.focus(), 100);
    return () => window.clearInterval(timer);
  }, [sent]);

  async function sendCode() {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/user/email/send-code", { method: "POST", body: {} });
      rememberEmailCodeSent();
      setCooldown(EMAIL_CODE_COOLDOWN_MS / 1000);
      setSent(true);
      setEditing(false);
      setCode("");
    } catch {
      setError(t("profile.email.verify.error.send"));
    } finally {
      setBusy(false);
    }
  }

  async function saveAndSend() {
    const clean = draft.trim().toLowerCase();
    if (!clean) { setError(t("profile.email.error.empty")); return; }
    if (!isValidEmail(clean)) { setError(t("profile.email.error.invalid")); return; }
    setBusy(true);
    setError(null);
    let emailSaved = false;
    try {
      await apiFetch("/user/email", { method: "PUT", body: { email: clean } });
      emailSaved = true;
      setCurrentEmail(clean);
      clearEmailCodeSent();
      await apiFetch("/user/email/send-code", { method: "POST", body: {} });
      rememberEmailCodeSent();
      setCooldown(EMAIL_CODE_COOLDOWN_MS / 1000);
      setSent(true);
      setEditing(false);
      setCode("");
    } catch (nextError: unknown) {
      if (emailSaved) {
        setEditing(false);
        setSent(false);
        setError(t("profile.email.verify.error.send"));
        return;
      }
      const shaped = nextError as { code?: string; data?: { error?: string } };
      const errorCode = String(shaped?.code || shaped?.data?.error || "");
      if (errorCode === "email_already_used") setError(t("profile.email.error.already_used"));
      else setError(t("profile.email.error.save"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    const clean = code.trim();
    if (!clean) { setError(t("profile.email.verify.error.empty_code")); return; }
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/user/email/confirm", { method: "POST", body: { code: clean } });
      clearEmailCodeSent();
      await onVerified();
    } catch (nextError: unknown) {
      const shaped = nextError as { code?: string; data?: { error?: string } };
      const errorCode = String(shaped?.code || shaped?.data?.error || "");
      setError(errorCode === "invalid_code"
        ? t("profile.email.verify.error.invalid_code")
        : t("profile.email.verify.error.confirm"));
    } finally {
      setBusy(false);
    }
  }

  const shownEmail = editing ? draft.trim().toLowerCase() : currentEmail || draft.trim().toLowerCase();

  return (
    <div className="assistant assistant--center assistant--email">
      <AssistantLanguageSwitch lang={lang} onChange={setLang} />
      <div className="assistant__step">{t("assistant.email.eyebrow")}</div>
      <div className="assistant__orb" aria-hidden="true">✉️</div>
      <div className="assistant__title">{t(editing ? "assistant.email.add_title" : "assistant.email.verify_title")}</div>
      <p className="assistant__text">{t(editing ? "assistant.email.add_text" : "assistant.email.verify_text")}</p>

      {editing ? (
        <form className="assistant-email" onSubmit={(event) => { event.preventDefault(); void saveAndSend(); }}>
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
            disabled={busy}
            autoFocus
          />
          {error && <div className="pre assistant-email__error">{error}</div>}
          <button className="btn btn--primary assistant__primary" type="submit" disabled={busy}>
            {busy ? t("profile.email.verify.sending") : t("assistant.email.save_send")}
          </button>
        </form>
      ) : sent ? (
        <form className="assistant-email" onSubmit={(event) => { event.preventDefault(); void confirmCode(); }}>
          <div className="assistant-email__address">{shownEmail}</div>
          <label className="field__label" htmlFor="assistant-email-code">{t("profile.email.verify.code_label")}</label>
          <input
            ref={codeRef}
            id="assistant-email-code"
            className="input assistant-email__input assistant-email__code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => { setCode(event.target.value); setError(null); }}
            placeholder={t("profile.email.verify.code_ph")}
            disabled={busy}
          />
          {error && <div className="pre assistant-email__error">{error}</div>}
          <button className="btn btn--primary assistant__primary" type="submit" disabled={busy || !code.trim()}>
            {busy ? t("profile.email.verify.confirming") : t("assistant.email.confirm_continue")}
          </button>
          <button className="btn assistant__secondary" type="button" onClick={() => void sendCode()} disabled={busy || cooldown > 0}>
            {cooldown > 0 ? t("profile.email.verify.resend_cooldown").replace("{n}", String(cooldown)) : t("profile.email.verify.resend_btn")}
          </button>
          <p className="assistant-email__hint">{t("profile.email.verify.spam_hint")}</p>
        </form>
      ) : (
        <div className="assistant-email">
          <div className="assistant-email__address">{shownEmail}</div>
          {error && <div className="pre assistant-email__error">{error}</div>}
          <button className="btn btn--primary assistant__primary" type="button" onClick={() => void sendCode()} disabled={busy}>
            {busy ? t("profile.email.verify.sending") : t("profile.email.verify.send_btn")}
          </button>
          <button className="btn assistant__secondary" type="button" onClick={() => { setDraft(shownEmail); setEditing(true); setError(null); }}>
            {t("assistant.email.change")}
          </button>
        </div>
      )}

      <div className="assistant-email__exit">
        <button className="btn" type="button" onClick={onBack}>{t("assistant.back")}</button>
        <button className="btn" type="button" onClick={onLater}>{t("assistant.offer.later")}</button>
      </div>
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
  const [emailConfirmed, setEmailConfirmed] = useState(false);
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

  const needsEmailVerification = Boolean(me?.profile) && me?.profile?.emailVerified !== true && !emailConfirmed;
  if (needsEmailVerification) {
    return (
      <AssistantEmailVerification
        email={String(me?.profile?.email || "").trim()}
        lang={lang}
        setLang={setLang}
        onVerified={async () => {
          setEmailConfirmed(true);
          await refetchMe();
        }}
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
