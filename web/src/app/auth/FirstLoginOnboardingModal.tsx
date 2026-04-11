// web/src/app/auth/FirstLoginOnboardingModal.tsx

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../shared/api/client";
import { toast } from "../../shared/ui/toast";
import { toastApiError } from "../../shared/ui/toast/toastApiError";
import { refetchMe } from "./useMe";

type Props = {
  open: boolean;
  me: any;
  onSkip?: () => void;
};

type Step = "email" | "password";

// ─── утилиты — экспортируем для переиспользования в Login.tsx и Profile.tsx ──

export function pwdScore(p: string): number {
  let s = 0;
  if (p.length >= 8) s++;
  if (/[A-Z]/.test(p)) s++;
  if (/[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 5);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function getEmailErrorText(err: unknown): string {
  const raw = String((err as any)?.message || "").toLowerCase();
  if (raw.includes("email_already_used") || raw.includes("already in use"))
    return "Этот email уже привязан к другому аккаунту.";
  if (raw.includes("invalid_email")) return "Укажите корректный email.";
  if (raw.includes("empty_email"))   return "Введите email.";
  if (raw.includes("email_not_saved"))
    return "Не удалось сохранить email. Проверьте адрес и попробуйте снова.";
  return "Не удалось сохранить email. Попробуйте ещё раз.";
}

// ─── ModalShell ───────────────────────────────────────────────────────────────

function ModalShell({
  title, badge, children,
}: {
  title: string; badge?: string; children: React.ReactNode;
}) {
  return createPortal(
    <div role="dialog" aria-modal="true" className="modal" style={{ zIndex: 10001 }}>
      <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="card__body">
          <div className="modal__head">
            <div className="modal__title">{title}</div>
            {badge ? <span className="badge">{badge}</span> : null}
          </div>
          <div className="modal__content">{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── основной компонент ───────────────────────────────────────────────────────

export function FirstLoginOnboardingModal({ open, me, onSkip }: Props) {
  const navigate = useNavigate();

  const emailStepDone    = Boolean(me?.profile?.emailStepDone);
  const passwordStepDone = Boolean(me?.profile?.passwordStepDone);
  const login            = String(me?.profile?.login  ?? "").trim();
  const currentEmail     = String(me?.profile?.email  ?? "").trim();

  const [localEmailDone,      setLocalEmailDone]      = useState(false);
  const [localPasswordDone,   setLocalPasswordDone]   = useState(false);
  const [showDoneScreen,      setShowDoneScreen]       = useState(false);
  const [goingToLogin,        setGoingToLogin]         = useState(false);

  const effectiveEmailDone    = emailStepDone    || localEmailDone;
  const effectivePasswordDone = passwordStepDone || localPasswordDone;

  const needEmail    = !effectiveEmailDone;
  const needPassword = !effectivePasswordDone;
  const totalSteps   = (needEmail ? 1 : 0) + (needPassword ? 1 : 0);

  const [step, setStep] = useState<Step>(() => (!emailStepDone ? "email" : "password"));

  const [pwd1, setPwd1] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [showPwd1, setShowPwd1] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);
  const [pwdBusy,  setPwdBusy]  = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);

  const [emailDraft, setEmailDraft] = useState(currentEmail);
  const [emailBusy,  setEmailBusy]  = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setLocalEmailDone(false);
      setLocalPasswordDone(false);
      setPwdError(null);
      setEmailError(null);
      setShowDoneScreen(false);
      setPwd1("");
      setPwd2("");
      return;
    }
    setStep(!effectiveEmailDone ? "email" : "password");
    setEmailDraft(currentEmail || "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pwdStrength     = useMemo(() => pwdScore(pwd1), [pwd1]);
  const canSaveEmail    = isValidEmail(String(emailDraft || "").trim()) && !emailBusy;
  const canSavePassword = pwd1.trim().length >= 8 && pwd2.length > 0 && pwd1 === pwd2 && !pwdBusy;

  const currentStepNumber = step === "email" ? 1 : needEmail ? 2 : 1;
  const badge = totalSteps > 1 ? `Шаг ${currentStepNumber} из ${totalSteps}` : undefined;

  const emailForDisplay = String(emailDraft || currentEmail || "").trim();

  // ── saveEmail ─────────────────────────────────────────────────────────────
  async function saveEmail() {
    const clean = String(emailDraft || "").trim().toLowerCase();
    if (!clean)               { setEmailError("Введите email."); return; }
    if (!isValidEmail(clean)) { setEmailError("Укажите корректный email."); return; }

    setEmailBusy(true);
    setEmailError(null);

    try {
      await apiFetch("/user/email", {
        method: "PUT",
        body: { email: clean },
      });

      setLocalEmailDone(true);
      refetchMe().catch(() => {});

      if (needPassword) {
        setStep("password");
        toast.success("Email сохранён", {
          description: "Теперь создайте пароль для входа.",
          durationMs: 2500,
        });
      } else {
        // Только email нужен был — всё готово
        setShowDoneScreen(true);
      }
    } catch (e: unknown) {
      setEmailError(getEmailErrorText(e));
      toastApiError(e, { title: "Не удалось сохранить email." });
    } finally {
      setEmailBusy(false);
    }
  }

  // ── savePassword ──────────────────────────────────────────────────────────
  async function savePassword() {
    if (!canSavePassword) return;

    setPwdBusy(true);
    setPwdError(null);

    try {
      const res = await apiFetch<{ ok?: boolean; error?: string }>("/auth/password/set", {
        method: "POST",
        body: { password: pwd1.trim() },
      });

      if (!(res as any)?.ok) {
        throw new Error(String((res as any)?.error || "password_set_failed"));
      }

      setLocalPasswordDone(true);
      // Показываем финальный экран — сессия могла слететь, не пытаемся refetch
      setShowDoneScreen(true);
    } catch (e: unknown) {
      const raw = String((e as any)?.message || "").toLowerCase();
      if (raw.includes("password_too_short")) {
        setPwdError("Пароль должен быть не короче 8 символов.");
        return;
      }
      setPwdError("Не удалось сохранить пароль. Попробуйте ещё раз.");
      toastApiError(e, { title: "Не удалось сохранить пароль." });
    } finally {
      setPwdBusy(false);
    }
  }

  // ── Переход на логин ──────────────────────────────────────────────────────
  async function goToLogin() {
    setGoingToLogin(true);
    try {
      // Разлогиниваем чтобы очистить слетевшую/невалидную сессию
      await apiFetch("/logout", { method: "POST" }).catch(() => {});
      try {
        sessionStorage.removeItem("auth:pending");
        sessionStorage.removeItem("auth:pending_at");
      } catch { /* ignore */ }
      navigate("/login", { replace: true });
    } finally {
      setGoingToLogin(false);
    }
  }

  function handleSkip() {
    onSkip?.();
    toast.info("Настройку можно завершить позже", {
      description: "При следующем входе мы снова предложим добавить недостающие данные.",
      durationMs: 3000,
    });
  }

  if (!open) return null;

  // ── Финальный экран — всё сохранено, нужно войти заново ──────────────────
  if (showDoneScreen) {
    return (
      <ModalShell title="Готово ✅">
        <p className="p">
          Email и пароль сохранены. Теперь войдите заново — это нужно один раз после смены пароля.
        </p>

        <div className="pre">
          <div><strong>Email:</strong> {emailForDisplay || "—"}</div>
          <div><strong>Пароль:</strong> тот, который вы только что задали</div>
        </div>

        <p className="p" style={{ opacity: 0.8, fontSize: 13 }}>
          В Telegram вход пройдёт автоматически. В браузере введите email и пароль.
        </p>

        <div className="actions actions--1">
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => void goToLogin()}
            disabled={goingToLogin}
          >
            {goingToLogin ? "Выходим…" : "Перейти к авторизации →"}
          </button>
        </div>
      </ModalShell>
    );
  }

  // Оба шага выполнены
  if (effectiveEmailDone && effectivePasswordDone) return null;

  // ── Шаг EMAIL ─────────────────────────────────────────────────────────────
  if (step === "email" && !effectiveEmailDone) {
    return (
      <ModalShell title="Добавьте email" badge={badge}>
        <p className="p">
          Email нужен для входа вне Telegram и восстановления доступа.
        </p>

        <div className="kv">
          <div className="kv__item">
            <div className="kv__k">Логин в боте</div>
            <div className="kv__v">{login || "—"}</div>
          </div>
          {needPassword ? (
            <div className="kv__item">
              <div className="kv__k">Дальше</div>
              <div className="kv__v">Создание пароля</div>
            </div>
          ) : null}
        </div>

        <label className="field">
          <span className="field__label">Email</span>
          <input
            className="input"
            placeholder="name@example.com"
            value={emailDraft}
            onChange={(e) => { setEmailDraft(e.target.value); setEmailError(null); }}
            autoComplete="email"
            inputMode="email"
            disabled={emailBusy}
          />
        </label>

        {emailError ? (
          <div className="auth__error">
            <div className="auth__errorTitle">Ошибка</div>
            <div className="auth__errorText">{emailError}</div>
          </div>
        ) : null}

        <div className="actions actions--2">
          <button className="btn" type="button" onClick={handleSkip} disabled={emailBusy}>
            Пропустить
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!canSaveEmail}
            onClick={() => void saveEmail()}
          >
            {emailBusy ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </ModalShell>
    );
  }

  // ── Шаг ПАРОЛЬ ────────────────────────────────────────────────────────────
  return (
    <ModalShell title="Создайте пароль" badge={badge}>
      <p className="p">
        Пароль нужен для входа в браузере вне Telegram.
      </p>

      <div className="kv">
        <div className="kv__item">
          <div className="kv__k">Логин в боте</div>
          <div className="kv__v">{login || "—"}</div>
        </div>
        {effectiveEmailDone ? (
          <div className="kv__item">
            <div className="kv__k">Email</div>
            <div className="kv__v">{emailForDisplay || "—"}</div>
          </div>
        ) : null}
      </div>

      <label className="field">
        <span className="field__label">Новый пароль</span>
        <div className="pwdfield">
          <input
            className="input"
            placeholder="Минимум 8 символов"
            value={pwd1}
            onChange={(e) => { setPwd1(e.target.value); setPwdError(null); }}
            type={showPwd1 ? "text" : "password"}
            autoComplete="new-password"
            disabled={pwdBusy}
          />
          <button type="button" className="btn btn--soft pwdfield__btn"
            onClick={() => setShowPwd1(v => !v)} disabled={pwdBusy}
            aria-label={showPwd1 ? "Скрыть" : "Показать"}>
            {showPwd1 ? "🙈" : "👁"}
          </button>
        </div>
      </label>

      <label className="field">
        <span className="field__label">Повторите пароль</span>
        <div className="pwdfield">
          <input
            className="input"
            placeholder="Повторите пароль"
            value={pwd2}
            onChange={(e) => setPwd2(e.target.value)}
            type={showPwd2 ? "text" : "password"}
            autoComplete="new-password"
            disabled={pwdBusy}
          />
          <button type="button" className="btn btn--soft pwdfield__btn"
            onClick={() => setShowPwd2(v => !v)} disabled={pwdBusy}
            aria-label={showPwd2 ? "Скрыть" : "Показать"}>
            {showPwd2 ? "🙈" : "👁"}
          </button>
        </div>
      </label>

      <div className="pre">
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Надёжность пароля</span>
          <span>{pwdStrength}/5</span>
        </div>
        {pwd2.length > 0 && pwd1 !== pwd2 ? (
          <div style={{ marginTop: 4, opacity: 0.8 }}>Пароли не совпадают</div>
        ) : null}
      </div>

      {pwdError ? (
        <div className="auth__error">
          <div className="auth__errorTitle">Ошибка</div>
          <div className="auth__errorText">{pwdError}</div>
        </div>
      ) : null}

      <div className="actions actions--2">
        <button className="btn" type="button" onClick={handleSkip} disabled={pwdBusy}>
          Пропустить
        </button>
        <button
          className="btn btn--primary"
          type="button"
          disabled={!canSavePassword}
          onClick={() => void savePassword()}
        >
          {pwdBusy ? "Сохраняем…" : "Сохранить пароль"}
        </button>
      </div>
    </ModalShell>
  );
}
