// FILE: web/src/pages/Profile.tsx
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { apiFetch } from "../shared/api/client";
import type { PasswordSetResponse, UserEmailResponse } from "../shared/api/types";
import { useI18n } from "../shared/i18n";
import {
  disablePush,
  enablePushByUserGesture,
  getPushState,
  isPushDisabledByUser,
} from "../app/notifications/push";
import { PageStatusCard } from "../shared/ui/PageStatusCard";
import { toastApiError } from "../shared/ui/toast/toastApiError";
import { normalizeError } from "../shared/api/errorText";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

async function copyToClipboard(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // ignore
  }
}

function formatDate(v?: string | null) {
  const s = String(v ?? "").trim();
  return s || "—";
}

function isStandalonePwa(): boolean {
  try {
    const mm = window.matchMedia?.("(display-mode: standalone)");
    const standalone = Boolean(mm?.matches);
    const iosStandalone = Boolean((navigator as any)?.standalone);
    return standalone || iosStandalone;
  } catch {
    return false;
  }
}

function isIOS(): boolean {
  const ua = String(navigator.userAgent || "");
  return /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function pwdScore(p: string) {
  let s = 0;
  if (p.length >= 8) s++;
  if (/[A-Z]/.test(p)) s++;
  if (/[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 5);
}

function permissionLabel(
  p: string,
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string
) {
  if (p === "granted") return t("profile.push.permission.granted", "Разрешены");
  if (p === "denied") return t("profile.push.permission.denied", "Запрещены");
  if (p === "default") return t("profile.push.permission.default", "Не выбрано");
  return t("profile.push.permission.unsupported", "Недоступно");
}

function CardTitle({
  icon,
  children,
  right,
}: {
  icon?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="row">
      <div className="h1">
        {icon ? `${icon} ` : ""}
        {children}
      </div>
      <div style={{ marginLeft: "auto" }}>{right}</div>
    </div>
  );
}

function Badge({
  text,
  tone = "neutral",
}: {
  text: string;
  tone?: "ok" | "warn" | "neutral";
}) {
  const className =
    tone === "ok"
      ? "chip chip--ok"
      : tone === "warn"
        ? "chip chip--warn"
        : "chip";
  return <span className={className}>{text}</span>;
}

function RowLine({
  icon,
  label,
  value,
  right,
  hint,
}: {
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
          {icon ? <span aria-hidden="true">{icon}</span> : null}
          <span>{label}</span>
        </div>
        {value != null ? <div className="profile-row__value">{value}</div> : null}
      </div>

      {right ? <div className="profile-row__right">{right}</div> : null}
      {hint ? <div className="profile-row__hint">{hint}</div> : null}
    </div>
  );
}

function Modal({
  open,
  title,
  children,
  onClose,
  closeLabel,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  closeLabel: string;
}) {
  if (!open) return null;

  return createPortal(
    <div role="dialog" aria-modal="true" onMouseDown={onClose} className="modal">
      <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="card__body">
          <div className="modal__head">
            <div className="modal__title">{title}</div>
            <button
              className="btn modal__close"
              onClick={onClose}
              aria-label={closeLabel}
              type="button"
            >
              ✕
            </button>
          </div>
          <div className="modal__content">{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Toast({ text }: { text: string }) {
  return <div className="pre">{text}</div>;
}

function Segmented({
  value,
  onChange,
  ariaLabel,
}: {
  value: "ru" | "en";
  onChange: (v: "ru" | "en") => void;
  ariaLabel: string;
}) {
  return (
    <div className="seg" role="tablist" aria-label={ariaLabel}>
      <button
        type="button"
        className={`btn seg__btn ${value === "ru" ? "btn--primary" : ""}`}
        onClick={() => onChange("ru")}
        role="tab"
        aria-selected={value === "ru"}
      >
        RU
      </button>
      <button
        type="button"
        className={`btn seg__btn ${value === "en" ? "btn--primary" : ""}`}
        onClick={() => onChange("en")}
        role="tab"
        aria-selected={value === "en"}
      >
        EN
      </button>
    </div>
  );
}

export function Profile() {
  const nav = useNavigate();
  const { me, loading, error, refetch } = useMe() as any;
  const { lang, setLang, t } = useI18n();

  const profile = me?.profile;
  const isAdmin = Boolean(profile?.isAdmin || me?.admin?.isAdmin);

  const loginText = useMemo(() => {
    const l =
      String(profile?.login ?? profile?.username ?? "").trim() ||
      (profile?.id != null ? `@${profile.id}` : "");
    return l;
  }, [profile?.login, profile?.username, profile?.id]);

  const created = profile?.created ?? null;
  const lastLogin = profile?.lastLogin ?? null;

  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }

  const [editPersonal, setEditPersonal] = useState(false);
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [personalError, setPersonalError] = useState<string | null>(null);

  const [fullName, setFullName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [savedFullName, setSavedFullName] = useState<string>("");
  const [savedPhone, setSavedPhone] = useState<string>("");

  useEffect(() => {
    const fn = String(profile?.fullName ?? profile?.full_name ?? profile?.displayName ?? "").trim();
    const ph = String(profile?.phone ?? "").trim();
    setFullName(fn);
    setPhone(ph);
    setSavedFullName(fn);
    setSavedPhone(ph);
  }, [profile?.fullName, profile?.full_name, profile?.displayName, profile?.phone]);

  async function savePersonal() {
    setPersonalError(null);
    setSavingPersonal(true);
    try {
      const payload = {
        full_name: String(fullName || "").trim(),
        phone: String(phone || "").trim(),
      };

      await apiFetch("/user/profile", {
        method: "POST",
        body: payload,
      });

      setSavedFullName(payload.full_name);
      setSavedPhone(payload.phone);
      setEditPersonal(false);
      showToast(t("profile.toast.saved", "Данные сохранены"));
    } catch (e: any) {
      setPersonalError(
        e?.message || t("profile.personal.error", "Не удалось сохранить изменения.")
      );
    } finally {
      setSavingPersonal(false);
    }
  }

  function cancelPersonal() {
    setPersonalError(null);
    setEditPersonal(false);
    setFullName(savedFullName);
    setPhone(savedPhone);
  }

  const [telegramLocal, setTelegramLocal] = useState<any>(null);
  const telegramRaw = telegramLocal ?? me?.telegram ?? null;

  useEffect(() => {
    if (!telegramLocal && me?.telegram) setTelegramLocal(me.telegram);
  }, [me?.telegram, telegramLocal]);

  const telegramLogin = useMemo(() => {
    const raw = telegramRaw?.login ?? telegramRaw?.username ?? "";
    const s = String(raw ?? "").trim();
    if (!s) return "";
    return s.startsWith("@") ? s : `@${s}`;
  }, [telegramRaw?.login, telegramRaw?.username]);

  const [tgModal, setTgModal] = useState(false);
  const [tgLoginDraft, setTgLoginDraft] = useState<string>("");
  const [savingTg, setSavingTg] = useState(false);
  const [tgError, setTgError] = useState<string | null>(null);

  useEffect(() => {
    if (!tgModal) {
      setTgLoginDraft(String(telegramLogin || "").replace(/^@/, ""));
      setTgError(null);
    }
  }, [tgModal, telegramLogin]);

  async function saveTelegramLogin() {
    setTgError(null);
    const clean = String(tgLoginDraft || "").trim().replace(/^@/, "");

    if (!clean) {
      setTgError(t("profile.telegram.error.empty", "Введите Telegram логин."));
      return;
    }
    if (!/^[a-zA-Z0-9_]{5,32}$/.test(clean)) {
      setTgError(t("profile.telegram.error.invalid", "Некорректный Telegram логин."));
      return;
    }

    setSavingTg(true);
    try {
      const resp = await apiFetch<any>("/user/telegram", {
        method: "POST",
        body: { login: clean },
      });

      const tg = resp?.telegram ?? null;
      if (tg) {
        setTelegramLocal({
          login: tg.login ?? clean,
          username: tg.username ?? null,
          chatId: tg.chat_id ?? tg.chatId ?? null,
          status: tg?.ShpynSDNSystem?.status ?? tg.status ?? null,
        });
      } else {
        setTelegramLocal({ ...(telegramRaw ?? {}), login: clean });
      }

      setTgModal(false);
      showToast(t("profile.telegram.toast.saved", "Telegram обновлён"));
    } catch (e: any) {
      setTgError(
        e?.message || t("profile.telegram.error.save", "Не удалось сохранить Telegram логин.")
      );
    } finally {
      setSavingTg(false);
    }
  }

  const [email, setEmail] = useState<string>("");
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailModal, setEmailModal] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  async function loadEmail() {
    setEmailLoading(true);
    try {
      const resp = await apiFetch<UserEmailResponse>("/user/email", { method: "GET" });
      if ((resp as any)?.ok) {
        setEmail(String((resp as any).email ?? "").trim());
        setEmailVerified(
          typeof (resp as any).emailVerified === "boolean" ? (resp as any).emailVerified : null
        );
      }
    } catch {
      // ignore
    } finally {
      setEmailLoading(false);
    }
  }

  useEffect(() => {
    void loadEmail();
  }, []);

  useEffect(() => {
    if (!emailModal) {
      setEmailDraft(email || "");
      setEmailError(null);
    }
  }, [emailModal, email]);

  function getEmailSaveErrorText(err: unknown): string {
    const raw = String((err as any)?.message || "").toLowerCase();

    if (raw.includes("email_already_used") || raw.includes("already in use")) {
      return t(
        "profile.email.error.already_used",
        "Этот email уже привязан к другому аккаунту."
      );
    }

    if (raw.includes("invalid_email")) {
      return t("profile.email.error.invalid", "Укажите корректный email.");
    }

    if (raw.includes("empty_email")) {
      return t("profile.email.error.empty", "Введите email.");
    }

    if (raw.includes("email_not_saved")) {
      return t(
        "profile.email.error.not_saved",
        "Не удалось сохранить email. Проверьте адрес и попробуйте снова."
      );
    }

    if (raw.includes("email_save_check_failed")) {
      return t(
        "profile.email.error.save_check_failed",
        "Не удалось проверить сохранение email. Попробуйте ещё раз."
      );
    }

    return t("profile.email.error.save", "Не удалось сохранить email. Попробуйте ещё раз.");
  }

  async function saveEmail() {
    setEmailError(null);
    const clean = String(emailDraft || "").trim().toLowerCase();

    if (!clean) {
      setEmailError(t("profile.email.error.empty", "Введите email."));
      return;
    }
    if (!isValidEmail(clean)) {
      setEmailError(t("profile.email.error.invalid", "Укажите корректный email."));
      return;
    }

    setEmailBusy(true);
    try {
      const resp = await apiFetch<UserEmailResponse>("/user/email", {
        method: "PUT",
        body: { email: clean },
      });

      if ((resp as any)?.ok) {
        setEmail(String((resp as any).email ?? clean));
        setEmailVerified(
          typeof (resp as any).emailVerified === "boolean" ? (resp as any).emailVerified : false
        );
        setEmailModal(false);
        showToast(t("profile.email.toast.saved", "Email сохранён"));
        return;
      }

      setEmailError(t("profile.email.error.save", "Не удалось сохранить email. Попробуйте ещё раз."));
    } catch (e: unknown) {
      setEmailError(getEmailSaveErrorText(e));
    } finally {
      setEmailBusy(false);
    }
  }

  async function requestVerifyEmail() {
    if (!email) {
      setEmailError(t("profile.email.error.need_email", "Сначала добавьте email."));
      return;
    }

    setEmailBusy(true);
    try {
      await apiFetch("/user/email/verify", {
        method: "POST",
        body: {},
      });
      showToast(
        t("profile.email.toast.verify_sent", "Письмо для подтверждения отправлено")
      );
    } catch {
      showToast(
        t("profile.email.toast.verify_failed", "Не удалось отправить письмо для подтверждения")
      );
    } finally {
      setEmailBusy(false);
    }
  }

  const [pwdModal, setPwdModal] = useState(false);
  const [pwd1, setPwd1] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [showPwd1, setShowPwd1] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);

  useEffect(() => {
    if (!pwdModal) {
      setPwd1("");
      setPwd2("");
      setShowPwd1(false);
      setShowPwd2(false);
      setPwdError(null);
      setPwdBusy(false);
    }
  }, [pwdModal]);

  const pwdStrength = useMemo(() => pwdScore(pwd1), [pwd1]);
  const canSavePassword =
    pwd1.trim().length >= 8 && pwd2.length > 0 && pwd1 === pwd2 && !pwdBusy;

  async function savePasswordFromProfile() {
    if (!canSavePassword) return;

    setPwdBusy(true);
    setPwdError(null);

    try {
      const res = await apiFetch<PasswordSetResponse>("/auth/password/set", {
        method: "POST",
        body: { password: pwd1.trim() },
      });

      if (!(res as any)?.ok) {
        throw new Error(String((res as any)?.error || "password_set_failed"));
      }

      showToast(t("profile.password.toast.changed", "Пароль изменён"));

      try {
        await apiFetch("/logout", { method: "POST" });
      } catch {
        // ignore
      }

      nav("/login?reason=pwd_changed", { replace: true, state: { from: "/profile" } });
    } catch (e: unknown) {
      const n = normalizeError(e);
      const msg =
        n.description || t("profile.password.error.save", "Не удалось изменить пароль.");
      setPwdError(msg);
      toastApiError(e, {
        title: t("profile.password.error.save", "Не удалось изменить пароль."),
      });
    } finally {
      setPwdBusy(false);
    }
  }

  const [copied, setCopied] = useState(false);
  async function doCopyLogin() {
    if (!loginText) return;
    await copyToClipboard(loginText);
    setCopied(true);
    showToast(t("profile.toast.copied", "Скопировано"));
    window.setTimeout(() => setCopied(false), 1200);
  }

  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);

    try {
      const uid = Number(profile?.id ?? me?.profile?.id ?? me?.id ?? 0) || 0;

      if (uid) {
        try {
          sessionStorage.removeItem(`push.onboarding.dismissed:browser:u:${uid}`);
          sessionStorage.removeItem(`push.onboarding.dismissed:pwa:u:${uid}`);
          sessionStorage.removeItem(`push.onboarding.browser.dismissed.session.v1`);
          sessionStorage.removeItem(`push.onboarding.pwa.dismissed.session.v1`);
        } catch {
          // ignore
        }
      }

      await apiFetch("/logout", { method: "POST" });
    } finally {
      setLoggingOut(false);
      nav("/login", { replace: true });
    }
  }

  const [standalone, setStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosInstallModal, setIosInstallModal] = useState(false);

  useEffect(() => {
    setStandalone(isStandalonePwa());

    const onBip = (e: Event) => {
      e.preventDefault?.();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setStandalone(true);
      setDeferredPrompt(null);
      showToast(t("profile.pwa.toast.installed", "Приложение установлено"));
    };

    window.addEventListener("beforeinstallprompt", onBip as any);
    window.addEventListener("appinstalled", onInstalled as any);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip as any);
      window.removeEventListener("appinstalled", onInstalled as any);
    };
  }, [t]);

  async function doInstallPwa() {
    if (standalone) {
      showToast(t("profile.pwa.toast.already_installed", "Уже установлено"));
      return;
    }

    if (isIOS()) {
      setIosInstallModal(true);
      return;
    }

    if (!deferredPrompt) {
      showToast(t("profile.pwa.toast.menu", "Установите приложение через меню браузера."));
      return;
    }

    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice?.outcome === "accepted") {
        showToast(t("profile.pwa.toast.started", "Установка запущена"));
      } else {
        showToast(t("profile.pwa.toast.cancelled", "Установка отменена"));
      }
    } catch {
      showToast(t("profile.pwa.toast.failed", "Не удалось запустить установку"));
    } finally {
      setDeferredPrompt(null);
    }
  }

  const [pushLoading, setPushLoading] = useState(false);
  const [pushState, setPushState] = useState<{
    supported: boolean;
    permission: NotificationPermission | "unsupported";
    hasSubscription: boolean;
    standalone: boolean;
    disabledByUser: boolean;
  }>({
    supported: false,
    permission: "unsupported",
    hasSubscription: false,
    standalone: false,
    disabledByUser: false,
  });

  async function refreshPush() {
    try {
      const s = await getPushState();
      setPushState({
        ...s,
        disabledByUser: isPushDisabledByUser(),
      });
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void refreshPush();
  }, []);

  async function togglePush() {
    if (pushLoading) return;
    setPushLoading(true);
    try {
      const enabled =
        pushState.permission === "granted" &&
        pushState.hasSubscription &&
        !pushState.disabledByUser;

      if (enabled) {
        await disablePush();
        showToast(t("profile.push.toast.disabled", "Уведомления выключены"));
      } else {
        if (isIOS() && !standalone) {
          showToast(
            t("profile.push.toast.install_ios", "Для push на iPhone сначала установите приложение.")
          );
          setIosInstallModal(true);
          return;
        }

        const ok = await enablePushByUserGesture();
        if (ok) {
          showToast(t("profile.push.toast.enabled", "Уведомления включены"));
        } else {
          if (pushState.permission === "denied") {
            showToast(
              t("profile.push.toast.denied", "Уведомления запрещены в браузере.")
            );
          } else {
            showToast(t("profile.push.toast.failed", "Не удалось включить уведомления."));
          }
        }
      }
    } finally {
      setPushLoading(false);
      await refreshPush();
    }
  }

  if (loading) {
    return (
      <div className="section">
        <div className="page-status">
          <PageStatusCard
            title={t("profile.loading.title", "Профиль")}
            text={t("profile.loading.text", "Загрузка...")}
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("profile.title", "Профиль")}</h1>
            <p className="p">{t("profile.error.text", "Не удалось загрузить данные.")}</p>

            <div className="actions actions--2">
              <button className="btn btn--primary" onClick={() => refetch?.()} type="button">
                {t("profile.error.retry", "Повторить")}
              </button>
              <button className="btn btn--danger" onClick={logout} disabled={loggingOut} type="button">
                {loggingOut ? "…" : t("profile.logout", "Выйти")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const personalNameView = savedFullName || profile?.displayName || "—";
  const personalPhoneView = savedPhone || "—";

  const telegramStatusBadge = telegramLogin ? (
    <Badge text={t("profile.telegram.badge.linked", "Подключен")} tone="ok" />
  ) : (
    <Badge text={t("profile.telegram.badge.unlinked", "Не подключен")} />
  );

  const pwaText = standalone
    ? t("profile.pwa.installed", "Установлено")
    : t("profile.pwa.not_installed", "Не установлено");

  const pwaBadge = standalone ? (
    <Badge text={t("profile.pwa.installed", "Установлено")} tone="ok" />
  ) : (
    <Badge text={t("profile.pwa.not_installed", "Не установлено")} />
  );

  const pwaBtnText = isIOS()
    ? t("profile.pwa.button.how", "Как установить")
    : deferredPrompt
      ? t("profile.pwa.button.install", "Установить")
      : t("profile.pwa.button.menu", "Через меню");

  const pwaHint = standalone
    ? t("profile.pwa.hint.installed", "Приложение уже на главном экране.")
    : isIOS()
      ? t("profile.pwa.hint.ios", "iPhone: «Поделиться» → «На экран Домой».")
      : deferredPrompt
        ? t("profile.pwa.hint.available", "Можно установить в один тап.")
        : t("profile.pwa.hint.menu", "Откройте меню браузера и выберите установку.");

  const pushPermText = permissionLabel(String(pushState.permission), t);
  const pushEnabled =
    pushState.permission === "granted" &&
    pushState.hasSubscription &&
    !pushState.disabledByUser;

  const pushBadge = pushEnabled ? (
    <Badge text={t("profile.push.enabled", "Включены")} tone="ok" />
  ) : pushState.permission === "denied" ? (
    <Badge text={t("profile.push.permission.denied", "Запрещены")} />
  ) : pushState.permission === "granted" ? (
    <Badge text={t("profile.push.permission.granted", "Разрешены")} tone="ok" />
  ) : (
    <Badge text={pushPermText} />
  );

  const pushHint = !pushState.supported
    ? t("profile.push.hint.unsupported", "В этом браузере уведомления недоступны.")
    : pushState.permission === "denied"
      ? t("profile.push.hint.denied", "Разрешите уведомления в настройках браузера.")
      : isIOS() && !standalone
        ? t("profile.push.hint.ios_install", "Для push на iPhone сначала установите приложение.")
        : pushEnabled
          ? t("profile.push.hint.enabled", "Будем отправлять важные уведомления.")
          : pushState.permission === "default"
            ? t("profile.push.hint.ask", "Нажмите «Включить», чтобы разрешить уведомления.")
            : pushState.permission === "granted" && pushState.disabledByUser
              ? t(
                  "profile.push.hint.disabled_by_user",
                  "Выключено вручную. Можно включить снова."
                )
              : t(
                  "profile.push.hint.subscription",
                  "Разрешение уже есть, осталось включить подписку."
                );

  const emailBadge = email
    ? emailVerified === true
      ? <Badge text={t("profile.email.badge.verified", "Подтверждён")} tone="ok" />
      : <Badge text={t("profile.email.badge.unverified", "Не подтверждён")} />
    : <Badge text={t("profile.email.badge.empty", "Не указан")} />;

  const emailHint = email
    ? emailVerified === true
      ? t(
          "profile.email.hint.verified",
          "Используется для входа и восстановления доступа."
        )
      : t(
          "profile.email.hint.unverified",
          "Добавлен как дополнительный логин. Рекомендуем подтвердить."
        )
    : t(
        "profile.email.hint.empty",
        "Добавьте email для входа и восстановления доступа."
      );

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <CardTitle icon="👤">
            {t("profile.title", "Профиль")}
          </CardTitle>
          <p className="p">{t("profile.head.sub", "Аккаунт, вход и настройки.")}</p>

          {toast ? <Toast text={toast} /> : null}

          <div className="actions actions--1">
            {isAdmin ? (
              <button className="btn btn--accent" onClick={() => nav("/admin")} type="button">
                🛠 {t("profile.admin", "Админка")}
              </button>
            ) : null}

            <button className="btn" onClick={() => setPwdModal(true)} type="button">
              🔐 {t("profile.change_password", "Сменить пароль")}
            </button>

            <button className="btn btn--danger" onClick={logout} disabled={loggingOut} type="button">
              🚪 {loggingOut ? "…" : t("profile.logout", "Выйти")}
            </button>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card__body">
            <CardTitle
              icon="🪪"
              right={
                !editPersonal ? (
                  <button className="btn" onClick={() => setEditPersonal(true)} type="button">
                    {t("profile.personal.edit", "Изменить")}
                  </button>
                ) : (
                  <div className="row">
                    <button
                      className="btn btn--primary"
                      onClick={savePersonal}
                      disabled={savingPersonal}
                      type="button"
                    >
                      {savingPersonal ? "…" : t("profile.personal.save", "Сохранить")}
                    </button>
                    <button className="btn" onClick={cancelPersonal} disabled={savingPersonal} type="button">
                      {t("profile.personal.cancel", "Отмена")}
                    </button>
                  </div>
                )
              }
            >
              {t("profile.personal.title", "Личные данные")}
            </CardTitle>

            {personalError ? <div className="pre">{personalError}</div> : null}

            <div className="profile-list">
              <RowLine
                icon="🙍"
                label={t("profile.personal.name", "Имя")}
                value={
                  editPersonal ? (
                    <input
                      className="input"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder={t("profile.personal.name_ph", "Полное имя")}
                    />
                  ) : (
                    personalNameView
                  )
                }
              />

              <RowLine
                icon="📞"
                label={t("profile.personal.phone", "Телефон")}
                value={
                  editPersonal ? (
                    <input
                      className="input"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+47…"
                    />
                  ) : (
                    personalPhoneView
                  )
                }
              />

              <RowLine
                icon="🔢"
                label={t("profile.personal.login", "Логин")}
                value={loginText || "—"}
                right={
                  loginText ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={doCopyLogin}
                      title={t("profile.personal.copy", "Скопировать")}
                    >
                      {copied ? "✓" : "📋"}
                    </button>
                  ) : null
                }
              />

              <div className="kv kv--2">
                <div className="kv__item">
                  <div className="kv__k">{t("profile.personal.id", "ID")}</div>
                  <div className="kv__v">{profile?.id ?? "—"}</div>
                </div>
                <div className="kv__item">
                  <div className="kv__k">{t("profile.personal.created", "Создан")}</div>
                  <div className="kv__v">{formatDate(created)}</div>
                </div>
              </div>

              <RowLine
                icon="🕒"
                label={t("profile.personal.last_login", "Последний вход")}
                value={formatDate(lastLogin)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card__body">
            <CardTitle icon="🔑">
              {t("profile.auth.title", "Вход и привязки")}
            </CardTitle>

            <div className="profile-list">
              <RowLine
                icon="✉️"
                label={t("profile.email.title", "Email")}
                value={
                  emailLoading
                    ? t("profile.email.loading", "Загрузка…")
                    : email || t("profile.email.empty", "Не указан")
                }
                right={
                  <>
                    {emailBadge}
                    <button className="btn" onClick={() => setEmailModal(true)} type="button">
                      {email
                        ? t("profile.email.change", "Изменить")
                        : t("profile.email.add", "Добавить")}
                    </button>
                    {email && emailVerified !== true ? (
                      <button
                        className="btn btn--primary"
                        onClick={requestVerifyEmail}
                        disabled={emailBusy}
                        type="button"
                      >
                        {emailBusy ? "…" : t("profile.email.verify", "Подтвердить")}
                      </button>
                    ) : null}
                  </>
                }
                hint={emailHint}
              />

              <RowLine
                icon="✈️"
                label="Telegram"
                value={telegramLogin ? telegramLogin : t("profile.telegram.unlinked", "Не подключен")}
                right={
                  <>
                    {telegramStatusBadge}
                    <button className="btn" onClick={() => setTgModal(true)} type="button">
                      {telegramLogin
                        ? t("profile.telegram.change", "Изменить")
                        : t("profile.telegram.link", "Подключить")}
                    </button>
                  </>
                }
                hint={t("profile.telegram.hint", "Используется для входа и уведомлений.")}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card__body">
            <CardTitle icon="⚙️">
              {t("profile.settings.title", "Настройки")}
            </CardTitle>

            <div className="profile-list">
              <div className="profile-row">
                <div className="profile-row__main">
                  <div className="profile-row__label">
                    <span aria-hidden="true">🌍</span>
                    <span>{t("profile.language.title", "Язык интерфейса")}</span>
                  </div>
                  <div className="profile-row__value">
                    {lang === "ru"
                      ? t("profile.language.ru", "Русский")
                      : t("profile.language.en", "English")}
                  </div>
                  <div className="profile-row__hint">
                    {t("profile.language.hint", "Сохраняется автоматически.")}
                  </div>
                </div>

                <div className="profile-row__right">
                  <Segmented
                    value={(lang as any) === "en" ? "en" : "ru"}
                    onChange={setLang as any}
                    ariaLabel={t("profile.language.aria", "Язык")}
                  />
                </div>
              </div>

              <div className="profile-row">
                <div className="profile-row__main">
                  <div className="profile-row__label">
                    <span aria-hidden="true">📲</span>
                    <span>{t("profile.pwa.title", "Приложение")}</span>
                  </div>
                  <div className="profile-row__value">{pwaText}</div>
                  <div className="profile-row__hint">{pwaHint}</div>
                </div>

                <div className="profile-row__right">
                  {pwaBadge}
                  {!standalone ? (
                    <button className="btn btn--primary" onClick={doInstallPwa} type="button">
                      {pwaBtnText}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="profile-row">
                <div className="profile-row__main">
                  <div className="profile-row__label">
                    <span aria-hidden="true">🔔</span>
                    <span>{t("profile.push.title", "Уведомления")}</span>
                  </div>

                  <div className="profile-row__value">
                    {pushEnabled
                      ? t("profile.push.enabled", "Включены")
                      : t("profile.push.disabled", "Выключены")} • {pushPermText}
                  </div>

                  <div className="profile-row__hint">{pushHint}</div>
                </div>

                <div className="profile-row__right">
                  {pushBadge}

                  {!pushState.supported ? (
                    <button className="btn" type="button" disabled>
                      {t("profile.push.button.unavailable", "Недоступно")}
                    </button>
                  ) : pushState.permission === "denied" ? (
                    <button className="btn" type="button" disabled>
                      {t("profile.push.button.settings", "В настройках")}
                    </button>
                  ) : isIOS() && !standalone ? (
                    <button
                      className="btn btn--primary"
                      type="button"
                      onClick={doInstallPwa}
                      disabled={pushLoading}
                    >
                      {t("profile.pwa.button.install", "Установить")}
                    </button>
                  ) : (
                    <button
                      className={`btn ${pushEnabled ? "" : "btn--primary"}`}
                      type="button"
                      onClick={togglePush}
                      disabled={pushLoading}
                    >
                      {pushLoading
                        ? "…"
                        : pushEnabled
                          ? t("profile.push.button.disable", "Выключить")
                          : t("profile.push.button.enable", "Включить")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={iosInstallModal}
        title={t("profile.pwa.ios_modal.title", "Установка на iPhone")}
        onClose={() => setIosInstallModal(false)}
        closeLabel={t("profile.modal.close", "Закрыть")}
      >
        <p className="p">
          {t(
            "profile.pwa.ios_modal.text",
            "На iPhone приложение устанавливается через меню «Поделиться»."
          )}
        </p>

        <div className="pre">
          {t(
            "profile.pwa.ios_modal.steps",
            "1) Откройте меню «Поделиться»\n2) Выберите «На экран Домой»\n3) Подтвердите добавление"
          )}
        </div>

        <div className="actions actions--1">
          <button className="btn btn--primary" onClick={() => setIosInstallModal(false)} type="button">
            {t("profile.ok", "Понятно")}
          </button>
        </div>
      </Modal>

      <Modal
        open={tgModal}
        title={
          telegramLogin
            ? t("profile.telegram.modal.change_title", "Изменить Telegram")
            : t("profile.telegram.modal.link_title", "Подключить Telegram")
        }
        onClose={() => setTgModal(false)}
        closeLabel={t("profile.modal.close", "Закрыть")}
      >
        <p className="p">{t("profile.telegram.modal.label", "Telegram логин без @")}</p>

        <input
          className="input"
          value={tgLoginDraft}
          onChange={(e) => setTgLoginDraft(e.target.value)}
          placeholder={t("profile.telegram.modal.placeholder", "например: shpunbest")}
        />

        {tgError ? <div className="pre">{tgError}</div> : null}

        <div className="actions actions--2">
          <button className="btn" onClick={() => setTgModal(false)} disabled={savingTg} type="button">
            {t("profile.personal.cancel", "Отмена")}
          </button>
          <button className="btn btn--primary" onClick={saveTelegramLogin} disabled={savingTg} type="button">
            {savingTg ? "…" : t("profile.personal.save", "Сохранить")}
          </button>
        </div>
      </Modal>

      <Modal
        open={emailModal}
        title={
          email
            ? t("profile.email.modal.change_title", "Изменить email")
            : t("profile.email.modal.add_title", "Добавить email")
        }
        onClose={() => setEmailModal(false)}
        closeLabel={t("profile.modal.close", "Закрыть")}
      >
        <p className="p">
          {t(
            "profile.email.modal.text",
            "Укажите email, который будет использоваться для входа и восстановления доступа."
          )}
        </p>

        <input
          className="input"
          value={emailDraft}
          onChange={(e) => setEmailDraft(e.target.value)}
          placeholder={t("profile.email.modal.placeholder", "name@example.com")}
          autoComplete="email"
          inputMode="email"
        />

        {emailError ? <div className="pre">{emailError}</div> : null}

        <div className="actions actions--2">
          <button className="btn" onClick={() => setEmailModal(false)} disabled={emailBusy} type="button">
            {t("profile.personal.cancel", "Отмена")}
          </button>
          <button className="btn btn--primary" onClick={saveEmail} disabled={emailBusy} type="button">
            {emailBusy ? "…" : t("profile.email.save", "Сохранить")}
          </button>
        </div>
      </Modal>

      <Modal
        open={pwdModal}
        title={t("profile.password.modal.title", "Сменить пароль")}
        onClose={() => setPwdModal(false)}
        closeLabel={t("profile.modal.close", "Закрыть")}
      >
        <p className="p">
          {t(
            "profile.password.modal.text",
            "Введите новый пароль. После сохранения нужно будет войти снова."
          )}
        </p>

        <label className="field">
          <span className="field__label">{t("profile.password.field.p1", "Новый пароль")}</span>
          <div className="pwdfield">
            <input
              className="input"
              placeholder={t("profile.password.field.p1_ph", "Минимум 8 символов")}
              value={pwd1}
              onChange={(e) => setPwd1(e.target.value)}
              type={showPwd1 ? "text" : "password"}
              autoComplete="new-password"
              disabled={pwdBusy}
            />
            <button
              type="button"
              className="btn btn--soft pwdfield__btn"
              onClick={() => setShowPwd1((v) => !v)}
              disabled={pwdBusy}
              aria-label={
                showPwd1
                  ? t("profile.password.hide_password", "Скрыть пароль")
                  : t("profile.password.show_password", "Показать пароль")
              }
              title={
                showPwd1
                  ? t("profile.password.hide", "Скрыть")
                  : t("profile.password.show", "Показать")
              }
            >
              {showPwd1 ? "🙈" : "👁"}
            </button>
          </div>
        </label>

        <label className="field">
          <span className="field__label">{t("profile.password.field.p2", "Повторите пароль")}</span>
          <div className="pwdfield">
            <input
              className="input"
              placeholder={t("profile.password.field.p2_ph", "Повторите пароль")}
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              type={showPwd2 ? "text" : "password"}
              autoComplete="new-password"
              disabled={pwdBusy}
            />
            <button
              type="button"
              className="btn btn--soft pwdfield__btn"
              onClick={() => setShowPwd2((v) => !v)}
              disabled={pwdBusy}
              aria-label={
                showPwd2
                  ? t("profile.password.hide_password", "Скрыть пароль")
                  : t("profile.password.show_password", "Показать пароль")
              }
              title={
                showPwd2
                  ? t("profile.password.hide", "Скрыть")
                  : t("profile.password.show", "Показать")
              }
            >
              {showPwd2 ? "🙈" : "👁"}
            </button>
          </div>
        </label>

        <div className="pre pwdmeter">
          <div className="pwdmeter__row">
            <span className="pwdmeter__title">{t("profile.password.strength", "Надёжность")}</span>
            <span className="pwdmeter__score">{pwdStrength}/5</span>
          </div>
          <div className="pwdmeter__tip">
            {t("profile.password.tip", "Используйте 8+ символов, цифры и спецсимволы.")}
          </div>
        </div>

        {pwdError ? <div className="pre">{pwdError}</div> : null}

        <div className="actions actions--2">
          <button className="btn" onClick={() => setPwdModal(false)} disabled={pwdBusy} type="button">
            {t("profile.personal.cancel", "Отмена")}
          </button>
          <button
            className="btn btn--primary"
            onClick={savePasswordFromProfile}
            disabled={!canSavePassword}
            type="button"
          >
            {pwdBusy ? "…" : t("profile.password.save", "Сменить пароль")}
          </button>
        </div>
      </Modal>
    </div>
  );
}