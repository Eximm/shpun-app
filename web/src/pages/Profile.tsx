import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { apiFetch } from "../shared/api/client";
import type { PasswordSetResponse, UserEmailResponse } from "../shared/api/types";
import { useI18n } from "../shared/i18n";
import { disablePush, enablePushByUserGesture, getPushState, isPushDisabledByUser } from "../app/notifications/push";
import { toastApiError } from "../shared/ui/toast/toastApiError";
import { getMood } from "../shared/payments-mood";
import { normalizeError } from "../shared/api/errorText";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

type VerifyModalState = "idle" | "sent" | "success";

const EMAIL_CODE_SENT_KEY    = "email_verify:sent_at";
const EMAIL_CODE_COOLDOWN_MS = 60_000;

async function copyToClipboard(text: string) {
  if (!text) return;
  try { await navigator.clipboard?.writeText(text); } catch { /* ignore */ }
}

function formatDate(v?: string | null) {
  if (!String(v ?? "").trim()) return "—";
  try {
    return new Date(String(v)).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return String(v ?? "").trim(); }
}

function isStandalonePwa(): boolean {
  try {
    return Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches) || Boolean((navigator as any)?.standalone);
  } catch { return false; }
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(String(navigator.userAgent || "")) && !(window as any).MSStream;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function pwdScore(p: string) {
  let s = 0;
  if (p.length >= 8)           s++;
  if (/[A-Z]/.test(p))        s++;
  if (/[a-z]/.test(p))        s++;
  if (/\d/.test(p))            s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 5);
}

function permissionLabel(p: string, t: (k: string) => string) {
  if (p === "granted")  return t("profile.push.permission.granted");
  if (p === "denied")   return t("profile.push.permission.denied");
  if (p === "default")  return t("profile.push.permission.default");
  return t("profile.push.permission.unsupported");
}

function getCodeSentAt(): number {
  try { return Number(localStorage.getItem(EMAIL_CODE_SENT_KEY) ?? 0) || 0; } catch { return 0; }
}
function setCodeSentAt() {
  try { localStorage.setItem(EMAIL_CODE_SENT_KEY, String(Date.now())); } catch { /* ignore */ }
}
function clearCodeSentAt() {
  try { localStorage.removeItem(EMAIL_CODE_SENT_KEY); } catch { /* ignore */ }
}
function getCooldownLeft(): number {
  const sentAt = getCodeSentAt();
  if (!sentAt) return 0;
  const left = Math.ceil((sentAt + EMAIL_CODE_COOLDOWN_MS - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

/* ─── UI primitives ──────────────────────────────────────────────────────── */

function Modal({ open, title, children, onClose, closeLabel }: {
  open: boolean; title: string; children: React.ReactNode; onClose: () => void; closeLabel: string;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" onMouseDown={onClose} className="modal">
      <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="card__body">
          <div className="modal__head">
            <div className="modal__title">{title}</div>
            <button className="btn modal__close" onClick={onClose} aria-label={closeLabel} type="button">✕</button>
          </div>
          <div className="modal__content">{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Segmented({ value, onChange, ariaLabel }: {
  value: "ru" | "en"; onChange: (v: "ru" | "en") => void; ariaLabel: string;
}) {
  return (
    <div className="seg profile-seg" role="tablist" aria-label={ariaLabel} style={{ "--profile-lang-index": value === "en" ? 1 : 0 } as any}>
      <span className="profile-seg__rail" aria-hidden="true" />
      <button type="button" className={`btn seg__btn${value === "ru" ? " btn--primary" : ""}`} onClick={() => onChange("ru")} role="tab" aria-selected={value === "ru"}>RU</button>
      <button type="button" className={`btn seg__btn${value === "en" ? " btn--primary" : ""}`} onClick={() => onChange("en")} role="tab" aria-selected={value === "en"}>EN</button>
    </div>
  );
}

/* ─── Compact row — вариант А ────────────────────────────────────────────── */

function PRow({ label, value, muted, right, hint, last }: {
  label: string; value?: React.ReactNode; muted?: boolean;
  right?: React.ReactNode; hint?: string; last?: boolean;
}) {
  return (
    <div className={`profile-compact-row${last ? " profile-compact-row--last" : ""}`} style={{
      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      gap: 10, padding: "8px 0",
      borderBottom: last ? "none" : "0.5px solid rgba(255,255,255,0.06)",
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", fontWeight: 700, marginBottom: 2 }}>{label}</div>
        {value != null && (
          <div style={{ fontSize: 13, fontWeight: 700, color: muted ? "rgba(255,255,255,0.30)" : "rgba(255,255,255,0.88)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {value}
          </div>
        )}
        {hint && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.4, marginTop: 2 }}>{hint}</div>}
      </div>
      {right && (
        <div className="profile-compact-row__right" style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 0 }}>
          {right}
        </div>
      )}
    </div>
  );
}

function SectionCard({ icon, title, children, action }: {
  icon?: string; title: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="card profile-section-card" style={{ marginTop: 8 }}>
      <div className="card__body" style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
          {icon && <span style={{ fontSize: 13, opacity: 0.7 }}>{icon}</span>}
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.32)", flex: 1 }}>
            {title}
          </div>
          {action && <div style={{ flexShrink: 0 }}>{action}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

function SmallBadge({ text, tone }: { text: string; tone?: "ok" | "warn" | "neutral" }) {
  const bg  = tone === "ok" ? "rgba(43,227,143,0.12)" : tone === "warn" ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.07)";
  const bdr = tone === "ok" ? "rgba(43,227,143,0.30)" : tone === "warn" ? "rgba(245,158,11,0.30)" : "rgba(255,255,255,0.12)";
  const col = tone === "ok" ? "#2be38f"               : tone === "warn" ? "#f59e0b"               : "rgba(255,255,255,0.55)";
  return (
    <span className={`profile-smallBadge profile-smallBadge--${tone || "neutral"}`} style={{ display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 800, background: bg, border: `0.5px solid ${bdr}`, color: col, whiteSpace: "nowrap" }}>
      {text}
    </span>
  );
}

function SmallBtn({ children, onClick, primary, danger, disabled }: {
  children: React.ReactNode; onClick?: () => void; primary?: boolean; danger?: boolean; disabled?: boolean;
}) {
  let bg = "rgba(255,255,255,0.07)"; let bdr = "rgba(255,255,255,0.14)"; let col = "rgba(255,255,255,0.80)";
  if (primary) { bg = "linear-gradient(135deg,#7c5cff,#4dd7ff)"; bdr = "transparent"; col = "#050a14"; }
  if (danger)  { bg = "rgba(255,77,109,0.12)"; bdr = "rgba(255,77,109,0.28)"; col = "#ff4d6d"; }
  return (
    <button type="button" className={`profile-smallBtn${primary ? " profile-smallBtn--primary" : ""}${danger ? " profile-smallBtn--danger" : ""}`} onClick={onClick} disabled={disabled} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      padding: "4px 9px", borderRadius: 7, fontSize: 11, fontWeight: 700,
      background: bg, border: `0.5px solid ${bdr}`, color: col,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
      whiteSpace: "nowrap", minHeight: 26,
    }}>
      {children}
    </button>
  );
}

/* ─── Email Verify Modal ─────────────────────────────────────────────────── */

function EmailVerifyModal({ open, email, onClose, onVerified, t }: {
  open: boolean; email: string; onClose: () => void; onVerified: () => void; t: (k: string) => string;
}) {
  const [state,      setState]      = useState<VerifyModalState>("idle");
  const [code,       setCode]       = useState("");
  const [codeError,  setCodeError]  = useState<string | null>(null);
  const [sending,    setSending]    = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cooldown,   setCooldown]   = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) return;
    const left = getCooldownLeft();
    setCooldown(left);
    if (getCodeSentAt() > 0) setState("sent");
    if (timerRef.current) clearInterval(timerRef.current);
    if (left > 0) {
      timerRef.current = setInterval(() => {
        const l = getCooldownLeft(); setCooldown(l);
        if (l <= 0 && timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      }, 1000);
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [open]);

  useEffect(() => { if (!open) { setState("idle"); setCode(""); setCodeError(null); } }, [open]);
  useEffect(() => { if (state === "sent") setTimeout(() => codeInputRef.current?.focus(), 100); }, [state]);

  function handleClose() { if (state === "success") clearCodeSentAt(); setCode(""); setCodeError(null); onClose(); }

  async function sendCode() {
    if (cooldown > 0 || sending) return;
    setSending(true); setCodeError(null);
    try {
      await apiFetch("/user/email/send-code", { method: "POST", body: {} });
      setCodeSentAt(); setCooldown(EMAIL_CODE_COOLDOWN_MS / 1000);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        const l = getCooldownLeft(); setCooldown(l);
        if (l <= 0 && timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      }, 1000);
      setState("sent"); setCode("");
    } catch { setCodeError(t("profile.email.verify.error.send")); }
    finally { setSending(false); }
  }

  async function confirmCode() {
    const trimmed = code.trim();
    if (!trimmed) { setCodeError(t("profile.email.verify.error.empty_code")); return; }
    setConfirming(true); setCodeError(null);
    try {
      await apiFetch("/user/email/confirm", { method: "POST", body: { code: trimmed } });
      clearCodeSentAt(); setState("success"); onVerified();
    } catch (e: any) {
      const errCode = e?.code ?? e?.data?.error ?? "";
      setCodeError(errCode === "invalid_code" ? t("profile.email.verify.error.invalid_code") : t("profile.email.verify.error.confirm"));
    } finally { setConfirming(false); }
  }

  const idleScreen = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ textAlign: "center", fontSize: 48, lineHeight: 1 }}>✉️</div>
      <p className="p" style={{ textAlign: "center", margin: 0 }}>{t("profile.email.verify.idle.text_pre")}<br /><strong>{email}</strong></p>
      {codeError && <div className="pre" style={{ textAlign: "center" }}>{codeError}</div>}
      <button className="btn btn--primary" type="button" onClick={() => void sendCode()} disabled={sending || cooldown > 0} style={{ width: "100%" }}>
        {sending ? t("profile.email.verify.sending") : t("profile.email.verify.send_btn")}
      </button>
      <button className="btn" type="button" onClick={handleClose} style={{ width: "100%" }}>{t("profile.personal.cancel")}</button>
    </div>
  );

  const sentScreen = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ textAlign: "center", fontSize: 48, lineHeight: 1 }}>📬</div>
      <p className="p" style={{ textAlign: "center", margin: 0 }}>{t("profile.email.verify.sent.text_pre")} <strong>{email}</strong>.<br />{t("profile.email.verify.sent.text_post")}</p>
      <form onSubmit={(e) => { e.preventDefault(); void confirmCode(); }}>
        <div className="field">
          <label className="field__label">{t("profile.email.verify.code_label")}</label>
          <input ref={codeInputRef} className="input" placeholder={t("profile.email.verify.code_ph")}
            value={code} onChange={(e) => { setCode(e.target.value); setCodeError(null); }}
            inputMode="numeric" autoComplete="one-time-code" disabled={confirming}
            style={{ textAlign: "center", letterSpacing: "0.15em", fontSize: 20 }} />
        </div>
        {codeError && <div className="pre" style={{ marginTop: 8, textAlign: "center" }}>{codeError}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          <button className="btn btn--primary" type="submit" disabled={confirming || !code.trim()} style={{ width: "100%" }}>
            {confirming ? t("profile.email.verify.confirming") : t("profile.email.verify.confirm_btn")}
          </button>
          <button className="btn" type="button" onClick={() => void sendCode()} disabled={sending || cooldown > 0} style={{ width: "100%", opacity: cooldown > 0 ? 0.6 : 1 }}>
            {sending ? t("profile.email.verify.sending") : cooldown > 0 ? t("profile.email.verify.resend_cooldown").replace("{n}", String(cooldown)) : t("profile.email.verify.resend_btn")}
          </button>
        </div>
      </form>
      <p className="p" style={{ textAlign: "center", margin: 0, opacity: 0.5, fontSize: 13 }}>{t("profile.email.verify.spam_hint")}</p>
    </div>
  );

  const successScreen = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
      <div style={{ fontSize: 64, lineHeight: 1 }}>✅</div>
      <div style={{ textAlign: "center" }}>
        <div className="h1" style={{ marginBottom: 8 }}>{t("profile.email.verify.success.title")}</div>
        <p className="p" style={{ margin: 0 }}>{t("profile.email.verify.success.text_pre")} <strong>{email}</strong> {t("profile.email.verify.success.text_post")}</p>
      </div>
      <button className="btn btn--primary" type="button" onClick={handleClose} style={{ width: "100%" }}>{t("profile.ok")}</button>
    </div>
  );

  const titles: Record<VerifyModalState, string> = {
    idle: t("profile.email.verify.modal.title_idle"),
    sent: t("profile.email.verify.modal.title_sent"),
    success: t("profile.email.verify.modal.title_success"),
  };

  return (
    <Modal open={open} title={titles[state]} onClose={handleClose} closeLabel={t("profile.modal.close")}>
      {state === "idle"    && idleScreen}
      {state === "sent"    && sentScreen}
      {state === "success" && successScreen}
    </Modal>
  );
}

/* ─── Profile ────────────────────────────────────────────────────────────── */

export function Profile() {
  const nav = useNavigate();
  const { me, loading, error, refetch } = useMe() as any;
  const { lang, setLang, t } = useI18n();

  const profile = me?.profile;
  const isAdmin = Boolean(profile?.isAdmin || me?.admin?.isAdmin);

  const loginText = useMemo(() => {
    const l = String(profile?.login ?? profile?.username ?? "").trim() || (profile?.id != null ? `@${profile.id}` : "");
    return l;
  }, [profile?.login, profile?.username, profile?.id]);

  const authLoginText = useMemo(() => String(profile?.login2 ?? "").trim(), [profile?.login2]);

  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) { setToast(msg); window.setTimeout(() => setToast(null), 2200); }

  // Personal
  const [editPersonal,   setEditPersonal]   = useState(false);
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [personalError,  setPersonalError]  = useState<string | null>(null);
  const [fullName,       setFullName]       = useState("");
  const [phone,          setPhone]          = useState("");
  const [savedFullName,  setSavedFullName]  = useState("");
  const [savedPhone,     setSavedPhone]     = useState("");

  useEffect(() => {
    const fn = String(profile?.fullName ?? profile?.full_name ?? profile?.displayName ?? "").trim();
    const ph = String(profile?.phone ?? "").trim();
    setFullName(fn); setPhone(ph); setSavedFullName(fn); setSavedPhone(ph);
  }, [profile?.fullName, profile?.full_name, profile?.displayName, profile?.phone]);

  async function savePersonal() {
    setPersonalError(null); setSavingPersonal(true);
    try {
      const payload = { full_name: fullName.trim(), phone: phone.trim() };
      await apiFetch("/user/profile", { method: "POST", body: payload });
      setSavedFullName(payload.full_name); setSavedPhone(payload.phone);
      setEditPersonal(false); showToast("✅ " + t("profile.toast.saved"));
    } catch (e: any) { setPersonalError(e?.message || t("profile.personal.error")); }
    finally { setSavingPersonal(false); }
  }

  function cancelPersonal() {
    setPersonalError(null); setEditPersonal(false);
    setFullName(savedFullName); setPhone(savedPhone);
  }

  // Telegram
  const [telegramLocal, setTelegramLocal] = useState<any>(null);
  const telegramRaw = telegramLocal ?? me?.telegram ?? null;

  useEffect(() => {
    if (!telegramLocal && me?.telegram) setTelegramLocal(me.telegram);
  }, [me?.telegram, telegramLocal]);

  const telegramLogin = useMemo(() => {
    const s = String(telegramRaw?.login ?? telegramRaw?.username ?? "").trim();
    return s ? (s.startsWith("@") ? s : `@${s}`) : "";
  }, [telegramRaw?.login, telegramRaw?.username]);

  const [tgModal,      setTgModal]      = useState(false);
  const [tgLoginDraft, setTgLoginDraft] = useState("");
  const [savingTg,     setSavingTg]     = useState(false);
  const [tgError,      setTgError]      = useState<string | null>(null);

  useEffect(() => {
    if (!tgModal) { setTgLoginDraft(telegramLogin.replace(/^@/, "")); setTgError(null); }
  }, [tgModal, telegramLogin]);

  async function saveTelegramLogin() {
    setTgError(null);
    const clean = tgLoginDraft.trim().replace(/^@/, "");
    if (!clean) { setTgError(t("profile.telegram.error.empty")); return; }
    if (!/^[a-zA-Z0-9_]{5,32}$/.test(clean)) { setTgError(t("profile.telegram.error.invalid")); return; }
    setSavingTg(true);
    try {
      const resp = await apiFetch<any>("/user/telegram", { method: "POST", body: { login: clean } });
      const tg   = resp?.telegram ?? null;
      setTelegramLocal(tg
        ? { login: tg.login ?? clean, username: tg.username ?? null, chatId: tg.chat_id ?? tg.chatId ?? null, status: tg?.ShpynSDNSystem?.status ?? tg.status ?? null }
        : { ...(telegramRaw ?? {}), login: clean }
      );
      setTgModal(false); showToast("✈️ " + t("profile.telegram.toast.saved"));
    } catch (e: any) { setTgError(e?.message || t("profile.telegram.error.save")); }
    finally { setSavingTg(false); }
  }

  // Email
  const [email,         setEmail]         = useState("");
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [emailLoading,  setEmailLoading]  = useState(false);
  const [emailBusy,     setEmailBusy]     = useState(false);
  const [emailModal,    setEmailModal]    = useState(false);
  const [emailDraft,    setEmailDraft]    = useState("");
  const [emailError,    setEmailError]    = useState<string | null>(null);
  const [emailSaved,    setEmailSaved]    = useState(false);
  const [verifyModal,   setVerifyModal]   = useState(false);

  async function loadEmail() {
    setEmailLoading(true);
    try {
      const resp = await apiFetch<UserEmailResponse>("/user/email", { method: "GET" }) as any;
      if (resp?.ok) { setEmail(String(resp.email ?? "").trim()); setEmailVerified(typeof resp.emailVerified === "boolean" ? resp.emailVerified : null); }
    } catch { /* ignore */ }
    finally { setEmailLoading(false); }
  }

  useEffect(() => { void loadEmail(); }, []);
  useEffect(() => { if (!emailModal) { setEmailDraft(email || ""); setEmailError(null); setEmailSaved(false); } }, [emailModal, email]);

  function getEmailError(err: unknown): string {
    const raw = String((err as any)?.message || "").toLowerCase();
    if (raw.includes("email_already_used") || raw.includes("already in use")) return t("profile.email.error.already_used");
    if (raw.includes("invalid_email"))     return t("profile.email.error.invalid");
    if (raw.includes("empty_email"))       return t("profile.email.error.empty");
    if (raw.includes("email_not_saved"))   return t("profile.email.error.not_saved");
    if (raw.includes("email_save_check_failed")) return t("profile.email.error.save_check_failed");
    return t("profile.email.error.save");
  }

  async function saveEmail() {
    setEmailError(null);
    const clean = emailDraft.trim().toLowerCase();
    if (!clean)               { setEmailError(t("profile.email.error.empty")); return; }
    if (!isValidEmail(clean)) { setEmailError(t("profile.email.error.invalid")); return; }
    setEmailBusy(true);
    try {
      const resp = await apiFetch<UserEmailResponse>("/user/email", { method: "PUT", body: { email: clean } }) as any;
      if (resp?.ok) { setEmail(String(resp.email ?? clean)); setEmailVerified(typeof resp.emailVerified === "boolean" ? resp.emailVerified : false); setEmailSaved(true); return; }
      setEmailError(t("profile.email.error.save"));
    } catch (e: unknown) { setEmailError(getEmailError(e)); }
    finally { setEmailBusy(false); }
  }

  // Password
  const [pwdModal, setPwdModal] = useState(false);
  const [pwd1,     setPwd1]     = useState("");
  const [pwd2,     setPwd2]     = useState("");
  const [showPwd1, setShowPwd1] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);
  const [pwdBusy,  setPwdBusy]  = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);

  useEffect(() => { if (!pwdModal) { setPwd1(""); setPwd2(""); setShowPwd1(false); setShowPwd2(false); setPwdError(null); setPwdBusy(false); } }, [pwdModal]);

  const pwdStrength     = useMemo(() => pwdScore(pwd1), [pwd1]);
  const canSavePassword = pwd1.trim().length >= 8 && pwd2.length > 0 && pwd1 === pwd2 && !pwdBusy;

  async function savePassword() {
    if (!canSavePassword) return;
    setPwdBusy(true); setPwdError(null);
    try {
      const res = await apiFetch<PasswordSetResponse>("/auth/password/set", { method: "POST", body: { password: pwd1.trim() } }) as any;
      if (!res?.ok) throw new Error(String(res?.error || "password_set_failed"));
      showToast("🔐 " + t("profile.password.toast.changed"));
      try { await apiFetch("/logout", { method: "POST" }); } catch { /* ignore */ }
      nav("/login?reason=pwd_changed", { replace: true, state: { from: "/profile" } });
    } catch (e: unknown) {
      const n = normalizeError(e);
      setPwdError(n.description || t("profile.password.error.save"));
      toastApiError(e, { title: t("profile.password.error.save") });
    } finally { setPwdBusy(false); }
  }

  const [copied, setCopied] = useState(false);
  async function doCopyLogin() {
    if (!loginText) return;
    await copyToClipboard(loginText);
    setCopied(true); showToast(getMood("copied") ?? "📋 " + t("profile.toast.copied"));
    window.setTimeout(() => setCopied(false), 1200);
  }

  const [loggingOut, setLoggingOut] = useState(false);
  async function logout() {
    setLoggingOut(true);
    try {
      const uid = Number(profile?.id ?? me?.id ?? 0) || 0;
      if (uid) {
        try { ["browser", "pwa"].forEach((k) => { sessionStorage.removeItem(`push.onboarding.dismissed:${k}:u:${uid}`); sessionStorage.removeItem(`push.onboarding.${k}.dismissed.session.v1`); }); } catch { /* ignore */ }
      }
      await apiFetch("/logout", { method: "POST" });
    } finally { setLoggingOut(false); nav("/login", { replace: true }); }
  }

  // PWA
  const [standalone,      setStandalone]      = useState(false);
  const [deferredPrompt,  setDeferredPrompt]  = useState<BeforeInstallPromptEvent | null>(null);
  const [iosInstallModal, setIosInstallModal] = useState(false);

  useEffect(() => {
    setStandalone(isStandalonePwa());
    const onBip       = (e: Event) => { e.preventDefault?.(); setDeferredPrompt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => { setStandalone(true); setDeferredPrompt(null); showToast("📲 " + t("profile.pwa.toast.installed")); };
    window.addEventListener("beforeinstallprompt", onBip as any);
    window.addEventListener("appinstalled",        onInstalled as any);
    return () => { window.removeEventListener("beforeinstallprompt", onBip as any); window.removeEventListener("appinstalled", onInstalled as any); };
  }, [t]);

  async function doInstallPwa() {
    if (standalone)      { showToast("📲 " + t("profile.pwa.toast.already_installed")); return; }
    if (isIOS())         { setIosInstallModal(true); return; }
    if (!deferredPrompt) { showToast("📲 " + t("profile.pwa.toast.menu")); return; }
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      showToast(choice?.outcome === "accepted" ? "🚀 " + t("profile.pwa.toast.started") : "😕 " + t("profile.pwa.toast.cancelled"));
    } catch { showToast("😬 " + t("profile.pwa.toast.failed")); }
    finally { setDeferredPrompt(null); }
  }

  // Push
  const [pushLoading, setPushLoading] = useState(false);
  const [pushState,   setPushState]   = useState<{
    supported: boolean; permission: NotificationPermission | "unsupported"; hasSubscription: boolean; standalone: boolean; disabledByUser: boolean;
  }>({ supported: false, permission: "unsupported", hasSubscription: false, standalone: false, disabledByUser: false });

  async function refreshPush() { try { const s = await getPushState(); setPushState({ ...s, disabledByUser: isPushDisabledByUser() }); } catch { /* ignore */ } }
  useEffect(() => { void refreshPush(); }, []);

  async function togglePush() {
    if (pushLoading) return;
    setPushLoading(true);
    try {
      const enabled = pushState.permission === "granted" && pushState.hasSubscription && !pushState.disabledByUser;
      if (enabled) { await disablePush(); showToast("🔕 " + t("profile.push.toast.disabled")); }
      else {
        if (isIOS() && !standalone) { showToast("📲 " + t("profile.push.toast.install_ios")); setIosInstallModal(true); return; }
        const ok = await enablePushByUserGesture();
        showToast(ok ? "🔔 " + t("profile.push.toast.enabled") : pushState.permission === "denied" ? "🚫 " + t("profile.push.toast.denied") : "😬 " + t("profile.push.toast.failed"));
      }
    } finally { setPushLoading(false); await refreshPush(); }
  }

  if (loading) {
    return (
      <div className="app-loader" style={{ opacity: 1, transition: "opacity 180ms ease", pointerEvents: "auto" }}>
        <div className="app-loader__card">
          <div className="app-loader__shine" />
          <div className="app-loader__brandRow"><div className="app-loader__mark" /><div className="app-loader__title">Shpun App</div></div>
          <div className="app-loader__text">{t("home.loading.text")}</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="section">
        <div className="card"><div className="card__body">
          <h1 className="h1">{t("profile.title")}</h1>
          <p className="p">{t("profile.error.text")}</p>
          <div className="actions actions--2" style={{ marginTop: 12 }}>
            <button className="btn btn--primary" onClick={() => refetch?.()} type="button">{t("profile.error.retry")}</button>
            <button className="btn btn--danger" onClick={() => void logout()} disabled={loggingOut} type="button">{loggingOut ? "…" : t("profile.logout")}</button>
          </div>
        </div></div>
      </div>
    );
  }

  // Derived
  const personalNameView  = savedFullName || profile?.displayName || "—";
  const personalPhoneView = savedPhone || "—";
  const pushEnabled       = pushState.permission === "granted" && pushState.hasSubscription && !pushState.disabledByUser;
  const pushPermText      = permissionLabel(String(pushState.permission), t);
  const codePending       = getCodeSentAt() > 0 && emailVerified !== true;
  const displayName       = personalNameView !== "—" ? personalNameView : authLoginText || loginText || "—";
  const initials          = displayName.trim().split(/\s+/).map((w: string) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

  let pushBtn: React.ReactNode;
  if (!pushState.supported)              pushBtn = <SmallBtn disabled>{t("profile.push.button.unavailable")}</SmallBtn>;
  else if (pushState.permission === "denied") pushBtn = <SmallBtn disabled>{t("profile.push.button.settings")}</SmallBtn>;
  else if (isIOS() && !standalone)       pushBtn = <SmallBtn primary onClick={() => void doInstallPwa()} disabled={pushLoading}>{t("profile.pwa.button.install")}</SmallBtn>;
  else pushBtn = (
    <SmallBtn primary={!pushEnabled} onClick={() => void togglePush()} disabled={pushLoading}>
      {pushLoading ? "…" : pushEnabled ? t("profile.push.button.disable") : t("profile.push.button.enable")}
    </SmallBtn>
  );

  /* ── Render ── */
  return (
    <div className="section profile-page">

      {/* ── Шапка ── */}
      <div className="card profile-hero-card">
        <div className="card__body" style={{ padding: "13px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 13, flexShrink: 0,
              background: "linear-gradient(135deg,rgba(124,92,255,0.35),rgba(77,215,255,0.25))",
              border: "0.5px solid rgba(124,92,255,0.35)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, fontWeight: 800, color: "#a78bff",
            }}>
              {initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "rgba(255,255,255,0.92)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {displayName}
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", marginTop: 2 }}>
                ID {profile?.id ?? "—"}{loginText ? ` · ${loginText}` : ""}
              </div>
            </div>
            {isAdmin && <SmallBtn onClick={() => nav("/admin")}>🛠 {t("profile.admin")}</SmallBtn>}
          </div>

          {/* Метадаты */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
            {[
              { k: t("profile.personal.created"),   v: formatDate(profile?.created) },
              { k: t("profile.personal.last_login"), v: formatDate(profile?.lastLogin) },
            ].map(({ k, v }) => (
              <div key={k} style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.07)", borderRadius: 9, padding: "7px 10px" }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.32)", marginBottom: 2 }}>{k}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.72)" }}>{v}</div>
              </div>
            ))}
          </div>

          {toast && <div className="home-alert home-alert--ok" style={{ marginBottom: 8 }}>{toast}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
            <button className="btn" onClick={() => setPwdModal(true)} type="button" style={{ fontSize: 12, minHeight: 34 }}>
              🔐 {t("profile.change_password")}
            </button>
            <button className="btn btn--danger" onClick={() => void logout()} disabled={loggingOut} type="button" style={{ fontSize: 12, minHeight: 34 }}>
              🚪 {loggingOut ? "…" : t("profile.logout")}
            </button>
          </div>
        </div>
      </div>

      {/* ── Личные данные ── */}
      <SectionCard icon="🪪" title={t("profile.personal.title")}
        action={!editPersonal ? <SmallBtn onClick={() => setEditPersonal(true)}>{t("profile.personal.edit")}</SmallBtn> : undefined}>

        {personalError && <div className="pre" style={{ marginBottom: 8 }}>{personalError}</div>}

        {editPersonal ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="field">
              <label className="field__label">{t("profile.personal.name")}</label>
              <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t("profile.personal.name_ph")} />
            </div>
            <div className="field">
              <label className="field__label">{t("profile.personal.phone")}</label>
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7…" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
              <SmallBtn onClick={cancelPersonal} disabled={savingPersonal}>{t("profile.personal.cancel")}</SmallBtn>
              <SmallBtn primary onClick={() => void savePersonal()} disabled={savingPersonal}>{savingPersonal ? "…" : t("profile.personal.save")}</SmallBtn>
            </div>
          </div>
        ) : (
          <>
            <PRow label={t("profile.personal.name")} value={personalNameView !== "—" ? personalNameView : undefined} muted={personalNameView === "—"} />
            <PRow label={t("profile.personal.phone")} value={personalPhoneView !== "—" ? personalPhoneView : t("profile.email.empty")} muted={personalPhoneView === "—"} />
            <PRow
              label={t("profile.personal.login")}
              value={loginText || "—"}
              right={loginText ? <SmallBtn onClick={() => void doCopyLogin()}>{copied ? "✓" : "📋"}</SmallBtn> : undefined}
            />
            <PRow label={t("profile.personal.id")} value={profile?.id ?? "—"} last />
          </>
        )}
      </SectionCard>

      {/* ── Вход и привязки ── */}
      <SectionCard icon="🔑" title={t("profile.auth.title")}>

        <PRow
          label={t("profile.auth.login2.title")}
          value={authLoginText || t("profile.auth.login2.empty")}
          muted={!authLoginText}
          right={<SmallBadge text={t("profile.auth.login2.badge")} />}
        />

        <PRow
          label={t("profile.email.title")}
          value={emailLoading ? t("profile.email.loading") : email || t("profile.email.empty")}
          muted={!email}
          hint={codePending ? t("profile.email.code_pending") : undefined}
          right={
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
              {email && <SmallBadge text={emailVerified === true ? t("profile.email.badge.verified") : t("profile.email.badge.unverified")} tone={emailVerified === true ? "ok" : "warn"} />}
              <SmallBtn onClick={() => setEmailModal(true)}>{email ? t("profile.email.change") : t("profile.email.add")}</SmallBtn>
              {email && emailVerified !== true && (
                <SmallBtn primary onClick={() => setVerifyModal(true)}>{codePending ? t("profile.email.enter_code") : t("profile.email.verify")}</SmallBtn>
              )}
            </div>
          }
        />

        <PRow
          label="Telegram"
          value={telegramLogin || t("profile.telegram.unlinked")}
          muted={!telegramLogin}
          right={
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {telegramLogin ? <SmallBadge text={t("profile.telegram.badge.linked")} tone="ok" /> : <SmallBadge text={t("profile.telegram.badge.unlinked")} />}
              <SmallBtn onClick={() => setTgModal(true)}>{telegramLogin ? t("profile.telegram.change") : t("profile.telegram.link")}</SmallBtn>
            </div>
          }
          last
        />
      </SectionCard>

      {/* ── Настройки ── */}
      <SectionCard icon="⚙️" title={t("profile.settings.title")}>

        <PRow
          label={t("profile.language.title")}
          value={lang === "ru" ? t("profile.language.ru") : t("profile.language.en")}
          right={<Segmented value={(lang as any) === "en" ? "en" : "ru"} onChange={setLang as any} ariaLabel={t("profile.language.aria")} />}
        />

        <PRow
          label={t("profile.pwa.title")}
          value={standalone ? t("profile.pwa.installed") : t("profile.pwa.not_installed")}
          muted={!standalone}
          right={standalone
            ? <SmallBadge text={t("profile.pwa.installed")} tone="ok" />
            : <SmallBtn primary onClick={() => void doInstallPwa()}>{isIOS() ? t("profile.pwa.button.how") : deferredPrompt ? t("profile.pwa.button.install") : t("profile.pwa.button.menu")}</SmallBtn>}
        />

        <PRow
          label={t("profile.push.title")}
          value={<>{pushEnabled ? t("profile.push.enabled") : t("profile.push.disabled")}<span style={{ opacity: 0.45, fontWeight: 600, fontSize: 11 }}> · {pushPermText}</span></>}
          right={<div style={{ display: "flex", gap: 4 }}>{pushBtn}</div>}
          last
        />
      </SectionCard>

      {/* ── Модалки ── */}

      <EmailVerifyModal open={verifyModal} email={email} onClose={() => setVerifyModal(false)} onVerified={() => setEmailVerified(true)} t={t} />

      <Modal open={iosInstallModal} title={t("profile.pwa.ios_modal.title")} onClose={() => setIosInstallModal(false)} closeLabel={t("profile.modal.close")}>
        <p className="p">{t("profile.pwa.ios_modal.text")}</p>
        <div className="pre">{t("profile.pwa.ios_modal.steps")}</div>
        <div className="actions actions--1" style={{ marginTop: 12 }}>
          <button className="btn btn--primary" onClick={() => setIosInstallModal(false)} type="button">{t("profile.ok")}</button>
        </div>
      </Modal>

      <Modal open={tgModal} title={telegramLogin ? t("profile.telegram.modal.change_title") : t("profile.telegram.modal.link_title")} onClose={() => setTgModal(false)} closeLabel={t("profile.modal.close")}>
        <p className="p">{t("profile.telegram.modal.label")}</p>
        <input className="input" style={{ marginTop: 10 }} value={tgLoginDraft} onChange={(e) => setTgLoginDraft(e.target.value)} placeholder={t("profile.telegram.modal.placeholder")} />
        {tgError && <div className="pre" style={{ marginTop: 8 }}>{tgError}</div>}
        <div className="actions actions--2" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => setTgModal(false)} disabled={savingTg} type="button">{t("profile.personal.cancel")}</button>
          <button className="btn btn--primary" onClick={() => void saveTelegramLogin()} disabled={savingTg} type="button">{savingTg ? "…" : t("profile.personal.save")}</button>
        </div>
      </Modal>

      <Modal
        open={emailModal}
        title={emailSaved ? t("profile.email.modal.saved_title") : email ? t("profile.email.modal.change_title") : t("profile.email.modal.add_title")}
        onClose={() => setEmailModal(false)}
        closeLabel={t("profile.modal.close")}
      >
        {emailSaved ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p className="p" style={{ margin: 0 }}>Email <strong>{email}</strong> — {t("profile.email.toast.saved")}.</p>
            <div className="pre" style={{ background: "rgba(124,92,255,.06)", borderColor: "rgba(124,92,255,.2)" }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>📨 {t("profile.email.modal.verify_title")}</div>
              <div style={{ opacity: 0.75, fontSize: 13, lineHeight: 1.5 }}>{t("profile.email.modal.verify_text")}</div>
            </div>
            <div className="actions actions--2">
              <button className="btn" onClick={() => setEmailModal(false)} type="button">{t("profile.email.modal.later")}</button>
              <button className="btn btn--primary" onClick={() => { setEmailModal(false); setVerifyModal(true); }} type="button">{t("profile.email.modal.verify_now")}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="pre" style={{ marginBottom: 12, background: "rgba(124,92,255,.06)", borderColor: "rgba(124,92,255,.2)" }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>📌 {t("profile.email.modal.notice_title")}</div>
              <div style={{ opacity: 0.75, fontSize: 13, lineHeight: 1.5 }}>{t("profile.email.modal.text")}</div>
              {authLoginText && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,.08)" }}>
                  <div style={{ opacity: 0.6, fontSize: 12, marginBottom: 2 }}>{t("profile.email.modal.login_label")}</div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{authLoginText}</div>
                </div>
              )}
            </div>
            <input className="input" style={{ marginTop: 4 }} value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} placeholder={t("profile.email.modal.placeholder")} autoComplete="email" inputMode="email" />
            {emailError && <div className="pre" style={{ marginTop: 8 }}>{emailError}</div>}
            <div className="actions actions--2" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setEmailModal(false)} disabled={emailBusy} type="button">{t("profile.personal.cancel")}</button>
              <button className="btn btn--primary" onClick={() => void saveEmail()} disabled={emailBusy} type="button">{emailBusy ? "…" : t("profile.email.save")}</button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={pwdModal} title={t("profile.password.modal.title")} onClose={() => setPwdModal(false)} closeLabel={t("profile.modal.close")}>
        <p className="p">{t("profile.password.modal.text")}</p>
        <label className="field" style={{ marginTop: 12 }}>
          <span className="field__label">{t("profile.password.field.p1")}</span>
          <div className="pwdfield">
            <input className="input" placeholder={t("profile.password.field.p1_ph")} value={pwd1} onChange={(e) => setPwd1(e.target.value)} type={showPwd1 ? "text" : "password"} autoComplete="new-password" disabled={pwdBusy} />
            <button type="button" className="btn btn--soft pwdfield__btn" onClick={() => setShowPwd1((v) => !v)} disabled={pwdBusy}>{showPwd1 ? "🙈" : "👁"}</button>
          </div>
        </label>
        <label className="field" style={{ marginTop: 10 }}>
          <span className="field__label">{t("profile.password.field.p2")}</span>
          <div className="pwdfield">
            <input className="input" placeholder={t("profile.password.field.p2_ph")} value={pwd2} onChange={(e) => setPwd2(e.target.value)} type={showPwd2 ? "text" : "password"} autoComplete="new-password" disabled={pwdBusy} />
            <button type="button" className="btn btn--soft pwdfield__btn" onClick={() => setShowPwd2((v) => !v)} disabled={pwdBusy}>{showPwd2 ? "🙈" : "👁"}</button>
          </div>
        </label>
        <div className="pre pwdmeter" style={{ marginTop: 10 }}>
          <div className="pwdmeter__row">
            <span className="pwdmeter__title">{t("profile.password.strength")}</span>
            <span className="pwdmeter__score">{pwdStrength}/5</span>
          </div>
          <div className="pwdmeter__tip">{t("profile.password.tip")}</div>
        </div>
        {pwdError && <div className="pre" style={{ marginTop: 8 }}>{pwdError}</div>}
        <div className="actions actions--2" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => setPwdModal(false)} disabled={pwdBusy} type="button">{t("profile.personal.cancel")}</button>
          <button className="btn btn--primary" onClick={() => void savePassword()} disabled={!canSavePassword} type="button">{pwdBusy ? "…" : t("profile.password.save")}</button>
        </div>
      </Modal>

    </div>
  );
}
