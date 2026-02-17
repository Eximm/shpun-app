import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { apiFetch } from "../shared/api/client";
import { useI18n } from "../shared/i18n";

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

function isTelegramWebView() {
  const w = window as any;
  const hasTg = !!w?.Telegram?.WebApp;
  const ua = String(navigator.userAgent || "");
  return hasTg || ua.includes("Telegram");
}

function isStandaloneMode() {
  const w = window as any;
  if (typeof w?.navigator?.standalone === "boolean") return !!w.navigator.standalone; // iOS
  return window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
}

type InstallPromptEvent = Event & {
  prompt?: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function CardTitle({ children }: { children: any }) {
  return (
    <div className="h1" style={{ fontSize: 18, margin: 0 }}>
      {children}
    </div>
  );
}

function SmallMuted({ children }: { children: any }) {
  return (
    <div className="p" style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
      {children}
    </div>
  );
}

function FieldRow({
  label,
  value,
  action,
}: {
  label: string;
  value: any;
  action?: any;
}) {
  return (
    <div className="kv__item">
      <div className="kv__k">{label}</div>
      <div
        className="kv__v"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "nowrap",
          width: "100%",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>{value}</div>
        {action}
      </div>
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
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
    <>
      <style>{`
        @keyframes shp_toast_in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shp_toast_out {
          from { opacity: 1; transform: translateY(0); }
          to   { opacity: 0; transform: translateY(-6px); }
        }
      `}</style>
      <div
        className="pre"
        style={{
          marginTop: 12,
          animation: "shp_toast_in 140ms ease-out",
        }}
      >
        {text}
      </div>
    </>
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

  // ---- Local UI state (to avoid full refetch after saves) ----
  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  }

  // Personal fields
  const [editPersonal, setEditPersonal] = useState(false);
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [personalError, setPersonalError] = useState<string | null>(null);

  const [fullName, setFullName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [savedFullName, setSavedFullName] = useState<string>("");
  const [savedPhone, setSavedPhone] = useState<string>("");

  // Telegram
  const [telegramLocal, setTelegramLocal] = useState<any>(null);
  const telegramRaw = telegramLocal ?? me?.telegram ?? null;

  const telegramLogin = useMemo(() => {
    const raw = telegramRaw?.login ?? telegramRaw?.username ?? "";
    const s = String(raw ?? "").trim();
    if (!s) return "";
    return s.startsWith("@") ? s : `@${s}`;
  }, [telegramRaw?.login, telegramRaw?.username]);

  // Copy login
  const [copied, setCopied] = useState(false);

  // Logout
  const [loggingOut, setLoggingOut] = useState(false);

  // Telegram modal
  const [tgModal, setTgModal] = useState(false);
  const [tgLoginDraft, setTgLoginDraft] = useState<string>("");
  const [savingTg, setSavingTg] = useState(false);
  const [tgError, setTgError] = useState<string | null>(null);

  // PWA install state
  const [tgWebView, setTgWebView] = useState<boolean>(() => isTelegramWebView());
  const [standalone, setStandalone] = useState<boolean>(() => isStandaloneMode());
  const installEventRef = useRef<InstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState<boolean>(false);
  const [installing, setInstalling] = useState<boolean>(false);

  // Sync local fields from /me
  useEffect(() => {
    const fn = String(profile?.fullName ?? profile?.full_name ?? profile?.displayName ?? "").trim();
    const ph = String(profile?.phone ?? "").trim();
    setFullName(fn);
    setPhone(ph);
    setSavedFullName(fn);
    setSavedPhone(ph);
    // do not include editPersonal to avoid overriding during edit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.fullName, profile?.full_name, profile?.displayName, profile?.phone]);

  useEffect(() => {
    // keep local telegram snapshot in sync with /me when not yet changed locally
    if (!telegramLocal && me?.telegram) setTelegramLocal(me.telegram);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.telegram]);

  useEffect(() => {
    if (!tgModal) {
      setTgLoginDraft(String(telegramLogin || "").replace(/^@/, ""));
      setTgError(null);
    }
  }, [tgModal, telegramLogin]);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault?.();
      installEventRef.current = e as InstallPromptEvent;
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", onBip as any);

    const refreshEnv = () => {
      setTgWebView(isTelegramWebView());
      setStandalone(isStandaloneMode());
    };
    window.addEventListener("resize", refreshEnv);
    document.addEventListener("visibilitychange", refreshEnv);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip as any);
      window.removeEventListener("resize", refreshEnv);
      document.removeEventListener("visibilitychange", refreshEnv);
    };
  }, []);

  async function logout() {
    setLoggingOut(true);
    try {
      await apiFetch("/logout", { method: "POST" });
    } finally {
      setLoggingOut(false);
      nav("/login", { replace: true });
    }
  }

  async function doCopyLogin() {
    if (!loginText) return;
    await copyToClipboard(loginText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  function goChangePassword() {
    nav("/set-password?intent=change&redirect=/profile");
  }

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
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
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
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: clean }),
      });

      // /api/user/telegram returns { ok: true, telegram: ... }
      const tg = resp?.telegram ?? null;
      if (tg) {
        // normalize to what /me provides
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

  function openLoginInBrowser() {
    const url = `${window.location.origin}/login`;
    const w = window as any;
    if (w?.Telegram?.WebApp?.openLink) w.Telegram.WebApp.openLink(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  async function doInstallPwa() {
    const ev = installEventRef.current;
    if (!ev?.prompt) return;
    setInstalling(true);
    try {
      await ev.prompt();
      try {
        await ev.userChoice;
      } catch {
        // ignore
      }
      setStandalone(isStandaloneMode());
      setCanInstall(false);
      installEventRef.current = null;
      showToast("Установка завершена ✅");
    } finally {
      setInstalling(false);
    }
  }

  if (loading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("profile.title")}</h1>
            <p className="p">Загрузка…</p>
          </div>
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

  const pwaTitle = tgWebView ? "Открыто в Telegram" : standalone ? "Установлено" : "Открыто в браузере";
  const pwaHint = tgWebView
    ? "Для установки PWA откройте приложение в браузере и войдите через Telegram Widget."
    : standalone
    ? "Приложение установлено и будет открываться как отдельное."
    : canInstall
    ? "Можно установить приложение одним нажатием."
    : "Если кнопки установки нет — используйте меню браузера: «Установить приложение / Add to Home screen».";

  return (
    <div className="section">
      {/* Header */}
      <div className="card">
        <div className="card__body">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <h1 className="h1">{t("profile.title")}</h1>
              <p className="p">Управление аккаунтом и привязками</p>
            </div>

            <button className="btn" onClick={() => refetch?.()} title={t("profile.refresh")}>
              {t("profile.refresh")}
            </button>
          </div>

          {toast ? <Toast text={toast} /> : null}

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
            }}
          >
            <button className="btn" onClick={goChangePassword} style={{ width: "100%" }}>
              {t("profile.change_password")}
            </button>

            <button className="btn btn--danger" onClick={logout} disabled={loggingOut} style={{ width: "100%" }}>
              {loggingOut ? "…" : t("profile.logout")}
            </button>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 14,
        }}
      >
        {/* LEFT */}
        <div style={{ display: "grid", gap: 14 }}>
          {/* Personal */}
          <div className="card">
            <div className="card__body">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <CardTitle>Личные данные</CardTitle>

                {!editPersonal ? (
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
                )}
              </div>

              {personalError ? (
                <div className="pre" style={{ marginTop: 10 }}>
                  {personalError}
                </div>
              ) : null}

              <div className="kv" style={{ marginTop: 10 }}>
                <FieldRow
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
                      savedFullName || profile?.displayName || "—"
                    )
                  }
                />

                <FieldRow
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
                      savedPhone || "—"
                    )
                  }
                />

                <FieldRow
                  label="Логин"
                  value={
                    <span
                      style={{
                        display: "block",
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {loginText || "—"}
                    </span>
                  }
                  action={
                    loginText ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={doCopyLogin}
                        style={{ padding: "6px 10px", marginLeft: "auto" }}
                        title="Copy"
                      >
                        {copied ? t("profile.copied") : t("profile.copy")}
                      </button>
                    ) : null
                  }
                />

                <FieldRow label="ID" value={profile?.id ?? "—"} />
                <FieldRow label="Создан" value={formatDate(created)} />
                <FieldRow label="Последний вход" value={formatDate(lastLogin)} />
              </div>
            </div>
          </div>

          {/* Settings (language + notifications) */}
          <div className="card">
            <div className="card__body">
              <CardTitle>Настройки приложения</CardTitle>

              <div style={{ marginTop: 10 }}>
                <div className="p" style={{ margin: 0, opacity: 0.85 }}>
                  Язык интерфейса
                </div>

                <div className="row" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className={`btn ${lang === "ru" ? "btn--primary" : ""}`}
                    onClick={() => setLang("ru")}
                  >
                    {t("profile.lang.ru")}
                  </button>

                  <button
                    type="button"
                    className={`btn ${lang === "en" ? "btn--primary" : ""}`}
                    onClick={() => setLang("en")}
                  >
                    {t("profile.lang.en")}
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div className="p" style={{ margin: 0, opacity: 0.85 }}>
                  Уведомления
                </div>
                <SmallMuted>Скоро: управление Push/Telegram уведомлениями и важными событиями аккаунта.</SmallMuted>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display: "grid", gap: 14 }}>
          {/* Auth & bindings */}
          <div className="card">
            <div className="card__body">
              <CardTitle>Авторизация и привязки</CardTitle>

              <div className="kv" style={{ marginTop: 10 }}>
                <div className="kv__item">
                  <div className="kv__k">Telegram</div>
                  <div
                    className="kv__v"
                    style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
                  >
                    <span>
                      {telegramLogin ? (
                        <>
                          <b>{telegramLogin}</b> <span style={{ opacity: 0.8 }}>— привязан</span>
                        </>
                      ) : (
                        "Не привязан"
                      )}
                    </span>
                    <button className="btn" onClick={() => setTgModal(true)}>
                      {telegramLogin ? "Изменить" : "Привязать"}
                    </button>
                  </div>
                  <SmallMuted>Привязка Telegram используется для входа и уведомлений.</SmallMuted>
                </div>

                <div className="kv__item">
                  <div className="kv__k">Google</div>
                  <div className="kv__v">Скоро</div>
                </div>

                <div className="kv__item">
                  <div className="kv__k">Yandex</div>
                  <div className="kv__v">Скоро</div>
                </div>
              </div>
            </div>
          </div>

          {/* PWA */}
          <div className="card">
            <div className="card__body">
              <CardTitle>PWA и установка</CardTitle>

              <div style={{ marginTop: 10 }}>
                <div className="p" style={{ margin: 0, opacity: 0.85 }}>
                  Статус: <b>{pwaTitle}</b>
                </div>
                <SmallMuted>{pwaHint}</SmallMuted>
              </div>

              <div style={{ marginTop: 12 }}>
                {tgWebView ? (
                  <button className="btn btn--primary" onClick={openLoginInBrowser} style={{ width: "100%" }}>
                    Открыть в браузере (для установки)
                  </button>
                ) : (
                  <button
                    className={`btn ${canInstall && !standalone ? "btn--primary" : ""}`}
                    onClick={doInstallPwa}
                    disabled={!canInstall || installing || standalone}
                    style={{ width: "100%" }}
                    title={!canInstall ? "Браузер не предлагает установку сейчас." : ""}
                  >
                    {standalone ? "Уже установлено ✅" : installing ? "…" : canInstall ? "Установить" : "Установка недоступна"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Telegram modal */}
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
          placeholder="например: nivats"
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
