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
import { resetOnboardingPromptSession } from "../shared/onboardingPromptSession";
import { normalizeError } from "../shared/api/errorText";
import { detectPwaInstallPlatform, isIOSPwaInstallPlatform, pwaGuideKey, resetPwaInstallPromptForNextSession } from "../shared/pwa/install";
import { clearTelegramMiniAppSession } from "../shared/telegram/sdk";
import { PageBackButton } from "../shared/ui/PageBackButton";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

type VerifyModalState = "idle" | "sent" | "success";
type ProfileScreen = "main" | "settings" | "about";

const EMAIL_CODE_SENT_KEY    = "email_verify:sent_at";
const EMAIL_CODE_COOLDOWN_MS = 60_000;

function readEnv(key: string): string {
  const v = (import.meta as any).env?.[key];
  return typeof v === "string" ? v.trim() : "";
}

function getTelegramBotUsername(): string {
  const raw = readEnv("VITE_TG_BOT_USERNAME");
  return raw.startsWith("@") ? raw.slice(1).trim() : raw.trim();
}

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

function getPwaInstallPrompt(): BeforeInstallPromptEvent | null {
  try {
    return (window as any).__pwaInstallPrompt ?? null;
  } catch {
    return null;
  }
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
  icon?: React.ReactNode; title: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="card profile-section-card" style={{ marginTop: 8 }}>
      <div className="card__body" style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
          {icon && <span className="profile-section-icon">{icon}</span>}
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

type ProfileIconName =
  | "activity"
  | "server"
  | "settings"
  | "info"
  | "reviews"
  | "support"
  | "channel"
  | "logout"
  | "admin"
  | "moon"
  | "user"
  | "mail"
  | "telegram"
  | "lock"
  | "globe"
  | "phone"
  | "bell"
  | "document"
  | "bolt"
  | "eye"
  | "eyeOff";

function ProfileIcon({ name }: { name: ProfileIconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
  };
  return (
    <svg className="profile-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === "activity" && <>
        <path {...common} d="M4 19V5" />
        <path {...common} d="M8 19v-6" />
        <path {...common} d="M12 19V9" />
        <path {...common} d="M16 19v-9" />
        <path {...common} d="M20 19V7" />
      </>}
      {name === "server" && <>
        <rect {...common} x="4" y="5" width="16" height="6" rx="2" />
        <rect {...common} x="4" y="13" width="16" height="6" rx="2" />
        <path {...common} d="M8 8h.01M8 16h.01M12 8h4M12 16h4" />
      </>}
      {name === "settings" && <>
        <path {...common} d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
        <path {...common} d="M19 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.6-1.5L13.7 2h-4l-.4 3a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.6 1.5l.4 3h4l.4-3a8 8 0 0 0 2.6-1.5l2.4 1 2-3.5-2.1-1.5Z" />
      </>}
      {name === "info" && <>
        <circle {...common} cx="12" cy="12" r="9" />
        <path {...common} d="M12 11v5M12 8h.01" />
      </>}
      {name === "reviews" && <>
        <path {...common} d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v5A3.5 3.5 0 0 1 15.5 15H11l-5 4v-4.3A3.5 3.5 0 0 1 5 12V6.5Z" />
        <path {...common} d="M9 8h6M9 11h4" />
      </>}
      {name === "support" && <>
        <circle {...common} cx="12" cy="12" r="9" />
        <path {...common} d="M8 8.5A4.5 4.5 0 0 1 16 11c0 3-4 2.8-4 5" />
        <path {...common} d="M12 19h.01" />
      </>}
      {name === "channel" && <>
        <path {...common} d="M4 13V9l13-5v14L4 13Z" />
        <path {...common} d="M7 14.5 9 20h3l-2.5-5" />
      </>}
      {name === "logout" && <>
        <path {...common} d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
        <path {...common} d="M15 8l4 4-4 4" />
        <path {...common} d="M19 12H9" />
      </>}
      {name === "admin" && <>
        <path {...common} d="M14.7 6.3 17 4l3 3-2.3 2.3" />
        <path {...common} d="M5 19l5.7-1.2L18 10.5 13.5 6 6.2 13.3 5 19Z" />
        <path {...common} d="M12.5 7 17 11.5" />
      </>}
      {name === "moon" && <path {...common} d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />}
      {name === "user" && <>
        <circle {...common} cx="12" cy="8" r="4" />
        <path {...common} d="M4.5 20a7.5 7.5 0 0 1 15 0" />
      </>}
      {name === "mail" && <>
        <rect {...common} x="3.5" y="5.5" width="17" height="13" rx="2" />
        <path {...common} d="m4.5 7 7.5 6 7.5-6" />
      </>}
      {name === "telegram" && <>
        <path {...common} d="M20.5 4.5 3.8 11.2c-1.1.4-1 1.9.2 2.2l4.1 1.1 1.6 4.7c.4 1.1 1.8 1.3 2.4.3l2.2-3.5 4.3 3c.9.6 2.1.1 2.3-1l2.2-12.2c.2-1-.8-1.8-1.7-1.4Z" />
        <path {...common} d="m8.1 14.5 7.9-5.2-6.3 7.1" />
      </>}
      {name === "lock" && <>
        <rect {...common} x="5" y="10" width="14" height="10" rx="2" />
        <path {...common} d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>}
      {name === "globe" && <>
        <circle {...common} cx="12" cy="12" r="9" />
        <path {...common} d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </>}
      {name === "phone" && <>
        <rect {...common} x="8" y="3" width="8" height="18" rx="2" />
        <path {...common} d="M11 18h2" />
      </>}
      {name === "bell" && <>
        <path {...common} d="M6 10a6 6 0 1 1 12 0c0 5 2 5 2 7H4c0-2 2-2 2-7Z" />
        <path {...common} d="M10 20a2.4 2.4 0 0 0 4 0" />
      </>}
      {name === "document" && <>
        <path {...common} d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
        <path {...common} d="M14 3v5h5M8.5 12h7M8.5 16h5" />
      </>}
      {name === "bolt" && <path {...common} d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />}
      {name === "eye" && <>
        <path {...common} d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
        <circle {...common} cx="12" cy="12" r="3" />
      </>}
      {name === "eyeOff" && <>
        <path {...common} d="M3 3l18 18" />
        <path {...common} d="M10.6 10.6A3 3 0 0 0 13.4 13.4" />
        <path {...common} d="M7.2 7.6C4.2 9.1 2.5 12 2.5 12s3.5 6 9.5 6c1.7 0 3.2-.4 4.5-1" />
        <path {...common} d="M19 14.4c1.6-1.2 2.5-2.4 2.5-2.4S18 6 12 6c-.8 0-1.5.1-2.2.3" />
      </>}
    </svg>
  );
}

function ProfileMenuItem({ icon, title, subtitle, onClick, badge, external, danger }: {
  icon: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  onClick?: () => void;
  badge?: React.ReactNode;
  external?: boolean;
  danger?: boolean;
}) {
  const interactive = Boolean(onClick);
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!interactive) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  }
  return (
    <div
      className={`profile-menu-item${danger ? " profile-menu-item--danger" : ""}${interactive ? " profile-menu-item--interactive" : ""}`}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <span className="profile-menu-item__icon" aria-hidden="true">{icon}</span>
      <span className="profile-menu-item__text">
        <span className="profile-menu-item__title">{title}</span>
        {subtitle != null && <span className="profile-menu-item__subtitle">{subtitle}</span>}
      </span>
      {badge && <span className="profile-menu-item__badge">{badge}</span>}
      <span className="profile-menu-item__arrow" aria-hidden="true">{interactive ? (external ? "↗" : "›") : ""}</span>
    </div>
  );
}

function ProfileSwitch({ checked, disabled }: { checked?: boolean; disabled?: boolean }) {
  return <span className={`profile-switch${checked ? " profile-switch--on" : ""}${disabled ? " profile-switch--disabled" : ""}`} aria-hidden="true" />;
}

/* ─── Email Verify Modal ─────────────────────────────────────────────────── */

export function EmailVerifyModal({ open, email, onClose, onVerified, t }: {
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
      <div className="profile-modal-icon"><ProfileIcon name="mail" /></div>
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
  const botUsername = useMemo(() => getTelegramBotUsername(), []);
  const [screen, setScreen] = useState<ProfileScreen>("main");

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
  const [tgLoginDraft] = useState("");
  const [savingTg,     setSavingTg]     = useState(false);
  const [tgError,      setTgError]      = useState<string | null>(null);
  const [tgWidgetState, setTgWidgetState] = useState<"idle" | "loading" | "ready" | "failed">("idle");

  useEffect(() => {
    if (!tgModal) setTgError(null);
  }, [tgModal]);

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
      setTgModal(false); showToast(t("profile.telegram.toast.saved"));
    } catch (e: any) { setTgError(e?.message || t("profile.telegram.error.save")); }
    finally { setSavingTg(false); }
  }
  void saveTelegramLogin;

  function mapTelegramBindError(e: unknown): string {
    const mergeHint = t(
      "profile.telegram.error.already_bound",
      "Этот Telegram уже привязан к другому аккаунту. Если это ваш аккаунт и вы хотите объединить или перенести привязку, обратитесь в поддержку — поможем аккуратно связать всё в один кабинет."
    );
    const raw = String((e as any)?.message || "").toLowerCase();
    const code = String((e as any)?.code || (e as any)?.data?.error || "").toLowerCase();
    if (raw.includes("telegram account already exists")) return mergeHint;
    if (raw.includes("telegram_login_already_used") || code.includes("telegram_login_already_used")) return mergeHint;
    if (raw.includes("missing_telegram_payload")) return t("profile.telegram.error.widget_payload", "Telegram не передал данные. Попробуйте открыть кнопку ещё раз.");
    return t("profile.telegram.error.bind", "Не удалось привязать Telegram.");
  }

  async function bindTelegramWidget(widgetUser: Record<string, any>) {
    setTgError(null);
    setSavingTg(true);
    try {
      const resp = await apiFetch<any>("/user/telegram/bind-widget", {
        method: "POST",
        body: widgetUser,
      });
      const tg = resp?.telegram ?? null;
      setTelegramLocal(tg
        ? {
            login: tg.login ?? tg.username ?? widgetUser?.username ?? null,
            username: tg.username ?? tg.login ?? widgetUser?.username ?? null,
            chatId: tg.chat_id ?? tg.chatId ?? widgetUser?.id ?? null,
            status: tg?.ShpynSDNSystem?.status ?? tg.status ?? "member",
          }
        : {
            ...(telegramRaw ?? {}),
            login: widgetUser?.username ?? null,
            username: widgetUser?.username ?? null,
            chatId: widgetUser?.id ?? null,
            status: "member",
          }
      );
      setTgModal(false);
      showToast(t("profile.telegram.toast.linked", "Telegram подключён"));
      await refetch?.();
    } catch (e: any) {
      setTgError(mapTelegramBindError(e));
      toastApiError(e, { title: t("profile.telegram.error.bind", "Не удалось привязать Telegram") });
    } finally {
      setSavingTg(false);
    }
  }

  async function mountTelegramBindWidget(force = false) {
    if (!botUsername) {
      setTgWidgetState("failed");
      setTgError(t("profile.telegram.error.no_bot", "Telegram-бот не настроен."));
      return;
    }
    if (!force && (tgWidgetState === "loading" || tgWidgetState === "ready")) return;
    const container = document.getElementById("profile-tg-widget-container");
    if (!container) return;
    container.innerHTML = "";
    setTgError(null);
    setTgWidgetState("loading");
    (window as any).__shpunTelegramBindAuth = (user: Record<string, any>) => { void bindTelegramWidget(user); };
    try {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        let settled = false;
        const done = (ok: boolean, error?: Error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(tid);
          script.onload = null;
          script.onerror = null;
          if (ok) resolve();
          else reject(error ?? new Error("tg_widget_failed"));
        };
        script.async = true;
        script.src = "https://telegram.org/js/telegram-widget.js?22";
        script.setAttribute("data-telegram-login", botUsername);
        script.setAttribute("data-size", "large");
        script.setAttribute("data-userpic", "true");
        script.setAttribute("data-request-access", "write");
        script.setAttribute("data-onauth", "__shpunTelegramBindAuth(user)");
        const tid = window.setTimeout(() => {
          script.remove();
          done(false, new Error("tg_widget_timeout"));
        }, 2500);
        script.onload = () => done(true);
        script.onerror = () => done(false, new Error("tg_widget_failed"));
        container.appendChild(script);
      });
      setTgWidgetState("ready");
    } catch {
      container.innerHTML = "";
      setTgWidgetState("failed");
      setTgError(t("profile.telegram.error.widget_load", "Telegram сейчас не загрузился. Попробуйте ещё раз."));
    }
  }

  useEffect(() => {
    if (!tgModal) {
      setTgWidgetState("idle");
      try { delete (window as any).__shpunTelegramBindAuth; } catch { /* ignore */ }
    }
  }, [tgModal]);

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
      showToast(t("profile.password.toast.changed"));
      try {
        resetPwaInstallPromptForNextSession();
        resetOnboardingPromptSession();
        clearTelegramMiniAppSession();
      } catch { /* ignore */ }
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
    setCopied(true); showToast(getMood("copied") ?? t("profile.toast.copied"));
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
      try {
        resetPwaInstallPromptForNextSession();
        resetOnboardingPromptSession();
        clearTelegramMiniAppSession();
      } catch { /* ignore */ }
      await apiFetch("/logout", { method: "POST" });
    } finally { setLoggingOut(false); nav("/login", { replace: true }); }
  }

  // PWA
  const [standalone,      setStandalone]      = useState(false);
  const [deferredPrompt,  setDeferredPrompt]  = useState<BeforeInstallPromptEvent | null>(() => getPwaInstallPrompt());
  const [pwaGuideOpen,    setPwaGuideOpen]    = useState(false);
  const pwaPlatform = useMemo(() => detectPwaInstallPlatform(), []);
  const pwaGuide = pwaGuideKey(pwaPlatform);

  useEffect(() => {
    setStandalone(isStandalonePwa());
    const onBip       = (e: Event) => { e.preventDefault?.(); setDeferredPrompt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => { setStandalone(true); setDeferredPrompt(null); showToast(t("profile.pwa.toast.installed")); };
    window.addEventListener("beforeinstallprompt", onBip as any);
    window.addEventListener("appinstalled",        onInstalled as any);
    return () => { window.removeEventListener("beforeinstallprompt", onBip as any); window.removeEventListener("appinstalled", onInstalled as any); };
  }, [t]);

  async function doInstallPwa() {
    if (standalone)      { showToast(t("profile.pwa.toast.already_installed")); return; }
    const prompt = deferredPrompt || getPwaInstallPrompt();
    if (prompt && prompt !== deferredPrompt) setDeferredPrompt(prompt);
    if (!prompt) { setPwaGuideOpen(true); return; }
    try {
      await prompt!.prompt();
      const choice = await prompt!.userChoice;
      showToast(choice?.outcome === "accepted" ? t("profile.pwa.toast.started") : t("profile.pwa.toast.cancelled"));
    } catch { showToast(t("profile.pwa.toast.failed")); }
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
      if (enabled) { await disablePush(); showToast(t("profile.push.toast.disabled")); }
      else {
        if (isIOSPwaInstallPlatform(pwaPlatform) && !standalone) { showToast(t("profile.push.toast.install_ios")); setPwaGuideOpen(true); return; }
        await enablePushByUserGesture().catch(() => false);
        const actual = await getPushState().catch(() => null);
        if (actual) setPushState({ ...actual, disabledByUser: isPushDisabledByUser() });
        showToast(
          actual?.permission === "granted" && actual.hasSubscription && !actual.disabledByUser
            ? t("profile.push.toast.enabled")
            : actual?.permission === "denied"
              ? t("profile.push.toast.denied")
              : t("profile.push.toast.failed")
        );
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
  else if (isIOSPwaInstallPlatform(pwaPlatform) && !standalone) pushBtn = <SmallBtn primary onClick={() => void doInstallPwa()} disabled={pushLoading}>{t("profile.pwa.button.install")}</SmallBtn>;
  else pushBtn = (
    <SmallBtn primary={!pushEnabled} onClick={() => void togglePush()} disabled={pushLoading}>
      {pushLoading ? "…" : pushEnabled ? t("profile.push.button.disable") : t("profile.push.button.enable")}
    </SmallBtn>
  );

  /* ── Render ── */
  const supportUrl = "https://t.me/shpun_staff";
  const channelUrl = "https://t.me/shpunsdn";

  function openExternal(url: string) {
    try { window.open(url, "_blank", "noopener,noreferrer"); }
    catch { window.location.href = url; }
  }

  return (
    <div className="section profile-page profile-more-page">
      {toast && <div className="home-alert home-alert--ok profile-more-toast">{toast}</div>}

      {screen === "main" && (
        <div className="profile-more-shell">
          <div className="profile-more-top">
            <div className="profile-more-user">
              <div className="profile-more-avatar">{initials}</div>
              <div className="profile-more-user__text">
                <div className="profile-more-user__name">{displayName}</div>
                <div className="profile-more-user__meta">ID {profile?.id ?? "—"}{loginText ? ` · ${loginText}` : ""}</div>
              </div>
            </div>
            <button className="profile-more-logout" type="button" onClick={() => void logout()} disabled={loggingOut}>{loggingOut ? "…" : "Выйти"}</button>
          </div>

          <div className="profile-more-stats">
            <div className="profile-more-stat"><span>Создан</span><strong>{formatDate(profile?.created)}</strong></div>
            <div className="profile-more-stat"><span>Последний вход</span><strong>{formatDate(profile?.lastLogin)}</strong></div>
          </div>

          {isAdmin && (
            <div className="profile-more-group profile-more-group--admin">
              <div className="profile-more-group__title">Администрирование</div>
              <div className="profile-menu-list profile-menu-list--admin">
                <ProfileMenuItem icon={<ProfileIcon name="admin" />} title={t("profile.admin")} subtitle="Пульт для внутренней магии" onClick={() => nav("/admin")} />
              </div>
            </div>
          )}

          <div className="profile-more-group">
            <div className="profile-more-group__title">Утилиты</div>
            <div className="profile-menu-list">
              <ProfileMenuItem icon={<ProfileIcon name="server" />} title="Статус серверов" subtitle="Онлайн, аптайм и отклик" onClick={() => nav("/server-status")} />
            </div>
          </div>

          <div className="profile-more-group">
            <div className="profile-more-group__title">Меню</div>
            <div className="profile-menu-list">
              <ProfileMenuItem icon={<ProfileIcon name="settings" />} title="Настройки" subtitle="Тема, язык, уведомления и вход" onClick={() => setScreen("settings")} />
              <ProfileMenuItem icon={<ProfileIcon name="info" />} title="О сервисе" subtitle="Кто такой Shpun и зачем он оживляет интернет" onClick={() => setScreen("about")} />
              <ProfileMenuItem icon={<ProfileIcon name="reviews" />} title="Отзывы" subtitle="Что пишут пользователи" onClick={() => nav("/reviews")} />
              <ProfileMenuItem icon={<ProfileIcon name="support" />} title="Поддержка" subtitle="Telegram чат" external onClick={() => openExternal(supportUrl)} />
              <ProfileMenuItem icon={<ProfileIcon name="channel" />} title="Новости" subtitle="Группа с объявлениями" external onClick={() => openExternal(channelUrl)} />
              <ProfileMenuItem icon={<ProfileIcon name="logout" />} title="Выйти из аккаунта" subtitle="Закрыть сессию на этом устройстве" danger onClick={() => void logout()} />
            </div>
          </div>
        </div>
      )}

      {screen === "settings" && (
        <div className="profile-more-shell">
          <PageBackButton onClick={() => setScreen("main")} />
          <div className="profile-more-title">Настройки</div>

          <div className="profile-more-group">
            <div className="profile-more-group__title">Внешний вид</div>
            <div className="profile-menu-list">
              <ProfileMenuItem icon={<ProfileIcon name="moon" />} title="Тема оформления" subtitle="Тёмная, как ночной серверный шкаф" badge={<ProfileSwitch checked disabled />} onClick={() => showToast("Светлую тему пока не заводили — тёмная держит стиль.")} />
            </div>
          </div>

          <div className="profile-more-group">
            <div className="profile-more-group__title">Аккаунт</div>
            <div className="profile-menu-list">
              <ProfileMenuItem icon={<ProfileIcon name="user" />} title={t("profile.personal.title")} subtitle={`${personalNameView !== "—" && personalNameView !== "вЂ”" ? personalNameView : t("profile.email.empty")} · ID ${profile?.id ?? "—"}`} badge={<SmallBtn>{t("profile.personal.edit")}</SmallBtn>} onClick={() => setEditPersonal(true)} />
              <ProfileMenuItem icon={<ProfileIcon name="mail" />} title={t("profile.email.title")} subtitle={emailLoading ? t("profile.email.loading") : email || t("profile.email.empty")} badge={email ? <SmallBadge text={emailVerified === true ? t("profile.email.badge.verified") : t("profile.email.badge.unverified")} tone={emailVerified === true ? "ok" : "warn"} /> : undefined} onClick={() => setEmailModal(true)} />
              <ProfileMenuItem icon={<ProfileIcon name="telegram" />} title="Telegram" subtitle={telegramLogin || t("profile.telegram.unlinked")} badge={telegramLogin ? <SmallBadge text={t("profile.telegram.badge.linked")} tone="ok" /> : <SmallBadge text={t("profile.telegram.badge.unlinked")} />} onClick={() => setTgModal(true)} />
              <ProfileMenuItem icon={<ProfileIcon name="lock" />} title={t("profile.change_password")} subtitle="Смена пароля и повторный вход" onClick={() => setPwdModal(true)} />
            </div>
          </div>

          <div className="profile-more-group">
            <div className="profile-more-group__title">Основные</div>
            <div className="profile-menu-list">
              <ProfileMenuItem icon={<ProfileIcon name="globe" />} title={t("profile.language.title")} subtitle={lang === "ru" ? t("profile.language.ru") : t("profile.language.en")} badge={<Segmented value={(lang as any) === "en" ? "en" : "ru"} onChange={setLang as any} ariaLabel={t("profile.language.aria")} />} />
              <ProfileMenuItem icon={<ProfileIcon name="phone" />} title={t("profile.pwa.title")} subtitle={standalone ? t("profile.pwa.installed") : t("profile.pwa.not_installed")} badge={standalone ? <SmallBadge text={t("profile.pwa.installed")} tone="ok" /> : <SmallBtn primary>{deferredPrompt ? t("profile.pwa.button.install") : t("profile.pwa.button.how")}</SmallBtn>} onClick={() => void doInstallPwa()} />
              <ProfileMenuItem icon={<ProfileIcon name="bell" />} title={t("profile.push.title")} subtitle={<>{pushEnabled ? t("profile.push.enabled") : t("profile.push.disabled")} · {pushPermText}</>} badge={<ProfileSwitch checked={pushEnabled} disabled={!pushState.supported || pushState.permission === "denied" || pushLoading} />} onClick={() => void togglePush()} />
              <ProfileMenuItem icon={<ProfileIcon name="document" />} title={t("profile.legal.title")} subtitle={t("profile.legal.value")} onClick={() => nav("/legal")} />
            </div>
          </div>
        </div>
      )}

      {screen === "about" && (
        <div className="profile-more-shell profile-about-shell">
          <PageBackButton onClick={() => setScreen("main")} />
          <div className="card profile-more-info"><div className="card__body">
            <div className="profile-about-top">
              <div className="profile-more-info__icon"><ProfileIcon name="bolt" /></div>
              <div className="profile-about-titleBlock">
                <div className="profile-about-kicker">О сервисе</div>
                <h2>Shpun App</h2>
                <p className="profile-about-lead">
                  VPN-сервис для привычного интернета без лишних квестов с настройками.
                </p>
              </div>
            </div>
            <div className="profile-about-summary">
              <span>Держим баланс качества, понятного кабинета и доступной цены.</span>
              <span>Развиваем собственную экосистему: Telegram-вход, статусы серверов, сценарии для устройств и решения для домашней сети.</span>
            </div>
            <div className="profile-about-grid">
              <div className="profile-about-card"><ProfileIcon name="activity" /><b>Видео и связь</b><span>Помогаем смотреть ролики, держать мессенджеры под рукой и не ругаться с мобильным интернетом каждый вечер.</span></div>
              <div className="profile-about-card"><ProfileIcon name="server" /><b>Баланс и качество</b><span>Следим за стабильностью, ценой и понятностью сервиса. Нам важно, чтобы VPN был не роскошью, а нормальным рабочим инструментом.</span></div>
              <div className="profile-about-card"><ProfileIcon name="lock" /><b>Кабинет без квестов</b><span>Услуги, оплата, бонусы, уведомления и вход через e-mail или Telegram собраны в одном месте.</span></div>
              <div className="profile-about-card"><ProfileIcon name="phone" /><b>Для разных устройств</b><span>Телефон, компьютер, планшет или домашняя сеть — стараемся закрывать сценарии, которыми реально пользуются каждый день.</span></div>
              <div className="profile-about-card"><ProfileIcon name="admin" /><b>Свои разработки</b><span>У нас есть собственные модули и интеграции, а не только набор чужих ссылок под красивой кнопкой.</span></div>
              <div className="profile-about-card"><ProfileIcon name="globe" /><b>Shpun Router</b><span>Отдельное направление — наш пакет для OpenWrt-роутеров, чтобы VPN работал сразу для всей домашней сети.</span></div>
            </div>
            <div className="actions actions--2 profile-about-actions">
              <button className="btn btn--primary" type="button" onClick={() => nav("/services")}>Мои услуги</button>
              <button className="btn" type="button" onClick={() => nav("/legal")}>Оферта и условия</button>
            </div>
          </div></div>
        </div>
      )}

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
            {isAdmin && <SmallBtn onClick={() => nav("/admin")}><ProfileIcon name="admin" /> {t("profile.admin")}</SmallBtn>}
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
              <ProfileIcon name="lock" /> {t("profile.change_password")}
            </button>
            <button className="btn btn--danger" onClick={() => void logout()} disabled={loggingOut} type="button" style={{ fontSize: 12, minHeight: 34 }}>
              <ProfileIcon name="logout" /> {loggingOut ? "…" : t("profile.logout")}
            </button>
          </div>
        </div>
      </div>

      {/* ── Личные данные ── */}
      <SectionCard icon={<ProfileIcon name="user" />} title={t("profile.personal.title")}
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
              right={loginText ? <SmallBtn onClick={() => void doCopyLogin()}>{copied ? "Готово" : "Копировать"}</SmallBtn> : undefined}
            />
            <PRow label={t("profile.personal.id")} value={profile?.id ?? "—"} last />
          </>
        )}
      </SectionCard>

      {/* ── Вход и привязки ── */}
      <SectionCard icon={<ProfileIcon name="lock" />} title={t("profile.auth.title")}>

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
      <SectionCard icon={<ProfileIcon name="settings" />} title={t("profile.settings.title")}>

        <PRow
          label={t("profile.language.title")}
          value={lang === "ru" ? t("profile.language.ru") : t("profile.language.en")}
          right={<Segmented value={(lang as any) === "en" ? "en" : "ru"} onChange={setLang as any} ariaLabel={t("profile.language.aria")} />}
        />

        <PRow
          label={t("profile.pwa.title")}
          value={standalone ? t("profile.pwa.installed") : t("profile.pwa.not_installed")}
          muted={!standalone}
          hint={standalone ? t("profile.pwa.hint.installed") : deferredPrompt ? t("profile.pwa.hint.available") : t(`profile.pwa.hint.${pwaGuide}`)}
          right={standalone
            ? <SmallBadge text={t("profile.pwa.installed")} tone="ok" />
            : <SmallBtn primary onClick={() => void doInstallPwa()}>{deferredPrompt ? t("profile.pwa.button.install") : t("profile.pwa.button.how")}</SmallBtn>}
        />

        <PRow
          label={t("profile.push.title")}
          value={<>{pushEnabled ? t("profile.push.enabled") : t("profile.push.disabled")}<span style={{ opacity: 0.45, fontWeight: 600, fontSize: 11 }}> · {pushPermText}</span></>}
          right={<div style={{ display: "flex", gap: 4 }}>{pushBtn}</div>}
        />

        <PRow
          label={t("profile.legal.title")}
          value={t("profile.legal.value")}
          hint={t("profile.legal.hint")}
          right={<SmallBtn onClick={() => nav("/legal")}>{t("profile.legal.open")}</SmallBtn>}
          last
        />
      </SectionCard>

      {/* ── Модалки ── */}

      <Modal open={editPersonal} title={t("profile.personal.title")} onClose={cancelPersonal} closeLabel={t("profile.modal.close")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {personalError && <div className="pre">{personalError}</div>}
          <div className="field">
            <label className="field__label">{t("profile.personal.name")}</label>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t("profile.personal.name_ph")} />
          </div>
          <div className="field">
            <label className="field__label">{t("profile.personal.phone")}</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7…" />
          </div>
          <div className="actions actions--2">
            <button className="btn" onClick={cancelPersonal} disabled={savingPersonal} type="button">{t("profile.personal.cancel")}</button>
            <button className="btn btn--primary" onClick={() => void savePersonal()} disabled={savingPersonal} type="button">{savingPersonal ? "…" : t("profile.personal.save")}</button>
          </div>
        </div>
      </Modal>

      <EmailVerifyModal open={verifyModal} email={email} onClose={() => setVerifyModal(false)} onVerified={() => setEmailVerified(true)} t={t} />

      <Modal open={pwaGuideOpen} title={t(`profile.pwa.guide.${pwaGuide}.title`)} onClose={() => setPwaGuideOpen(false)} closeLabel={t("profile.modal.close")}>
        <p className="p">{t(`profile.pwa.guide.${pwaGuide}.text`)}</p>
        <div className="pre">{t(`profile.pwa.guide.${pwaGuide}.steps`)}</div>
        <div className="actions actions--1" style={{ marginTop: 12 }}>
          <button className="btn btn--primary" onClick={() => setPwaGuideOpen(false)} type="button">{t("profile.ok")}</button>
        </div>
      </Modal>

      <Modal open={tgModal} title={telegramLogin ? t("profile.telegram.modal.change_title") : t("profile.telegram.modal.link_title")} onClose={() => setTgModal(false)} closeLabel={t("profile.modal.close")}>
        <div className="pre" style={{ background: "rgba(14,165,233,.08)", borderColor: "rgba(56,189,248,.24)" }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>{t("profile.telegram.bind.title", "Вход через Telegram")}</div>
          <div style={{ opacity: 0.78, fontSize: 13, lineHeight: 1.45 }}>
            {t("profile.telegram.bind.text", "Подтвердите свой Telegram-аккаунт. После подключения можно будет входить без пароля — удобно, быстро и без лишних ритуалов.")}
          </div>
        </div>
        <div id="profile-tg-widget-container" style={{ minHeight: 46, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 12 }} />
        {tgError && <div className="pre" style={{ marginTop: 8 }}>{tgError}</div>}
        <div className="actions actions--2" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => setTgModal(false)} disabled={savingTg} type="button">{t("profile.personal.cancel")}</button>
          <button className="btn btn--primary" onClick={() => void mountTelegramBindWidget(true)} disabled={savingTg || tgWidgetState === "loading"} type="button">
            {savingTg ? "…" : tgWidgetState === "loading" ? t("profile.telegram.bind.loading", "Загружаем Telegram…") : t("profile.telegram.bind.cta", "Подключить через Telegram")}
          </button>
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
              <div className="profile-note-title"><ProfileIcon name="mail" /> {t("profile.email.modal.verify_title")}</div>
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
              <div className="profile-note-title"><ProfileIcon name="info" /> {t("profile.email.modal.notice_title")}</div>
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
            <button type="button" className="btn btn--soft pwdfield__btn" onClick={() => setShowPwd1((v) => !v)} disabled={pwdBusy}>{showPwd1 ? <ProfileIcon name="eyeOff" /> : <ProfileIcon name="eye" />}</button>
          </div>
        </label>
        <label className="field" style={{ marginTop: 10 }}>
          <span className="field__label">{t("profile.password.field.p2")}</span>
          <div className="pwdfield">
            <input className="input" placeholder={t("profile.password.field.p2_ph")} value={pwd2} onChange={(e) => setPwd2(e.target.value)} type={showPwd2 ? "text" : "password"} autoComplete="new-password" disabled={pwdBusy} />
            <button type="button" className="btn btn--soft pwdfield__btn" onClick={() => setShowPwd2((v) => !v)} disabled={pwdBusy}>{showPwd2 ? <ProfileIcon name="eyeOff" /> : <ProfileIcon name="eye" />}</button>
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
