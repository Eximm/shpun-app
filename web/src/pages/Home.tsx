// web/src/pages/Home.tsx
import { Link } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import React, { useEffect, useState } from "react";
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

function ActionGrid({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  const n = Math.max(1, Math.min(5, items.length));
  return <div className={`actions actions--${n}`}>{items}</div>;
}

function getTelegramWebApp(): any | null {
  return (window as any)?.Telegram?.WebApp ?? null;
}

function hasTelegramInitData(): boolean {
  const tg = getTelegramWebApp();
  const initData = String(tg?.initData ?? "").trim();
  return initData.length > 0;
}

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent || "");
}

/**
 * consume_url может прийти относительным или абсолютным на другом домене.
 * Мы всегда открываем consume на текущем origin, чтобы sid cookie оказалась там же.
 */
function normalizeConsumeUrl(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return s;

  const origin = window.location.origin;

  if (s.startsWith("/")) return origin + s;

  try {
    const u = new URL(s);
    const cur = new URL(origin);

    if (u.host !== cur.host) {
      u.protocol = cur.protocol;
      u.host = cur.host;
    }
    return u.toString();
  } catch {
    return s;
  }
}

/**
 * Открываем внешний браузер из Telegram.
 * 1) tg.openLink(url, try_instant_view:false)
 * 2) Android: через 300мс tg.close() (часто помогает избежать "miniapp в miniapp")
 * 3) Android fallback: intent:// to Chrome
 * 4) fallback: window.open
 */
function openInBrowser(url: string) {
  const tg = getTelegramWebApp();
  const android = isAndroid();

  if (tg?.openLink) {
    try {
      tg.openLink(url, { try_instant_view: false });
      if (android) {
        setTimeout(() => {
          try {
            tg.close();
          } catch {
            // ignore
          }
        }, 300);
      }
      return;
    } catch {
      // continue fallbacks
    }
  }

  if (android) {
    try {
      const u = new URL(url);
      const scheme = u.protocol.replace(":", "");
      const intentUrl =
        `intent://${u.host}${u.pathname}${u.search}${u.hash}` +
        `#Intent;scheme=${scheme};package=com.android.chrome;end`;
      window.location.href = intentUrl;
      return;
    } catch {
      // ignore
    }
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export function Home() {
  const { t } = useI18n();
  const { me, loading, error, refetch } = useMe();

  const [transfer, setTransfer] = useState<TransferState>({ status: "idle" });

  const [promo, setPromo] = useState<{ code: string; state: PromoState }>({
    code: "",
    state: { status: "idle" },
  });

  const inTelegramMiniApp = hasTelegramInitData();
  const hasTelegramObject = !!getTelegramWebApp();
  const transferBusy = transfer.status === "loading";

  const profile = me?.profile;
  const balance = me?.balance;
  const displayName = profile?.displayName || profile?.login || "";

  useEffect(() => {
    // intentionally empty
  }, [transfer.status]);

  async function startTransferAndOpen() {
    if (hasTelegramObject && !inTelegramMiniApp) {
      setTransfer({
        status: "error",
        message: t(
          "error.open_in_tg",
          "Откройте приложение внутри Telegram (в Mini App), чтобы перенести вход в браузер."
        ),
      });
      return;
    }

    try {
      setTransfer({ status: "loading" });

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
            ? t("error.open_in_tg", "Откройте приложение внутри Telegram, чтобы войти.")
            : String(json?.error || "transfer_start_failed");
        setTransfer({ status: "error", message: msg });
        return;
      }

      const rawConsumeUrl = String(json.consume_url || "").trim();
      if (!rawConsumeUrl) {
        setTransfer({
          status: "error",
          message: t("home.install.error", "Не получилось открыть установку.") + ": consume_url",
        });
        return;
      }

      const consumeUrl = normalizeConsumeUrl(rawConsumeUrl);
      const expiresAt = Number(json.expires_at || 0) || undefined;

      setTransfer({ status: "ready", consumeUrl, expiresAt });

      openInBrowser(consumeUrl);
    } catch (e: any) {
      setTransfer({
        status: "error",
        message: e?.message || t("home.install.error", "Не получилось открыть установку."),
      });
    }
  }

  async function applyPromoStub() {
    const code = promo.code.trim();
    if (!code) {
      setPromo((p) => ({
        ...p,
        state: { status: "error", message: t("promo.err.empty", "Введите промокод.") },
      }));
      return;
    }

    setPromo((p) => ({ ...p, state: { status: "applying" } }));
    await new Promise((r) => setTimeout(r, 450));

    setPromo((p) => ({
      ...p,
      state: {
        status: "done",
        message: t("promo.done.stub", "Промокоды скоро будут доступны прямо в приложении ✨"),
      },
    }));
  }

  if (loading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("home.loading.title", "ShpunApp")}</h1>
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
            <h1 className="h1">{t("home.error.title", "ShpunApp")}</h1>
            <p className="p">{t("home.error.text", "Ошибка загрузки профиля.")}</p>

            <ActionGrid>
              <button className="btn btn--primary" onClick={() => refetch?.()}>
                {t("home.error.retry", "Повторить")}
              </button>
              <Link className="btn" to="/app/profile">
                {t("home.actions.profile", "Профиль")}
              </Link>
              {!inTelegramMiniApp && (
                <Link className="btn" to="/login">
                  {t("home.actions.login", "Войти")}
                </Link>
              )}
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
          <div className="home-hero__head">
            <div>
              <h1 className="h1">
                {t("home.hello", "Привет")}
                {displayName ? `, ${displayName}` : ""} 👋
              </h1>
              <p className="p">
                {t("home.subtitle", "SDN System — баланс, услуги и управление подпиской.")}
              </p>
            </div>

            <button className="btn" onClick={() => refetch?.()} title={t("home.refresh", "⟳ Обновить")}>
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
        </div>
      </div>

      {/* Install CTA — ONLY inside Telegram MiniApp */}
      {inTelegramMiniApp && (
        <div className="section">
          <div className="card home-install">
            <div className="home-install__glow" />
            <div className="card__body">
              <div className="home-install__copy">
                <div className="home-install__title">🚀 Установить Shpun App</div>
                <div className="home-install__sub">
                  Откроем браузер и предложим установку приложения на устройство.
                </div>

                {transfer.status === "error" && (
                  <div className="pre home-install__error">{transfer.message}</div>
                )}
              </div>

              <div className="home-install__btnwrap">
                <button
                  className="btn btn--primary home-install__btn"
                  onClick={startTransferAndOpen}
                  disabled={transferBusy}
                >
                  {transferBusy ? "Открываем…" : "Установить"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* News preview */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="home-news__head">
              <div>
                <div className="h1 home-news__title">{t("home.news.title", "Новости")}</div>
                <p className="p">
                  {t("home.news.subtitle", "Коротко и по делу. Полная лента — в “Новости”.")}
                </p>
              </div>
              <Link className="btn" to="/app/feed">
                {t("home.news.open", "Открыть")}
              </Link>
            </div>

            <div className="list">
              <div className="list__item">
                <div className="list__main">
                  <div className="list__title">
                    {t("home.news.item1.title", "✅ Система стабильна — всё работает")}
                  </div>
                  <div className="list__sub">
                    {t("home.news.item1.sub", "Если видишь “Can’t connect” — просто обнови страницу.")}
                  </div>
                </div>
                <div className="list__side">
                  <span className="chip chip--ok">today</span>
                </div>
              </div>

              <div className="list__item">
                <div className="list__main">
                  <div className="list__title">{t("home.news.item2.title", "🧭 Лента — в “Новости”")}</div>
                  <div className="list__sub">
                    {t(
                      "home.news.item2.sub",
                      "Главная — витрина. Новости — лента. Дальше подключим реальные данные."
                    )}
                  </div>
                </div>
                <div className="list__side">
                  <span className="chip chip--soft">new</span>
                </div>
              </div>
            </div>

            <ActionGrid>
              <Link className="btn" to="/app/feed">
                {t("home.news.open_full", "Открыть новости")}
              </Link>
            </ActionGrid>
          </div>
        </div>
      </div>

      {/* Promo codes */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1 home-promo__title">{t("promo.title", "Промокоды")}</div>
            <p className="p">
              {t("promo.desc", "Есть промокод? Введи его здесь — бонусы или скидка применятся к аккаунту.")}
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

export default Home;
