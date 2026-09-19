// FILE: web/src/pages/Login.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../shared/api/client";
import { refetchMe } from "../app/auth/useMe";
import type { AuthResponse } from "../shared/api/types";
import { useI18n } from "../shared/i18n";
import { toast } from "../shared/ui/toast";
import { normalizeError } from "../shared/api/errorText";
import {
  ensureTelegramWebAppSdk,
  getTelegramWebApp,
  hasTelegramMiniAppParams,
  isTelegramMiniAppEnv,
  readTelegramInitData,
} from "../shared/telegram/sdk";
import { resetOnboardingPromptSession } from "../shared/onboardingPromptSession";
import controlsIconUrl from "../assets/brand-icons/controls.svg";
import routerIconUrl from "../assets/brand-icons/router.svg";
import shieldIconUrl from "../assets/brand-icons/shield.svg";
import signalIconUrl from "../assets/brand-icons/signal-bars.svg";
import telegramIconUrl from "../assets/brand-icons/telegram.svg";
import youtubeIconUrl from "../assets/brand-icons/youtube.svg";
import allowedEmailDomains from "../shared/data/allowed-email-domains.json";
import {
  buildReferralPayload,
  captureReferralFromLocation,
  clearPendingPartnerId,
  clearPendingReferralAlias,
  isValidReferralAlias,
  normalizePartnerId,
  parseReferralFromHref,
  readPendingPartnerId,
  readPendingReferralAlias,
  replaceReferralInUrl,
  savePendingPartnerId,
  savePendingReferralAlias,
  type CapturedReferral,
} from "../shared/referrals/capture";

/* ─── Types ─────────────────────────────────────────────────────────────── */

type TgWebApp  = { initData?: string; ready?: () => void; expand?: () => void };
type Mode      = "detecting" | "telegram" | "web";
type AuthModal = "none" | "login" | "register" | "forgot" | "reset";
type TgWidgetState           = "idle" | "loading" | "ready" | "failed";
type RegisterEmailClientCode =
  | "email_required"
  | "email_invalid_format"
  | "email_non_ascii"
  | "email_domain_not_allowed"
  | "email_local_too_short"
  | "email_local_invalid"
  | "email_domain_invalid"
  | "email_domain_numeric";

/* ─── Constants ─────────────────────────────────────────────────────────── */

const AUTH_PENDING_KEY   = "auth:pending";
const AUTH_PENDING_AT_KEY= "auth:pending_at";
const AUTH_EVER_KEY      = "auth:ever_succeeded";
const TG_MINI_AUTH_ATTEMPT_KEY = "tg_mini_auth:last_attempt";
const TG_MINI_AUTH_AUTO_COOLDOWN_MS = 20_000;
const TG_MINI_AUTH_MANUAL_COOLDOWN_MS = 6_000;
const FORGOT_SENT_KEY    = "forgot_pwd:sent_at";
const FORGOT_COOLDOWN_MS = 60_000;
const ORBIT_RESOURCE_POOL = [
  "Instagram",
  "Facebook",
  "X",
  "YouTube",
  "WhatsApp",
  "Telegram",
  "Discord",
  "LinkedIn",
  "Signal",
  "Viber",
  "FaceTime",
  "Google Meet",
  "Roblox",
  "Bluesky",
  "TikTok",
] as const;
const ORBIT_RESOURCE_COUNT = 5;
const REGISTER_ALLOWED_EMAIL_DOMAINS = new Set(
  allowedEmailDomains.map((domain) => String(domain).trim().toLowerCase())
);

/* ─── Forgot helpers ─────────────────────────────────────────────────────── */

function getForgotSentAt(): number {
  try { return Number(localStorage.getItem(FORGOT_SENT_KEY) ?? 0) || 0; } catch { return 0; }
}
function setForgotSentAt() {
  try { localStorage.setItem(FORGOT_SENT_KEY, String(Date.now())); } catch { /* ignore */ }
}
function getForgotCooldown(): number {
  const sentAt = getForgotSentAt();
  if (!sentAt) return 0;
  const left = Math.ceil((sentAt + FORGOT_COOLDOWN_MS - Date.now()) / 1000);
  return left > 0 ? left : 0;
}
function wasForgotSent(): boolean { return getForgotSentAt() > 0; }

/* ─── Auth helpers ───────────────────────────────────────────────────────── */

function setAuthPending(provider: string) {
  try { sessionStorage.setItem(AUTH_PENDING_KEY, provider); sessionStorage.setItem(AUTH_PENDING_AT_KEY, String(Date.now())); } catch { /* ignore */ }
}
function clearAuthPending() {
  try { sessionStorage.removeItem(AUTH_PENDING_KEY); sessionStorage.removeItem(AUTH_PENDING_AT_KEY); } catch { /* ignore */ }
}
function markAuthEverSucceeded() { try { localStorage.setItem(AUTH_EVER_KEY, "1"); } catch { /* ignore */ } }
function hasEverSucceededAuth(): boolean { try { return localStorage.getItem(AUTH_EVER_KEY) === "1"; } catch { return false; } }

/* ─── Utils ──────────────────────────────────────────────────────────────── */

function sleep(ms: number) { return new Promise<void>((r) => window.setTimeout(r, ms)); }

function readEnv(key: string): string {
  const v = (import.meta as any).env?.[key];
  return typeof v === "string" ? v.trim() : "";
}

function getTelegramBotUsername(): string {
  const raw = readEnv("VITE_TG_BOT_USERNAME");
  return raw.startsWith("@") ? raw.slice(1).trim() : raw.trim();
}

function getTelegramInitData(): string | null {
  const d = readTelegramInitData();
  return d && d.length > 0 ? d : null;
}

function fingerprintTelegramInitData(initData: string): string {
  const s = String(initData ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function canStartTelegramMiniAuth(initData: string, manual = false): boolean {
  const key = fingerprintTelegramInitData(initData);
  const now = Date.now();
  const cooldown = manual ? TG_MINI_AUTH_MANUAL_COOLDOWN_MS : TG_MINI_AUTH_AUTO_COOLDOWN_MS;
  try {
    const raw = sessionStorage.getItem(TG_MINI_AUTH_ATTEMPT_KEY);
    if (raw) {
      const rec = JSON.parse(raw) as { key?: string; at?: number };
      const at = Number(rec?.at ?? 0) || 0;
      if (rec?.key === key && at > 0 && now - at < cooldown) return false;
    }
    sessionStorage.setItem(TG_MINI_AUTH_ATTEMPT_KEY, JSON.stringify({ key, at: now }));
  } catch {
    // If sessionStorage is unavailable, do not block auth.
  }
  return true;
}

async function waitTelegramInitData(timeoutMs = 1500): Promise<string | null> {
  const immediate = getTelegramInitData();
  if (immediate && immediate.length > 50) {
    try { const tg = getTelegramWebApp() as TgWebApp | null; tg?.ready?.(); tg?.expand?.(); } catch { /* ignore */ }
    return immediate;
  }
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(50);
    const d = getTelegramInitData();
    if (d && d.length > 50) {
      try { const tg = getTelegramWebApp() as TgWebApp | null; tg?.ready?.(); tg?.expand?.(); } catch { /* ignore */ }
      return d;
    }
  }
  return null;
}

function getReferralFromLocation(): CapturedReferral {
  try {
    return parseReferralFromHref(window.location.href);
  } catch {
    return { partnerId: 0, alias: "" };
  }
}

function looksLikeCode(s: string) {
  const v = String(s || "").trim();
  return v.length > 0 && /^[a-z0-9_:.|-]+$/i.test(v) && !/\s/.test(v);
}

function normalizeEmailInput(value: string): string { return String(value || "").trim().toLowerCase(); }

function validateRegisterEmailClient(value: string): RegisterEmailClientCode | null {
  const email = normalizeEmailInput(value);
  if (!email) return "email_required";
  if (!/^[\x00-\x7F]+$/.test(email)) return "email_non_ascii";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "email_invalid_format";
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (!REGISTER_ALLOWED_EMAIL_DOMAINS.has(domain)) return "email_domain_not_allowed";
  return null;
}

function pwdScore(p: string): number {
  let s = 0;
  if (p.length >= 8)           s++;
  if (/[A-Z]/.test(p))        s++;
  if (/[a-z]/.test(p))        s++;
  if (/\d/.test(p))            s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 5);
}

function LoginIcon({ src, className = "loginHero__svgIcon" }: { src: string; className?: string }) {
  return <img className={className} src={src} alt="" aria-hidden="true" draggable={false} />;
}

function IconBonus() {
  return (
    <svg className="loginHero__svgIcon loginHero__svgIcon--bonus" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 10h14v8.2A1.8 1.8 0 0 1 17.2 20H6.8A1.8 1.8 0 0 1 5 18.2V10Z" />
      <path d="M4.4 6.8A1.8 1.8 0 0 1 6.2 5h11.6a1.8 1.8 0 0 1 1.8 1.8V10H4.4V6.8Z" />
      <path className="loginHero__bonusRibbon" d="M11 5h2v15h-2V5Z" />
      <path className="loginHero__bonusSpark" d="M8.4 3.3c1.8 0 3.1 1.7 3.6 2.7-1.7.2-5 .1-5.7-1.3-.4-.8.6-1.4 2.1-1.4Zm7.2 0c-1.8 0-3.1 1.7-3.6 2.7 1.7.2 5 .1 5.7-1.3.4-.8-.6-1.4-2.1-1.4Z" />
    </svg>
  );
}

async function ensureAuthorizedAfterAuth(attempts = 12, delayMs = 250) {
  for (let i = 0; i < attempts; i++) {
    const me = await refetchMe().catch(() => null);
    if (me) return me;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}

function mapRedirectError(e: string, t: (k: string, fb?: string) => string): string {
  switch (String(e || "").trim()) {
    case "missing_telegram_payload": return t("login.err.missing_payload");
    case "tg_widget_failed":         return t("login.err.tg_widget_failed");
    case "telegram_account_not_found": return t("login.err.telegram_account_not_found");
    case "no_shm_session":           return t("login.err.no_shm_session");
    case "user_lookup_failed":       return t("login.err.user_lookup_failed");
    case "not_authenticated":
    case "session_expired":          return t("login.err.not_authenticated");
    default:                         return t("login.err.unknown");
  }
}

function mapEmailError(code: string, t: (k: string, fb?: string) => string): string {
  switch (String(code || "").trim()) {
    case "email_required":            return t("login.err.email_required");
    case "email_non_ascii":           return t("login.err.email_non_ascii");
    case "email_invalid_format":      return t("login.err.email_invalid_format");
    case "email_local_too_short":     return t("login.err.email_local_too_short");
    case "email_local_invalid":       return t("login.err.email_local_invalid");
    case "email_domain_invalid":      return t("login.err.email_domain_invalid");
    case "email_domain_numeric":      return t("login.err.email_domain_invalid");
    case "email_domain_not_allowed":  return t("login.err.email_domain_not_allowed");
    default:                          return "";
  }
}

function mapAuthError(raw: string, t: (k: string, fb?: string) => string): string {
  const code = String(raw || "").trim();
  if (!code) return t("login.err.unknown");
  if (!looksLikeCode(code)) return code;
  const emailMsg = mapEmailError(code, t);
  if (emailMsg) return emailMsg;
  switch (code) {
    case "login_and_password_required": return t("login.err.login_and_password_required");
    case "login_required":              return t("login.err.login_required");
    case "password_required":           return t("login.err.password_required");
    case "invalid_credentials":         return t("login.err.invalid_credentials");
    case "shm_auth_unavailable":        return t("login.err.shm_auth_unavailable");
    case "password_too_short":
    case "password_too_short_or_weak":  return t("login.err.password_too_short");
    case "login_taken":
    case "user_exists":                 return t("login.err.login_taken");
    case "registration_limited":        return t("login.err.registration_limited");
    case "not_authenticated":           return t("login.err.not_authenticated");
    case "no_shm_session":              return t("login.err.no_shm_session");
    case "init_data_required":          return t("login.err.init_data_required");
    case "telegram_login_not_allowed_in_regular_register":
                                      return t("login.err.telegram_login_not_allowed");
    case "shm_telegram_auth_failed":
    case "shm_telegram_widget_auth_failed": return t("login.err.tg_failed");
    case "shm_register_failed":         return t("login.err.register_failed");
    case "shm_register_exception":      return t("login.err.register_unavailable");
    case "shm_auth_exception":          return t("login.err.shm_auth_unavailable");
    default:                            return t("login.err.generic");
  }
}

function mapTelegramAuthError(raw: string, t: (k: string, fb?: string) => string): string {
  const code = String(raw || "").trim();
  if (!code) return t("login.err.tg_failed");
  if (!looksLikeCode(code)) return code;
  switch (code) {
    case "init_data_required":
    case "missing_telegram_payload":
      return t("login.err.init_data_required");
    case "not_authenticated":
    case "session_expired":
    case "no_shm_session":
      return t("login.err.telegram_session");
    case "telegram_auth_limited":
      return t("login.err.telegram_auth_limited");
    case "telegram_account_not_found":
      return t("login.err.telegram_account_not_found");
    case "invalid_credentials":
    case "shm_auth_unavailable":
    case "shm_telegram_auth_failed":
    case "shm_telegram_widget_auth_failed":
    case "telegram_password_login_failed":
    case "shm_register_failed":
    default:
      return t("login.err.tg_failed");
  }
}

function errorToAuthRaw(e: unknown, fallback: string): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const a = e as any;
    const code = typeof a.error === "string" ? a.error : typeof a.code === "string" ? a.code : "";
    if (code) return code;
    const nested = a?.json?.error || a?.data?.error || a?.body?.error;
    if (typeof nested === "string" && nested) return nested;
  }
  const n = normalizeError(e);
  if (n.status === 401 || n.status === 403 || n.code === "not_authenticated") return "not_authenticated";
  if (n.description && !looksLikeCode(n.description)) return n.description;
  return fallback;
}

/* ─── LangSwitch ─────────────────────────────────────────────────────────── */

function LangSwitch({ lang, setLang, ariaLabel }: { lang: "ru" | "en"; setLang: (v: "ru" | "en") => void; ariaLabel: string }) {
  return (
    <div className="seg login__langSwitch" aria-label={ariaLabel}>
      <button type="button" className={`btn seg__btn ${lang === "ru" ? "btn--primary" : ""}`} onClick={() => setLang("ru")}>RU</button>
      <button type="button" className={`btn seg__btn ${lang === "en" ? "btn--primary" : ""}`} onClick={() => setLang("en")}>EN</button>
    </div>
  );
}

/* ─── Login ──────────────────────────────────────────────────────────────── */

export function Login() {
  const { t, lang, setLang } = useI18n();
  const nav = useNavigate();
  const loc: any = useLocation();
  const orbitResources = useMemo(() => {
    const pool = [...ORBIT_RESOURCE_POOL];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, ORBIT_RESOURCE_COUNT);
  }, []);

  const [mode,    setMode]    = useState<Mode>("detecting");
  const [loading, setLoading] = useState(false);

  // ── Modal & auth fields ───────────────────────────────────────────────────
  const [authModal,     setAuthModal]     = useState<AuthModal>("none");
  const [login,         setLogin]         = useState("");
  const [clientName,    setClientName]    = useState("");
  const [password,      setPassword]      = useState("");
  const [password2,     setPassword2]     = useState("");
  const [showPassword,  setShowPassword]  = useState(false);
  const [showPassword2, setShowPassword2] = useState(false);
  const [passwordLoginError, setPasswordLoginError] = useState<string | null>(null);
  const [emailTouched,  setEmailTouched]  = useState(false);
  const [registerEmailServerCode, setRegisterEmailServerCode] =
    useState<RegisterEmailClientCode | null>(null);

  // ── Forgot password ───────────────────────────────────────────────────────
  const [forgotLogin,    setForgotLogin]    = useState("");
  const [forgotSent,     setForgotSent]     = useState(() => wasForgotSent());
  const [forgotLoading,  setForgotLoading]  = useState(false);
  const [forgotCooldown, setForgotCooldown] = useState(() => getForgotCooldown());
  const forgotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Reset password (по токену из письма) ──────────────────────────────────
  const [resetToken,       setResetToken]       = useState("");
  const [resetPwd1,        setResetPwd1]        = useState("");
  const [resetPwd2,        setResetPwd2]        = useState("");
  const [resetShowPwd1,    setResetShowPwd1]    = useState(false);
  const [resetShowPwd2,    setResetShowPwd2]    = useState(false);
  const [resetLoading,     setResetLoading]     = useState(false);
  const [resetVerifying,   setResetVerifying]   = useState(false);
  const [resetVerifyError, setResetVerifyError] = useState<string | null>(null);
  const [resetError,       setResetError]       = useState<string | null>(null);
  const [resetDone,        setResetDone]        = useState(false);

  const resetStrength  = pwdScore(resetPwd1);
  const resetPwdMatch  = resetPwd2.length === 0 || resetPwd1 === resetPwd2;
  const canSubmitReset = resetPwd1.length >= 8 && resetPwd2.length > 0
                         && resetPwd1 === resetPwd2 && !resetLoading
                         && !resetVerifying && !resetVerifyError;

  // ── Partner / widget ──────────────────────────────────────────────────────
  const [partnerId,      setPartnerId]      = useState<number>(() => readPendingPartnerId());
  const [referralAlias, setReferralAlias] = useState<string>(() => readPendingReferralAlias());
  const [partnerIdInput, setPartnerIdInput] = useState<string>(() => {
    const p = readPendingPartnerId(); return p > 0 ? String(p) : "";
  });
  const [tgWidgetState, setTgWidgetState] = useState<TgWidgetState>("idle");
  const [partnerOpen,   setPartnerOpen]   = useState(false);
  const [partnerApplying, setPartnerApplying] = useState(false);
  const [partnerError,  setPartnerError]  = useState<string | null>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const authInProgressRef       = useRef(false);
  const widgetWrapRef           = useRef<HTMLDivElement | null>(null);
  const authModalBodyRef        = useRef<HTMLDivElement | null>(null);
  const loginInputRef           = useRef<HTMLInputElement | null>(null);
  const passwordInputRef        = useRef<HTMLInputElement | null>(null);
  const referralHandledRef      = useRef(false);
  const resolvedReferralRef     = useRef<{ alias: string; linkType: "partner" | "campaign"; partnerId: number } | null>(null);
  const authOkHandledRef        = useRef(false);
  const tokenHandledRef         = useRef(false);
  const redirectErrorHandledRef = useRef<string>("");
  const lastToastRef            = useRef<{ msg: string; at: number }>({ msg: "", at: 0 });

  const botUsername = useMemo(() => getTelegramBotUsername(), []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const canPasswordLogin    = login.trim().length > 0 && password.length > 0;
  const passwordsMatch      = password2.length === 0 ? true : password === password2;
  const registerEmailCode = authModal === "register"
    ? (registerEmailServerCode || validateRegisterEmailClient(login))
    : null;
  const registerEmailMessage = registerEmailCode ? mapEmailError(registerEmailCode, t) : "";
  const canPasswordRegister = login.trim().length > 0 && password.length > 0
    && password2.length > 0 && password === password2 && !registerEmailCode;

  useEffect(() => {
    if (authModal === "none") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [authModal]);

  useEffect(() => {
    if (authModal !== "register" || !login.trim()) return;
    const timer = window.setTimeout(() => setEmailTouched(true), 450);
    return () => window.clearTimeout(timer);
  }, [authModal, login]);

  // ── Toast ─────────────────────────────────────────────────────────────────
  function toastError(raw: string) {
    const msg = mapAuthError(raw, t);
    const now = Date.now();
    if (lastToastRef.current.msg === msg && now - lastToastRef.current.at < 1200) return;
    lastToastRef.current = { msg, at: now };
    toast.error(t("login.toast.error_title"), { description: msg });
  }

  function toastTelegramError(raw: string) {
    const msg = mapTelegramAuthError(raw, t);
    const now = Date.now();
    if (lastToastRef.current.msg === msg && now - lastToastRef.current.at < 1200) return;
    lastToastRef.current = { msg, at: now };
    toast.error(t("login.toast.error_title"), { description: msg });
  }

  async function resolveReferralAlias(
    aliasRaw: string
  ): Promise<{ ok: true; linkType: "partner" | "campaign"; partnerId: number } | { ok: false }> {
    const alias = String(aliasRaw ?? "").trim().toLowerCase();
    if (!alias) return { ok: false };
    try {
      const resolved = await apiFetch<{ ok: true; linkType: "partner" | "campaign"; partnerId: number }>(
        `/referrals/resolve?alias=${encodeURIComponent(alias)}`,
        { method: "GET" }
      );
      const normalized = {
        linkType: resolved.linkType,
        partnerId: normalizePartnerId(resolved.partnerId),
      };
      resolvedReferralRef.current = { alias, ...normalized };
      return { ok: true, ...normalized };
    } catch {
      return { ok: false };
    }
  }

  async function buildReferralAuthPayload(): Promise<Record<string, any>> {
    // Capture synchronously first: even if the resolve request below fails,
    // the alias is persisted and can be attributed by the backend claim path.
    captureReferralFromLocation();

    let id = getReferralFromLocation().partnerId || readPendingPartnerId() || partnerId;
    let alias = getReferralFromLocation().alias || readPendingReferralAlias() || referralAlias;

    if (id > 0 && !alias) {
      clearPendingReferralAlias();
      setReferralAlias("");
    }

    if (alias) {
      // Avoid a second resolve (and a second visits_count tick) when this exact
      // alias was already resolved during this Login session (auto-capture or
      // manual apply).
      const cached = resolvedReferralRef.current;
      if (cached && cached.alias === alias) {
        id = cached.linkType === "partner" ? cached.partnerId : 0;
        if (cached.linkType === "campaign") clearPendingPartnerId();
      } else {
        const resolved = await resolveReferralAlias(alias);
        if (resolved.ok) {
          id = resolved.linkType === "partner" ? resolved.partnerId : 0;
          if (resolved.linkType === "campaign") clearPendingPartnerId();
        } else {
          alias = "";
        }
      }
    }

    if (id > 0) {
      savePendingPartnerId(id);
      setPartnerId(id);
      setPartnerIdInput(String(id));
    }
    if (alias) {
      savePendingReferralAlias(alias);
      setReferralAlias(alias);
    }

    return buildReferralPayload(id, alias);
  }

  // ── Modal controls ────────────────────────────────────────────────────────
  function resetTelegramWidgetUi() {
    const container = document.getElementById("tg-widget-container");
    if (container) container.innerHTML = "";
    setTgWidgetState("idle");
    try { delete (window as any).__shpunTelegramWidgetAuth; } catch { /* ignore */ }
  }

  function openModal(next: AuthModal) {
    resetTelegramWidgetUi();
    setAuthModal(next);
    setPassword(""); setPassword2(""); setShowPassword(false); setShowPassword2(false);
    setPasswordLoginError(null);
    setEmailTouched(false); setRegisterEmailServerCode(null);
    if (next !== "register") setClientName("");
    if (next === "register") {
      const p = readPendingPartnerId();
      setPartnerIdInput((p > 0 ? p : partnerId) > 0 ? String(p > 0 ? p : partnerId) : "");
    }
    // При открытии forgot — подставляем email из поля логина если forgotLogin пустой
    if (next === "forgot" && !forgotLogin.trim()) {
      const emailFromLogin = login.trim().toLowerCase();
      if (emailFromLogin && emailFromLogin.includes("@")) setForgotLogin(emailFromLogin);
    }
    if (next !== "forgot") setForgotLoading(false);
  }

  function closeModal() {
    resetTelegramWidgetUi();
    setAuthModal("none");
    setPassword(""); setPassword2(""); setShowPassword(false); setShowPassword2(false);
    setPasswordLoginError(null);
    setClientName(""); setEmailTouched(false); setRegisterEmailServerCode(null); setForgotLoading(false);
    // Reset-state сбрасываем полностью
    setResetToken(""); setResetPwd1(""); setResetPwd2("");
    setResetShowPwd1(false); setResetShowPwd2(false);
    setResetError(null); setResetDone(false); setResetVerifyError(null);
  }

  async function applyPartnerCode() {
    const raw = partnerIdInput.trim();
    setPartnerError(null);
    const nextPartnerId = normalizePartnerId(raw);
    if (nextPartnerId > 0) {
      setPartnerId(nextPartnerId);
      savePendingPartnerId(nextPartnerId);
      setReferralAlias("");
      clearPendingReferralAlias();
      setPartnerIdInput(String(nextPartnerId));
      replaceReferralInUrl("partner", String(nextPartnerId));
      setPartnerOpen(false);
      requestAnimationFrame(() => authModalBodyRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
      return;
    }
    if (!isValidReferralAlias(raw)) {
      setPartnerError(t("login.partner.invalid"));
      return;
    }
    const alias = raw.toLowerCase();
    setPartnerApplying(true);
    const resolved = await resolveReferralAlias(alias);
    setPartnerApplying(false);
    if (!resolved.ok) {
      setPartnerError(t("login.partner.not_found"));
      return;
    }
    if (resolved.linkType === "partner" && resolved.partnerId > 0) {
      setPartnerId(resolved.partnerId);
      savePendingPartnerId(resolved.partnerId);
      setReferralAlias(alias);
      savePendingReferralAlias(alias);
      setPartnerIdInput(String(resolved.partnerId));
    } else {
      // Campaign alias: no partner id, but the alias drives backend attribution.
      setPartnerId(0);
      clearPendingPartnerId();
      setReferralAlias(alias);
      savePendingReferralAlias(alias);
      setPartnerIdInput(alias);
    }
    replaceReferralInUrl("alias", alias);
    setPartnerOpen(false);
    requestAnimationFrame(() => authModalBodyRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function cancelPartnerCode() {
    setPartnerIdInput(partnerId > 0 ? String(partnerId) : referralAlias);
    setPartnerError(null);
    setPartnerOpen(false);
  }

  // ── Reset password logic ──────────────────────────────────────────────────
  function openResetModal(token: string) {
    // Сбрасываем всё предыдущее
    setResetToken(token);
    setResetPwd1(""); setResetPwd2(""); setResetShowPwd1(false); setResetShowPwd2(false);
    setResetError(null); setResetDone(false); setResetVerifyError(null);
    setAuthModal("reset");
    void verifyResetToken(token);
  }

  async function verifyResetToken(token: string) {
    setResetVerifying(true);
    setResetVerifyError(null);
    try {
      await apiFetch(`/auth/password-reset/verify?token=${encodeURIComponent(token)}`);
    } catch (e: any) {
      const code = String(e?.code ?? e?.data?.error ?? "");
      setResetVerifyError(
        code === "invalid_or_expired_token"
          ? t("login.reset.invalid")
          : t("login.reset.verify_failed")
      );
    } finally {
      setResetVerifying(false);
    }
  }

  async function submitReset() {
    if (!canSubmitReset) return;
    setResetError(null);
    setResetLoading(true);
    try {
      await apiFetch("/auth/password-reset/confirm", {
        method: "POST",
        body: { token: resetToken, password: resetPwd1.trim() },
      });
      setResetDone(true);
    } catch (e: any) {
      const code = String(e?.code ?? e?.data?.error ?? "");
      setResetError(
        code === "invalid_or_expired_token"
          ? t("login.reset.invalid_request_new")
          : t("login.reset.change_failed")
      );
    } finally {
      setResetLoading(false);
    }
  }

  // ── Forgot password logic ─────────────────────────────────────────────────
  async function forgotPassword() {
    const email = forgotLogin.trim().toLowerCase();
    if (!email) { toastError("login_required"); return; }
    if (forgotCooldown > 0) return;
    setForgotLoading(true);
    try {
      await apiFetch("/auth/password-reset", { method: "POST", body: { login: email } });
    } catch { /* не раскрываем существование аккаунта */ }
    finally {
      setForgotSentAt();
      setForgotCooldown(FORGOT_COOLDOWN_MS / 1000);
      if (forgotTimerRef.current) clearInterval(forgotTimerRef.current);
      forgotTimerRef.current = setInterval(() => {
        const l = getForgotCooldown();
        setForgotCooldown(l);
        if (l <= 0 && forgotTimerRef.current) { clearInterval(forgotTimerRef.current); forgotTimerRef.current = null; }
      }, 1000);
      setForgotLoading(false);
      setForgotSent(true);
    }
  }

  // ── Telegram ──────────────────────────────────────────────────────────────
  async function goAfterAuth(r?: AuthResponse, provider?: string) {
    if (!r || !(r as any).ok) {
      clearAuthPending();
      const raw = String((r as any)?.error ?? "") || "login_failed";
      if (provider === "telegram") toastTelegramError(raw);
      else toastError(raw);
      return;
    }
    markAuthEverSucceeded();
    resetOnboardingPromptSession();
    setAuthPending(provider || "auth");
    clearPendingPartnerId();
    clearPendingReferralAlias();
    setPartnerId(0); setPartnerIdInput(""); setClientName("");
    const nextRaw = String((r as any).next ?? "home").trim();
    if (nextRaw === "set_password") {
      nav("/set-password", { replace: true, state: { login: String((r as any).login ?? "").trim() } });
      return;
    }
    if (provider === "telegram") await sleep(200);
    const me = await ensureAuthorizedAfterAuth();
    if (!me) {
      clearAuthPending();
      toast.error(t("login.toast.error_title"), { description: t("login.auth.finish_failed") });
      return;
    }
    nav(String(loc?.state?.from ?? "").trim() || "/", { replace: true });
  }

  async function telegramLoginMiniApp() {
    if (authInProgressRef.current) return;
    authInProgressRef.current = true; setLoading(true);
    try {
      let initData = getTelegramInitData();
      if (!initData) initData = await waitTelegramInitData(3000);
      if (!initData) { toastTelegramError("init_data_required"); return; }
      if (!canStartTelegramMiniAuth(initData, true)) {
        toastTelegramError("telegram_auth_limited");
        return;
      }
      const referralPayload = await buildReferralAuthPayload();
      const r = await apiFetch<AuthResponse>("/auth/telegram", {
        method: "POST",
        body: { initData, ...referralPayload },
      });
      await goAfterAuth(r, "telegram");
    } catch (e: unknown) { clearAuthPending(); toastTelegramError(errorToAuthRaw(e, t("error.telegram_login_failed")));
    } finally { setLoading(false); authInProgressRef.current = false; }
  }

  async function passwordLogin() {
    if (mode === "telegram") { toast.error(t("login.toast.error_title"), { description: t("login.tg.only.password_disabled") }); return; }
    if (!canPasswordLogin) {
      const raw = !login.trim()
        ? (password ? "login_required" : "login_and_password_required")
        : "password_required";
      setPasswordLoginError(mapAuthError(raw, t));
      toastError(raw);
      requestAnimationFrame(() => {
        (!login.trim() ? loginInputRef : passwordInputRef).current?.focus();
      });
      return;
    }
    setPasswordLoginError(null);
    setLoading(true);
    try {
      const r = await apiFetch<AuthResponse>("/auth/password", { method: "POST", body: { login: login.trim(), password, mode: "login" } });
      await goAfterAuth(r, "password");
    } catch (e: unknown) {
      clearAuthPending();
      const raw = errorToAuthRaw(e, t("error.password_login_failed"));
      setPasswordLoginError(mapAuthError(raw, t));
      toastError(raw);
    } finally { setLoading(false); }
  }

  async function passwordRegister() {
    if (mode === "telegram") { toast.error(t("login.toast.error_title"), { description: t("login.tg.only.password_disabled") }); return; }
    setEmailTouched(true);
    if (registerEmailCode) { toastError(registerEmailCode); return; }
    if (!canPasswordRegister) {
      if (!login.trim() || !password) toastError("login_and_password_required");
      else if (!passwordsMatch) toastError(t("login.password.mismatch"));
      return;
    }
    const finalPartnerId = normalizePartnerId(partnerIdInput);
    if (partnerIdInput.trim() && finalPartnerId <= 0 && !referralAlias) { toastError(t("login.partner.invalid")); return; }
    setLoading(true);
    try {
      const referralPayload = await buildReferralAuthPayload();
      const r = await apiFetch<AuthResponse>("/auth/password", {
        method: "POST",
        body: {
          login: normalizeEmailInput(login), password, mode: "register",
          client: clientName.trim() || normalizeEmailInput(login),
          ...referralPayload,
        },
      });
      await goAfterAuth(r, "password");
    } catch (e: unknown) {
      clearAuthPending();
      const raw = errorToAuthRaw(e, t("error.password_register_failed"));
      if (raw.startsWith("email_")) {
        setRegisterEmailServerCode(raw as RegisterEmailClientCode);
        setEmailTouched(true);
      }
      toastError(raw);
    } finally { setLoading(false); }
  }

  async function telegramLoginWidget(widgetUser: Record<string, any>) {
    if (authInProgressRef.current) return;
    authInProgressRef.current = true; setLoading(true);
    try {
      const referralPayload = await buildReferralAuthPayload();
      const r = await apiFetch<AuthResponse>("/auth/telegram_widget", {
        method: "POST",
        body: {
          ...widgetUser,
          ...referralPayload,
          mode: authModal === "register" ? "register" : "login",
        },
      });
      await goAfterAuth(r, "telegram");
    } catch (e: unknown) { clearAuthPending(); toastTelegramError(errorToAuthRaw(e, t("error.telegram_login_failed")));
    } finally { setLoading(false); authInProgressRef.current = false; }
  }

  async function mountTelegramWidget(force = false) {
    if (mode === "telegram") return;
    if (!botUsername) { setTgWidgetState("failed"); return; }
    if (!force && (tgWidgetState === "loading" || tgWidgetState === "ready")) return;
    const container = document.getElementById("tg-widget-container");
    if (!container) return;
    container.innerHTML = "";
    setTgWidgetState("loading");
    (window as any).__shpunTelegramWidgetAuth = (user: Record<string, any>) => { void telegramLoginWidget(user); };
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
        script.setAttribute("data-onauth", "__shpunTelegramWidgetAuth(user)");
        const tid = window.setTimeout(() => {
          script.remove();
          done(false, new Error("tg_widget_timeout"));
        }, 1500);
        script.onload  = () => done(true);
        script.onerror = () => done(false, new Error("tg_widget_failed"));
        container.appendChild(script);
      });
      setTgWidgetState("ready");
    } catch { container.innerHTML = ""; setTgWidgetState("failed"); }
  }

  // ── Effects ───────────────────────────────────────────────────────────────

  // Telegram auto-login
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const telegramSignal = isTelegramMiniAppEnv() || hasTelegramMiniAppParams();
      if (telegramSignal) {
        setMode("telegram");
        await ensureTelegramWebAppSdk(1200);
      }
      const initData = await waitTelegramInitData(1500);
      if (cancelled) return;
      if (!initData) { setMode(telegramSignal || hasTelegramMiniAppParams() ? "telegram" : "web"); return; }
      setMode("telegram");
      if (!canStartTelegramMiniAuth(initData, false)) return;
      authInProgressRef.current = true; setLoading(true);
      try {
        const referralPayload = await buildReferralAuthPayload();
        const r = await apiFetch<AuthResponse>("/auth/telegram", {
          method: "POST",
          body: { initData, ...referralPayload },
        });
        if (!cancelled) await goAfterAuth(r, "telegram");
      } catch { if (!cancelled) clearAuthPending(); }
      finally { authInProgressRef.current = false; if (!cancelled) setLoading(false); }
    };
    void run();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ?token= — открываем модалку смены пароля
  useEffect(() => {
    if (tokenHandledRef.current) return;
    const sp    = new URLSearchParams(String(loc?.search ?? ""));
    const token = sp.get("token")?.trim();
    if (!token) return;
    tokenHandledRef.current = true;
    // Убираем токен из URL
    sp.delete("token");
    const nextSearch = sp.toString();
    window.history.replaceState(null, "", window.location.pathname + (nextSearch ? `?${nextSearch}` : ""));
    openResetModal(token);
  }, [loc?.search]); // eslint-disable-line react-hooks/exhaustive-deps

  // ?a=auth_ok — после редиректа из виджета
  useEffect(() => {
    const sp = new URLSearchParams(String(loc?.search ?? ""));
    const a  = String(sp.get("a") ?? "").trim().toLowerCase();
    const p  = String(sp.get("p") ?? "").trim().toLowerCase();
    if (a !== "auth_ok" || authOkHandledRef.current) return;
    authOkHandledRef.current = true;
    setAuthPending(p || "auth");
    sp.delete("a"); sp.delete("p");
    const nextSearch = sp.toString();
    window.history.replaceState(null, "", window.location.pathname + (nextSearch ? `?${nextSearch}` : "") + window.location.hash);
    void (async () => {
      const me = await ensureAuthorizedAfterAuth();
      if (me) { markAuthEverSucceeded(); nav("/", { replace: true }); return; }
      clearAuthPending();
      toast.error(t("login.toast.error_title"), { description: t("login.auth.finish_failed") });
    })();
  }, [loc?.search, nav, t]);

  // ?e= — ошибка от редиректа
  useEffect(() => {
    const sp = new URLSearchParams(String(loc?.search ?? ""));
    const e  = String(sp.get("e") ?? "").trim();
    if (!e || redirectErrorHandledRef.current === e) return;
    redirectErrorHandledRef.current = e;
    const hadPreviousAuth = hasEverSucceededAuth() || !!sessionStorage.getItem(AUTH_PENDING_KEY);
    const sessionRelated  = e === "not_authenticated" || e === "session_expired" || e === "no_shm_session";
    if (sessionRelated && !hadPreviousAuth) return;
    const msg = mapRedirectError(e, t);
    if (msg) toastError(msg);
  }, [loc?.search, t]);

  // Реферальный код из URL
  useEffect(() => {
    if (referralHandledRef.current) return;
    if (mode === "detecting") return;
    referralHandledRef.current = true;
    void (async () => {
      // Persist synchronously first so a failed resolve never loses attribution.
      const captured = captureReferralFromLocation();
      let fromUrl = captured.partnerId;
      const alias = captured.alias;

      if (fromUrl > 0 && !alias) {
        clearPendingReferralAlias();
        setReferralAlias("");
      }

      let resolvedAlias = false;
      let aliasKnownInvalid = false;
      if (alias) {
        const resolved = await resolveReferralAlias(alias);
        if (resolved.ok) {
          resolvedAlias = true;
          fromUrl = resolved.linkType === "partner" ? resolved.partnerId : 0;
          if (resolved.linkType === "campaign") {
            clearPendingPartnerId();
            setPartnerId(0);
            setPartnerIdInput("");
          }
          savePendingReferralAlias(alias);
          setReferralAlias(alias);
        } else {
          // Unknown/disabled alias: keep the normal registration possible and
          // tell the user instead of silently dropping the invitation.
          aliasKnownInvalid = true;
          clearPendingReferralAlias();
          setReferralAlias("");
          setPartnerIdInput("");
        }
      }

      const pending = readPendingPartnerId();
      const finalId = fromUrl > 0 ? fromUrl : pending;
      if (finalId > 0) {
        savePendingPartnerId(finalId);
        setPartnerId(finalId);
        setPartnerIdInput(String(finalId));
      }
      if (mode === "web" && aliasKnownInvalid) {
        toast.error(t("login.partner.notice_title"), { description: t("login.partner.not_found") });
      }
      if (mode === "web" && (finalId > 0 || resolvedAlias)) openModal("register");
    })();
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Forgot cooldown timer on mount
  useEffect(() => {
    function tick() {
      const left = getForgotCooldown();
      setForgotCooldown(left);
      if (left <= 0 && forgotTimerRef.current) { clearInterval(forgotTimerRef.current); forgotTimerRef.current = null; }
    }
    tick();
    if (getForgotCooldown() > 0) forgotTimerRef.current = setInterval(tick, 1000);
    return () => { if (forgotTimerRef.current) clearInterval(forgotTimerRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup widget on unmount
  useEffect(() => {
    return () => {
      const container = document.getElementById("tg-widget-container");
      if (container) container.innerHTML = "";
      try { delete (window as any).__shpunTelegramWidgetAuth; } catch { /* ignore */ }
    };
  }, []);

  // ── Modals ────────────────────────────────────────────────────────────────

  // Reset password modal
  const resetModal = authModal === "reset" ? (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="card modal__card">
        <div className="card__body">
          <div className="modal__head">
            <div className="modal__title">🔐 {t("login.reset.title")}</div>
            <button type="button" className="btn modal__close" onClick={closeModal}
              aria-label={t("common.close")}>×</button>
          </div>
          <div className="modal__content">

            {resetVerifying && (
              <p className="p" style={{ opacity: 0.6 }}>{t("login.reset.verifying")}</p>
            )}

            {!resetVerifying && resetVerifyError && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ textAlign: "center", fontSize: 48 }}>⚠️</div>
                <p className="p" style={{ textAlign: "center", margin: 0 }}>{resetVerifyError}</p>
                <div className="auth__actions">
                  <button type="button" className="btn btn--primary login__btnFull"
                    onClick={() => { setResetVerifyError(null); openModal("forgot"); }}>
                    {t("login.reset.request_new")}
                  </button>
                  <button type="button" className="btn login__btnFull" onClick={closeModal}>
                    {t("login.reset.back")}
                  </button>
                </div>
              </div>
            )}

            {!resetVerifying && !resetVerifyError && resetDone && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
                <div style={{ fontSize: 56 }}>✅</div>
                <p className="p" style={{ textAlign: "center", margin: 0 }}>
                  {t("login.reset.done")}
                </p>
                <div className="auth__actions" style={{ width: "100%" }}>
                  <button type="button" className="btn btn--primary login__btnFull"
                    onClick={() => { closeModal(); openModal("login"); }}>
                    {t("login.reset.login")}
                  </button>
                </div>
              </div>
            )}

            {!resetVerifying && !resetVerifyError && !resetDone && (
              <form className="auth__form" onSubmit={(e) => { e.preventDefault(); void submitReset(); }}>
                <p className="p" style={{ marginBottom: 16 }}>{t("login.reset.text")}</p>

                <div className="field">
                  <label className="field__label">{t("onboarding.password.new")}</label>
                  <div className="pwdfield">
                    <input className="input" placeholder={t("onboarding.password.placeholder")}
                      value={resetPwd1} onChange={(e) => setResetPwd1(e.target.value)}
                      type={resetShowPwd1 ? "text" : "password"}
                      autoComplete="new-password" disabled={resetLoading} />
                    <button type="button" className="btn pwdfield__btn"
                      onClick={() => setResetShowPwd1((v) => !v)} disabled={resetLoading}>
                      {resetShowPwd1 ? "🙈" : "👁"}
                    </button>
                  </div>
                </div>

                {resetPwd1.length > 0 && (
                  <div className="pre pwdmeter" style={{ marginTop: 4 }}>
                    <div className="pwdmeter__row">
                      <span className="pwdmeter__title">{t("profile.password.strength")}</span>
                      <span className="pwdmeter__score">{resetStrength}/5</span>
                    </div>
                    <div className="pwdmeter__tip">{t("profile.password.tip")}</div>
                  </div>
                )}

                <div className="field">
                  <label className="field__label">{t("onboarding.password.repeat")}</label>
                  <div className="pwdfield">
                    <input className="input" placeholder={t("onboarding.password.repeat")}
                      value={resetPwd2} onChange={(e) => setResetPwd2(e.target.value)}
                      type={resetShowPwd2 ? "text" : "password"}
                      autoComplete="new-password" disabled={resetLoading} />
                    <button type="button" className="btn pwdfield__btn"
                      onClick={() => setResetShowPwd2((v) => !v)} disabled={resetLoading}>
                      {resetShowPwd2 ? "🙈" : "👁"}
                    </button>
                  </div>
                </div>

                {resetPwd2.length > 0 && !resetPwdMatch && (
                  <div className="pre" style={{ marginTop: 4 }}>{t("login.password.mismatch")}</div>
                )}
                {resetError && (
                  <div className="pre" style={{ marginTop: 8 }}>{resetError}</div>
                )}

                <div className="auth__actions">
                  <button type="submit" className="btn btn--primary login__btnFull" disabled={!canSubmitReset}>
                    {resetLoading ? t("onboarding.saving") : t("login.reset.submit")}
                  </button>
                </div>
                <div className="login__switchWrap">
                  <button type="button" className="btn login__switchBtn" onClick={closeModal} disabled={resetLoading}>
                    {t("login.reset.back")}
                  </button>
                </div>
              </form>
            )}

          </div>
        </div>
      </div>
    </div>
  ) : null;

  // Forgot password modal
  const forgotModal = authModal === "forgot" ? (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="card modal__card">
        <div className="card__body">
          <div className="modal__head">
            <div className="modal__title">🔑 {t("login.forgot.title")}</div>
            <button type="button" className="btn modal__close" onClick={closeModal}
              disabled={forgotLoading} aria-label={t("common.close")}>×</button>
          </div>
          <div className="modal__content">
            {!forgotSent || !forgotLogin.trim() ? (
              <form className="auth__form" onSubmit={(e) => { e.preventDefault(); void forgotPassword(); }}>
                <p className="p" style={{ marginBottom: 16 }}>
                  {t("login.forgot.text")}
                </p>
                <div className="field">
                  <label className="field__label">Email</label>
                  <input className="input" type="email" placeholder="you@example.com"
                    value={forgotLogin} onChange={(e) => setForgotLogin(e.target.value)}
                    autoComplete="email" inputMode="email" disabled={forgotLoading} />
                </div>
                <div className="auth__actions">
                  <button type="submit" className="btn btn--primary login__btnFull"
                    disabled={forgotLoading || !forgotLogin.trim() || forgotCooldown > 0}>
                    {forgotLoading ? t("login.forgot.sending")
                      : forgotCooldown > 0 ? t("login.forgot.retry_in").replace("{seconds}", String(forgotCooldown))
                      : t("login.forgot.send")}
                  </button>
                </div>
                <div className="login__switchWrap">
                  <button type="button" className="btn login__switchBtn"
                    onClick={() => openModal("login")} disabled={forgotLoading}>
                    {t("login.reset.back")}
                  </button>
                </div>
              </form>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ textAlign: "center", fontSize: 48 }}>📬</div>
                <p className="p" style={{ textAlign: "center", margin: 0 }}>
                  {t("login.forgot.sent")}
                </p>
                <div className="auth__actions">
                  <button type="button" className="btn login__btnFull"
                    onClick={() => void forgotPassword()}
                    disabled={forgotLoading || forgotCooldown > 0}
                    style={{ opacity: forgotCooldown > 0 ? 0.6 : 1 }}>
                    {forgotLoading ? t("login.forgot.sending")
                      : forgotCooldown > 0 ? t("login.forgot.resend_in").replace("{seconds}", String(forgotCooldown))
                      : t("login.forgot.resend")}
                  </button>
                  <button type="button" className="btn login__btnFull"
                    onClick={() => {
                      setForgotSent(false); setForgotLogin("");
                      try { localStorage.removeItem(FORGOT_SENT_KEY); } catch { /* ignore */ }
                      setForgotCooldown(0);
                      if (forgotTimerRef.current) { clearInterval(forgotTimerRef.current); forgotTimerRef.current = null; }
                    }}
                    disabled={forgotLoading}>
                    {t("login.forgot.other_email")}
                  </button>
                  <button type="button" className="btn btn--primary login__btnFull" onClick={closeModal}>
                    {t("login.forgot.ok")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  ) : null;

  const telegramModalChoice = mode !== "telegram" ? (
    <div ref={widgetWrapRef} className="loginRegisterChoice">
      <div className="loginRegisterChoice__icon">
        <LoginIcon src={telegramIconUrl} className="loginHero__svgIcon loginHero__svgIcon--telegram" />
      </div>
      <div className="loginRegisterChoice__body">
        <div className="loginRegisterChoice__title">
          {authModal === "login" ? t("login.telegram.login_choice_title") : t("login.telegram.register_choice_title")}
        </div>
        <div className="loginRegisterChoice__text">
          {authModal === "login" ? t("login.telegram.login_choice_text") : t("login.telegram.register_choice_text")}
        </div>
        {botUsername ? (
          <>
            <div id="tg-widget-container" className="login__widgetBox login__widgetBox--modal" />
            {(tgWidgetState === "idle" || tgWidgetState === "failed") && (
              <button type="button" className="btn loginRegisterChoice__btn"
                onClick={() => void mountTelegramWidget(true)} disabled={loading}>
                {tgWidgetState === "failed"
                  ? t("login.widget.retry.alt")
                  : authModal === "login"
                    ? t("login.telegram.login_choice_cta")
                    : t("login.telegram.register_choice_cta")}
              </button>
            )}
          </>
        ) : (
          <div className="loginRegisterChoice__fallback">{t("login.widget.unavailable.alt")}</div>
        )}
      </div>
    </div>
  ) : null;

  // Password (login / register) modal
  const passwordModal = authModal === "login" || authModal === "register" ? (
    createPortal(<div className="modal loginAuthModal" role="dialog" aria-modal="true">
      <div className="card modal__card loginAuthModal__card">
        <div ref={authModalBodyRef} className="card__body">
          <div className="modal__head">
            <div>
              <div className="modal__title">
                {authModal === "login"
                  ? t("login.password.form_title_login")
                  : t("login.password.form_title_register")}
              </div>
            </div>
            <button type="button" className="btn modal__close" onClick={closeModal}
              disabled={loading} aria-label={t("common.close")}>×</button>
          </div>
          <div className="modal__content">
            {authModal === "register" && !partnerOpen && (normalizePartnerId(partnerIdInput) > 0 || referralAlias) && (
              <div className="login__partnerInvite">
                <div className="login__partnerInviteTitle">{t("login.partner.notice")}</div>
                <div className="login__partnerInviteMeta">
                  {referralAlias
                    ? <>{t("login.partner.name")}: <b>{referralAlias}</b></>
                    : <>{t("login.partner.id")}: <b>{partnerIdInput}</b></>}
                </div>
              </div>
            )}
            {authModal === "login" && telegramModalChoice}
            {mode !== "telegram" && authModal === "login" && (
              <div className="loginModalDivider"><span>{t("login.modal.email_divider")}</span></div>
            )}
            {authModal === "register" && (
              <p className="p" style={{ margin: "0 0 16px" }}>
                {t("login.password.register_intro")}
              </p>
            )}
            <form className={`auth__form ${authModal === "register" ? "loginRegisterForm" : ""}`} onSubmit={(e) => { e.preventDefault(); void (authModal === "login" ? passwordLogin() : passwordRegister()); }}>
              <div className={authModal === "register" ? "field loginRegisterStep" : "field"}>
                <label className="field__label">
                  {authModal === "register" ? t("login.password.register_email") : t("login.password.login_or_email")}
                </label>
                <input
                  ref={loginInputRef}
                  className={`input ${authModal === "register" && emailTouched && registerEmailCode ? "input--invalid" : ""}`}
                  placeholder={authModal === "register" ? t("login.password.login_ph_register") : t("login.password.login_ph")}
                  value={login} onChange={(e) => {
                    setLogin(e.target.value);
                    if (authModal === "login") setPasswordLoginError(null);
                    if (authModal === "register") {
                      setEmailTouched(false);
                      setRegisterEmailServerCode(null);
                    }
                  }}
                  onBlur={() => { if (authModal === "register") setEmailTouched(true); }}
                  autoComplete="username" disabled={loading}
                  inputMode={authModal === "register" ? "email" : "text"}
                  aria-invalid={authModal === "register" && emailTouched && Boolean(registerEmailCode)}
                  aria-describedby={authModal === "register" && emailTouched && registerEmailMessage ? "register-email-error" : undefined}
                />
                {authModal === "register" && emailTouched && registerEmailMessage && (
                  <div id="register-email-error" className="login__fieldError" role="alert">
                    {registerEmailMessage}
                  </div>
                )}
              </div>

              {authModal === "register" && (
                <div className="field loginRegisterStep loginRegisterStep__optional">
                  <label className="field__label">{t("login.password.client")}</label>
                  <input className="input" placeholder={t("login.password.client_ph")}
                    value={clientName} onChange={(e) => setClientName(e.target.value)}
                    autoComplete="name" disabled={loading} />
                </div>
              )}

              <div className={authModal === "register" ? "field loginRegisterStep" : "field"}>
                <label className="field__label">
                  {authModal === "register" ? t("login.password.register_password") : t("login.password.password")}
                </label>
                <div className="pwdfield">
                  <input className="input" placeholder={t("login.password.password_ph")}
                    ref={passwordInputRef}
                    value={password} onChange={(e) => {
                      setPassword(e.target.value);
                      if (authModal === "login") setPasswordLoginError(null);
                    }}
                    type={showPassword ? "text" : "password"}
                    autoComplete={authModal === "login" ? "current-password" : "new-password"}
                    disabled={loading} />
                  <button type="button" className="btn pwdfield__btn"
                    onClick={() => setShowPassword((v) => !v)} disabled={loading}
                    aria-label={showPassword ? t("login.password.hide") : t("login.password.show")}>👁</button>
                </div>
              </div>

              {authModal === "login" && passwordLoginError && (
                <div className="loginAuthError" role="alert" aria-live="assertive">
                  <div className="loginAuthError__title">{t("login.password.login_error_title")}</div>
                  <div className="loginAuthError__text">{passwordLoginError}</div>
                </div>
              )}

              {authModal === "login" && (
                <div className="login__switchWrap" style={{ marginTop: 4 }}>
                  <button type="button" className="btn login__switchBtn"
                    onClick={() => openModal("forgot")} disabled={loading}>
                    {t("login.forgot.title")}
                  </button>
                </div>
              )}

              {authModal === "register" && (
                <>
                  <div className="field loginRegisterStep">
                    <label className="field__label">{t("login.password.register_repeat")}</label>
                    <div className="pwdfield">
                      <input className="input" placeholder={t("login.password.repeat_ph")}
                        value={password2} onChange={(e) => setPassword2(e.target.value)}
                        type={showPassword2 ? "text" : "password"}
                        autoComplete="new-password" disabled={loading} />
                      <button type="button" className="btn pwdfield__btn"
                        onClick={() => setShowPassword2((v) => !v)} disabled={loading}
                        aria-label={showPassword2 ? t("login.password.hide") : t("login.password.show")}>👁</button>
                    </div>
                  </div>
                  <div className="loginPartnerCode">
                    {!partnerOpen ? (
                      <button type="button" className="btn login__switchBtn"
                        onClick={() => { setPartnerError(null); setPartnerOpen(true); }} disabled={loading}>
                        {normalizePartnerId(partnerIdInput) > 0 || referralAlias
                          ? t("login.partner.change")
                          : t("login.partner.have_code")}
                      </button>
                    ) : (
                      <div className="loginPartnerCode__editor">
                        <div className="field">
                          <label className="field__label">{t("login.partner.field")}</label>
                          <input className={`input ${partnerError ? "input--invalid" : ""}`}
                            placeholder={t("login.partner.field_ph")}
                            value={partnerIdInput}
                            onChange={(e) => { setPartnerError(null); setPartnerIdInput(String(e.target.value).trim()); }}
                            autoComplete="off" autoCapitalize="none" spellCheck={false}
                            disabled={loading || partnerApplying} />
                          {partnerError && (
                            <div className="login__fieldError" role="alert">{partnerError}</div>
                          )}
                        </div>
                        <div className="loginPartnerCode__actions">
                          <button type="button" className="btn btn--accent"
                            onClick={() => void applyPartnerCode()}
                            disabled={loading || partnerApplying || !partnerIdInput.trim()}>
                            {partnerApplying ? t("login.partner.applying") : t("login.partner.apply")}
                          </button>
                          <button type="button" className="btn"
                            onClick={cancelPartnerCode} disabled={loading || partnerApplying}>
                            {t("login.partner.cancel")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  {password2.length > 0 && !passwordsMatch && (
                    <div className="pre login__preMt12">{t("login.password.mismatch")}</div>
                  )}
                </>
              )}

              <div className="auth__actions">
                <button type="submit" className="btn btn--primary login__btnFull"
                  disabled={loading || (authModal === "register" && !canPasswordRegister)}>
                  {loading
                    ? (authModal === "login" ? t("login.password.submit_loading") : t("login.password.register_loading"))
                    : (authModal === "login" ? t("login.password.submit") : t("login.password.register_submit"))}
                </button>
              </div>
              <div className="login__switchWrap">
                <button type="button" className="btn login__switchBtn" disabled={loading}
                  onClick={() => openModal(authModal === "login" ? "register" : "login")}>
                  {authModal === "login" ? t("login.password.switch_register") : t("login.password.switch_login")}
                </button>
              </div>
            </form>
            {authModal === "register" && mode !== "telegram" && (
              <>
                <div className="loginModalDivider"><span>{t("login.modal.telegram_register_divider")}</span></div>
                {telegramModalChoice}
              </>
            )}
          </div>
        </div>
      </div>
    </div>, document.body)
  ) : null;

  // ── Loader ────────────────────────────────────────────────────────────────

  if (mode === "detecting") {
    return (
      <div className="app-loader" style={{ opacity: 1, transition: "opacity 180ms ease", pointerEvents: "auto" }}>
        <div className="app-loader__card">
          <div className="app-loader__shine" />
          <div className="app-loader__brandRow"><div className="app-loader__mark" /><div className="app-loader__title">Shpun App</div></div>
          <div className="app-loader__text">{t("login.desc.tg.detecting")}</div>
        </div>
      </div>
    );
  }

  // ── Telegram Mini App UI ──────────────────────────────────────────────────

  if (mode === "telegram") {
    return (
      <div className="section telegram-login-section">
        <div className={`tg-login ${loading ? "tg-login--loading" : "tg-login--fallback"}`}>
          <div className="tg-login__glow" />
          <div className="tg-login__head">
            <div className="tg-login__brand">
              <div className="tg-login__mark" />
              <div>
                <div className="tg-login__title">Shpun App</div>
                <div className="tg-login__subtitle">{t("login.tg.subtitle")}</div>
              </div>
            </div>
            <div className="tg-login__badge">{loading ? t("login.tg.badge.auto") : t("login.tg.badge.manual")}</div>
          </div>

          <div className="tg-login__body">
            <h1 className="tg-login__heading">{loading ? t("login.tg.heading.loading") : t("login.tg.heading.fallback")}</h1>
            <p className="tg-login__text">{loading ? t("login.desc.tg.loading") : t("login.desc.tg.only")}</p>

            <div className="tg-login__steps" aria-label={t("login.tg.steps_label")}>
              <div className={`tg-login__step ${loading ? "is-active" : "is-done"}`}>
                <span className="tg-login__dot" />
                <span>{t("login.tg.step.session")}</span>
              </div>
              <div className={`tg-login__step ${loading ? "" : "is-active"}`}>
                <span className="tg-login__dot" />
                <span>{t("login.tg.step.token")}</span>
              </div>
              <div className="tg-login__step">
                <span className="tg-login__dot" />
                <span>{t("login.tg.step.cabinet")}</span>
              </div>
            </div>

            {!loading && (
              <div className="tg-login__note">{t("login.tg.fallback.note")}</div>
            )}

            {!loading && (
              <div className="auth__actions tg-login__actions">
                <button type="button" className="btn btn--primary login__btnFull"
                  onClick={() => void telegramLoginMiniApp()} disabled={loading}>
                  {loading ? t("login.tg.cta_loading") : t("login.tg.retry")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Web UI ────────────────────────────────────────────────────────────────

  return (
    <div className="section loginPage">
      <div className="loginPage__ambient loginPage__ambient--one" />
      <div className="loginPage__ambient loginPage__ambient--two" />

      <div className="loginHero">
        <section className="loginHero__story" aria-labelledby="login-title">
          <div className="loginHero__topline">
            <span className="loginHero__spark" />
            <span>{t("login.hero.eyebrow")}</span>
          </div>
          <h1 id="login-title" className="loginHero__title">{t("login.title")}</h1>
          <p className="loginHero__lead">{partnerId > 0 ? t("login.desc.web.partner") : t("login.desc.web.short")}</p>

          <div className="loginHero__benefits" aria-label={t("login.what.title")}>
            <div className="loginHero__benefit loginHero__benefit--hot">
              <span className="loginHero__benefitIcon loginHero__benefitIcon--youtube">
                <LoginIcon src={youtubeIconUrl} className="loginHero__svgIcon loginHero__svgIcon--youtube" />
              </span>
              <div>
                <strong>{t("login.hero.benefit.1.title")}</strong>
                <em>{t("login.hero.benefit.1.text")}</em>
              </div>
            </div>
            <div className="loginHero__benefit">
              <span className="loginHero__benefitIcon">
                <LoginIcon src={signalIconUrl} />
              </span>
              <div>
                <strong>{t("login.hero.benefit.2.title")}</strong>
                <em>{t("login.hero.benefit.2.text")}</em>
              </div>
            </div>
            <div className="loginHero__benefit">
              <span className="loginHero__benefitIcon loginHero__benefitIcon--shield">
                <LoginIcon src={shieldIconUrl} className="loginHero__svgIcon loginHero__svgIcon--shield" />
              </span>
              <div>
                <strong>{t("login.hero.benefit.3.title")}</strong>
                <em>{t("login.hero.benefit.3.text")}</em>
              </div>
            </div>
            <div className="loginHero__benefit">
              <span className="loginHero__benefitIcon">
                <LoginIcon src={routerIconUrl} />
              </span>
              <div>
                <strong>{t("login.hero.benefit.4.title")}</strong>
                <em>{t("login.hero.benefit.4.text")}</em>
              </div>
            </div>
          </div>

          <div className="loginHero__orbit" aria-hidden="true">
            <div className="loginHero__planet">
              <div className="loginHero__brandMark">
                <span className="loginHero__brandAura" />
                <svg className="loginHero__brandSvg" viewBox="0 0 120 120" focusable="false" aria-hidden="true">
                  <path
                    className="loginHero__brandShield"
                    fillRule="evenodd"
                    d="M60 7C73.8 17.3 88.9 23.2 106 25.8C105 67.4 88.5 95.8 60 113C31.5 95.8 15 67.4 14 25.8C31.1 23.2 46.2 17.3 60 7ZM60 26C49.9 32.1 39 36.4 27.1 38.8C30.2 66.9 41.4 86.5 60 99C78.6 86.5 89.8 66.9 92.9 38.8C81 36.4 70.1 32.1 60 26Z"
                  />
                  <path
                    className="loginHero__brandBolt"
                    d="M76 28L37 69H58L47 95L85 50H66L76 28Z"
                  />
                </svg>
                <i className="loginHero__brandSpark loginHero__brandSpark--one" />
                <i className="loginHero__brandSpark loginHero__brandSpark--two" />
                <i className="loginHero__brandSpark loginHero__brandSpark--three" />
              </div>
            </div>
            {orbitResources.map((name, idx) => (
              <span
                key={name}
                className={`loginHero__resourceTrack loginHero__resourceTrack--${idx + 1}`}
              >
                <b>{name}</b>
              </span>
            ))}
          </div>
        </section>

        <section className="loginPanel card" aria-label={t("login.title")}>
          <div className="loginPanel__shine" />
          <div className="card__body loginPanel__body">
            <div className="auth__head loginPanel__head">
              <div>
                <div className="loginPanel__badge">{partnerId > 0 ? t("login.partner.notice") : t("login.hero.badge")}</div>
                <h2 className="loginPanel__title">{t("login.hero.panel_title")}</h2>
                <p className="p">{t("login.hero.panel_text")}</p>
              </div>
              <LangSwitch lang={(lang as "ru" | "en") === "en" ? "en" : "ru"}
                setLang={setLang as (v: "ru" | "en") => void} ariaLabel={t("login.lang.aria")} />
            </div>

            {partnerId > 0 && (
              <div className="loginInviteStrip">
                <div className="loginInviteStrip__icon"><IconBonus /></div>
                <div>
                  <div className="loginInviteStrip__title">{t("login.partner.banner")}</div>
                  <div className="loginInviteStrip__meta">
                    {referralAlias
                      ? <>{t("login.partner.name")}: <b>{referralAlias}</b></>
                      : <>{t("login.partner.id")}: <b>{partnerId}</b></>}
                  </div>
                </div>
              </div>
            )}

            <div className="loginEmailBox">
              <div className="loginEmailBox__head">
                <div>
                  <div className="loginEmailBox__title">{t("login.email.card_title")}</div>
                </div>
              </div>
              <div className="loginPanel__quick">
                <button type="button" className="btn loginPanel__primaryAction" onClick={() => openModal("login")} disabled={loading}>
                  <span>{t("login.password.open_login")}</span>
                  <b>→</b>
                </button>
                <button type="button" className="btn loginPanel__secondaryAction" onClick={() => openModal("register")} disabled={loading}>
                  <span>{partnerId > 0 ? t("login.password.open_register_partner") : t("login.password.open_register")}</span>
                  <b>→</b>
                </button>
              </div>
            </div>

            <div className="loginPanel__tiles" aria-label={t("login.what.title")}>
              <div className="loginPanel__tile">
                <span className="loginPanel__tileIcon loginHero__featureIcon--youtube">
                  <LoginIcon src={youtubeIconUrl} className="loginHero__svgIcon loginHero__svgIcon--youtube" />
                </span>
                <div>
                  <strong>{t("login.hero.feature.1.title")}</strong>
                  <em>{t("login.what.1.short")}</em>
                </div>
              </div>
              <div className="loginPanel__tile">
                <span className="loginPanel__tileIcon loginHero__featureIcon--telegram">
                  <LoginIcon src={telegramIconUrl} className="loginHero__svgIcon loginHero__svgIcon--telegram" />
                </span>
                <div>
                  <strong>{t("login.hero.feature.2.title")}</strong>
                  <em>{t("login.what.2.short")}</em>
                </div>
              </div>
              <div className="loginPanel__tile loginPanel__tile--wide">
                <span className="loginPanel__tileIcon">
                  <LoginIcon src={controlsIconUrl} />
                </span>
                <div>
                  <strong>{t("login.hero.feature.3.title")}</strong>
                  <em>{t("login.what.3.short")}</em>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {resetModal}
      {forgotModal}
      {passwordModal}
    </div>
  );
}

export default Login;
