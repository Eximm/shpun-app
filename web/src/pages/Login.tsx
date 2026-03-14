import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../shared/api/client";
import { refetchMe } from "../app/auth/useMe";
import type { AuthResponse } from "../shared/api/types";
import { useI18n } from "../shared/i18n";
import { toast } from "../shared/ui/toast";
import { normalizeError } from "../shared/api/errorText";

type TgWebApp = {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
};

function getTelegramWebApp(): TgWebApp | null {
  const tg = (window as any)?.Telegram?.WebApp as TgWebApp | undefined;
  return tg ?? null;
}

function getTelegramInitData(): string | null {
  const tg = getTelegramWebApp();
  const initData = tg?.initData;
  return initData && initData.length > 0 ? initData : null;
}

function readEnv(key: string): string {
  const v = (import.meta as any).env?.[key];
  return typeof v === "string" ? v.trim() : "";
}

function getTelegramBotUsername(): string {
  const raw = readEnv("VITE_TG_BOT_USERNAME");
  const bot = raw.startsWith("@") ? raw.slice(1).trim() : raw.trim();
  return bot;
}

type Mode = "telegram" | "web";
type PassMode = "login" | "register";

const PARTNER_LS_KEY = "partner_id_pending";
const AUTH_PENDING_KEY = "auth:pending";
const AUTH_PENDING_AT_KEY = "auth:pending_at";

function setAuthPending(provider: string) {
  try {
    sessionStorage.setItem(AUTH_PENDING_KEY, provider);
    sessionStorage.setItem(AUTH_PENDING_AT_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

function readPendingPartnerId(): number {
  try {
    const v = String(localStorage.getItem(PARTNER_LS_KEY) ?? "").trim();
    if (!v) return 0;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
  } catch {
    return 0;
  }
}

function clearPendingPartnerId() {
  try {
    localStorage.removeItem(PARTNER_LS_KEY);
  } catch {
    // ignore
  }
}

function looksLikeCode(s: string) {
  const v = String(s || "").trim();
  if (!v) return false;
  return /^[a-z0-9_:.|-]+$/i.test(v) && !/\s/.test(v);
}

function mapRedirectError(e: string, t: (k: string, fb?: string) => string): string {
  const code = String(e || "").trim();
  if (!code) return "";

  switch (code) {
    case "missing_telegram_payload":
      return t("login.err.missing_payload", "Telegram не передал данные для входа. Попробуйте ещё раз.");
    case "tg_widget_failed":
      return t("login.err.tg_widget_failed", "Не удалось войти через Telegram. Попробуйте ещё раз.");
    case "no_shm_session":
      return t("login.err.no_shm_session", "Не удалось открыть сессию. Попробуйте ещё раз.");
    case "user_lookup_failed":
      return t("login.err.user_lookup_failed", "Не удалось загрузить данные аккаунта. Попробуйте ещё раз.");
    default:
      return t("login.err.unknown", "Не удалось выполнить вход. Попробуйте ещё раз.");
  }
}

function mapAuthError(raw: string, t: (k: string, fb?: string) => string): string {
  const code = String(raw || "").trim();
  if (!code) return t("login.err.unknown", "Не удалось выполнить вход. Попробуйте ещё раз.");

  if (!looksLikeCode(code)) return code;

  switch (code) {
    case "login_and_password_required":
      return t("login.err.login_and_password_required", "Введите логин и пароль.");
    case "login_required":
      return t("login.err.login_required", "Введите логин.");
    case "password_required":
      return t("login.err.password_required", "Введите пароль.");
    case "invalid_credentials":
      return t("login.err.invalid_credentials", "Неверный логин или пароль.");
    case "password_too_short":
    case "password_too_short_or_weak":
      return t("login.err.password_too_short", "Пароль слишком короткий. Минимум 8 символов.");
    case "login_taken":
    case "user_exists":
      return t("login.err.login_taken", "Этот логин уже занят.");
    case "not_authenticated":
      return t("login.err.not_authenticated", "Нужно войти заново.");
    case "no_shm_session":
      return t("login.err.no_shm_session", "Не удалось открыть сессию. Попробуйте ещё раз.");
    case "init_data_required":
      return t("login.err.init_data_required", "Откройте приложение в Telegram для быстрого входа.");
    case "shm_telegram_auth_failed":
    case "shm_telegram_widget_auth_failed":
      return t("login.err.tg_failed", "Не удалось войти через Telegram. Попробуйте ещё раз.");
    default:
      return t("login.err.generic", "Не удалось выполнить вход. Попробуйте ещё раз.");
  }
}

function errorToAuthRaw(e: unknown, fallback: string): string {
  if (typeof e === "string") return e;

  if (e && typeof e === "object") {
    const any = e as any;
    const code = typeof any.error === "string" ? any.error : typeof any.code === "string" ? any.code : "";
    if (code) return code;
    const nested = any?.json?.error || any?.data?.error || any?.body?.error;
    if (typeof nested === "string" && nested) return nested;
  }

  const n = normalizeError(e);

  if (n.status === 401 || n.status === 403 || n.code === "not_authenticated") return "not_authenticated";

  if ((n.code || "").toLowerCase().startsWith("shm_") || (n.code || "").toLowerCase() === "shm_error") {
    return "login_failed";
  }

  if (n.description && !looksLikeCode(n.description)) return n.description;

  return fallback;
}

function LangSwitch({
  lang,
  setLang,
  ariaLabel,
}: {
  lang: "ru" | "en";
  setLang: (v: "ru" | "en") => void;
  ariaLabel: string;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 6,
        alignItems: "center",
        flexWrap: "nowrap",
      }}
      aria-label={ariaLabel}
    >
      <button
        type="button"
        className={`btn ${lang === "ru" ? "btn--primary" : ""}`}
        onClick={() => setLang("ru")}
      >
        RU
      </button>
      <button
        type="button"
        className={`btn ${lang === "en" ? "btn--primary" : ""}`}
        onClick={() => setLang("en")}
      >
        EN
      </button>
    </div>
  );
}

export function Login() {
  const { t, lang, setLang } = useI18n();
  const nav = useNavigate();
  const loc: any = useLocation();

  const initDataNow = getTelegramInitData();
  const mode: Mode = initDataNow ? "telegram" : "web";

  const [tgInitData, setTgInitData] = useState<string | null>(initDataNow);
  const [loading, setLoading] = useState(false);

  const [passMode, setPassMode] = useState<PassMode>("login");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const partnerId = useMemo(() => readPendingPartnerId(), []);

  const autoLoginStarted = useRef(false);
  const widgetWrapRef = useRef<HTMLDivElement | null>(null);

  const lastToastRef = useRef<{ msg: string; at: number }>({ msg: "", at: 0 });
  function toastError(raw: string) {
    const msg = mapAuthError(raw, t);
    const now = Date.now();
    if (lastToastRef.current.msg === msg && now - lastToastRef.current.at < 1200) return;
    lastToastRef.current = { msg, at: now };

    toast.error(t("login.toast.error_title", "Ошибка"), { description: msg });
  }

  const canPasswordLogin = login.trim().length > 0 && password.length > 0;
  const passwordsMatch = password2.length === 0 ? true : password === password2;
  const canPasswordRegister =
    login.trim().length > 0 && password.length > 0 && password2.length > 0 && password === password2;

  const botUsername = useMemo(() => getTelegramBotUsername(), []);

  function goAfterAuth(r?: AuthResponse, provider?: string) {
    const ok = !!r && (r as any).ok === true;

    if (!ok) {
      const msg = String((r as any)?.error ?? "").trim();
      toastError(msg || "login_failed");
      return;
    }

    setAuthPending(provider || "auth");
    refetchMe().catch(() => {});
    clearPendingPartnerId();

    const nextRaw = String((r as any).next ?? "home").trim();
    const next = nextRaw || "home";
    const loginFromApi = String((r as any).login ?? "").trim();

    if (next === "set_password") {
      nav("/set-password", {
        replace: true,
        state: { login: loginFromApi },
      });
      return;
    }

    const to = String(loc?.state?.from ?? "").trim() || "/";
    nav(to, { replace: true });
  }

  async function passwordLogin() {
    if (!canPasswordLogin) {
      toastError("login_and_password_required");
      return;
    }

    setAuthPending("password");

    setLoading(true);
    try {
      const r = await apiFetch<AuthResponse>("/auth/password", {
        method: "POST",
        body: {
          login: login.trim(),
          password,
          mode: "login",
          ...(partnerId ? { partner_id: partnerId } : {}),
        },
      });
      goAfterAuth(r, "password");
    } catch (e: unknown) {
      toastError(errorToAuthRaw(e, t("error.password_login_failed", "Не удалось войти по паролю.")));
    } finally {
      setLoading(false);
    }
  }

  async function passwordRegister() {
    if (!canPasswordRegister) {
      if (!login.trim() || !password) toastError("login_and_password_required");
      else if (!passwordsMatch) toastError(t("login.password.mismatch", "Пароли не совпадают."));
      return;
    }

    setAuthPending("password");

    setLoading(true);
    try {
      const r = await apiFetch<AuthResponse>("/auth/password", {
        method: "POST",
        body: {
          login: login.trim(),
          password,
          mode: "register",
          ...(partnerId ? { partner_id: partnerId } : {}),
        },
      });
      goAfterAuth(r, "password");
    } catch (e: unknown) {
      toastError(errorToAuthRaw(e, t("error.password_register_failed", "Не удалось создать аккаунт.")));
    } finally {
      setLoading(false);
    }
  }

  async function telegramLoginMiniApp() {
    const initData = tgInitData || getTelegramInitData();
    if (!initData) {
      toastError(t("error.open_in_tg", "Откройте приложение в Telegram для быстрого входа."));
      return;
    }

    setAuthPending("telegram");

    setLoading(true);
    try {
      const r = await apiFetch<AuthResponse>("/auth/telegram", {
        method: "POST",
        body: {
          initData,
          ...(partnerId ? { partner_id: partnerId } : {}),
        },
      });
      goAfterAuth(r, "telegram");
    } catch (e: unknown) {
      toastError(errorToAuthRaw(e, t("error.telegram_login_failed", "Не удалось войти через Telegram.")));
    } finally {
      setLoading(false);
    }
  }

  async function telegramLoginWidget(widgetUser: Record<string, any>) {
    setAuthPending("telegram");

    setLoading(true);
    try {
      const r = await apiFetch<AuthResponse>("/auth/telegram_widget", {
        method: "POST",
        body: {
          ...widgetUser,
          ...(partnerId ? { partner_id: partnerId } : {}),
        },
      });
      goAfterAuth(r, "telegram");
    } catch (e: unknown) {
      toastError(errorToAuthRaw(e, t("error.telegram_login_failed", "Не удалось войти через Telegram.")));
    } finally {
      setLoading(false);
    }
  }

  function focusWidget() {
    widgetWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    const sp = new URLSearchParams(String(loc?.search ?? ""));
    const a = String(sp.get("a") ?? "").trim().toLowerCase();
    const p = String(sp.get("p") ?? "").trim().toLowerCase();

    if (a === "auth_ok") {
      const provider = p || "auth";

      setAuthPending(provider);
      refetchMe().catch(() => {});

      sp.delete("a");
      sp.delete("p");

      const nextSearch = sp.toString();
      const nextUrl = window.location.pathname + (nextSearch ? `?${nextSearch}` : "") + window.location.hash;

      window.history.replaceState(null, "", nextUrl);

      nav("/", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc?.search]);

  useEffect(() => {
    const sp = new URLSearchParams(String(loc?.search ?? ""));
    const e = sp.get("e") ?? "";
    if (!e) return;

    const msg = mapRedirectError(e, t);
    if (msg) toastError(msg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc?.search]);

  useEffect(() => {
    const tg = getTelegramWebApp();
    tg?.ready?.();
    tg?.expand?.();

    if (mode === "telegram") {
      const pull = () => setTgInitData(getTelegramInitData());

      pull();
      const t1 = window.setTimeout(pull, 50);
      const t2 = window.setTimeout(pull, 200);
      const t3 = window.setTimeout(pull, 600);

      if (!autoLoginStarted.current) {
        autoLoginStarted.current = true;
        window.setTimeout(() => {
          telegramLoginMiniApp();
        }, 180);
      }

      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
        window.clearTimeout(t3);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode !== "web") return;

    const containerId = "tg-widget-container";
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = "";
    if (!botUsername) return;

    const w = window as any;
    w.__shpunTelegramWidgetAuth = (user: Record<string, any>) => {
      telegramLoginWidget(user);
    };

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-userpic", "true");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "__shpunTelegramWidgetAuth(user)");

    container.appendChild(script);

    return () => {
      container.innerHTML = "";
      try {
        delete (window as any).__shpunTelegramWidgetAuth;
      } catch {
        // ignore
      }
    };
  }, [mode, botUsername, partnerId]);

  const headerCard = (
    <div className="pre login__headerCard">
      <div className="login__whatTitle">{t("login.what.title", "Что такое Shpun App")}</div>

      <div className="login__whatList">
        <div>✅ {t("login.what.1", "Shpun App — это ваш личный кабинет для управления сервисами Shpun.")}</div>
        <div>💳 {t("login.what.2", "Здесь собраны баланс, услуги, оплаты, бонусы и важные уведомления.")}</div>
        <div>⚙️ {t("login.what.3", "Вы можете быстро открыть нужный раздел и управлять аккаунтом в одном месте.")}</div>
        <div>✈️ {t("login.what.4", "Через Telegram вход занимает всего пару секунд.")}</div>
      </div>
    </div>
  );

  const passwordDetails = (
    <details className="auth__details">
      <summary className="auth__detailsSummary">{t("login.password.summary", "Войти по логину и паролю")}</summary>

      <form
        className="auth__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (passMode === "login") passwordLogin();
          else passwordRegister();
        }}
      >
        <div className="login__formTitle">
          {passMode === "login"
            ? t("login.password.form_title_login", "Вход по логину и паролю")
            : t("login.password.form_title_register", "Регистрация")}
        </div>

        <div className="auth__grid">
          <label className="field">
            <span className="field__label">{t("login.password.login", "Логин")}</span>
            <input
              className="input"
              placeholder={t("login.password.login_ph", "Введите логин")}
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              disabled={loading}
              inputMode="text"
            />
          </label>

          <label className="field">
            <span className="field__label">{t("login.password.password", "Пароль")}</span>
            <input
              className="input"
              placeholder={t("login.password.password_ph", "Введите пароль")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={passMode === "login" ? "current-password" : "new-password"}
              disabled={loading}
            />
          </label>

          {passMode === "register" && (
            <label className="field">
              <span className="field__label">{t("login.password.repeat", "Повторите пароль")}</span>
              <input
                className="input"
                placeholder={t("login.password.repeat_ph", "Повторите пароль")}
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                type="password"
                autoComplete="new-password"
                disabled={loading}
              />
            </label>
          )}
        </div>

        {passMode === "register" && password2.length > 0 && !passwordsMatch && (
          <div className="pre login__preMt12">{t("login.password.mismatch", "Пароли не совпадают.")}</div>
        )}

        <div className="auth__actions">
          <button
            type="submit"
            className="btn btn--primary login__btnFull"
            disabled={loading || (passMode === "login" ? !canPasswordLogin : !canPasswordRegister)}
          >
            {loading
              ? passMode === "login"
                ? t("login.password.submit_loading", "Входим…")
                : t("login.password.register_loading", "Создаём аккаунт…")
              : passMode === "login"
                ? t("login.password.submit", "Войти")
                : t("login.password.register_submit", "Создать аккаунт")}
          </button>
        </div>

        <div className="login__switchWrap">
          <button
            type="button"
            className="btn login__switchBtn"
            disabled={loading}
            onClick={() => {
              if (passMode === "login") {
                setPassMode("register");
              } else {
                setPassMode("login");
                setPassword2("");
              }
            }}
          >
            {passMode === "login"
              ? t("login.password.switch_register", "Создать аккаунт")
              : t("login.password.switch_login", "Уже есть аккаунт? Войти")}
          </button>
        </div>

        <div className="pre login__preMt12">
          {passMode === "login"
            ? t("login.password.tip", "Используйте этот способ, если входите не через Telegram.")
            : t("login.password.register_tip", "Этот способ подойдёт для входа из браузера.")}
        </div>
      </form>
    </details>
  );

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div className="auth__head">
            <div>
              <h1 className="h1">{t("login.title", "Вход в Shpun App")}</h1>
              {mode === "telegram" ? (
                <p className="p">{t("login.desc.tg", "Продолжите вход через Telegram.")}</p>
              ) : (
                <p className="p">{t("login.desc.web", "Войдите через Telegram или по логину и паролю.")}</p>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <LangSwitch
                lang={(lang as "ru" | "en") === "en" ? "en" : "ru"}
                setLang={setLang as (v: "ru" | "en") => void}
                ariaLabel={t("login.lang.aria", "Язык")}
              />

              <span className="badge">
                {mode === "telegram" ? t("login.badge.tg", "Telegram") : t("login.badge.web", "Браузер")}
              </span>
            </div>
          </div>

          {headerCard}

          <div className="auth__divider login__dividerMt14">
            <span>{t("login.divider.telegram", "Вход через Telegram")}</span>
          </div>

          {mode === "telegram" ? (
            <div className="auth__actions login__dividerMt14">
              <button type="button" className="btn btn--primary login__btnFull" onClick={telegramLoginMiniApp} disabled={loading}>
                {loading ? t("login.tg.cta_loading", "Входим…") : t("login.tg.cta", "Продолжить")}
              </button>
            </div>
          ) : (
            <div ref={widgetWrapRef} className="login__dividerMt14">
              <div className="pre login__preMb10">
                {t("login.widget.tip", "Быстрый вход в аккаунт через Telegram.")}
              </div>

              {!botUsername ? (
                <div className="pre">{t("login.widget.unavailable", "Вход через Telegram сейчас недоступен.")}</div>
              ) : (
                <div id="tg-widget-container" className="login__widgetBox" />
              )}
            </div>
          )}

          <div className="auth__divider login__dividerMt14">
            <span>{t("login.divider.password", "Логин и пароль")}</span>
          </div>

          {passwordDetails}

          <div className="auth__divider login__dividerMt14">
            <span>{t("login.divider.providers", "Другие способы")}</span>
          </div>

          <div className="auth__providers">
            <button
              className="btn auth__provider login__providerBtn"
              onClick={mode === "telegram" ? telegramLoginMiniApp : focusWidget}
              disabled={loading}
              type="button"
            >
              <span className="auth__providerIcon">✈️</span>
              <span className="auth__providerText">
                Telegram
                <span className="auth__providerHint">
                  {mode === "telegram"
                    ? t("login.providers.telegram.hint.tg", "быстрый вход")
                    : t("login.providers.telegram.hint.web", "открыть вход")}
                </span>
              </span>
              <span className="auth__providerRight">→</span>
            </button>

            <button className="btn auth__provider login__providerBtn" disabled={true} type="button" title={t("login.providers.soon", "Скоро")}>
              <span className="auth__providerIcon">🟦</span>
              <span className="auth__providerText">
                Google
                <span className="auth__providerHint">{t("login.providers.google.hint", "скоро")}</span>
              </span>
              <span className="auth__providerRight">🔒</span>
            </button>

            <button className="btn auth__provider login__providerBtn" disabled={true} type="button" title={t("login.providers.soon", "Скоро")}>
              <span className="auth__providerIcon">🟨</span>
              <span className="auth__providerText">
                Yandex
                <span className="auth__providerHint">{t("login.providers.yandex.hint", "скоро")}</span>
              </span>
              <span className="auth__providerRight">🔒</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;