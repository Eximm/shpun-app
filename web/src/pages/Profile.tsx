// FILE: web/src/pages/Profile.tsx

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
import { normalizeError } from "../shared/api/errorText";

/* ─── Types ─────────────────────────────────────────────────────────────── */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

type VerifyModalState = "idle" | "sent" | "success";

/* ─── Constants ─────────────────────────────────────────────────────────── */

const EMAIL_CODE_SENT_KEY    = "email_verify:sent_at";
const EMAIL_CODE_COOLDOWN_MS = 60_000; // 60 сек между отправками

/* ─── Utils ─────────────────────────────────────────────────────────────── */

async function copyToClipboard(text: string) {
  if (!text) return;
  try { await navigator.clipboard?.writeText(text); } catch { /* ignore */ }
}

function formatDate(v?: string | null) {
  return String(v ?? "").trim() || "—";
}

function isStandalonePwa(): boolean {
  try {
    return Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches) || Boolean((navigator as any)?.standalone);
  } catch { return false; }
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(String(navigator.userAgent || "")) && !(window as any).MSStream;
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
  try { return Number(sessionStorage.getItem(EMAIL_CODE_SENT_KEY) ?? 0) || 0; } catch { return 0; }
}

function setCodeSentAt() {
  try { sessionStorage.setItem(EMAIL_CODE_SENT_KEY, String(Date.now())); } catch { /* ignore */ }
}

function clearCodeSentAt() {
  try { sessionStorage.removeItem(EMAIL_CODE_SENT_KEY); } catch { /* ignore */ }
}

function getCooldownLeft(): number {
  const sentAt = getCodeSentAt();
  if (!sentAt) return 0;
  const left = Math.ceil((sentAt + EMAIL_CODE_COOLDOWN_MS - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

/* ─── Small components ───────────────────────────────────────────────────── */

function SectionTitle({ icon, children, right }: {
  icon?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div className="h1">{icon ? `${icon} ` : ""}{children}</div>
      {right && <div style={{ flexShrink: 0 }}>{right}</div>}
    </div>
  );
}

function Badge({ text, tone = "neutral" }: { text: string; tone?: "ok" | "warn" | "neutral" }) {
  const cls = tone === "ok" ? "chip chip--ok" : tone === "warn" ? "chip chip--warn" : "chip";
  return <span className={cls}>{text}</span>;
}

function RowLine({ icon, label, value, right, hint }: {
  icon?: string;
  label: string;
  value?: React.ReactNode;
  right?: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="profile-row">
      <div className="profile-row__main">
        <div className="profile-row__label">
          {icon && <span aria-hidden="true">{icon}</span>}
          <span>{label}</span>
        </div>
        {value != null && <div className="profile-row__value">{value}</div>}
      </div>
      {right && <div className="profile-row__right">{right}</div>}
      {hint  && <div className="profile-row__hint">{hint}</div>}
    </div>
  );
}

function Modal({ open, title, children, onClose, closeLabel }: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  closeLabel: string;
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
  value: "ru" | "en";
  onChange: (v: "ru" | "en") => void;
  ariaLabel: string;
}) {
  return (
    <div className="seg" role="tablist" aria-label={ariaLabel}>
      <button type="button" className={`btn seg__btn${value === "ru" ? " btn--primary" : ""}`} onClick={() => onChange("ru")} role="tab" aria-selected={value === "ru"}>RU</button>
      <button type="button" className={`btn seg__btn${value === "en" ? " btn--primary" : ""}`} onClick={() => onChange("en")} role="tab" aria-selected={value === "en"}>EN</button>
    </div>
  );
}

/* ─── Email Verify Modal ─────────────────────────────────────────────────── */

function EmailVerifyModal({ open, email, onClose, onVerified }: {
  open: boolean;
  email: string;
  onClose: () => void;
  onVerified: () => void;
}) {
  const [state,       setState]       = useState<VerifyModalState>(() =>
    getCodeSentAt() > 0 ? "sent" : "idle"
  );
  const [code,        setCode]        = useState("");
  const [codeError,   setCodeError]   = useState<string | null>(null);
  const [sending,     setSending]     = useState(false);
  const [confirming,  setConfirming]  = useState(false);
  const [cooldown,    setCooldown]    = useState(() => getCooldownLeft());

  const codeInputRef = useRef<HTMLInputElement>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  // Тикаем таймер — запускаем при монтировании и при открытии модалки
  useEffect(() => {
    function tick() {
      const left = getCooldownLeft();
      setCooldown(left);
      if (left <= 0 && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    tick(); // сразу показываем актуальное значение

    if (timerRef.current) clearInterval(timerRef.current);
    if (getCooldownLeft() > 0) {
      timerRef.current = setInterval(tick, 1000);
    }

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [open]);

  // Фокус на поле кода когда переходим в sent
  useEffect(() => {
    if (state === "sent") {
      setTimeout(() => codeInputRef.current?.focus(), 100);
    }
  }, [state]);

  // Сбрасываем состояние при закрытии (кроме sent — его помним)
  function handleClose() {
    if (state === "success") {
      clearCodeSentAt();
    }
    setCode("");
    setCodeError(null);
    onClose();
  }

  async function sendCode() {
    if (cooldown > 0 || sending) return;
    setSending(true);
    setCodeError(null);
    try {
      await apiFetch("/user/email/send-code", { method: "POST", body: {} });
      setCodeSentAt();
      const left = EMAIL_CODE_COOLDOWN_MS / 1000;
      setCooldown(left);
      // Запускаем таймер сразу
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        const l = getCooldownLeft();
        setCooldown(l);
        if (l <= 0 && timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      }, 1000);
      setState("sent");
      setCode("");
    } catch {
      setCodeError("Не удалось отправить письмо. Попробуйте позже.");
    } finally {
      setSending(false);
    }
  }

  async function confirmCode() {
    const trimmed = code.trim();
    if (!trimmed) { setCodeError("Введите код из письма"); return; }
    setConfirming(true);
    setCodeError(null);
    try {
      await apiFetch("/user/email/confirm", { method: "POST", body: { code: trimmed } });
      clearCodeSentAt();
      setState("success");
      onVerified();
    } catch (e: any) {
      const errCode = e?.code ?? e?.data?.error ?? "";
      setCodeError(
        errCode === "invalid_code"
          ? "Неверный код. Проверьте письмо и попробуйте ещё раз."
          : "Не удалось подтвердить. Попробуйте ещё раз."
      );
    } finally {
      setConfirming(false);
    }
  }

  const maskedEmail = email; // показываем полный адрес

  // ── Экран: отправить код ─────────────────────────────────────────────────
  const idleScreen = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ textAlign: "center", fontSize: 48, lineHeight: 1 }}>✉️</div>
      <p className="p" style={{ textAlign: "center", margin: 0 }}>
        Отправим письмо с кодом подтверждения на<br />
        <strong>{maskedEmail}</strong>
      </p>
      {codeError && <div className="pre" style={{ textAlign: "center" }}>{codeError}</div>}
      <button
        className="btn btn--primary"
        type="button"
        onClick={() => void sendCode()}
        disabled={sending || cooldown > 0}
        style={{ width: "100%" }}
      >
        {sending ? "Отправляем…" : "Отправить код"}
      </button>
      <button className="btn" type="button" onClick={handleClose} style={{ width: "100%" }}>
        Отмена
      </button>
    </div>
  );

  // ── Экран: ввод кода ─────────────────────────────────────────────────────
  const sentScreen = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ textAlign: "center", fontSize: 48, lineHeight: 1 }}>📬</div>
      <p className="p" style={{ textAlign: "center", margin: 0 }}>
        Письмо отправлено на <strong>{maskedEmail}</strong>.<br />
        Введите код из письма.
      </p>

      <form onSubmit={(e) => { e.preventDefault(); void confirmCode(); }}>
        <div className="field">
          <label className="field__label">Код подтверждения</label>
          <input
            ref={codeInputRef}
            className="input"
            placeholder="Введите код"
            value={code}
            onChange={(e) => { setCode(e.target.value); setCodeError(null); }}
            inputMode="numeric"
            autoComplete="one-time-code"
            disabled={confirming}
            style={{ textAlign: "center", letterSpacing: "0.15em", fontSize: 20 }}
          />
        </div>

        {codeError && (
          <div className="pre" style={{ marginTop: 8, textAlign: "center" }}>{codeError}</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          <button
            className="btn btn--primary"
            type="submit"
            disabled={confirming || !code.trim()}
            style={{ width: "100%" }}
          >
            {confirming ? "Проверяем…" : "Подтвердить"}
          </button>

          <button
            className="btn"
            type="button"
            onClick={() => void sendCode()}
            disabled={sending || cooldown > 0}
            style={{ width: "100%", opacity: cooldown > 0 ? 0.6 : 1 }}
          >
            {sending
              ? "Отправляем…"
              : cooldown > 0
                ? `Повторить через ${cooldown} сек`
                : "Отправить повторно"}
          </button>
        </div>
      </form>

      <p className="p" style={{ textAlign: "center", margin: 0, opacity: 0.5, fontSize: 13 }}>
        Проверьте папку «Спам», если письмо не пришло
      </p>
    </div>
  );

  // ── Экран: успех ─────────────────────────────────────────────────────────
  const successScreen = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
      <div style={{ fontSize: 64, lineHeight: 1 }}>✅</div>
      <div style={{ textAlign: "center" }}>
        <div className="h1" style={{ marginBottom: 8 }}>Email подтверждён!</div>
        <p className="p" style={{ margin: 0 }}>
          Адрес <strong>{maskedEmail}</strong> успешно подтверждён.
        </p>
      </div>
      <button
        className="btn btn--primary"
        type="button"
        onClick={handleClose}
        style={{ width: "100%" }}
      >
        Готово
      </button>
    </div>
  );

  const titles: Record<VerifyModalState, string> = {
    idle:    "Подтверждение email",
    sent:    "Введите код",
    success: "Готово",
  };

  return (
    <Modal
      open={open}
      title={titles[state]}
      onClose={handleClose}
      closeLabel="Закрыть"
    >
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

  const profile  = me?.profile;
  const isAdmin  = Boolean(profile?.isAdmin || me?.admin?.isAdmin);

  const loginText = useMemo(() => {
    const l = String(profile?.login ?? profile?.username ?? "").trim() ||
              (profile?.id != null ? `@${profile.id}` : "");
    return l;
  }, [profile?.login, profile?.username, profile?.id]);

  // ── Toast ─────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }

  // ── Personal ──────────────────────────────────────────────────────────────
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
      setEditPersonal(false); showToast(getMood("copied") ? "✅ Сохранено" : "✅ Данные обновлены");
    } catch (e: any) { setPersonalError(e?.message || t("profile.personal.error")); }
    finally { setSavingPersonal(false); }
  }

  function cancelPersonal() {
    setPersonalError(null); setEditPersonal(false);
    setFullName(savedFullName); setPhone(savedPhone);
  }

  // ── Telegram ──────────────────────────────────────────────────────────────
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
  const [tgLoginDraft, setTgLoginDraft] = useState("");
  const [savingTg,     setSavingTg]     = useState(false);
  const [tgError,      setTgError]      = useState<string | null>(null);

  useEffect(() => {
    if (!tgModal) { setTgLoginDraft(telegramLogin.replace(/^@/, "")); setTgError(null); }
  }, [tgModal, telegramLogin]);

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
      setTgModal(false); showToast("✈️ Telegram привязан. Уведомления полетели.");
    } catch (e: any) { setTgError(e?.message || t("profile.telegram.error.save")); }
    finally { setSavingTg(false); }
  }

  // ── Email ─────────────────────────────────────────────────────────────────
  const [email,         setEmail]         = useState("");
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [emailLoading,  setEmailLoading]  = useState(false);
  const [emailBusy,     setEmailBusy]     = useState(false);
  const [emailModal,    setEmailModal]    = useState(false);
  const [emailDraft,    setEmailDraft]    = useState("");
  const [emailError,    setEmailError]    = useState<string | null>(null);

  // Модалка верификации
  const [verifyModal, setVerifyModal] = useState(false);

  async function loadEmail() {
    setEmailLoading(true);
    try {
      const resp = await apiFetch<UserEmailResponse>("/user/email", { method: "GET" }) as any;
      if (resp?.ok) {
        setEmail(String(resp.email ?? "").trim());
        setEmailVerified(typeof resp.emailVerified === "boolean" ? resp.emailVerified : null);
      }
    } catch { /* ignore */ }
    finally { setEmailLoading(false); }
  }

  useEffect(() => { void loadEmail(); }, []);

  useEffect(() => {
    if (!emailModal) { setEmailDraft(email || ""); setEmailError(null); }
  }, [emailModal, email]);

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
      if (resp?.ok) {
        setEmail(String(resp.email ?? clean));
        setEmailVerified(typeof resp.emailVerified === "boolean" ? resp.emailVerified : false);
        setEmailModal(false);
        showToast("✉️ Email сохранён. Не забудьте подтвердить.");
        return;
      }
      setEmailError(t("profile.email.error.save"));
    } catch (e: unknown) { setEmailError(getEmailError(e)); }
    finally { setEmailBusy(false); }
  }

  // ── Password ──────────────────────────────────────────────────────────────
  const [pwdModal,  setPwdModal]  = useState(false);
  const [pwd1,      setPwd1]      = useState("");
  const [pwd2,      setPwd2]      = useState("");
  const [showPwd1,  setShowPwd1]  = useState(false);
  const [showPwd2,  setShowPwd2]  = useState(false);
  const [pwdBusy,   setPwdBusy]   = useState(false);
  const [pwdError,  setPwdError]  = useState<string | null>(null);

  useEffect(() => {
    if (!pwdModal) { setPwd1(""); setPwd2(""); setShowPwd1(false); setShowPwd2(false); setPwdError(null); setPwdBusy(false); }
  }, [pwdModal]);

  const pwdStrength     = useMemo(() => pwdScore(pwd1), [pwd1]);
  const canSavePassword = pwd1.trim().length >= 8 && pwd2.length > 0 && pwd1 === pwd2 && !pwdBusy;

  async function savePassword() {
    if (!canSavePassword) return;
    setPwdBusy(true); setPwdError(null);
    try {
      const res = await apiFetch<PasswordSetResponse>("/auth/password/set", { method: "POST", body: { password: pwd1.trim() } }) as any;
      if (!res?.ok) throw new Error(String(res?.error || "password_set_failed"));
      showToast("🔐 Пароль изменён. Входите с новым.");
      try { await apiFetch("/logout", { method: "POST" }); } catch { /* ignore */ }
      nav("/login?reason=pwd_changed", { replace: true, state: { from: "/profile" } });
    } catch (e: unknown) {
      const n = normalizeError(e);
      setPwdError(n.description || t("profile.password.error.save"));
      toastApiError(e, { title: t("profile.password.error.save") });
    } finally { setPwdBusy(false); }
  }

  // ── Copy login ────────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);
  async function doCopyLogin() {
    if (!loginText) return;
    await copyToClipboard(loginText);
    setCopied(true); showToast(getMood("copied") ?? "📋 Скопировано");
    window.setTimeout(() => setCopied(false), 1200);
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  const [loggingOut, setLoggingOut] = useState(false);
  async function logout() {
    setLoggingOut(true);
    try {
      const uid = Number(profile?.id ?? me?.id ?? 0) || 0;
      if (uid) {
        try {
          ["browser", "pwa"].forEach((k) => {
            sessionStorage.removeItem(`push.onboarding.dismissed:${k}:u:${uid}`);
            sessionStorage.removeItem(`push.onboarding.${k}.dismissed.session.v1`);
          });
        } catch { /* ignore */ }
      }
      await apiFetch("/logout", { method: "POST" });
    } finally { setLoggingOut(false); nav("/login", { replace: true }); }
  }

  // ── PWA ───────────────────────────────────────────────────────────────────
  const [standalone,      setStandalone]      = useState(false);
  const [deferredPrompt,  setDeferredPrompt]  = useState<BeforeInstallPromptEvent | null>(null);
  const [iosInstallModal, setIosInstallModal] = useState(false);

  useEffect(() => {
    setStandalone(isStandalonePwa());
    const onBip       = (e: Event) => { e.preventDefault?.(); setDeferredPrompt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => { setStandalone(true); setDeferredPrompt(null); showToast("📲 Приложение установлено. Теперь как настоящее."); };
    window.addEventListener("beforeinstallprompt", onBip as any);
    window.addEventListener("appinstalled",        onInstalled as any);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip as any);
      window.removeEventListener("appinstalled",        onInstalled as any);
    };
  }, [t]);

  async function doInstallPwa() {
    if (standalone)      { showToast("📲 Уже установлено. Всё хорошо."); return; }
    if (isIOS())         { setIosInstallModal(true); return; }
    if (!deferredPrompt) { showToast("📲 Откройте меню браузера → «Добавить на экран»."); return; }
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      showToast(choice?.outcome === "accepted" ? "🚀 Установка началась!" : "😕 Отменили. Можно попробовать снова.");
    } catch { showToast("😬 Что-то пошло не так. Попробуйте через меню браузера."); }
    finally { setDeferredPrompt(null); }
  }

  // ── Push ──────────────────────────────────────────────────────────────────
  const [pushLoading, setPushLoading] = useState(false);
  const [pushState,   setPushState]   = useState<{
    supported: boolean;
    permission: NotificationPermission | "unsupported";
    hasSubscription: boolean;
    standalone: boolean;
    disabledByUser: boolean;
  }>({ supported: false, permission: "unsupported", hasSubscription: false, standalone: false, disabledByUser: false });

  async function refreshPush() {
    try { const s = await getPushState(); setPushState({ ...s, disabledByUser: isPushDisabledByUser() }); } catch { /* ignore */ }
  }

  useEffect(() => { void refreshPush(); }, []);

  async function togglePush() {
    if (pushLoading) return;
    setPushLoading(true);
    try {
      const enabled = pushState.permission === "granted" && pushState.hasSubscription && !pushState.disabledByUser;
      if (enabled) { await disablePush(); showToast("🔕 Уведомления выключены. Тихий режим."); }
      else {
        if (isIOS() && !standalone) { showToast("📲 Сначала установите приложение на экран."); setIosInstallModal(true); return; }
        const ok = await enablePushByUserGesture();
        showToast(ok
          ? "🔔 Уведомления включены. Будем на связи!"
          : pushState.permission === "denied" ? "🚫 Доступ закрыт. Разрешите в настройках браузера." : "😬 Не удалось включить. Попробуйте ещё раз."
        );
      }
    } finally { setPushLoading(false); await refreshPush(); }
  }

  // ── Loading / Error ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="app-loader" style={{ opacity: 1, transition: "opacity 180ms ease", pointerEvents: "auto" }}>
        <div className="app-loader__card">
          <div className="app-loader__shine" />
          <div className="app-loader__brandRow">
            <div className="app-loader__mark" />
            <div className="app-loader__title">Shpun App</div>
          </div>
          <div className="app-loader__text">{t("home.loading.text")}</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("profile.title")}</h1>
            <p className="p">{t("profile.error.text")}</p>
            <div className="actions actions--2" style={{ marginTop: 12 }}>
              <button className="btn btn--primary" onClick={() => refetch?.()} type="button">{t("profile.error.retry")}</button>
              <button className="btn btn--danger"  onClick={() => void logout()} disabled={loggingOut} type="button">
                {loggingOut ? "…" : t("profile.logout")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const personalNameView  = savedFullName || profile?.displayName || "—";
  const personalPhoneView = savedPhone || "—";

  const pushEnabled  = pushState.permission === "granted" && pushState.hasSubscription && !pushState.disabledByUser;
  const pushPermText = permissionLabel(String(pushState.permission), t);

  const emailBadge = email
    ? emailVerified === true
      ? <Badge text={t("profile.email.badge.verified")} tone="ok" />
      : <Badge text={t("profile.email.badge.unverified")} tone="warn" />
    : <Badge text={t("profile.email.badge.empty")} />;

  const emailHint = email
    ? emailVerified === true
      ? t("profile.email.hint.verified")
      : t("profile.email.hint.unverified")
    : t("profile.email.hint.empty");

  // Если код уже был отправлен в этой сессии — показываем подсказку
  const codePending = getCodeSentAt() > 0 && emailVerified !== true;

  const pushBadge = pushEnabled
    ? <Badge text={t("profile.push.enabled")} tone="ok" />
    : pushState.permission === "denied"  ? <Badge text={t("profile.push.permission.denied")} />
    : pushState.permission === "granted" ? <Badge text={t("profile.push.permission.granted")} tone="ok" />
    : <Badge text={pushPermText} />;

  const pushHint = !pushState.supported ? t("profile.push.hint.unsupported")
    : pushState.permission === "denied"  ? t("profile.push.hint.denied")
    : isIOS() && !standalone             ? t("profile.push.hint.ios_install")
    : pushEnabled                        ? t("profile.push.hint.enabled")
    : pushState.permission === "default" ? t("profile.push.hint.ask")
    : pushState.permission === "granted" && pushState.disabledByUser ? t("profile.push.hint.disabled_by_user")
    : t("profile.push.hint.subscription");

  const pwaHint    = standalone ? t("profile.pwa.hint.installed")
    : isIOS()        ? t("profile.pwa.hint.ios")
    : deferredPrompt ? t("profile.pwa.hint.available")
    : t("profile.pwa.hint.menu");

  const pwaBtnText = isIOS() ? t("profile.pwa.button.how") : deferredPrompt ? t("profile.pwa.button.install") : t("profile.pwa.button.menu");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="section">

      {/* ── Шапка ── */}
      <div className="card">
        <div className="card__body">
          <SectionTitle icon="👤">{t("profile.title")}</SectionTitle>
          <p className="p">{t("profile.head.sub")}</p>

          {toast && (
            <div className="home-alert home-alert--ok" style={{ marginTop: 10 }}>{toast}</div>
          )}

          <div className="profile-header-actions">
            {isAdmin && (
              <button className="btn btn--accent" onClick={() => nav("/admin")} type="button">
                🛠 {t("profile.admin")}
              </button>
            )}
            <button className="btn" onClick={() => setPwdModal(true)} type="button">
              🔐 {t("profile.change_password")}
            </button>
            <button className="btn btn--danger" onClick={() => void logout()} disabled={loggingOut} type="button">
              🚪 {loggingOut ? "…" : t("profile.logout")}
            </button>
          </div>
        </div>
      </div>

      {/* ── Личные данные ── */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <SectionTitle icon="🪪" right={
              !editPersonal
                ? <button className="btn" onClick={() => setEditPersonal(true)} type="button">{t("profile.personal.edit")}</button>
                : <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn btn--primary" onClick={() => void savePersonal()} disabled={savingPersonal} type="button">
                      {savingPersonal ? "…" : t("profile.personal.save")}
                    </button>
                    <button className="btn" onClick={cancelPersonal} disabled={savingPersonal} type="button">
                      {t("profile.personal.cancel")}
                    </button>
                  </div>
            }>
              {t("profile.personal.title")}
            </SectionTitle>

            {personalError && <div className="pre" style={{ marginTop: 10 }}>{personalError}</div>}

            <div className="profile-list">
              <RowLine
                icon="🙍" label={t("profile.personal.name")}
                value={editPersonal
                  ? <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t("profile.personal.name_ph")} />
                  : personalNameView}
              />
              <RowLine
                icon="📞" label={t("profile.personal.phone")}
                value={editPersonal
                  ? <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7…" />
                  : personalPhoneView}
              />
              <RowLine
                icon="🔢" label={t("profile.personal.login")}
                value={loginText || "—"}
                right={loginText
                  ? <button type="button" className="btn" onClick={() => void doCopyLogin()}>{copied ? "✓" : "📋"}</button>
                  : null}
              />
              <div className="kv kv--2">
                <div className="kv__item">
                  <div className="kv__k">{t("profile.personal.id")}</div>
                  <div className="kv__v">{profile?.id ?? "—"}</div>
                </div>
                <div className="kv__item">
                  <div className="kv__k">{t("profile.personal.created")}</div>
                  <div className="kv__v">{formatDate(profile?.created)}</div>
                </div>
              </div>
              <RowLine icon="🕒" label={t("profile.personal.last_login")} value={formatDate(profile?.lastLogin)} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Вход и привязки ── */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <SectionTitle icon="🔑">{t("profile.auth.title")}</SectionTitle>
            <div className="profile-list">

              {/* Email */}
              <RowLine
                icon="✉️"
                label={t("profile.email.title")}
                value={emailLoading ? t("profile.email.loading") : email || t("profile.email.empty")}
                right={
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {emailBadge}
                    <button className="btn" onClick={() => setEmailModal(true)} type="button">
                      {email ? t("profile.email.change") : t("profile.email.add")}
                    </button>
                    {email && emailVerified !== true && (
                      <button
                        className="btn btn--primary"
                        onClick={() => setVerifyModal(true)}
                        type="button"
                      >
                        {codePending ? "Ввести код" : t("profile.email.verify")}
                      </button>
                    )}
                  </div>
                }
                hint={codePending ? "Код уже отправлен — нажмите «Ввести код»" : emailHint}
              />

              {/* Telegram */}
              <RowLine
                icon="✈️"
                label="Telegram"
                value={telegramLogin || t("profile.telegram.unlinked")}
                right={
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {telegramLogin
                      ? <Badge text={t("profile.telegram.badge.linked")} tone="ok" />
                      : <Badge text={t("profile.telegram.badge.unlinked")} />}
                    <button className="btn" onClick={() => setTgModal(true)} type="button">
                      {telegramLogin ? t("profile.telegram.change") : t("profile.telegram.link")}
                    </button>
                  </div>
                }
                hint={t("profile.telegram.hint")}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Настройки ── */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <SectionTitle icon="⚙️">{t("profile.settings.title")}</SectionTitle>
            <div className="profile-list">

              {/* Язык */}
              <div className="profile-row">
                <div className="profile-row__main">
                  <div className="profile-row__label"><span aria-hidden="true">🌍</span><span>{t("profile.language.title")}</span></div>
                  <div className="profile-row__value">{lang === "ru" ? t("profile.language.ru") : t("profile.language.en")}</div>
                  <div className="profile-row__hint">{t("profile.language.hint")}</div>
                </div>
                <div className="profile-row__right">
                  <Segmented value={(lang as any) === "en" ? "en" : "ru"} onChange={setLang as any} ariaLabel={t("profile.language.aria")} />
                </div>
              </div>

              {/* PWA */}
              <div className="profile-row">
                <div className="profile-row__main">
                  <div className="profile-row__label"><span aria-hidden="true">📲</span><span>{t("profile.pwa.title")}</span></div>
                  <div className="profile-row__value">{standalone ? t("profile.pwa.installed") : t("profile.pwa.not_installed")}</div>
                  <div className="profile-row__hint">{pwaHint}</div>
                </div>
                <div className="profile-row__right">
                  {standalone ? <Badge text={t("profile.pwa.installed")} tone="ok" /> : <Badge text={t("profile.pwa.not_installed")} />}
                  {!standalone && (
                    <button className="btn btn--primary" onClick={() => void doInstallPwa()} type="button">{pwaBtnText}</button>
                  )}
                </div>
              </div>

              {/* Push */}
              <div className="profile-row">
                <div className="profile-row__main">
                  <div className="profile-row__label"><span aria-hidden="true">🔔</span><span>{t("profile.push.title")}</span></div>
                  <div className="profile-row__value">{pushEnabled ? t("profile.push.enabled") : t("profile.push.disabled")} · {pushPermText}</div>
                  <div className="profile-row__hint">{pushHint}</div>
                </div>
                <div className="profile-row__right">
                  {pushBadge}
                  {!pushState.supported ? (
                    <button className="btn" type="button" disabled>{t("profile.push.button.unavailable")}</button>
                  ) : pushState.permission === "denied" ? (
                    <button className="btn" type="button" disabled>{t("profile.push.button.settings")}</button>
                  ) : isIOS() && !standalone ? (
                    <button className="btn btn--primary" type="button" onClick={() => void doInstallPwa()} disabled={pushLoading}>{t("profile.pwa.button.install")}</button>
                  ) : (
                    <button className={`btn${pushEnabled ? "" : " btn--primary"}`} type="button" onClick={() => void togglePush()} disabled={pushLoading}>
                      {pushLoading ? "…" : pushEnabled ? t("profile.push.button.disable") : t("profile.push.button.enable")}
                    </button>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* ── Модалка верификации email ── */}
      <EmailVerifyModal
        open={verifyModal}
        email={email}
        onClose={() => setVerifyModal(false)}
        onVerified={() => setEmailVerified(true)}
      />

      {/* ── Модалка iOS ── */}
      <Modal open={iosInstallModal} title={t("profile.pwa.ios_modal.title")} onClose={() => setIosInstallModal(false)} closeLabel={t("profile.modal.close")}>
        <p className="p">{t("profile.pwa.ios_modal.text")}</p>
        <div className="pre">{t("profile.pwa.ios_modal.steps")}</div>
        <div className="actions actions--1" style={{ marginTop: 12 }}>
          <button className="btn btn--primary" onClick={() => setIosInstallModal(false)} type="button">{t("profile.ok")}</button>
        </div>
      </Modal>

      {/* ── Модалка Telegram ── */}
      <Modal open={tgModal} title={telegramLogin ? t("profile.telegram.modal.change_title") : t("profile.telegram.modal.link_title")} onClose={() => setTgModal(false)} closeLabel={t("profile.modal.close")}>
        <p className="p">{t("profile.telegram.modal.label")}</p>
        <input className="input" style={{ marginTop: 10 }} value={tgLoginDraft} onChange={(e) => setTgLoginDraft(e.target.value)} placeholder={t("profile.telegram.modal.placeholder")} />
        {tgError && <div className="pre" style={{ marginTop: 8 }}>{tgError}</div>}
        <div className="actions actions--2" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => setTgModal(false)} disabled={savingTg} type="button">{t("profile.personal.cancel")}</button>
          <button className="btn btn--primary" onClick={() => void saveTelegramLogin()} disabled={savingTg} type="button">{savingTg ? "…" : t("profile.personal.save")}</button>
        </div>
      </Modal>

      {/* ── Модалка Email ── */}
      <Modal open={emailModal} title={email ? t("profile.email.modal.change_title") : t("profile.email.modal.add_title")} onClose={() => setEmailModal(false)} closeLabel={t("profile.modal.close")}>
        <p className="p">{t("profile.email.modal.text")}</p>
        <input className="input" style={{ marginTop: 10 }} value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} placeholder={t("profile.email.modal.placeholder")} autoComplete="email" inputMode="email" />
        {emailError && <div className="pre" style={{ marginTop: 8 }}>{emailError}</div>}
        <div className="actions actions--2" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => setEmailModal(false)} disabled={emailBusy} type="button">{t("profile.personal.cancel")}</button>
          <button className="btn btn--primary" onClick={() => void saveEmail()} disabled={emailBusy} type="button">{emailBusy ? "…" : t("profile.email.save")}</button>
        </div>
      </Modal>

      {/* ── Модалка пароля ── */}
      <Modal open={pwdModal} title={t("profile.password.modal.title")} onClose={() => setPwdModal(false)} closeLabel={t("profile.modal.close")}>
        <p className="p">{t("profile.password.modal.text")}</p>
        <label className="field" style={{ marginTop: 12 }}>
          <span className="field__label">{t("profile.password.field.p1")}</span>
          <div className="pwdfield">
            <input className="input" placeholder={t("profile.password.field.p1_ph")} value={pwd1} onChange={(e) => setPwd1(e.target.value)} type={showPwd1 ? "text" : "password"} autoComplete="new-password" disabled={pwdBusy} />
            <button type="button" className="btn btn--soft pwdfield__btn" onClick={() => setShowPwd1((v) => !v)} disabled={pwdBusy} aria-label={showPwd1 ? t("profile.password.hide_password") : t("profile.password.show_password")}>
              {showPwd1 ? "🙈" : "👁"}
            </button>
          </div>
        </label>
        <label className="field" style={{ marginTop: 10 }}>
          <span className="field__label">{t("profile.password.field.p2")}</span>
          <div className="pwdfield">
            <input className="input" placeholder={t("profile.password.field.p2_ph")} value={pwd2} onChange={(e) => setPwd2(e.target.value)} type={showPwd2 ? "text" : "password"} autoComplete="new-password" disabled={pwdBusy} />
            <button type="button" className="btn btn--soft pwdfield__btn" onClick={() => setShowPwd2((v) => !v)} disabled={pwdBusy} aria-label={showPwd2 ? t("profile.password.hide_password") : t("profile.password.show_password")}>
              {showPwd2 ? "🙈" : "👁"}
            </button>
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
          <button className="btn btn--primary" onClick={() => void savePassword()} disabled={!canSavePassword} type="button">
            {pwdBusy ? "…" : t("profile.password.save")}
          </button>
        </div>
      </Modal>

    </div>
  );
}