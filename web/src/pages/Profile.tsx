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

function permissionLabel(p: string) {
  if (p === "granted") return "Разрешены";
  if (p === "denied") return "Запрещены";
  if (p === "default") return "Не выбрано";
  return "Недоступно";
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
}: {
  open: boolean;
  title: string;
  children: any;
  onClose: () => void;
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
            <button className="btn" onClick={onClose} aria-label="Close">
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
}: {
  value: "ru" | "en";
  onChange: (v: "ru" | "en") => void;
}) {
  return (
    <div className="seg" role="tablist" aria-label="Language">
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
      showToast("Данные сохранены ✅");
    } catch (e: any) {
      setPersonalError(e?.message || "Не удалось сохранить изменения.");
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
      setTgError("Введите Telegram логин.");
      return;
    }
    if (!/^[a-zA-Z0-9_]{5,32}$/.test(clean)) {
      setTgError("Некорректный Telegram логин.");
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
      showToast("Telegram обновлён ✅");
    } catch (e: any) {
      setTgError(e?.message || "Не удалось сохранить Telegram логин.");
    } finally {
      setSavingTg(false);
    }
  }

  const [copied, setCopied] = useState(false);
  async function doCopyLogin() {
    if (!loginText) return;
    await copyToClipboard(loginText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await apiFetch("/logout", { method: "POST" });
    } finally {
      setLoggingOut(false);
      nav("/login", { replace: true });
    }
  }

  function goChangePassword() {
    nav("/set-password?intent=change&redirect=/profile");
  }

  // ===== PWA install =====
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
      showToast("Приложение установлено ✅");
    };

    window.addEventListener("beforeinstallprompt", onBip as any);
    window.addEventListener("appinstalled", onInstalled as any);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip as any);
      window.removeEventListener("appinstalled", onInstalled as any);
    };
  }, []);

  async function doInstallPwa() {
    if (standalone) {
      showToast("Уже установлено ✅");
      return;
    }

    if (isIOS()) {
      setIosInstallModal(true);
      return;
    }

    if (!deferredPrompt) {
      showToast("Установка через меню браузера (⋮) → «Установить приложение»");
      return;
    }

    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice?.outcome === "accepted") showToast("Установка запущена ✅");
      else showToast("Установка отменена");
    } catch {
      showToast("Не удалось запустить установку");
    } finally {
      setDeferredPrompt(null);
    }
  }

  // ===== Push state + toggle =====
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
        showToast("Уведомления выключены");
      } else {
        // iOS требует установленной PWA, остальные браузеры — нет
        if (isIOS() && !standalone) {
          showToast("Для push на iPhone нужно установить приложение (PWA) 📲");
          setIosInstallModal(true);
          return;
        }

        const ok = await enablePushByUserGesture();
        if (ok) showToast("Уведомления включены ✅");
        else {
          if (pushState.permission === "denied") showToast("Уведомления запрещены в браузере");
          else showToast("Не удалось включить уведомления");
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
          <PageStatusCard title="Услуги" text="Загрузка..." />
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
            <p className="p">Ошибка загрузки данных.</p>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn--primary" onClick={() => refetch?.()}>
                Повторить
              </button>
              <button className="btn btn--danger" onClick={logout} disabled={loggingOut}>
                {loggingOut ? "…" : t("profile.logout")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const personalNameView = savedFullName || profile?.displayName || "—";
  const personalPhoneView = savedPhone || "—";
  const telegramStatusBadge = telegramLogin ? <Badge text="Привязан" tone="ok" /> : <Badge text="Не привязан" />;
  const soonBadge = <Badge text="Скоро" tone="soon" />;

  const langHint = "Сохраняется автоматически.";

  const pwaText = standalone ? "Установлено" : "Не установлено";
  const pwaBadge = standalone ? <Badge text="Установлено" tone="ok" /> : <Badge text="Не установлено" />;

  const pwaBtnText = isIOS() ? "Как установить" : deferredPrompt ? "Установить" : "Через меню";

  const pwaHint = standalone
    ? "Есть на экране."
    : isIOS()
      ? "iPhone: «Поделиться» → «На экран Домой»."
      : deferredPrompt
        ? "Рекомендуем установить на экран."
        : "Открой меню (⋮) → «Установить приложение».";

  const pushPermText = permissionLabel(String(pushState.permission));
  const pushEnabled =
    pushState.permission === "granted" &&
    pushState.hasSubscription &&
    !pushState.disabledByUser;

  const pushBadge =
    pushEnabled ? (
      <Badge text="Включены" tone="ok" />
    ) : pushState.permission === "denied" ? (
      <Badge text="Запрещены" />
    ) : pushState.permission === "granted" ? (
      <Badge text="Разрешены" tone="ok" />
    ) : (
      <Badge text={pushPermText} />
    );

  const pushHint = !pushState.supported
    ? "Недоступно в этом браузере."
    : pushState.permission === "denied"
      ? "Разреши уведомления в настройках сайта."
      : isIOS() && !standalone
        ? "Для push на iPhone нужно установить приложение (PWA)."
        : pushEnabled
          ? "Можно присылать важные уведомления."
          : pushState.permission === "default"
            ? "Нажми «Включить», чтобы запросить доступ."
            : pushState.permission === "granted" && pushState.disabledByUser
              ? "Выключено вручную — нажми «Включить»."
              : "Разрешение есть — включи подписку.";

  return (
    <div className="section">
      {/* Header */}
      <div className="card">
        <div className="card__body">
          <CardTitle
            icon="👤"
            right={
              <button className="btn" onClick={() => refetch?.()} title={t("profile.refresh")}>
                {t("profile.refresh")}
              </button>
            }
          >
            {t("profile.title")}
          </CardTitle>

          <p className="p">Аккаунт • привязки • настройки</p>

          {toast ? <Toast text={toast} /> : null}

          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            <button className="btn" onClick={goChangePassword} style={{ width: "100%" }}>
              🔐 {t("profile.change_password")}
            </button>

            <button
              className="btn btn--danger"
              onClick={logout}
              disabled={loggingOut}
              style={{ width: "100%" }}
            >
              🚪 {loggingOut ? "…" : t("profile.logout")}
            </button>
          </div>
        </div>
      </div>

      {/* Personal */}
      <div className="section" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card__body">
            <CardTitle
              icon="🪪"
              right={
                !editPersonal ? (
                  <button className="btn" onClick={() => setEditPersonal(true)}>
                    Редактировать
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button className="btn btn--primary" onClick={savePersonal} disabled={savingPersonal}>
                      {savingPersonal ? "…" : "Сохранить"}
                    </button>
                    <button className="btn" onClick={cancelPersonal} disabled={savingPersonal}>
                      Отмена
                    </button>
                  </div>
                )
              }
            >
              Личные данные
            </CardTitle>

            {personalError ? (
              <div className="pre" style={{ marginTop: 10 }}>
                {personalError}
              </div>
            ) : null}

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <RowLine
                icon="🙍"
                label="Имя"
                value={
                  editPersonal ? (
                    <input
                      className="input"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Полное имя"
                      style={{ width: "100%" }}
                    />
                  ) : (
                    personalNameView
                  )
                }
              />

              <RowLine
                icon="📞"
                label="Телефон"
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
                label="Логин"
                value={loginText || "—"}
                right={
                  loginText ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={doCopyLogin}
                      style={{ padding: "6px 10px", opacity: 0.9 }}
                      title="Copy"
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
                <RowLine icon="🆔" label="ID" value={profile?.id ?? "—"} />
                <RowLine icon="📅" label="Создан" value={formatDate(created)} />
              </div>

              <RowLine icon="🕒" label="Последний вход" value={formatDate(lastLogin)} />
            </div>
          </div>
        </div>
      </div>

      {/* Auth */}
      <div className="section" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card__body">
            <CardTitle icon="🔑">Авторизация и привязки</CardTitle>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <RowLine
                icon="✈️"
                label="Telegram"
                value={telegramLogin ? `${telegramLogin}` : "Не привязан"}
                right={
                  <>
                    {telegramStatusBadge}
                    <button className="btn" onClick={() => setTgModal(true)}>
                      {telegramLogin ? "Изменить" : "Привязать"}
                    </button>
                  </>
                }
                hint="Используется для входа и уведомлений."
              />

              <RowLine icon="🟦" label="Google" value="OAuth" right={soonBadge} />
              <RowLine icon="🟥" label="Yandex" value="OAuth" right={soonBadge} />
            </div>
          </div>
        </div>
      </div>

      {/* Settings */}
      <div className="section" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card__body">
            <CardTitle icon="⚙️">Настройки</CardTitle>

            <div className="profile-list">
              {/* Language */}
              <div className="profile-row">
                <div className="profile-row__main">
                  <div className="profile-row__label">
                    <span aria-hidden="true">🌍</span>
                    <span>Язык интерфейса</span>
                  </div>
                  <div className="profile-row__value">{lang === "ru" ? "Русский" : "English"}</div>
                  <div className="profile-row__hint">{langHint}</div>
                </div>

                <div className="profile-row__right">
                  <Segmented value={(lang as any) === "en" ? "en" : "ru"} onChange={setLang as any} />
                </div>
              </div>

              {/* PWA */}
              <div className="profile-row">
                <div className="profile-row__main">
                  <div className="profile-row__label">
                    <span aria-hidden="true">📲</span>
                    <span>Приложение (PWA)</span>
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

              {/* Push */}
              <div className="profile-row">
                <div className="profile-row__main">
                  <div className="profile-row__label">
                    <span aria-hidden="true">🔔</span>
                    <span>Push-уведомления</span>
                  </div>

                  <div className="profile-row__value">
                    {pushEnabled ? "Включены" : "Выключены"} • {pushPermText}
                  </div>

                  <div className="profile-row__hint">{pushHint}</div>
                </div>

                <div className="profile-row__right">
                  {pushBadge}

                  {!pushState.supported ? (
                    <button className="btn" type="button" disabled>
                      Недоступно
                    </button>
                  ) : pushState.permission === "denied" ? (
                    <button className="btn" type="button" disabled>
                      В настройках
                    </button>
                  ) : isIOS() && !standalone ? (
                    <button className="btn btn--primary" type="button" onClick={doInstallPwa} disabled={pushLoading}>
                      Установить
                    </button>
                  ) : (
                    <button
                      className={`btn ${pushEnabled ? "" : "btn--primary"}`}
                      type="button"
                      onClick={togglePush}
                      disabled={pushLoading}
                    >
                      {pushLoading ? "…" : pushEnabled ? "Выключить" : "Включить"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal open={iosInstallModal} title="Установка на iPhone" onClose={() => setIosInstallModal(false)}>
        <div className="p" style={{ marginTop: 0 }}>
          iOS устанавливает PWA через меню <b>Поделиться</b>.
        </div>
        <div className="pre" style={{ marginTop: 10 }}>
          1) Открой меню “Поделиться” (иконка квадрат со стрелкой вверх)
          {"\n"}2) Выбери “На экран Домой”
          {"\n"}3) Подтверди “Добавить”
        </div>
        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button className="btn btn--primary" onClick={() => setIosInstallModal(false)}>
            Понятно
          </button>
        </div>
      </Modal>

      <Modal
        open={tgModal}
        title={telegramLogin ? "Изменить Telegram" : "Привязать Telegram"}
        onClose={() => setTgModal(false)}
      >
        <div className="p" style={{ marginTop: 0 }}>
          Telegram логин (без <b>@</b>)
        </div>

        <input
          className="input"
          value={tgLoginDraft}
          onChange={(e) => setTgLoginDraft(e.target.value)}
          placeholder="например: shpunbest"
          style={{ width: "100%", marginTop: 8 }}
        />

        {tgError ? (
          <div className="pre" style={{ marginTop: 10 }}>
            {tgError}
          </div>
        ) : null}

        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => setTgModal(false)} disabled={savingTg}>
            Отмена
          </button>
          <button className="btn btn--primary" onClick={saveTelegramLogin} disabled={savingTg}>
            {savingTg ? "…" : "Сохранить"}
          </button>
        </div>
      </Modal>
    </div>
  );
}