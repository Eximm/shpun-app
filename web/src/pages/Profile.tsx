// FILE: web/src/pages/Profile.tsx
import { Children, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { apiFetch } from "../shared/api/client";
import { useI18n } from "../shared/i18n";
import {
  disablePush,
  enablePushByUserGesture,
  getPushState,
  isPushDisabledByUser,
} from "../app/notifications/push";
import { PageStatusCard } from "../shared/ui/PageStatusCard";

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
  return s ? s : "—";
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

function permissionLabel(p: string, t: (k: string, fb?: string) => string) {
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
  children: any;
  right?: any;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div
        className="h1"
        style={{
          fontSize: 18,
          margin: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {icon ? <span aria-hidden="true">{icon}</span> : null}
        <span>{children}</span>
      </div>
      {right}
    </div>
  );
}

function Badge({
  text,
  tone = "neutral",
}: {
  text: string;
  tone?: "ok" | "soon" | "neutral";
}) {
  let className = "badge";

  if (tone === "ok") className += " chip--ok";
  if (tone === "soon") className += " chip--warn";

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
  value?: any;
  right?: any;
  hint?: any;
}) {
  const rightCount = right ? Children.count(right) : 0;

  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,.08)",
        background: "rgba(255,255,255,.02)",
        transition: "transform 120ms ease, background 120ms ease, border-color 120ms ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,.04)";
        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,.14)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,.02)";
        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,.08)";
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            minWidth: 0,
          }}
        >
          {icon ? (
            <span
              aria-hidden="true"
              style={{
                opacity: 0.9,
                width: 22,
                display: "inline-flex",
                justifyContent: "center",
              }}
            >
              {icon}
            </span>
          ) : null}

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
            {value != null ? (
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {value}
              </div>
            ) : null}
          </div>
        </div>

        {right ? (
          rightCount <= 1 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>{right}</div>
          ) : (
            <div
              className="rowline__right rowline__right--grid"
              style={{
                display: "grid",
                gridAutoFlow: "column",
                gridAutoColumns: "120px",
                gap: 10,
                alignItems: "center",
                justifyContent: "end",
              }}
            >
              {right}
            </div>
          )
        ) : null}
      </div>

      {hint ? <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>{hint}</div> : null}
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
  children: any;
  onClose: () => void;
  closeLabel: string;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: 16,
        zIndex: 9999,
      }}
    >
      <div
        className="card"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(680px, 100%)" }}
      >
        <div className="card__body">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div className="h1" style={{ fontSize: 18, margin: 0 }}>
              {title}
            </div>
            <button className="btn" onClick={onClose} aria-label={closeLabel}>
              ✕
            </button>
          </div>
          <div style={{ marginTop: 12 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

function Toast({ text }: { text: string }) {
  return (
    <div className="pre" style={{ marginTop: 12 }}>
      {text}
    </div>
  );
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
    window.setTimeout(() => setToast(null), 1800);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setPersonalError(e?.message || t("profile.personal.error", "Не удалось сохранить изменения."));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.telegram]);

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
      setTgError(e?.message || t("profile.telegram.error.save", "Не удалось сохранить Telegram логин."));
    } finally {
      setSavingTg(false);
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
      const uid =
        Number(profile?.id ?? me?.profile?.id ?? me?.id ?? 0) || 0;

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

  function goChangePassword() {
    nav("/set-password?intent=change&redirect=/profile");
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
      if (choice?.outcome === "accepted") showToast(t("profile.pwa.toast.started", "Установка запущена"));
      else showToast(t("profile.pwa.toast.cancelled", "Установка отменена"));
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
    refreshPush();
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
          showToast(t("profile.push.toast.install_ios", "Для push на iPhone сначала установите приложение."));
          setIosInstallModal(true);
          return;
        }

        const ok = await enablePushByUserGesture();
        if (ok) showToast(t("profile.push.toast.enabled", "Уведомления включены"));
        else {
          if (pushState.permission === "denied") showToast(t("profile.push.toast.denied", "Уведомления запрещены в браузере."));
          else showToast(t("profile.push.toast.failed", "Не удалось включить уведомления."));
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
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn--primary" onClick={() => refetch?.()}>
                {t("profile.error.retry", "Повторить")}
              </button>
              <button className="btn btn--danger" onClick={logout} disabled={loggingOut}>
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
  const telegramStatusBadge = telegramLogin
    ? <Badge text={t("profile.telegram.badge.linked", "Подключен")} tone="ok" />
    : <Badge text={t("profile.telegram.badge.unlinked", "Не подключен")} />;
  const soonBadge = <Badge text={t("profile.soon", "Скоро")} tone="soon" />;

  const langHint = t("profile.language.hint", "Сохраняется автоматически.");

  const pwaText = standalone
    ? t("profile.pwa.installed", "Установлено")
    : t("profile.pwa.not_installed", "Не установлено");

  const pwaBadge = standalone
    ? <Badge text={t("profile.pwa.installed", "Установлено")} tone="ok" />
    : <Badge text={t("profile.pwa.not_installed", "Не установлено")} />;

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

  const pushBadge =
    pushEnabled ? (
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
              ? t("profile.push.hint.disabled_by_user", "Выключено вручную. Можно включить снова.")
              : t("profile.push.hint.subscription", "Разрешение уже есть, осталось включить подписку.");

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <CardTitle
            icon="👤"
            right={
              <button className="btn" onClick={() => refetch?.()} title={t("profile.refresh", "Обновить")}>
                {t("profile.refresh", "Обновить")}
              </button>
            }
          >
            {t("profile.title", "Профиль")}
          </CardTitle>

          <p className="p">{t("profile.head.sub", "Аккаунт, вход и настройки.")}</p>

          {toast ? <Toast text={toast} /> : null}

          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            {isAdmin ? (
              <button className="btn btn--accent" onClick={() => nav("/admin/broadcasts")} style={{ width: "100%" }}>
                🛠 Broadcasts
              </button>
            ) : null}

            <button className="btn" onClick={goChangePassword} style={{ width: "100%" }}>
              🔐 {t("profile.change_password", "Сменить пароль")}
            </button>

            <button
              className="btn btn--danger"
              onClick={logout}
              disabled={loggingOut}
              style={{ width: "100%" }}
            >
              🚪 {loggingOut ? "…" : t("profile.logout", "Выйти")}
            </button>
          </div>
        </div>
      </div>

      <div className="section" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card__body">
            <CardTitle
              icon="🪪"
              right={
                !editPersonal ? (
                  <button className="btn" onClick={() => setEditPersonal(true)}>
                    {t("profile.personal.edit", "Изменить")}
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button className="btn btn--primary" onClick={savePersonal} disabled={savingPersonal}>
                      {savingPersonal ? "…" : t("profile.personal.save", "Сохранить")}
                    </button>
                    <button className="btn" onClick={cancelPersonal} disabled={savingPersonal}>
                      {t("profile.personal.cancel", "Отмена")}
                    </button>
                  </div>
                )
              }
            >
              {t("profile.personal.title", "Личные данные")}
            </CardTitle>

            {personalError ? (
              <div className="pre" style={{ marginTop: 10 }}>
                {personalError}
              </div>
            ) : null}

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
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
                      style={{ width: "100%" }}
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
                      style={{ width: "100%" }}
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
                      style={{ padding: "6px 10px", opacity: 0.9 }}
                      title={t("profile.personal.copy", "Скопировать")}
                    >
                      {copied ? "✓" : "📋"}
                    </button>
                  ) : null
                }
              />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 10,
                }}
              >
                <RowLine icon="🆔" label={t("profile.personal.id", "ID")} value={profile?.id ?? "—"} />
                <RowLine icon="📅" label={t("profile.personal.created", "Создан")} value={formatDate(created)} />
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

      <div className="section" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card__body">
            <CardTitle icon="🔑">{t("profile.auth.title", "Вход и привязки")}</CardTitle>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <RowLine
                icon="✈️"
                label="Telegram"
                value={telegramLogin ? `${telegramLogin}` : t("profile.telegram.unlinked", "Не подключен")}
                right={
                  <>
                    {telegramStatusBadge}
                    <button className="btn" onClick={() => setTgModal(true)}>
                      {telegramLogin
                        ? t("profile.telegram.change", "Изменить")
                        : t("profile.telegram.link", "Подключить")}
                    </button>
                  </>
                }
                hint={t("profile.telegram.hint", "Используется для входа и уведомлений.")}
              />

              <RowLine icon="🟦" label="Google" value="OAuth" right={soonBadge} />
              <RowLine icon="🟥" label="Yandex" value="OAuth" right={soonBadge} />
            </div>
          </div>
        </div>
      </div>

      <div className="section" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card__body">
            <CardTitle icon="⚙️">{t("profile.settings.title", "Настройки")}</CardTitle>

            <div className="profile-list">
              <div className="profile-row">
                <div className="profile-row__main">
                  <div className="profile-row__label">
                    <span aria-hidden="true">🌍</span>
                    <span>{t("profile.language.title", "Язык интерфейса")}</span>
                  </div>
                  <div className="profile-row__value">
                    {lang === "ru" ? t("profile.language.ru", "Русский") : t("profile.language.en", "English")}
                  </div>
                  <div className="profile-row__hint">{langHint}</div>
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
                    {pushEnabled ? t("profile.push.enabled", "Включены") : t("profile.push.disabled", "Выключены")} • {pushPermText}
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
                    <button className="btn btn--primary" type="button" onClick={doInstallPwa} disabled={pushLoading}>
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
        <div className="p" style={{ marginTop: 0 }}>
          {t("profile.pwa.ios_modal.text", "На iPhone приложение устанавливается через меню «Поделиться».")}
        </div>
        <div className="pre" style={{ marginTop: 10 }}>
          {t(
            "profile.pwa.ios_modal.steps",
            "1) Откройте меню «Поделиться»\n2) Выберите «На экран Домой»\n3) Подтвердите добавление"
          )}
        </div>
        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button className="btn btn--primary" onClick={() => setIosInstallModal(false)}>
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
        <div className="p" style={{ marginTop: 0 }}>
          {t("profile.telegram.modal.label", "Telegram логин без @")}
        </div>

        <input
          className="input"
          value={tgLoginDraft}
          onChange={(e) => setTgLoginDraft(e.target.value)}
          placeholder={t("profile.telegram.modal.placeholder", "например: shpunbest")}
          style={{ width: "100%", marginTop: 8 }}
        />

        {tgError ? (
          <div className="pre" style={{ marginTop: 10 }}>
            {tgError}
          </div>
        ) : null}

        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => setTgModal(false)} disabled={savingTg}>
            {t("profile.personal.cancel", "Отмена")}
          </button>
          <button className="btn btn--primary" onClick={saveTelegramLogin} disabled={savingTg}>
            {savingTg ? "…" : t("profile.personal.save", "Сохранить")}
          </button>
        </div>
      </Modal>
    </div>
  );
}