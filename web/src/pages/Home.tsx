import { Link } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "../shared/i18n";

function Money({ amount, currency }: { amount: number; currency: string }) {
  const formatted =
    currency === "RUB"
      ? new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
      : new Intl.NumberFormat("ru-RU").format(amount) + ` ${currency}`;
  return <>{formatted}</>;
}

function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

type TransferState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; consumeUrl: string; expiresAt?: number }
  | { status: "error"; message: string };

type PromoState =
  | { status: "idle" }
  | { status: "applying" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function ActionGrid({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  const n = Math.max(1, Math.min(5, items.length));
  return <div className={`actions actions--${n}`}>{items}</div>;
}

function isTelegramWebApp(): boolean {
  return !!(window as any)?.Telegram?.WebApp;
}

function openInBrowser(url: string) {
  const tg = (window as any)?.Telegram?.WebApp;
  // В Telegram пытаемся открыть ссылку так, чтобы она ушла во внешний браузер.
  // У разных клиентов Telegram поведение отличается, поэтому делаем best-effort + fallback.
  if (tg?.openLink) {
    try {
      // Некоторые клиенты принимают 2-й параметр (options)
      tg.openLink(url, { try_instant_view: false });
      return;
    } catch {
      try {
        tg.openLink(url);
        return;
      } catch {
        // fallback below
      }
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function Home() {
  const { t } = useI18n();
  const { me, loading, error, refetch } = useMe();

  const [transfer, setTransfer] = useState<TransferState>({ status: "idle" });
  const [showTransferLink, setShowTransferLink] = useState(false);

  const [promo, setPromo] = useState<{ code: string; state: PromoState }>({
    code: "",
    state: { status: "idle" },
  });

  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [installState, setInstallState] = useState<
    "idle" | "prompting" | "done"
  >("idle");

  const inTelegram = isTelegramWebApp();

  const profile = me?.profile;
  const balance = me?.balance;

  const displayName = profile?.displayName || profile?.login || "";

  useEffect(() => {
    const handler = (e: Event) => {
      (e as any).preventDefault?.();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler as any);
    return () =>
      window.removeEventListener("beforeinstallprompt", handler as any);
  }, []);

  // Важно: install prompt показываем только в обычном браузере (не в Telegram WebApp)
  const canInstall = !inTelegram && !!installEvt && installState !== "done";

  async function runInstall() {
    // дополнительная защита: в Telegram install-подсказку вообще не открываем
    if (!installEvt || inTelegram) return;

    try {
      setInstallState("prompting");
      await installEvt.prompt();
      const choice = await installEvt.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") {
        setInstallState("done");
        setInstallEvt(null);
      } else {
        setInstallState("idle");
      }
    } catch {
      setInstallState("idle");
    }
  }

  const transferHint = useMemo(() => {
    if (transfer.status !== "ready") return "";
    if (!transfer.expiresAt)
      return t("home.desktop.hint.default", "Код одноразовый и быстро истекает.");
    const leftMs = transfer.expiresAt - Date.now();
    const leftSec = Math.max(0, Math.floor(leftMs / 1000));
    if (leftSec <= 0)
      return t("home.desktop.hint.expired", "Срок действия кода истёк. Нажми ещё раз.");
    return t(
      "home.desktop.hint.left",
      `Код одноразовый. Действует примерно ${leftSec} сек.`
    ).replace("{sec}", String(leftSec));
  }, [transfer, t]);

  async function startTransferAndOpen() {
    try {
      setTransfer({ status: "loading" });
      setShowTransferLink(false);

      const res = await fetch("/api/auth/transfer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        const msg =
          json?.error === "not_authenticated"
            ? t(
                "error.open_in_tg",
                "Откройте это приложение внутри Telegram, чтобы войти."
              )
            : String(json?.error || "transfer_start_failed");
        setTransfer({ status: "error", message: msg });
        return;
      }

      const consumeUrl = String(json.consume_url || "").trim();
      if (!consumeUrl) {
        setTransfer({
          status: "error",
          message: t("home.desktop.error.title", "Не получилось") + ": consume_url",
        });
        return;
      }

      const expiresAt = Number(json.expires_at || 0) || undefined;

      setTransfer({
        status: "ready",
        consumeUrl,
        expiresAt,
      });

      openInBrowser(consumeUrl);
    } catch (e: any) {
      setTransfer({
        status: "error",
        message: e?.message || t("home.desktop.error.title", "Не получилось"),
      });
    }
  }

  async function copyTransferUrl() {
    if (transfer.status !== "ready") return;
    const url = transfer.consumeUrl;

    try {
      await navigator.clipboard.writeText(url);
      alert(t("home.desktop.copy_ok", "Ссылка скопирована 👍"));
    } catch {
      window.prompt(t("home.desktop.copy_prompt", "Скопируй ссылку:"), url);
    }
  }

  async function applyPromoStub() {
    const code = promo.code.trim();
    if (!code) {
      setPromo((p) => ({
        ...p,
        state: {
          status: "error",
          message: t("promo.err.empty", "Введите промокод."),
        },
      }));
      return;
    }

    setPromo((p) => ({ ...p, state: { status: "applying" } }));
    await new Promise((r) => setTimeout(r, 450));

    setPromo((p) => ({
      ...p,
      state: {
        status: "done",
        message: t(
          "promo.done.stub",
          "Промокоды скоро будут доступны прямо в приложении ✨"
        ),
      },
    }));
  }

  if (loading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("home.loading.title", "Shpun")}</h1>
            <p className="p">{t("home.loading.text", "Загрузка…")}</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !me?.ok) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("home.error.title", "Shpun")}</h1>
            <p className="p">{t("home.error.text", "Ошибка загрузки профиля.")}</p>

            <ActionGrid>
              <button className="btn btn--primary" onClick={() => refetch?.()}>
                {t("home.error.retry", "Повторить")}
              </button>
              <Link className="btn" to="/app/profile">
                {t("home.actions.profile", "Профиль")}
              </Link>
            </ActionGrid>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      {/* User hero */}
      <div className="card">
        <div className="card__body">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <h1 className="h1">
                {t("home.hello", "Привет")}
                {displayName ? `, ${displayName}` : ""} 👋
              </h1>
              <p className="p">
                {t("home.subtitle", "SDN System — баланс, услуги и управление подпиской.")}
              </p>
            </div>

            <button
              className="btn"
              onClick={() => refetch?.()}
              title={t("home.refresh", "⟳ Обновить")}
            >
              {t("home.refresh", "⟳ Обновить")}
            </button>
          </div>

          <div className="kv kv--3">
            <div className="kv__item">
              <div className="kv__k">{t("home.kv.balance", "Баланс")}</div>
              <div className="kv__v">
                {balance ? <Money amount={balance.amount} currency={balance.currency} /> : "—"}
              </div>
            </div>

            <div className="kv__item">
              <div className="kv__k">{t("home.kv.bonus", "Бонусы")}</div>
              <div className="kv__v">{typeof me.bonus === "number" ? me.bonus : 0}</div>
            </div>

            <div className="kv__item">
              <div className="kv__k">{t("home.kv.discount", "Скидка")}</div>
              <div className="kv__v">{typeof me.discount === "number" ? `${me.discount}%` : "—"}</div>
            </div>
          </div>

          <ActionGrid>
            <Link className="btn btn--primary" to="/app/payments">
              {t("home.actions.payments", "Оплата")}
            </Link>
            <Link className="btn" to="/app/services">
              {t("home.actions.services", "Услуги")}
            </Link>
            <Link className="btn" to="/app/profile">
              {t("home.actions.profile", "Профиль")}
            </Link>

            {/* Реальная PWA-установка — только в браузере */}
            {canInstall && (
              <button
                className="btn"
                onClick={runInstall}
                disabled={installState === "prompting"}
                title={t("home.install", "Установить")}
              >
                {installState === "prompting"
                  ? t("home.install.opening", "Открываем…")
                  : t("home.install", "Установить")}
              </button>
            )}

            {/* В Telegram вместо "установить" — открываем во внешнем браузере (через transfer) */}
            {inTelegram && (
              <button
                className="btn"
                onClick={startTransferAndOpen}
                disabled={transfer.status === "loading"}
                title={t("home.install", "Установить")}
              >
                {transfer.status === "loading"
                  ? t("home.install.opening", "Открываем…")
                  : t("home.install", "Установить")}
              </button>
            )}
          </ActionGrid>

          <div className="kv kv--3">
            <div className="kv__item">
              <div className="kv__k">{t("home.meta.password", "Пароль")}</div>
              <div className="kv__v">
                {profile?.passwordSet
                  ? t("home.meta.password.on", "установлен")
                  : t("home.meta.password.off", "не установлен")}
              </div>
            </div>
            <div className="kv__item">
              <div className="kv__k">{t("home.meta.created", "Создан")}</div>
              <div className="kv__v">{fmtDate(profile?.created)}</div>
            </div>
            <div className="kv__item">
              <div className="kv__k">{t("home.meta.last_login", "Последний вход")}</div>
              <div className="kv__v">{fmtDate(profile?.lastLogin)}</div>
            </div>
          </div>

          {/* Подсказка про установку в Telegram */}
          {inTelegram && (
            <div className="pre" style={{ marginTop: 12, opacity: 0.9 }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>
                {t("home.install.tg.title", "Установка")}
              </div>
              <div style={{ opacity: 0.85 }}>
                {t(
                  "home.install.tg.text",
                  "Установка приложения работает через браузер. Мы откроем его во внешнем браузере и перенесём вход автоматически."
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Desktop transfer login */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>
              {t("home.desktop.title", "Открыть на компьютере")}
            </div>

            <p className="p">
              {t(
                "home.desktop.desc",
                "Нажми кнопку — мы откроем внешний браузер и перенесём вход в Shpun App. Ничего копировать не нужно."
              )}
            </p>

            <ActionGrid>
              <button
                className="btn btn--primary"
                onClick={startTransferAndOpen}
                disabled={transfer.status === "loading"}
              >
                {transfer.status === "loading"
                  ? t("home.desktop.opening", "Открываем…")
                  : t("home.desktop.open", "Открыть приложение на компьютере")}
              </button>

              {canInstall && (
                <button
                  className="btn"
                  onClick={runInstall}
                  disabled={installState === "prompting"}
                  title={t("home.desktop.install", "Установить")}
                >
                  {installState === "prompting"
                    ? t("home.desktop.installing", "Установка…")
                    : t("home.desktop.install", "Установить")}
                </button>
              )}

              {transfer.status === "ready" && (
                <button
                  className="btn"
                  onClick={() => setShowTransferLink((v) => !v)}
                  title={t(
                    "home.desktop.fallback.title",
                    "Резервный вариант (если авто-открытие не сработало)"
                  )}
                >
                  {showTransferLink
                    ? t("home.desktop.hide_link", "Скрыть ссылку")
                    : t("home.desktop.show_link", "Показать ссылку")}
                </button>
              )}
            </ActionGrid>

            {transfer.status === "ready" && showTransferLink && (
              <div className="pre">
                <div style={{ fontWeight: 900, marginBottom: 6 }}>
                  {t(
                    "home.desktop.fallback.title",
                    "Резервный вариант (если авто-открытие не сработало)"
                  )}
                </div>

                <div style={{ wordBreak: "break-word" }}>{transfer.consumeUrl}</div>

                <div style={{ marginTop: 10, opacity: 0.85 }}>{transferHint}</div>

                <div style={{ marginTop: 10 }}>
                  <button className="btn" onClick={copyTransferUrl}>
                    {t("home.desktop.copy", "Скопировать")}
                  </button>
                </div>
              </div>
            )}

            {transfer.status === "error" && (
              <div className="pre">
                <div style={{ fontWeight: 900, marginBottom: 6 }}>
                  {t("home.desktop.error.title", "Не получилось")}
                </div>
                <div style={{ opacity: 0.85 }}>{transfer.message}</div>

                <div style={{ marginTop: 10, opacity: 0.85 }}>
                  {t(
                    "home.desktop.error.tip",
                    "Подсказка: transfer-login работает только если ты уже вошёл в Shpun App внутри Telegram."
                  )}
                </div>
              </div>
            )}

            {!canInstall && !inTelegram && (
              <div className="pre" style={{ marginTop: 12, opacity: 0.9 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>
                  {t("home.install.no_button.title", "Установка")}
                </div>
                <div style={{ opacity: 0.85 }}>
                  {t(
                    "home.install.no_button.text",
                    "Если кнопки “Установить” нет — браузер не выдал запрос установки. Открой приложение в Chrome/Edge и попробуй снова."
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Promo codes (bottom) */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>
              {t("promo.title", "Промокоды")}
            </div>
            <p className="p">
              {t(
                "promo.desc",
                "Есть промокод? Введи его здесь — бонусы или скидка применятся к аккаунту."
              )}
            </p>

            <div className="actions actions--2">
              <div>
                <input
                  className="input"
                  value={promo.code}
                  onChange={(e) =>
                    setPromo((p) => ({
                      ...p,
                      code: e.target.value,
                      state: { status: "idle" },
                    }))
                  }
                  placeholder={t("promo.input_ph", "Например: SHPUN-2026")}
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </div>

              <button
                className="btn btn--primary"
                onClick={applyPromoStub}
                disabled={promo.state.status === "applying"}
              >
                {promo.state.status === "applying"
                  ? t("promo.applying", "Применяем…")
                  : t("promo.apply", "Применить")}
              </button>
            </div>

            {promo.state.status === "done" && <div className="pre">{promo.state.message}</div>}
            {promo.state.status === "error" && <div className="pre">{promo.state.message}</div>}

            <ActionGrid>
              <Link className="btn" to="/app/profile">
                {t("promo.history", "История / статус")}
              </Link>
            </ActionGrid>
          </div>
        </div>
      </div>
    </div>
  );
}
