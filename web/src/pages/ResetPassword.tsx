// FILE: web/src/pages/ResetPassword.tsx

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../shared/api/client";
import { toast } from "../shared/ui/toast";

function pwdScore(p: string) {
  let s = 0;
  if (p.length >= 8)           s++;
  if (/[A-Z]/.test(p))        s++;
  if (/[a-z]/.test(p))        s++;
  if (/\d/.test(p))            s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 5);
}

export function ResetPassword() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token")?.trim() ?? "";

  return token
    ? <ConfirmForm token={token} nav={nav} />
    : <RequestForm nav={nav} />;
}

// ── Форма запроса письма ──────────────────────────────────────────────────────

function RequestForm({ nav }: { nav: ReturnType<typeof useNavigate> }) {
  const [login,   setLogin]   = useState("");
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);

  async function submit() {
    const email = login.trim().toLowerCase();
    if (!email) {
      toast.error("Ошибка", { description: "Введите email" });
      return;
    }
    setLoading(true);
    try {
      await apiFetch("/auth/password-reset", {
        method: "POST",
        body: { login: email },
      });
    } catch {
      // намеренно игнорируем — не раскрываем существование аккаунта
    } finally {
      setLoading(false);
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">📬 Проверьте почту</h1>
            <p className="p">
              Если аккаунт с таким email существует — письмо со ссылкой для сброса пароля
              уже летит. Проверьте папку «Спам», если не видите письма.
            </p>
            <div className="auth__actions" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn btn--primary login__btnFull"
                onClick={() => nav("/login")}
              >
                Вернуться ко входу
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <h1 className="h1">🔑 Забыли пароль?</h1>
          <p className="p">
            Введите email для восстановления. Мы отправим ссылку для сброса пароля.
          </p>

          <form
            className="auth__form"
            style={{ marginTop: 16 }}
            onSubmit={(e) => { e.preventDefault(); void submit(); }}
          >
            <div className="field">
              <label className="field__label">Email для восстановления</label>
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="email"
                inputMode="email"
                disabled={loading}
              />
            </div>

            <div className="auth__actions">
              <button
                type="submit"
                className="btn btn--primary login__btnFull"
                disabled={loading || !login.trim()}
              >
                {loading ? "Отправляем…" : "Отправить ссылку"}
              </button>
            </div>
          </form>

          <div className="login__switchWrap" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn login__switchBtn"
              onClick={() => nav("/login")}
              disabled={loading}
            >
              ← Вернуться ко входу
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Форма установки нового пароля по токену ───────────────────────────────────

function ConfirmForm({ token, nav }: { token: string; nav: ReturnType<typeof useNavigate> }) {
  const [pwd1,     setPwd1]     = useState("");
  const [pwd2,     setPwd2]     = useState("");
  const [showPwd1, setShowPwd1] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [done,     setDone]     = useState(false);

  // Проверка токена и получение логина
  const [verifyLoading, setVerifyLoading] = useState(true);
  const [verifyError,   setVerifyError]   = useState<string | null>(null);
  const [authLogin,     setAuthLogin]     = useState<string>("");  // login2 или login

  const strength       = pwdScore(pwd1);
  const passwordsMatch = pwd2.length === 0 || pwd1 === pwd2;
  const canSubmit      = pwd1.length >= 8 && pwd2.length > 0 && pwd1 === pwd2
                         && !loading && !verifyLoading && !verifyError;

  useEffect(() => {
    void verifyToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function verifyToken() {
    setVerifyLoading(true);
    setVerifyError(null);
    try {
      // Просто проверяем что токен валидный — login2 получим после смены пароля
      await apiFetch(
        `/auth/password-reset/verify?token=${encodeURIComponent(token)}`
      );
    } catch (e: any) {
      const code = e?.code ?? e?.data?.error ?? "";
      setVerifyError(
        code === "invalid_or_expired_token"
          ? "Ссылка недействительна или устарела. Запросите новую."
          : "Не удалось проверить ссылку. Попробуйте запросить новую."
      );
    } finally {
      setVerifyLoading(false);
    }
  }

  async function submit() {
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      const resp = await apiFetch<{ ok: boolean; login2: string | null; login: string | null }>(
        "/auth/password-reset/confirm", {
        method: "POST",
        body: { token, password: pwd1.trim() },
      });
      // Биллинг возвращает login2/login в ответе на смену пароля
      const displayLogin = resp.login2?.trim() || resp.login?.trim() || "";
      setAuthLogin(displayLogin);
      setDone(true);
    } catch (e: any) {
      const code = e?.code ?? e?.data?.error ?? "";
      setError(
        code === "invalid_or_expired_token"
          ? "Ссылка недействительна или устарела. Запросите новую."
          : "Не удалось сменить пароль. Попробуйте ещё раз."
      );
    } finally {
      setLoading(false);
    }
  }

  // ── Загрузка ─────────────────────────────────────────────────────────────
  if (verifyLoading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">🔐 Новый пароль</h1>
            <p className="p" style={{ opacity: 0.6 }}>Проверяем ссылку…</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Ошибка токена ─────────────────────────────────────────────────────────
  if (verifyError) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">⚠️ Ссылка не подходит</h1>
            <p className="p">{verifyError}</p>
            <div className="auth__actions" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn btn--primary login__btnFull"
                onClick={() => nav("/reset-password")}
              >
                Запросить новую ссылку
              </button>
            </div>
            <div className="login__switchWrap" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn login__switchBtn"
                onClick={() => nav("/login")}
              >
                ← Вернуться ко входу
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Успех ─────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">✅ Пароль изменён</h1>
            <p className="p">Теперь входите с новым паролем.</p>

            {authLogin && (
              <div className="pre" style={{ marginTop: 12 }}>
                <div style={{ opacity: 0.6, fontSize: 13, marginBottom: 4 }}>
                  Ваш логин для входа:
                </div>
                <strong style={{ fontSize: 16 }}>{authLogin}</strong>
              </div>
            )}

            <div className="auth__actions" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn btn--primary login__btnFull"
                onClick={() => nav("/login")}
              >
                Войти
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Форма ─────────────────────────────────────────────────────────────────
  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <h1 className="h1">🔐 Новый пароль</h1>
          <p className="p">Придумайте новый пароль для вашего аккаунта.</p>

          {/* Логин показываем только после успешной смены — получаем из confirm */}

          <form
            className="auth__form"
            style={{ marginTop: 16 }}
            onSubmit={(e) => { e.preventDefault(); void submit(); }}
          >
            <div className="field">
              <label className="field__label">Новый пароль</label>
              <div className="pwdfield">
                <input
                  className="input"
                  placeholder="Минимум 8 символов"
                  value={pwd1}
                  onChange={(e) => setPwd1(e.target.value)}
                  type={showPwd1 ? "text" : "password"}
                  autoComplete="new-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="btn pwdfield__btn"
                  onClick={() => setShowPwd1((v) => !v)}
                  disabled={loading}
                  aria-label={showPwd1 ? "Скрыть пароль" : "Показать пароль"}
                >
                  {showPwd1 ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            {pwd1.length > 0 && (
              <div className="pre pwdmeter" style={{ marginTop: 4 }}>
                <div className="pwdmeter__row">
                  <span className="pwdmeter__title">Надёжность</span>
                  <span className="pwdmeter__score">{strength}/5</span>
                </div>
              </div>
            )}

            <div className="field">
              <label className="field__label">Повторите пароль</label>
              <div className="pwdfield">
                <input
                  className="input"
                  placeholder="Повторите пароль"
                  value={pwd2}
                  onChange={(e) => setPwd2(e.target.value)}
                  type={showPwd2 ? "text" : "password"}
                  autoComplete="new-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="btn pwdfield__btn"
                  onClick={() => setShowPwd2((v) => !v)}
                  disabled={loading}
                  aria-label={showPwd2 ? "Скрыть пароль" : "Показать пароль"}
                >
                  {showPwd2 ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            {pwd2.length > 0 && !passwordsMatch && (
              <div className="pre" style={{ marginTop: 4 }}>Пароли не совпадают</div>
            )}

            {error && (
              <div className="pre" style={{ marginTop: 8 }}>{error}</div>
            )}

            <div className="auth__actions">
              <button
                type="submit"
                className="btn btn--primary login__btnFull"
                disabled={!canSubmit}
              >
                {loading ? "Сохраняем…" : "Сохранить пароль"}
              </button>
            </div>
          </form>

          <div className="login__switchWrap" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn login__switchBtn"
              onClick={() => nav("/login")}
              disabled={loading}
            >
              ← Вернуться ко входу
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ResetPassword;