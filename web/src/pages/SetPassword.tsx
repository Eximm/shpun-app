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
  | {
      status: "allowed";
      mode: "change" | "forced_password" | "forced_email";
      login: string;
      email: string;
      emailStepDone: boolean;
    }
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

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getEmailSaveErrorText(
  err: unknown,
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string
): string {
  const raw = String((err as any)?.message || "").toLowerCase();

  if (raw.includes("email_already_used") || raw.includes("already in use")) {
    return t(
      "setpwd.email.error.already_used",
      "Этот email уже привязан к другому аккаунту."
    );
  }

  if (raw.includes("invalid_email")) {
    return t("setpwd.email.error.invalid", "Укажите корректный email.");
  }

  if (raw.includes("empty_email")) {
    return t("setpwd.email.error.empty", "Введите email.");
  }

  if (raw.includes("email_not_saved")) {
    return t(
      "setpwd.email.error.not_saved",
      "Не удалось сохранить email. Проверьте адрес и попробуйте снова."
    );
  }

  if (raw.includes("email_save_check_failed")) {
    return t(
      "setpwd.email.error.save_check_failed",
      "Не удалось проверить сохранение email. Попробуйте ещё раз."
    );
  }

  return t("setpwd.email.error.save", "Не удалось сохранить email. Попробуйте ещё раз.");
}

export function SetPassword() {
  const { t } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();

  const sp = useMemo(() => new URLSearchParams(loc.search), [loc.search]);
  const intent = (sp.get("intent") || "").trim().toLowerCase();
  const phase = (sp.get("phase") || "").trim().toLowerCase();
  const isChange = intent === "change";
  const phaseEmail = phase === "email";

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
  }, [loc]);
  const [login, setLogin] = useState<string>(initialLogin || "");

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const [showPwd1, setShowPwd1] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);

  const [emailDraft, setEmailDraft] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const score = useMemo(() => pwdScore(password), [password]);

  const canSubmitPassword =
    password.trim().length >= 8 && password2.length > 0 && password === password2 && !loading;

  const canSubmitEmail = isValidEmail(String(emailDraft || "").trim().toLowerCase()) && !emailBusy;

  useEffect(() => {
    let alive = true;

    async function gateAndLoadMe() {
      try {
        const me = await apiFetch<MeResponse>("/me", { method: "GET" });

        if (!me.ok) {
          if (!alive) return;
          setGate({
            status: "error",
            message:
              (me as any).error || t("setpwd.need_login.text", "Нужно войти в аккаунт."),
          });
          return;
        }

        const profile: any = (me as any)?.profile ?? {};
        const l = String(profile?.login ?? "").trim();
        const email = String(profile?.email ?? "").trim();
        const passwordSet = profile?.passwordSet === true;
        const emailStepDone = profile?.emailStepDone === true;

        if (alive && l && !login) setLogin(l);
        if (alive) setEmailDraft(email || "");

        if (isChange) {
          if (!alive) return;
          setGate({
            status: "allowed",
            mode: "change",
            login: l,
            email,
            emailStepDone,
          });
          return;
        }

        if (phaseEmail) {
          if (!alive) return;

          if (emailStepDone) {
            setGate({ status: "blocked" });
            nav(redirectTo, { replace: true });
            return;
          }

          setGate({
            status: "allowed",
            mode: "forced_email",
            login: l,
            email,
            emailStepDone,
          });
          return;
        }

        if (passwordSet === false) {
          if (!alive) return;
          setGate({
            status: "allowed",
            mode: "forced_password",
            login: l,
            email,
            emailStepDone,
          });
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
          message:
            n.description ||
            t("setpwd.load_failed.text", "Не удалось открыть страницу. Попробуйте ещё раз."),
        });
      }
    }

    void gateAndLoadMe();

    return () => {
      alive = false;
    };
  }, [isChange, phaseEmail, login, nav, redirectTo, t]);

  async function submitPassword() {
    if (!canSubmitPassword) return;

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

      if (isChange) {
        toast.success(
          t("setpwd.toast.changed.title", "Пароль изменён"),
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
        return;
      }

      toast.success(
        t("setpwd.toast.saved.title", "Пароль сохранён"),
        {
          description: t(
            "setpwd.toast.onboarding_next",
            "Теперь добавьте email для входа и восстановления доступа."
          ),
          durationMs: 2500,
        }
      );

      nav(`/set-password?phase=email&redirect=${encodeURIComponent(redirectTo)}`, {
        replace: true,
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

  async function submitEmail() {
    const clean = String(emailDraft || "").trim().toLowerCase();

    if (!clean) {
      setEmailError(t("setpwd.email.error.empty", "Введите email."));
      return;
    }
    if (!isValidEmail(clean)) {
      setEmailError(t("setpwd.email.error.invalid", "Укажите корректный email."));
      return;
    }

    setEmailBusy(true);
    setEmailError(null);

    try {
      const resp = await apiFetch<any>("/user/email", {
        method: "PUT",
        body: { email: clean },
      });

      if (!(resp as any)?.ok) {
        throw new Error(String((resp as any)?.error || "email_save_failed"));
      }

      await apiFetch("/auth/onboarding/mark", {
        method: "POST",
        body: { step: "email" },
      });

      toast.success(
        t("setpwd.email.toast.saved.title", "Email сохранён"),
        {
          description: t(
            "setpwd.email.toast.saved.desc",
            "Он будет использоваться для входа и восстановления доступа."
          ),
          durationMs: 2500,
        }
      );

      nav(redirectTo, { replace: true });
    } catch (e: unknown) {
      const msg = getEmailSaveErrorText(e, t);
      setEmailError(msg);
      toastApiError(e, { title: t("setpwd.email.error.save", "Не удалось сохранить email.") });
    } finally {
      setEmailBusy(false);
    }
  }

  async function exitForcedFlow() {
    try {
      await apiFetch("/logout", { method: "POST" });
    } catch {
      // ignore
    }
    nav("/login", { replace: true });
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
            <h1 className="h1">{t("setpwd.load_failed.title", "Не удалось открыть страницу")}</h1>
            <p className="p">{gate.message}</p>
            <div className="actions actions--2">
              <button
                className="btn btn--primary"
                onClick={() => window.location.reload()}
                type="button"
              >
                {t("setpwd.retry", "Повторить")}
              </button>
              <button
                className="btn"
                onClick={() => nav("/login", { replace: true })}
                type="button"
              >
                {t("setpwd.need_login.cta", "Перейти ко входу")}
              </button>
            </div>
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

  const isEmailStage = gate.mode === "forced_email";

  const title =
    gate.mode === "change"
      ? t("setpwd.change.title", "Сменить пароль")
      : isEmailStage
        ? t("setpwd.email.title", "Добавить email")
        : t("setpwd.title", "Создать пароль");

  const desc =
    gate.mode === "change"
      ? t("setpwd.change.desc", "Вы можете обновить пароль в любой момент.")
      : isEmailStage
        ? t(
            "setpwd.email.desc",
            "Укажите email, который будет использоваться для входа и восстановления доступа."
          )
        : t("setpwd.desc", "Пароль пригодится для входа в браузере и в приложении.");

  const nextText =
    gate.mode === "change"
      ? t("setpwd.kv.next_value_profile", "Профиль")
      : isEmailStage
        ? t("setpwd.kv.next_value_home", "Вход в приложение")
        : t("setpwd.kv.next_value_email", "Добавление email");

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div className="auth__head">
            <div>
              <h1 className="h1">{title}</h1>
              <p className="p">{desc}</p>
            </div>

            {gate.mode !== "change" && (
              <span className="badge">
                {isEmailStage
                  ? t("setpwd.badge.step2", "Шаг 2 из 2")
                  : t("setpwd.badge.step1", "Шаг 1 из 2")}
              </span>
            )}
          </div>

          <div className="kv">
            <div className="kv__item">
              <div className="kv__k">{t("setpwd.kv.login", "Логин")}</div>
              <div className="kv__v">{login || gate.login || "…"}</div>
            </div>
            <div className="kv__item">
              <div className="kv__k">{t("setpwd.kv.why", "Для чего")}</div>
              <div className="kv__v">
                {isEmailStage
                  ? t("setpwd.kv.why_value_email", "Вход и восстановление доступа")
                  : t("setpwd.kv.why_value", "Вход по паролю")}
              </div>
            </div>
            <div className="kv__item">
              <div className="kv__k">{t("setpwd.kv.next", "Дальше")}</div>
              <div className="kv__v">{nextText}</div>
            </div>
          </div>

          {!isEmailStage ? (
            <form
              className="auth__form"
              onSubmit={(e) => {
                e.preventDefault();
                void submitPassword();
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
                <button type="submit" className="btn btn--primary" disabled={!canSubmitPassword}>
                  {loading
                    ? t("setpwd.saving", "Сохраняем…")
                    : gate.mode === "change"
                      ? t("setpwd.change.save", "Сменить пароль")
                      : t("setpwd.save", "Сохранить пароль")}
                </button>

                {gate.mode === "change" ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={loading}
                    onClick={() => nav(redirectTo, { replace: true })}
                    title={t("setpwd.back", "Назад")}
                  >
                    {t("setpwd.back", "Назад")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    disabled={loading}
                    onClick={() => void exitForcedFlow()}
                    title={t("setpwd.exit", "Выйти")}
                  >
                    {t("setpwd.exit", "Выйти")}
                  </button>
                )}
              </div>
            </form>
          ) : (
            <form
              className="auth__form"
              onSubmit={(e) => {
                e.preventDefault();
                void submitEmail();
              }}
            >
              <label className="field">
                <span className="field__label">{t("setpwd.email.field", "Email")}</span>
                <input
                  className="input"
                  placeholder={t("setpwd.email.placeholder", "name@example.com")}
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  autoComplete="email"
                  inputMode="email"
                  disabled={emailBusy}
                />
              </label>

              <div className="pre pwdmeter">
                <div className="pwdmeter__tip">
                  {t(
                    "setpwd.email.tip",
                    "Этот email будет использоваться для входа в браузере и восстановления доступа."
                  )}
                </div>
              </div>

              <div className="actions actions--2">
                <button type="submit" className="btn btn--primary" disabled={!canSubmitEmail}>
                  {emailBusy
                    ? t("setpwd.email.saving", "Сохраняем…")
                    : t("setpwd.email.save", "Сохранить email")}
                </button>

                <button
                  type="button"
                  className="btn"
                  disabled={emailBusy}
                  onClick={() => void exitForcedFlow()}
                  title={t("setpwd.exit", "Выйти")}
                >
                  {t("setpwd.exit", "Выйти")}
                </button>
              </div>
            </form>
          )}

          {err && !isEmailStage && (
            <div className="auth__error">
              <div className="auth__errorTitle">{t("setpwd.err.title", "Ошибка")}</div>
              <div className="auth__errorText">{err}</div>
            </div>
          )}

          {emailError && isEmailStage && (
            <div className="auth__error">
              <div className="auth__errorTitle">{t("setpwd.err.title", "Ошибка")}</div>
              <div className="auth__errorText">{emailError}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SetPassword;