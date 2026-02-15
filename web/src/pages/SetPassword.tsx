// web/src/pages/SetPassword.tsx

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../shared/api/client";
import type { MeResponse, PasswordSetResponse } from "../shared/api/types";
import { useI18n } from "../shared/i18n/I18nProvider";

function pwdScore(p: string) {
  let s = 0;
  if (p.length >= 8) s++;
  if (/[A-Z]/.test(p)) s++;
  if (/[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 5);
}

type GateState =
  | { status: "checking" }
  | { status: "allowed" }
  | { status: "blocked" }
  | { status: "error"; message: string };

function normalizeRedirectPath(input: any, fallback: string) {
  const v = String(input ?? "").trim();
  if (!v) return fallback;
  if (!v.startsWith("/")) return fallback;
  if (v.startsWith("//")) return fallback;
  if (v.includes("\r") || v.includes("\n")) return fallback;
  if (/[^\x20-\x7E]/.test(v)) return fallback;
  return v;
}

export function SetPassword() {
  const { t } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();

  const sp = useMemo(() => new URLSearchParams(loc.search), [loc.search]);
  const intent = (sp.get("intent") || "").trim().toLowerCase(); // "change" | ""
  const isChange = intent === "change";

  const redirectTo = useMemo(() => {
    const raw = sp.get("redirect");
    // default: onboarding -> /app ; change -> /app/profile
    return normalizeRedirectPath(raw, isChange ? "/app/profile" : "/app");
  }, [sp, isChange]);

  const [gate, setGate] = useState<GateState>({ status: "checking" });

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [login, setLogin] = useState<string>("");

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const score = useMemo(() => pwdScore(password), [password]);

  const canSubmit =
    password.trim().length >= 8 &&
    password2.length > 0 &&
    password === password2 &&
    !loading;

  useEffect(() => {
    let alive = true;

    async function gateAndLoadMe() {
      try {
        const me = await apiFetch<MeResponse>("/me", { method: "GET" });

        if (!me.ok) {
          if (!alive) return;
          setGate({ status: "error", message: me.error || "Not authenticated" });
          return;
        }

        const l = String((me as any)?.profile?.login ?? "").trim();
        if (alive && l && !login) setLogin(l);

        const ps = (me as any)?.profile?.passwordSet;

        // ===== Gate rules =====
        // 1) intent=change: пользователь сам хочет сменить пароль => разрешаем всегда (если залогинен)
        if (isChange) {
          if (!alive) return;
          setGate({ status: "allowed" });
          return;
        }

        // 2) onboarding: разрешаем ТОЛЬКО если пароль не установлен
        if (ps === false) {
          if (!alive) return;
          setGate({ status: "allowed" });
          return;
        }

        // 3) если пароль уже установлен или неизвестно — блокируем и уводим на /app
        if (!alive) return;
        setGate({ status: "blocked" });
        nav("/app", { replace: true });
      } catch (e: any) {
        if (!alive) return;
        setGate({ status: "error", message: e?.message || "Not authenticated" });
      }
    }

    gateAndLoadMe();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChange]);

  async function submit() {
    if (!canSubmit) return;
    setLoading(true);
    setErr(null);

    try {
      const res = await apiFetch<PasswordSetResponse>("/auth/password/set", {
        method: "POST",
        body: JSON.stringify({ password }),
      });

      if (!res.ok) throw new Error(res.error || "Failed to set password");

      // onboarding => /app, change => /app/profile (или redirect=...)
      nav(redirectTo, { replace: true });
    } catch (e: any) {
      setErr(e?.message || "Failed to set password");
    } finally {
      setLoading(false);
    }
  }

  if (gate.status === "checking") {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("setpwd.checking.title", "Проверяем…")}</h1>
            <p className="p">{t("setpwd.checking.text", "Подготавливаем вход.")}</p>
          </div>
        </div>
      </div>
    );
  }

  if (gate.status === "error") {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("setpwd.need_login.title", "Нужен вход")}</h1>
            <p className="p">{gate.message}</p>
            <button
              className="btn btn--primary"
              onClick={() => nav("/login", { replace: true })}
            >
              {t("setpwd.need_login.cta", "Перейти к входу")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (gate.status === "blocked") {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <p className="p">{t("setpwd.redirecting", "Открываем приложение…")}</p>
          </div>
        </div>
      </div>
    );
  }

  const title = isChange
    ? t("setpwd.change.title", "Сменить пароль")
    : t("setpwd.title", "Установить пароль");

  const desc = isChange
    ? t(
        "setpwd.change.desc",
        "Вы можете изменить пароль в любой момент. Это не влияет на вход через Telegram."
      )
    : t(
        "setpwd.desc",
        "Вы вошли через Telegram. Создайте пароль — так вы сможете входить и вне Telegram."
      );

  const nextText = isChange
    ? t("setpwd.kv.next_value_profile", "Профиль")
    : t("setpwd.kv.next_value", "Главная");

  // allowed
  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div className="auth__head">
            <div>
              <h1 className="h1">{title}</h1>
              <p className="p">{desc}</p>
            </div>

            {!isChange && <span className="badge">{t("setpwd.badge", "Шаг 1 / 1")}</span>}
          </div>

          <div className="kv">
            <div className="kv__item">
              <div className="kv__k">{t("setpwd.kv.login", "Ваш логин")}</div>
              <div className="kv__v">{login || "…"}</div>
            </div>
            <div className="kv__item">
              <div className="kv__k">{t("setpwd.kv.why", "Зачем")}</div>
              <div className="kv__v">{t("setpwd.kv.why_value", "Резервный вход")}</div>
            </div>
            <div className="kv__item">
              <div className="kv__k">{t("setpwd.kv.next", "Дальше")}</div>
              <div className="kv__v">{nextText}</div>
            </div>
          </div>

          <form
            className="auth__form"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="auth__grid">
              <label className="field">
                <span className="field__label">
                  {t("setpwd.field.p1", "Новый пароль")}
                </span>
                <input
                  className="input"
                  placeholder={t("setpwd.field.p1_ph", "Минимум 8 символов")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete="new-password"
                  disabled={loading}
                />
              </label>

              <label className="field">
                <span className="field__label">
                  {t("setpwd.field.p2", "Повторите пароль")}
                </span>
                <input
                  className="input"
                  placeholder={t("setpwd.field.p2_ph", "Повторите пароль")}
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  type="password"
                  autoComplete="new-password"
                  disabled={loading}
                />
              </label>
            </div>

            <div className="pre">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "rgba(255,255,255,0.72)", fontWeight: 800 }}>
                  {t("setpwd.strength", "Надёжность")}
                </span>
                <span style={{ color: "rgba(255,255,255,0.62)", fontWeight: 800 }}>
                  {score}/5
                </span>
              </div>
              <div style={{ marginTop: 8, color: "rgba(255,255,255,0.62)", lineHeight: 1.35 }}>
                {t("setpwd.tip", "Совет: 8+ символов, цифры и спецсимволы.")}
              </div>
            </div>

            <div className="auth__actions">
              <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
                {loading
                  ? t("setpwd.saving", "Сохраняю…")
                  : isChange
                  ? t("setpwd.change.save", "Сменить пароль")
                  : t("setpwd.save", "Сохранить пароль")}
              </button>

              <button
                type="button"
                className="btn"
                disabled={loading}
                onClick={() => nav(redirectTo, { replace: true })}
                title={t("setpwd.back", "Назад")}
              >
                {isChange ? t("setpwd.back", "Назад") : t("setpwd.to_home", "На главную")}
              </button>
            </div>
          </form>

          {err && (
            <div className="auth__error">
              <div className="auth__errorTitle">{t("setpwd.err.title", "Ошибка")}</div>
              <div className="auth__errorText">{err}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
