// web/src/pages/Login.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../shared/api/client";
import { refetchMe } from "../app/auth/useMe";
import type { AuthResponse } from "../shared/api/types";
import { useI18n } from "../shared/i18n";
import { toast } from "../shared/ui/toast";
import { normalizeError } from "../shared/api/errorText";
import {
  getTelegramWebApp,
} from "../shared/telegram/sdk";

type TgWebApp = {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
};

function getTelegramInitData(): string | null {
  const tg = getTelegramWebApp() as TgWebApp | null;
  const initData = tg?.initData;
  return initData && initData.length > 0 ? initData : null;
}

function readEnv(key: string): string {
  const v = (import.meta as any).env?.[key];
  return typeof v === "string" ? v.trim() : "";
}

function getTelegramBotUsername(): string {
  const raw = readEnv("VITE_TG_BOT_USERNAME");
  return raw.startsWith("@") ? raw.slice(1).trim() : raw.trim();
}

type Mode = "detecting" | "telegram" | "web";
type AuthModal = "none" | "login" | "register";
type TgWidgetState = "idle" | "loading" | "ready" | "failed";

type RegisterEmailClientCode =
  | "email_required"
  | "email_invalid_format"
  | "email_non_ascii";

const PARTNER_LS_KEY   = "partner_id_pending";
const AUTH_PENDING_KEY = "auth:pending";
const AUTH_PENDING_AT_KEY = "auth:pending_at";
const AUTH_EVER_KEY    = "auth:ever_succeeded";

function setAuthPending(provider: string) {
  try {
    sessionStorage.setItem(AUTH_PENDING_KEY, provider);
    sessionStorage.setItem(AUTH_PENDING_AT_KEY, String(Date.now()));
  } catch { /* ignore */ }
}

function clearAuthPending() {
  try {
    sessionStorage.removeItem(AUTH_PENDING_KEY);
    sessionStorage.removeItem(AUTH_PENDING_AT_KEY);
  } catch { /* ignore */ }
}

function markAuthEverSucceeded() {
  try { localStorage.setItem(AUTH_EVER_KEY, "1"); } catch { /* ignore */ }
}

function hasEverSucceededAuth(): boolean {
  try { return localStorage.getItem(AUTH_EVER_KEY) === "1"; } catch { return false; }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function ensureAuthorizedAfterAuth(attempts = 12, delayMs = 250) {
  for (let i = 0; i < attempts; i++) {
    const me = await refetchMe().catch(() => null);
    if (me) return me;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}

/**
 * Получаем initData от Telegram WebApp.
 * Внутри Mini App window.Telegram.WebApp инициализирован Telegram ДО загрузки
 * нашего JS — initData доступен синхронно. Не грузим SDK динамически.
 */
async function waitTelegramInitData(timeoutMs = 3000): Promise<string | null> {
  // Быстрая синхронная проверка — если initData уже есть, возвращаем сразу
  const immediate = getTelegramInitData();
  if (immediate && immediate.length > 50) {
    try {
      const tg = getTelegramWebApp() as TgWebApp | null;
      tg?.ready?.();
      tg?.expand?.();
    } catch { /* ignore */ }
    return immediate;
  }

  // Если window.Telegram вообще не существует — это точно не Mini App, не ждём
  if (!(window as any)?.Telegram) return null;

  // window.Telegram есть, но initData ещё не готов — ждём (SDK инициализируется)
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(100);
    const initData = getTelegramInitData();
    if (initData && initData.length > 50) {
      try {
        const tg = getTelegramWebApp() as TgWebApp | null;
        tg?.ready?.();
        tg?.expand?.();
      } catch { /* ignore */ }
      return initData;
    }
  }
  return null;
}

function normalizePartnerId(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function readPendingPartnerId(): number {
  try { return normalizePartnerId(String(localStorage.getItem(PARTNER_LS_KEY) ?? "").trim()); }
  catch { return 0; }
}

function savePendingPartnerId(id: number) {
  try { if (id > 0) localStorage.setItem(PARTNER_LS_KEY, String(id)); } catch { /* ignore */ }
}

function clearPendingPartnerId() {
  try { localStorage.removeItem(PARTNER_LS_KEY); } catch { /* ignore */ }
}

function getPartnerIdFromLocation(): number {
  try {
    const fromSearch = normalizePartnerId(new URLSearchParams(window.location.search).get("partner_id"));
    if (fromSearch > 0) return fromSearch;
    const hash = String(window.location.hash ?? "");
    const idx = hash.indexOf("?");
    if (idx >= 0) {
      const fromHash = normalizePartnerId(new URLSearchParams(hash.slice(idx + 1)).get("partner_id"));
      if (fromHash > 0) return fromHash;
    }
  } catch { /* ignore */ }
  return 0;
}

function looksLikeCode(s: string) {
  const v = String(s || "").trim();
  return v.length > 0 && /^[a-z0-9_:.|-]+$/i.test(v) && !/\s/.test(v);
}

function normalizeEmailInput(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function validateRegisterEmailClient(value: string): RegisterEmailClientCode | null {
  const email = normalizeEmailInput(value);
  if (!email) return "email_required";
  if (!/^[\x00-\x7F]+$/.test(email)) return "email_non_ascii";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "email_invalid_format";
  return null;
}

function mapRedirectError(e: string, t: (k: string, fb?: string) => string): string {
  switch (String(e || "").trim()) {
    case "missing_telegram_payload": return t("login.err.missing_payload", "Telegram не передал данные для входа. Попробуйте ещё раз.");
    case "tg_widget_failed":        return t("login.err.tg_widget_failed", "Не удалось войти через Telegram. Попробуйте ещё раз.");
    case "no_shm_session":          return t("login.err.no_shm_session", "Не удалось открыть сессию. Попробуйте ещё раз.");
    case "user_lookup_failed":      return t("login.err.user_lookup_failed", "Не удалось загрузить данные аккаунта. Попробуйте ещё раз.");
    case "not_authenticated":
    case "session_expired":         return t("login.err.not_authenticated", "Нужно войти заново.");
    default:                        return t("login.err.unknown", "Не удалось выполнить вход. Попробуйте ещё раз.");
  }
}

function mapAuthError(raw: string, t: (k: string, fb?: string) => string): string {
  const code = String(raw || "").trim();
  if (!code) return t("login.err.unknown", "Не удалось выполнить вход. Попробуйте ещё раз.");
  if (!looksLikeCode(code)) return code;
  switch (code) {
    case "login_and_password_required": return t("login.err.login_and_password_required", "Введите логин или e-mail и пароль.");
    case "login_required":              return t("login.err.login_required", "Введите логин или e-mail.");
    case "password_required":           return t("login.err.password_required", "Введите пароль.");
    case "invalid_credentials":         return t("login.err.invalid_credentials", "Неверный e-mail или пароль.");
    case "password_too_short":
    case "password_too_short_or_weak":  return t("login.err.password_too_short", "Пароль слишком короткий. Минимум 8 символов.");
    case "login_taken":
    case "user_exists":                 return t("login.err.login_taken", "Этот e-mail уже занят.");
    case "not_authenticated":           return t("login.err.not_authenticated", "Нужно войти заново.");
    case "no_shm_session":              return t("login.err.no_shm_session", "Не удалось открыть сессию. Попробуйте ещё раз.");
    case "init_data_required":          return t("login.err.init_data_required", "Откройте приложение в Telegram для быстрого входа.");
    case "shm_telegram_auth_failed":
    case "shm_telegram_widget_auth_failed": return t("login.err.tg_failed", "Не удалось войти через Telegram. Попробуйте ещё раз.");
    case "shm_register_failed":         return t("login.err.register_failed", "Не удалось создать аккаунт. Попробуйте ещё раз.");
    case "email_required":              return t("login.err.email_required", "Введите e-mail.");
    case "email_non_ascii":             return t("login.err.email_non_ascii", "Используйте e-mail только латиницей.");
    case "email_invalid_format":        return t("login.err.email_invalid_format", "Это не похоже на настоящий e-mail.");
    case "email_disposable":            return t("login.err.email_disposable", "Временные e-mail не подходят.");
    case "email_domain_unresolvable":   return t("login.err.email_domain_unresolvable", "Не удалось подтвердить домен e-mail.");
    default:                            return t("login.err.generic", "Не удалось выполнить вход. Попробуйте ещё раз.");
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

function LangSwitch({ lang, setLang, ariaLabel }: { lang: "ru" | "en"; setLang: (v: "ru" | "en") => void; ariaLabel: string; }) {
  return (
    <div className="seg login__langSwitch" aria-label={ariaLabel}>
      <button type="button" className={`btn seg__btn ${lang === "ru" ? "btn--primary" : ""}`} onClick={() => setLang("ru")}>RU</button>
      <button type="button" className={`btn seg__btn ${lang === "en" ? "btn--primary" : ""}`} onClick={() => setLang("en")}>EN</button>
    </div>
  );
}

export function Login() {
  const { t, lang, setLang } = useI18n();
  const nav = useNavigate();
  const loc: any = useLocation();

  // "detecting" — пока не знаем режим (ждём initData)
  // "telegram"  — Mini App, автологин
  // "web"       — обычный браузер
  const [mode, setMode] = useState<Mode>("detecting");
  const [loading, setLoading] = useState(false);

  const [authModal, setAuthModal] = useState<AuthModal>("none");
  const [login, setLogin] = useState("");
  const [clientName, setClientName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPassword2, setShowPassword2] = useState(false);

  const [partnerId, setPartnerId] = useState<number>(() => readPendingPartnerId());
  const [partnerIdInput, setPartnerIdInput] = useState<string>(() => {
    const p = readPendingPartnerId(); return p > 0 ? String(p) : "";
  });

  const [emailTouched, setEmailTouched] = useState(false);
  const [tgWidgetState, setTgWidgetState] = useState<TgWidgetState>("idle");

  const authInProgressRef  = useRef(false);
  const widgetWrapRef      = useRef<HTMLDivElement | null>(null);
  const referralHandledRef = useRef(false);
  const authOkHandledRef   = useRef(false);
  const redirectErrorHandledRef = useRef<string>("");
  const lastToastRef       = useRef<{ msg: string; at: number }>({ msg: "", at: 0 });

  function toastError(raw: string) {
    const msg = mapAuthError(raw, t);
    const now = Date.now();
    if (lastToastRef.current.msg === msg && now - lastToastRef.current.at < 1200) return;
    lastToastRef.current = { msg, at: now };
    toast.error(t("login.toast.error_title", "Ошибка"), { description: msg });
  }

  const canPasswordLogin = login.trim().length > 0 && password.length > 0;
  const passwordsMatch = password2.length === 0 ? true : password === password2;
  const registerEmailCode = authModal === "register" ? validateRegisterEmailClient(login) : null;
  const registerEmailMessage = registerEmailCode === "email_required" ? t("login.err.email_required", "Введите e-mail.")
    : registerEmailCode === "email_non_ascii" ? t("login.err.email_non_ascii", "Используйте e-mail только латиницей.")
    : registerEmailCode === "email_invalid_format" ? t("login.err.email_invalid_format", "Это не похоже на настоящий e-mail.")
    : "";
  const canPasswordRegister = login.trim().length > 0 && password.length > 0 && password2.length > 0 && password === password2 && !registerEmailCode;
  const botUsername = useMemo(() => getTelegramBotUsername(), []);

  function openModal(next: AuthModal) {
    setAuthModal(next); setPassword(""); setPassword2(""); setShowPassword(false); setShowPassword2(false); setEmailTouched(false);
    if (next !== "register") setClientName("");
    if (next === "register") { const p = readPendingPartnerId(); setPartnerIdInput((p > 0 ? p : partnerId) > 0 ? String(p > 0 ? p : partnerId) : ""); }
  }

  function closeModal() {
    setAuthModal("none"); setPassword(""); setPassword2(""); setShowPassword(false); setShowPassword2(false); setClientName(""); setEmailTouched(false);
  }

  async function goAfterAuth(r?: AuthResponse, provider?: string) {
    if (!r || !(r as any).ok) {
      clearAuthPending();
      toastError(String((r as any)?.error ?? "") || "login_failed");
      return;
    }

    markAuthEverSucceeded();
    setAuthPending(provider || "auth");
    clearPendingPartnerId();
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
      toast.error(t("login.toast.error_title", "Ошибка"), {
        description: t("login.auth.finish_failed", "Не удалось завершить вход. Попробуйте ещё раз."),
      });
      return;
    }

    nav(String(loc?.state?.from ?? "").trim() || "/", { replace: true });
  }

  // ── АВТОЛОГИН В TELEGRAM MINI APP ─────────────────────────────────────────
  // Один эффект без зависимости от mode/tgInitData — запускается один раз.
  // Сам определяет режим и выполняет автологин если это Mini App.
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // waitTelegramInitData сам делает polling пока Telegram не инжектит WebApp.
      // Таймаут 5000ms — Telegram обычно инициализирует SDK за 100-500ms.
      const initData = await waitTelegramInitData(5000);

      if (cancelled) return;

      if (!initData) {
        // За 5 секунд initData не появился — это обычный браузер, не Mini App
        setMode("web");
        return;
      }

      // Это Mini App — устанавливаем режим и логинимся
      setMode("telegram");
      authInProgressRef.current = true;
      setLoading(true);

      try {
        const r = await apiFetch<AuthResponse>("/auth/telegram", {
          method: "POST",
          body: { initData, ...(readPendingPartnerId() > 0 ? { partner_id: readPendingPartnerId() } : {}) },
        });

        if (!cancelled) await goAfterAuth(r, "telegram");
      } catch {
        if (!cancelled) clearAuthPending();
        // Ошибку при автологине не показываем — пользователь увидит кнопку повтора
      } finally {
        // ВАЖНО: всегда сбрасываем флаг чтобы ручной логин не был заблокирован
        authInProgressRef.current = false;
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ручной логин в Mini App ───────────────────────────────────────────────
  async function telegramLoginMiniApp() {
    if (authInProgressRef.current) return;
    authInProgressRef.current = true;
    setLoading(true);

    try {
      let initData = getTelegramInitData();
      if (!initData) initData = await waitTelegramInitData(3000);

      if (!initData) {
        toastError(t("error.open_in_tg", "Откройте приложение в Telegram для быстрого входа."));
        return;
      }

      const r = await apiFetch<AuthResponse>("/auth/telegram", {
        method: "POST",
        body: { initData, ...(partnerId > 0 ? { partner_id: partnerId } : {}) },
      });
      await goAfterAuth(r, "telegram");
    } catch (e: unknown) {
      clearAuthPending();
      toastError(errorToAuthRaw(e, t("error.telegram_login_failed", "Не удалось войти через Telegram.")));
    } finally {
      setLoading(false);
      authInProgressRef.current = false;
    }
  }

  // ── Остальные функции (без изменений) ─────────────────────────────────────

  async function passwordLogin() {
    if (mode === "telegram") {
      toast.error(t("login.toast.error_title", "Ошибка"), { description: t("login.tg.only.password_disabled", "В mini app используйте вход через Telegram.") });
      return;
    }
    if (!canPasswordLogin) { toastError("login_and_password_required"); return; }
    setLoading(true);
    try {
      const r = await apiFetch<AuthResponse>("/auth/password", { method: "POST", body: { login: login.trim(), password, mode: "login" } });
      await goAfterAuth(r, "password");
    } catch (e: unknown) {
      clearAuthPending();
      toastError(errorToAuthRaw(e, t("error.password_login_failed", "Не удалось войти по паролю.")));
    } finally { setLoading(false); }
  }

  async function passwordRegister() {
    if (mode === "telegram") {
      toast.error(t("login.toast.error_title", "Ошибка"), { description: t("login.tg.only.password_disabled", "В mini app используйте вход через Telegram.") });
      return;
    }
    setEmailTouched(true);
    if (registerEmailCode) { toastError(registerEmailCode); return; }
    if (!canPasswordRegister) {
      if (!login.trim() || !password) toastError("login_and_password_required");
      else if (!passwordsMatch) toastError(t("login.password.mismatch", "Пароли не совпадают."));
      return;
    }
    const finalPartnerId = normalizePartnerId(partnerIdInput);
    if (partnerIdInput.trim() && finalPartnerId <= 0) { toastError(t("login.partner.invalid", "Партнёрский код должен быть положительным числом.")); return; }
    setLoading(true);
    try {
      const r = await apiFetch<AuthResponse>("/auth/password", {
        method: "POST",
        body: { login: normalizeEmailInput(login), password, mode: "register", client: clientName.trim() || normalizeEmailInput(login), ...(finalPartnerId > 0 ? { partner_id: finalPartnerId } : {}) },
      });
      await goAfterAuth(r, "password");
    } catch (e: unknown) {
      clearAuthPending();
      toastError(errorToAuthRaw(e, t("error.password_register_failed", "Не удалось создать аккаунт.")));
    } finally { setLoading(false); }
  }

  async function telegramLoginWidget(widgetUser: Record<string, any>) {
    if (authInProgressRef.current) return;
    authInProgressRef.current = true;
    setLoading(true);
    try {
      const r = await apiFetch<AuthResponse>("/auth/telegram_widget", { method: "POST", body: { ...widgetUser, ...(partnerId > 0 ? { partner_id: partnerId } : {}) } });
      await goAfterAuth(r, "telegram");
    } catch (e: unknown) {
      clearAuthPending();
      toastError(errorToAuthRaw(e, t("error.telegram_login_failed", "Не удалось войти через Telegram.")));
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
        script.async = true;
        script.src = "https://telegram.org/js/telegram-widget.js?22";
        script.setAttribute("data-telegram-login", botUsername);
        script.setAttribute("data-size", "large");
        script.setAttribute("data-userpic", "true");
        script.setAttribute("data-request-access", "write");
        script.setAttribute("data-onauth", "__shpunTelegramWidgetAuth(user)");
        const tid = window.setTimeout(() => reject(new Error("tg_widget_timeout")), 1500);
        script.onload = () => { window.clearTimeout(tid); resolve(); };
        script.onerror = () => { window.clearTimeout(tid); reject(new Error("tg_widget_failed")); };
        container.appendChild(script);
      });
      setTgWidgetState("ready");
    } catch { container.innerHTML = ""; setTgWidgetState("failed"); }
  }

  // ── Effects (referral, auth_ok redirect, error redirect) ──────────────────

  useEffect(() => {
    const sp = new URLSearchParams(String(loc?.search ?? ""));
    const a = String(sp.get("a") ?? "").trim().toLowerCase();
    const p = String(sp.get("p") ?? "").trim().toLowerCase();
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
      toast.error(t("login.toast.error_title", "Ошибка"), { description: t("login.auth.finish_failed", "Не удалось завершить вход. Попробуйте ещё раз.") });
    })();
  }, [loc?.search, nav, t]);

  useEffect(() => {
    const sp = new URLSearchParams(String(loc?.search ?? ""));
    const e = String(sp.get("e") ?? "").trim();
    if (!e || redirectErrorHandledRef.current === e) return;
    redirectErrorHandledRef.current = e;
    const hadPreviousAuth = hasEverSucceededAuth() || !!sessionStorage.getItem(AUTH_PENDING_KEY);
    const sessionRelated = e === "not_authenticated" || e === "session_expired" || e === "no_shm_session";
    if (sessionRelated && !hadPreviousAuth) return;
    const msg = mapRedirectError(e, t);
    if (msg) toastError(msg);
  }, [loc?.search, t]);

  useEffect(() => {
    if (referralHandledRef.current) return;
    referralHandledRef.current = true;
    const fromUrl = getPartnerIdFromLocation();
    const pending = readPendingPartnerId();
    const finalPartnerId = fromUrl > 0 ? fromUrl : pending;
    if (finalPartnerId > 0) {
      savePendingPartnerId(finalPartnerId);
      setPartnerId(finalPartnerId);
      setPartnerIdInput(String(finalPartnerId));
      if (mode === "web") setAuthModal("register");
    }
  }, [mode]);

  useEffect(() => {
    return () => {
      const container = document.getElementById("tg-widget-container");
      if (container) container.innerHTML = "";
      try { delete (window as any).__shpunTelegramWidgetAuth; } catch { /* ignore */ }
    };
  }, []);

  // ── Рендер ────────────────────────────────────────────────────────────────

  const passwordModal = authModal !== "none" ? (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="card modal__card">
        <div className="card__body">
          <div className="modal__head">
            <div>
              <div className="modal__title">
                {authModal === "login" ? t("login.password.form_title_login", "Вход по логину или e-mail и паролю") : t("login.password.form_title_register", "Создать аккаунт")}
              </div>
              <p className="p">
                {authModal === "login" ? t("login.password.tip", "Используйте этот способ, если входите не через Telegram.") : t("login.password.register_tip", "Этот способ подойдёт для входа из браузера.")}
              </p>
            </div>
            <button type="button" className="btn modal__close" onClick={closeModal} disabled={loading} aria-label={t("common.close", "Закрыть")}>×</button>
          </div>
          <div className="modal__content">
            {authModal === "register" && normalizePartnerId(partnerIdInput) > 0 && (
              <div className="pre">{t("login.partner.notice", "Вы пришли по приглашению. Партнёрская ссылка будет учтена при регистрации.")}</div>
            )}
            <form className="auth__form" onSubmit={(e) => { e.preventDefault(); void (authModal === "login" ? passwordLogin() : passwordRegister()); }}>
              <div className="field">
                <label className="field__label">{authModal === "register" ? t("login.password.login", "E-mail") : t("login.password.login_or_email", "Логин или e-mail")}</label>
                <input
                  className={`input ${authModal === "register" && emailTouched && registerEmailCode ? "input--invalid" : ""}`}
                  placeholder={authModal === "register" ? t("login.password.login_ph_register", "Введите ваш e-mail") : t("login.password.login_ph", "Введите логин или e-mail")}
                  value={login} onChange={(e) => setLogin(e.target.value)}
                  onBlur={() => { if (authModal === "register") setEmailTouched(true); }}
                  autoComplete="username" disabled={loading}
                  inputMode={authModal === "register" ? "email" : "text"}
                />
                {authModal === "register" && emailTouched && registerEmailMessage && <div className="login__fieldError">{registerEmailMessage}</div>}
              </div>
              {authModal === "register" && (
                <div className="field">
                  <label className="field__label">{t("login.password.client", "Имя клиента (необязательно)")}</label>
                  <input className="input" placeholder={t("login.password.client_ph", "Как к вам обращаться")} value={clientName} onChange={(e) => setClientName(e.target.value)} autoComplete="name" disabled={loading} />
                </div>
              )}
              <div className="field">
                <label className="field__label">{t("login.password.password", "Пароль")}</label>
                <div className="pwdfield">
                  <input className="input" placeholder={t("login.password.password_ph", "Введите пароль")} value={password} onChange={(e) => setPassword(e.target.value)}
                    type={showPassword ? "text" : "password"} autoComplete={authModal === "login" ? "current-password" : "new-password"} disabled={loading} />
                  <button type="button" className="btn pwdfield__btn" onClick={() => setShowPassword(v => !v)} disabled={loading} aria-label={showPassword ? "Скрыть" : "Показать"}>👁</button>
                </div>
              </div>
              {authModal === "register" && (
                <>
                  <div className="field">
                    <label className="field__label">{t("login.password.repeat", "Повторите пароль")}</label>
                    <div className="pwdfield">
                      <input className="input" placeholder={t("login.password.repeat_ph", "Повторите пароль")} value={password2} onChange={(e) => setPassword2(e.target.value)}
                        type={showPassword2 ? "text" : "password"} autoComplete="new-password" disabled={loading} />
                      <button type="button" className="btn pwdfield__btn" onClick={() => setShowPassword2(v => !v)} disabled={loading} aria-label={showPassword2 ? "Скрыть" : "Показать"}>👁</button>
                    </div>
                  </div>
                  <div className="field">
                    <label className="field__label">{t("login.partner.field", "Партнёрский код (необязательно)")}</label>
                    <input className="input" placeholder={t("login.partner.field_ph", "Введите ID партнёра")} value={partnerIdInput}
                      onChange={(e) => setPartnerIdInput(String(e.target.value).replace(/[^\d]/g, ""))} inputMode="numeric" autoComplete="off" disabled={loading} />
                  </div>
                </>
              )}
              {authModal === "register" && password2.length > 0 && !passwordsMatch && <div className="pre login__preMt12">{t("login.password.mismatch", "Пароли не совпадают.")}</div>}
              <div className="auth__actions">
                <button type="submit" className="btn btn--primary login__btnFull" disabled={loading || (authModal === "login" ? !canPasswordLogin : !canPasswordRegister)}>
                  {loading ? (authModal === "login" ? t("login.password.submit_loading", "Входим…") : t("login.password.register_loading", "Создаём аккаунт…"))
                    : (authModal === "login" ? t("login.password.submit", "Войти") : t("login.password.register_submit", "Создать аккаунт"))}
                </button>
              </div>
              <div className="login__switchWrap">
                <button type="button" className="btn login__switchBtn" disabled={loading} onClick={() => openModal(authModal === "login" ? "register" : "login")}>
                  {authModal === "login" ? t("login.password.switch_register", "Создать аккаунт") : t("login.password.switch_login", "Уже есть аккаунт? Войти")}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  // ── Определяем режим — красивый лоадер ───────────────────────────────────
  if (mode === "detecting") {
    return (
      <div className="app-loader" style={{ opacity: 1, transition: "opacity 180ms ease", pointerEvents: "auto" }}>
        <div className="app-loader__card">
          <div className="app-loader__shine" />
          <div className="app-loader__brandRow">
            <div className="app-loader__mark" />
            <div className="app-loader__title">Shpun App</div>
          </div>
          <div className="app-loader__text">
            {t("login.desc.tg.detecting", "Загрузка…")}
          </div>
        </div>
      </div>
    );
  }

  // ── Telegram Mini App UI ──────────────────────────────────────────────────
  if (mode === "telegram") {
    // Пока идёт автологин — показываем тот же лоадер что и в AuthGate
    if (loading) {
      return (
        <div className="app-loader" style={{ opacity: 1, transition: "opacity 180ms ease", pointerEvents: "auto" }}>
          <div className="app-loader__card">
            <div className="app-loader__shine" />
            <div className="app-loader__brandRow">
              <div className="app-loader__mark" />
              <div className="app-loader__title">Shpun App</div>
            </div>
            <div className="app-loader__text">
              {t("login.desc.tg.loading", "Выполняем вход через Telegram…")}
            </div>
          </div>
        </div>
      );
    }

    // Автологин не удался — показываем карточку с кнопкой повтора
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="app-loader__brandRow" style={{ marginBottom: 12 }}>
              <div className="app-loader__mark" />
              <div className="app-loader__title" style={{ fontSize: 20 }}>Shpun App</div>
            </div>

            <p className="p">
              {t("login.desc.tg.only", "Вход выполняется через Telegram. Нажмите кнопку ниже если не произошло автоматически.")}
            </p>

            <div className="auth__actions" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn btn--primary login__btnFull"
                onClick={() => void telegramLoginMiniApp()}
                disabled={loading}
              >
                {loading ? t("login.tg.cta_loading", "Входим…") : t("login.tg.retry", "Войти через Telegram")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Web UI ────────────────────────────────────────────────────────────────
  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div className="auth__head">
            <div>
              <h1 className="h1">{t("login.title", "Вход в Shpun App")}</h1>
              <p className="p">{partnerId > 0 ? t("login.desc.web.partner", "Ваш личный кабинет для сервисов Shpun. Войдите или создайте аккаунт по приглашению.") : t("login.desc.web.short", "Ваш личный кабинет для сервисов Shpun.")}</p>
            </div>
            <LangSwitch lang={(lang as "ru" | "en") === "en" ? "en" : "ru"} setLang={setLang as (v: "ru" | "en") => void} ariaLabel={t("login.lang.aria", "Язык")} />
          </div>

          <div className="pre login__headerCard">
            <div className="login__whatTitle">{t("login.what.title", "Что такое Shpun App")}</div>
            <div className="login__whatList">
              <div>✅ {t("login.what.1.short", "Личный кабинет для сервисов Shpun.")}</div>
              <div>💳 {t("login.what.2.short", "Баланс, оплаты и бонусы.")}</div>
              <div>⚙️ {t("login.what.3.short", "Услуги, настройки и уведомления.")}</div>
            </div>
          </div>

          {partnerId > 0 && <div className="pre login__preMt12">{t("login.partner.banner", "Приглашение сохранено. Для нового пользователя сразу открыта регистрация, и партнёрка будет учтена.")}</div>}

          <div className="auth__divider login__dividerMt14"><span>{t("login.divider.password", "E-mail и пароль")}</span></div>
          <div className="auth__actions">
            <button type="button" className="btn login__btnFull" onClick={() => openModal("login")} disabled={loading}>{t("login.password.open_login", "Войти по логину или e-mail")}</button>
            <button type="button" className="btn btn--primary login__btnFull" onClick={() => openModal("register")} disabled={loading}>
              {partnerId > 0 ? t("login.password.open_register_partner", "Зарегистрироваться по приглашению") : t("login.password.open_register", "Создать аккаунт")}
            </button>
          </div>

          <div className="auth__divider login__dividerMt14"><span>{t("login.divider.telegram", "Вход через Telegram")}</span></div>
          <div ref={widgetWrapRef} className="login__dividerMt14">
            <div className="pre login__preMb10">
              {tgWidgetState === "failed" ? t("login.widget.failed.soft", "Вход через Telegram сейчас может работать нестабильно. Попробуйте ещё раз или используйте другой способ входа.")
                : tgWidgetState === "loading" ? t("login.widget.loading", "Пробуем загрузить вход через Telegram...")
                : t("login.widget.tip.secondary", "Вы можете войти через Telegram или выбрать другой способ входа ниже.")}
            </div>
            {!botUsername ? (
              <div className="pre">{t("login.widget.unavailable.alt", "Вход через Telegram сейчас недоступен. Используйте другой способ входа ниже.")}</div>
            ) : (
              <>
                <div id="tg-widget-container" className="login__widgetBox" />
                {(tgWidgetState === "idle" || tgWidgetState === "failed") && (
                  <div className="auth__actions">
                    <button type="button" className="btn login__btnFull" onClick={() => void mountTelegramWidget(true)} disabled={loading}>
                      {tgWidgetState === "failed" ? t("login.widget.retry.alt", "Попробовать через Telegram ещё раз") : t("login.widget.open.alt", "Продолжить через Telegram")}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="auth__divider login__dividerMt14"><span>{t("login.divider.providers", "Другие способы")}</span></div>
          <div className="auth__providers">
            <button className="btn auth__provider login__providerBtn" onClick={() => { if (tgWidgetState === "idle" || tgWidgetState === "failed") void mountTelegramWidget(true); widgetWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }} disabled={loading} type="button">
              <span className="auth__providerIcon">✈️</span>
              <span className="auth__providerText">Telegram<span className="auth__providerHint">{tgWidgetState === "loading" ? t("login.providers.telegram.hint.loading", "загрузка...") : t("login.providers.telegram.hint.web", "открыть вход")}</span></span>
              <span className="auth__providerRight">→</span>
            </button>
            <button className="btn auth__provider login__providerBtn" disabled={true} type="button" title={t("login.providers.soon", "Скоро")}>
              <span className="auth__providerIcon">🟦</span><span className="auth__providerText">Google<span className="auth__providerHint">{t("login.providers.google.hint", "скоро")}</span></span><span className="auth__providerRight">🔒</span>
            </button>
            <button className="btn auth__provider login__providerBtn" disabled={true} type="button" title={t("login.providers.soon", "Скоро")}>
              <span className="auth__providerIcon">🟨</span><span className="auth__providerText">Yandex<span className="auth__providerHint">{t("login.providers.yandex.hint", "скоро")}</span></span><span className="auth__providerRight">🔒</span>
            </button>
          </div>
        </div>
      </div>
      {passwordModal}
    </div>
  );
}

export default Login;