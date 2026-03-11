import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../shared/api/client";
import type { MeResponse, PasswordSetResponse } from "../shared/api/types";
import { useI18n } from "../shared/i18n";
import { toast } from "../shared/ui/toast";
import { toastApiError } from "../shared/ui/toast/toastApiError";
import { normalizeError } from "../shared/api/errorText";

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
  const intent = (sp.get("intent") || "").trim().toLowerCase();
  const isChange = intent === "change";

  const redirectTo = useMemo(() => {
    const raw = sp.get("redirect");
    return normalizeRedirectPath(raw, isChange ? "/profile" : "/app");
  }, [sp, isChange]);

  const [gate, setGate] = useState<GateState>({ status: "checking" });

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const initialLogin = useMemo(() => {
    const s: any = (loc as any)?.state;
    return String(s?.login ?? "").trim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [login, setLogin] = useState<string>(initialLogin || "");

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const [showPwd1, setShowPwd1] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);

  const score = useMemo(() => pwdScore(password), [password]);

  const canSubmit =
    password.trim().length >= 8 && password2.length > 0 && password === password2 && !loading;

  useEffect(() => {
    let alive = true;

    async function gateAndLoadMe() {
      try {
        const me = await apiFetch<MeResponse>("/me", { method: "GET" });

        if (!me.ok) {
          if (!alive) return;
          setGate({
            status: "error",
            message: (me as any).error || t("setpwd.need_login.text", "Нужно войти в аккаунт."),
          });
          return;
        }

        const l = String((me as any)?.profile?.login ?? "").trim();
        if (alive && l && !login) setLogin(l);

        const psRaw = (me as any)?.profile?.passwordSet;
        const passwordSet: boolean | undefined = typeof psRaw === "boolean" ? psRaw : undefined;

        if (isChange) {
          if (!alive) return;
          setGate({ status: "allowed" });
          return;
        }

        if (passwordSet === false) {
          if (!alive) return;
          setGate({ status: "allowed" });
          return;
        }

        if (!alive) return;
        setGate({ status: "blocked" });
        nav("/app", { replace: true });
      } catch (e: unknown) {
        if (!alive) return;
        const n = normalizeError(e);
        setGate({
          status: "error",
          message: n.description || t("setpwd.need_login.text", "Нужно войти в аккаунт."),
        });
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
        body: { password: password.trim() },
      });

      if (!res.ok) {
        throw new Error(String((res as any).error || "password_set_failed"));
      }

      toast.success(
        isChange
          ? t("setpwd.toast.changed.title", "Пароль изменён")
          : t("setpwd.toast.saved.title", "Пароль сохранён"),
        {
          description: t("setpwd.toast.saved.desc", "Теперь войдите снова с новым паролем."),
          durationMs: 2500,
        }
      );

      try {
        await apiFetch("/logout", { method: "POST" });
      } catch {
        // ignore
      }

      nav(`/login?reason=pwd_changed`, {
        replace: true,
        state: { from: redirectTo },
      });
    } catch (e: unknown) {
      const n = normalizeError(e);
      const msg = n.description || t("setpwd.err.generic", "Не удалось сохранить пароль.");

      setErr(msg);
      toastApiError(e, { title: t("setpwd.err.generic", "Не удалось сохранить пароль.") });
    } finally {
      setLoading(false);
    }
  }

  if (gate.status === "checking") {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("setpwd.checking.title", "Проверяем доступ…")}</h1>
            <p className="p">{t("setpwd.checking.text", "Подготавливаем страницу.")}</p>
            <div className="skeleton p" style={{ width: "64%", marginTop: 12 }} />
            <div className="skeleton p" style={{ width: "46%", marginTop: 8 }} />
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
            <button className="btn btn--primary" onClick={() => nav("/login", { replace: true })}>
              {t("setpwd.need_login.cta", "Перейти ко входу")}
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
            <p className="p">{t("setpwd.redirecting", "Возвращаем в приложение…")}</p>
          </div>
        </div>
      </div>
    );
  }

  const title = isChange
    ? t("setpwd.change.title", "Сменить пароль")
    : t("setpwd.title", "Создать пароль");

  const desc = isChange
    ? t("setpwd.change.desc", "Вы можете обновить пароль в любой момент.")
    : t("setpwd.desc", "Пароль пригодится для входа в браузере и в приложении.");

  const nextText = isChange
    ? t("setpwd.kv.next_value_profile", "Профиль")
    : t("setpwd.kv.next_value", "Главная");

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div className="auth__head">
            <div>
              <h1 className="h1">{title}</h1>
              <p className="p">{desc}</p>
            </div>

            {!isChange && <span className="badge">{t("setpwd.badge", "Готово за минуту")}</span>}
          </div>

          <div className="kv">
            <div className="kv__item">
              <div className="kv__k">{t("setpwd.kv.login", "Логин")}</div>
              <div className="kv__v">{login || "…"}</div>
            </div>
            <div className="kv__item">
              <div className="kv__k">{t("setpwd.kv.why", "Для чего")}</div>
              <div className="kv__v">{t("setpwd.kv.why_value", "Вход по паролю")}</div>
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
                <span className="field__label">{t("setpwd.field.p1", "Новый пароль")}</span>

                <div className="pwdfield">
                  <input
                    className="input"
                    placeholder={t("setpwd.field.p1_ph", "Минимум 8 символов")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type={showPwd1 ? "text" : "password"}
                    autoComplete="new-password"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="btn btn--soft pwdfield__btn"
                    onClick={() => setShowPwd1((v) => !v)}
                    disabled={loading}
                    aria-label={
                      showPwd1
                        ? t("setpwd.field.hide_password", "Скрыть пароль")
                        : t("setpwd.field.show_password", "Показать пароль")
                    }
                    title={
                      showPwd1
                        ? t("setpwd.field.hide", "Скрыть")
                        : t("setpwd.field.show", "Показать")
                    }
                  >
                    {showPwd1 ? "🙈" : "👁"}
                  </button>
                </div>
              </label>

              <label className="field">
                <span className="field__label">{t("setpwd.field.p2", "Повторите пароль")}</span>

                <div className="pwdfield">
                  <input
                    className="input"
                    placeholder={t("setpwd.field.p2_ph", "Повторите пароль")}
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                    type={showPwd2 ? "text" : "password"}
                    autoComplete="new-password"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="btn btn--soft pwdfield__btn"
                    onClick={() => setShowPwd2((v) => !v)}
                    disabled={loading}
                    aria-label={
                      showPwd2
                        ? t("setpwd.field.hide_password", "Скрыть пароль")
                        : t("setpwd.field.show_password", "Показать пароль")
                    }
                    title={
                      showPwd2
                        ? t("setpwd.field.hide", "Скрыть")
                        : t("setpwd.field.show", "Показать")
                    }
                  >
                    {showPwd2 ? "🙈" : "👁"}
                  </button>
                </div>
              </label>
            </div>

            <div className="pre pwdmeter">
              <div className="pwdmeter__row">
                <span className="pwdmeter__title">{t("setpwd.strength", "Надёжность")}</span>
                <span className="pwdmeter__score">{score}/5</span>
              </div>
              <div className="pwdmeter__tip">
                {t("setpwd.tip", "Используйте 8+ символов, цифры и спецсимволы.")}
              </div>
            </div>

            <div className="actions actions--2">
              <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
                {loading
                  ? t("setpwd.saving", "Сохраняем…")
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

export default SetPassword;