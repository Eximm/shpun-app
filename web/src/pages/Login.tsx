// web/src/pages/Login.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../shared/api/client";
import type { AuthResponse } from "../shared/api/types";
import { useI18n } from "../shared/i18n";

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

function getAuthRedirectUrl(): string {
  // ВАЖНО: не хардкодим домен. Берём текущий origin страницы.
  // Тогда будет работать и на app.shpyn.online, и на app.sdnonline.online, и на dev-доменах.
  const origin = window.location.origin;
  return `${origin}/api/auth/telegram_widget_redirect`;
}

function mapRedirectError(e: string, t: (k: string, fb?: string) => string): string {
  const code = String(e || "").trim();
  if (!code) return "";

  switch (code) {
    case "missing_telegram_payload":
      return t("login.err.missing_payload", "Telegram не передал данные для входа. Попробуйте ещё раз.");
    case "tg_widget_failed":
      return t("login.err.tg_widget_failed", "Не удалось войти через Telegram-виджет. Попробуйте ещё раз.");
    case "no_shm_session":
      return t("login.err.no_shm_session", "Сессия не была создана. Попробуйте ещё раз.");
    case "user_lookup_failed":
      return t("login.err.user_lookup_failed", "Не удалось получить данные пользователя. Попробуйте ещё раз.");
    default:
      return t("login.err.unknown", "Не удалось выполнить вход. Попробуйте ещё раз.");
  }
}

export function Login() {
  const { t } = useI18n();
  const nav = useNavigate();
  const loc: any = useLocation();

  // Telegram-mode только когда реально есть initData
  const initDataNow = getTelegramInitData();
  const mode: Mode = initDataNow ? "telegram" : "web";

  const [tgInitData, setTgInitData] = useState<string | null>(initDataNow);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Password fallback + registration
  const [passMode, setPassMode] = useState<PassMode>("login");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const autoLoginStarted = useRef(false);
  const widgetWrapRef = useRef<HTMLDivElement | null>(null);

  const canPasswordLogin = login.trim().length > 0 && password.length > 0;
  const passwordsMatch = password2.length === 0 ? true : password === password2;
  const canPasswordRegister =
    login.trim().length > 0 &&
    password.length > 0 &&
    password2.length > 0 &&
    password === password2;

  const botUsername = useMemo(() => getTelegramBotUsername(), []);

  function goAfterAuth(r?: AuthResponse) {
    const ok = !!r && (r as any).ok === true;
    if (!ok) {
      const msg = (r as any)?.error;
      if (msg) setErr(String(msg));
      return;
    }

    const nextRaw = String((r as any).next ?? "home").trim();
    const next = nextRaw || "home";
    const loginFromApi = String((r as any).login ?? "").trim();

    if (next === "set_password") {
      nav("/app/set-password", {
        replace: true,
        state: { login: loginFromApi },
      });
      return;
    }

    const to = String(loc?.state?.from ?? "").trim() || "/app";
    nav(to, { replace: true });
  }

  async function passwordLogin() {
    if (!canPasswordLogin) return;

    setLoading(true);
    setErr(null);
    try {
      const r = await apiFetch<AuthResponse>("/auth/password", {
        method: "POST",
        body: JSON.stringify({ login: login.trim(), password, mode: "login" }),
      });
      goAfterAuth(r);
    } catch (e: any) {
      setErr(e?.message || t("error.password_login_failed", "Не удалось войти по паролю"));
    } finally {
      setLoading(false);
    }
  }

  async function passwordRegister() {
    if (!canPasswordRegister) return;

    setLoading(true);
    setErr(null);
    try {
      const r = await apiFetch<AuthResponse>("/auth/password", {
        method: "POST",
        body: JSON.stringify({ login: login.trim(), password, mode: "register" }),
      });
      goAfterAuth(r);
    } catch (e: any) {
      setErr(e?.message || t("error.password_login_failed", "Не удалось выполнить регистрацию"));
    } finally {
      setLoading(false);
    }
  }

  async function telegramLoginMiniApp() {
    const initData = tgInitData || getTelegramInitData();
    if (!initData) {
      setErr(t("error.open_in_tg", "Откройте это приложение внутри Telegram, чтобы войти."));
      return;
    }

    setLoading(true);
    setErr(null);
    try {
      const r = await apiFetch<AuthResponse>("/auth/telegram", {
        method: "POST",
        body: JSON.stringify({ initData }),
      });
      goAfterAuth(r);
    } catch (e: any) {
      setErr(e?.message || t("error.telegram_login_failed", "Не удалось войти через Telegram"));
    } finally {
      setLoading(false);
    }
  }

  function focusWidget() {
    widgetWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Пришли после redirect-flow: /login?e=...
  useEffect(() => {
    const sp = new URLSearchParams(String(loc?.search ?? ""));
    const e = sp.get("e") ?? "";
    if (!e) return;

    setErr(mapRedirectError(e, t));

    // можно почистить URL, чтобы не висело ?e=... (опционально)
    // nav("/login", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc?.search]);

  // Telegram Mini App: готовим окружение + auto-login
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

  // Web mode: inject Telegram Login Widget (redirect-flow via data-auth-url)
  useEffect(() => {
    if (mode !== "web") return;

    const containerId = "tg-widget-container";
    const container = document.getElementById(containerId);
    if (!container) return;

    // каждый раз аккуратно очищаем контейнер
    container.innerHTML = "";

    if (!botUsername) return;

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");

    // ✅ Канон: redirect-flow и без хардкода домена
    script.setAttribute("data-auth-url", getAuthRedirectUrl());

    container.appendChild(script);

    return () => {
      // cleanup для StrictMode/HMR
      container.innerHTML = "";
    };
  }, [mode, botUsername]);

  const headerCard = (
    <div
      className="pre"
      style={{
        marginTop: 10,
        background: "linear-gradient(135deg, rgba(124,92,255,0.14), rgba(77,215,255,0.08))",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      <div style={{ fontWeight: 900, marginBottom: 8 }}>
        {t("login.what.title", "Что это такое")}
      </div>

      <div style={{ display: "grid", gap: 6, opacity: 0.92 }}>
        <div>
          ✅{" "}
          {t(
            "login.what.1",
            "Shpun App — кабинет Shpun SDN System: баланс, услуги и управление подпиской."
          )}
        </div>
        <div>
          ⚡{" "}
          {t(
            "login.what.2",
            "Самый быстрый вход — через Telegram: без паролей и лишних действий."
          )}
        </div>
        <div>
          🔒{" "}
          {t("login.what.3", "Пароль — резервный способ входа (если нужно зайти из браузера).")}
        </div>
        <div>
          🧩{" "}
          {t(
            "login.what.4",
            "Google/Yandex появятся позже — сейчас всё уже работает через Telegram + пароль."
          )}
        </div>
      </div>
    </div>
  );

  const passwordDetails = (
    <details className="auth__details">
      <summary className="auth__detailsSummary">
        {t("login.password.summary", "Войти по логину и паролю")}
      </summary>

      <form
        className="auth__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (passMode === "login") passwordLogin();
          else passwordRegister();
        }}
      >
        <div style={{ fontWeight: 900, letterSpacing: 0.1, marginBottom: 10 }}>
          {passMode === "login"
            ? t("login.password.summary", "Войти по логину и паролю")
            : t("login.password.register_title", "Регистрация по логину и паролю")}
        </div>

        <div className="auth__grid">
          <label className="field">
            <span className="field__label">{t("login.password.login", "Логин")}</span>
            <input
              className="input"
              placeholder={t("login.password.login_ph", "например @123456789")}
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
              placeholder={t("login.password.password_ph", "••••••••")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={passMode === "login" ? "current-password" : "new-password"}
              disabled={loading}
            />
          </label>

          {passMode === "register" && (
            <label className="field">
              <span className="field__label">{t("login.password.repeat", "Повтор пароля")}</span>
              <input
                className="input"
                placeholder={t("login.password.repeat_ph", "Введите пароль ещё раз")}
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
          <div className="pre" style={{ marginTop: 12 }}>
            {t("login.password.mismatch", "Пароли не совпадают.")}
          </div>
        )}

        <div className="auth__actions">
          <button
            type="submit"
            className="btn btn--primary"
            style={{ width: "100%" }}
            disabled={loading || (passMode === "login" ? !canPasswordLogin : !canPasswordRegister)}
          >
            {loading
              ? passMode === "login"
                ? t("login.password.submit_loading", "Входим…")
                : t("login.password.register_loading", "Создаём аккаунт…")
              : passMode === "login"
              ? t("login.password.submit", "Войти")
              : t("login.password.register_submit", "Зарегистрироваться")}
          </button>
        </div>

        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <button
            type="button"
            className="btn"
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.03)",
              borderColor: "rgba(255,255,255,0.12)",
              fontWeight: 900,
            }}
            disabled={loading}
            onClick={() => {
              setErr(null);
              if (passMode === "login") {
                setPassMode("register");
              } else {
                setPassMode("login");
                setPassword2("");
              }
            }}
          >
            {passMode === "login"
              ? t("login.password.switch_register", "Регистрация")
              : t("login.password.switch_login", "Уже есть аккаунт? Вход")}
          </button>
        </div>

        <div className="pre" style={{ marginTop: 12 }}>
          {passMode === "login"
            ? t("login.password.tip", "Пароль — резервный способ. Основной вход — через Telegram.")
            : t("login.password.register_tip", "Регистрация — резервный способ. Основной вход — через Telegram.")}
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
                <p className="p">
                  {t("login.desc.tg", "Мы распознали Telegram Mini App — можно войти в один тап.")}
                </p>
              ) : (
                <p className="p">
                  {t("login.desc.web", "Войдите через Telegram-виджет или используйте логин и пароль.")}
                </p>
              )}
            </div>

            <span className="badge">
              {mode === "telegram" ? t("login.badge.tg", "Telegram") : t("login.badge.web", "Веб-режим")}
            </span>
          </div>

          {headerCard}

          {/* Основной вход: Telegram */}
          <div className="auth__divider" style={{ marginTop: 14 }}>
            <span>{t("login.divider.telegram", "Основной вход")}</span>
          </div>

          {mode === "telegram" ? (
            <div className="auth__actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn--primary"
                onClick={telegramLoginMiniApp}
                disabled={loading}
                style={{ width: "100%" }}
              >
                {loading ? t("login.tg.cta_loading", "Входим…") : t("login.tg.cta", "Войти через Telegram")}
              </button>
            </div>
          ) : (
            <div ref={widgetWrapRef} style={{ marginTop: 12 }}>
              <div className="pre" style={{ marginBottom: 10, borderColor: "rgba(255,255,255,0.10)" }}>
                {t("login.widget.tip", "Нажмите кнопку ниже — это официальный вход через Telegram.")}
              </div>

              {!botUsername ? (
                <div className="pre">
                  {t("login.widget.env_missing", "Не настроен VITE_TG_BOT_USERNAME — виджет Telegram недоступен.")}
                </div>
              ) : (
                <div id="tg-widget-container" style={{ display: "grid", justifyItems: "center", padding: "12px 0" }} />
              )}
            </div>
          )}

          {/* Резервный вход: password */}
          <div className="auth__divider" style={{ marginTop: 14 }}>
            <span>{t("login.divider.password", "Вход по логину и паролю")}</span>
          </div>

          {passwordDetails}

          {/* Другие способы */}
          <div className="auth__divider" style={{ marginTop: 14 }}>
            <span>{t("login.divider.providers", "Или другой способ")}</span>
          </div>

          <div className="auth__providers">
            <button
              className="btn auth__provider"
              onClick={mode === "telegram" ? telegramLoginMiniApp : focusWidget}
              disabled={loading}
              type="button"
              style={{ width: "100%" }}
            >
              <span className="auth__providerIcon">✈️</span>
              <span className="auth__providerText">
                Telegram
                <span className="auth__providerHint">
                  {mode === "telegram"
                    ? t("login.providers.telegram.hint.tg", "вход в один тап")
                    : t("login.providers.telegram.hint.web", "вход через виджет")}
                </span>
              </span>
              <span className="auth__providerRight">→</span>
            </button>

            <button
              className="btn auth__provider"
              disabled={true}
              type="button"
              style={{ width: "100%" }}
              title={t("login.providers.soon", "Скоро")}
            >
              <span className="auth__providerIcon">🟦</span>
              <span className="auth__providerText">
                Google
                <span className="auth__providerHint">{t("login.providers.google.hint", "скоро")}</span>
              </span>
              <span className="auth__providerRight">🔒</span>
            </button>

            <button
              className="btn auth__provider"
              disabled={true}
              type="button"
              style={{ width: "100%" }}
              title={t("login.providers.soon", "Скоро")}
            >
              <span className="auth__providerIcon">🟨</span>
              <span className="auth__providerText">
                Yandex
                <span className="auth__providerHint">{t("login.providers.yandex.hint", "скоро")}</span>
              </span>
              <span className="auth__providerRight">🔒</span>
            </button>
          </div>

          {err && (
            <div className="auth__error" style={{ marginTop: 12 }}>
              <div className="auth__errorTitle">{t("setpwd.err.title", "Ошибка")}</div>
              <div className="auth__errorText">{err}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Login;
