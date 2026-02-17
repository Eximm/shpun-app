import { useEffect, useMemo, useState } from "react";
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

function SmallMuted({ children }: { children: any }) {
  return (
    <div className="p" style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
      {children}
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
  const bg =
    tone === "ok"
      ? "rgba(46, 204, 113, .14)"
      : tone === "soon"
      ? "rgba(241, 196, 15, .14)"
      : "rgba(255,255,255,.08)";

  const bd =
    tone === "ok"
      ? "rgba(46, 204, 113, .35)"
      : tone === "soon"
      ? "rgba(241, 196, 15, .35)"
      : "rgba(255,255,255,.12)";

  return (
    <span
      style={{
        fontSize: 12,
        padding: "4px 8px",
        borderRadius: 999,
        border: `1px solid ${bd}`,
        background: bg,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
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
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,.08)",
        background: "rgba(255,255,255,.02)",
        transition:
          "transform 120ms ease, background 120ms ease, border-color 120ms ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background =
          "rgba(255,255,255,.04)";
        (e.currentTarget as HTMLDivElement).style.borderColor =
          "rgba(255,255,255,.14)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background =
          "rgba(255,255,255,.02)";
        (e.currentTarget as HTMLDivElement).style.borderColor =
          "rgba(255,255,255,.08)";
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
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {right}
          </div>
        ) : null}
      </div>

      {hint ? (
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>{hint}</div>
      ) : null}
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
    <>
      <style>{`
        @keyframes shp_toast_in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
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

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  }

  // Personal
  const [editPersonal, setEditPersonal] = useState(false);
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [personalError, setPersonalError] = useState<string | null>(null);

  const [fullName, setFullName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [savedFullName, setSavedFullName] = useState<string>("");
  const [savedPhone, setSavedPhone] = useState<string>("");

  useEffect(() => {
    const fn = String(
      profile?.fullName ?? profile?.full_name ?? profile?.displayName ?? ""
    ).trim();
    const ph = String(profile?.phone ?? "").trim();
    setFullName(fn);
    setPhone(ph);
    setSavedFullName(fn);
    setSavedPhone(ph);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    profile?.fullName,
    profile?.full_name,
    profile?.displayName,
    profile?.phone,
  ]);

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

  // Telegram binding
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
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: clean }),
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

  // Copy login
  const [copied, setCopied] = useState(false);
  async function doCopyLogin() {
    if (!loginText) return;
    await copyToClipboard(loginText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  // Logout / password
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
              <button
                className="btn btn--danger"
                onClick={logout}
                disabled={loggingOut}
              >
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
  const telegramStatusBadge = telegramLogin ? (
    <Badge text="Привязан" tone="ok" />
  ) : (
    <Badge text="Не привязан" />
  );
  const soonBadge = <Badge text="Скоро" tone="soon" />;

  return (
    <div className="section">
      {/* Header */}
      <div className="card">
        <div className="card__body">
          <CardTitle
            icon="👤"
            right={
              <button
                className="btn"
                onClick={() => refetch?.()}
                title={t("profile.refresh")}
              >
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
                    <button
                      className="btn btn--primary"
                      onClick={savePersonal}
                      disabled={savingPersonal}
                    >
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
                icon="🆔"
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
                <RowLine icon="🔢" label="ID" value={profile?.id ?? "—"} />
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

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <RowLine
                icon="🌍"
                label="Язык интерфейса"
                value={lang === "ru" ? "Русский" : "English"}
                right={
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={`btn ${lang === "ru" ? "btn--primary" : ""}`}
                      onClick={() => setLang("ru")}
                    >
                      Русский
                    </button>
                    <button
                      type="button"
                      className={`btn ${lang === "en" ? "btn--primary" : ""}`}
                      onClick={() => setLang("en")}
                    >
                      English
                    </button>
                  </div>
                }
              />

              <RowLine
                icon="🔔"
                label="Уведомления"
                value="Скоро"
                right={soonBadge}
                hint="Позже добавим управление Push/Telegram уведомлениями."
              />
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
