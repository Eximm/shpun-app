// web/src/pages/Home.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { useI18n } from "../shared/i18n";
import { apiFetch } from "../shared/api/client";

// ✅ NEW: toast
import { toast } from "../shared/ui/toast";

/* ========================================================================
   UTIL: Money formatting
   ======================================================================== */

function Money({ amount, currency }: { amount: number; currency: string }) {
  const formatted =
    currency === "RUB"
      ? new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
      : new Intl.NumberFormat("ru-RU").format(amount) + ` ${currency}`;
  return <>{formatted}</>;
}

/* ========================================================================
   UTIL: Telegram env helpers
   ======================================================================== */

function getTelegramWebApp(): any | null {
  return (window as any)?.Telegram?.WebApp ?? null;
}

function hasTelegramInitData(): boolean {
  const tg = getTelegramWebApp();
  const initData = String(tg?.initData ?? "").trim();
  return initData.length > 0;
}

/**
 * ✅ No transfer, no cookie migration.
 * Just open external browser to the page with Telegram Widget auth.
 *
 * If your widget is NOT on /login — change targetPath.
 */
function openExternalAuthPage() {
  const targetPath = "/login";

  const url = new URL(window.location.href);
  url.pathname = targetPath;
  url.search = "";
  url.hash = "";
  url.searchParams.set("from", "tg");

  const tg = getTelegramWebApp();

  try {
    if (tg?.openLink) {
      tg.openLink(url.toString(), { try_instant_view: false });
      return;
    }
  } catch {
    // fallback below
  }

  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

/* ========================================================================
   TYPES: Promo & API payloads
   ======================================================================== */

type PromoState =
  | { status: "idle" }
  | { status: "applying" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

/** ===== Services summary (from /api/services) ===== */
type ApiSummary = {
  total: number;
  active: number;
  blocked: number;
  pending: number;
  notPaid: number;
  expiringSoon: number;
  monthlyCost: number;
  currency: string;
};

type ApiForecast = {
  nextInDays: number | null;
  nextDate: string | null;
  nextAmount: number | null;
  currency: string;
};

type ApiServicesResponse = {
  ok: true;
  summary: ApiSummary;
  forecast?: ApiForecast;
};

/** ===== Payments forecast ===== */
type ForecastResp = { ok: true; raw: any };

/* ========================================================================
   UTIL: Formatting helpers
   ======================================================================== */

function fmtMoney(n: number, cur: string) {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur || "RUB",
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${v} ${cur || "RUB"}`;
  }
}

function fmtMoneyForecast(n: number, cur: string) {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur || "RUB",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `${v} ${cur || "RUB"}`;
  }
}

function fmtShortDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

/**
 * ✅ Strictly matches your real payload:
 * raw: { data: [ { total: 117.35, ... } ], date: "Thu Feb ..." }
 */
function parsePaymentsForecast(
  raw: any
): { whenText?: string; amount?: number } | null {
  if (!raw || typeof raw !== "object") return null;

  const data0 = Array.isArray(raw.data) && raw.data.length ? raw.data[0] : null;

  const amount =
    typeof data0?.total === "number" && Number.isFinite(data0.total)
      ? data0.total
      : null;

  const whenText =
    typeof raw.date === "string" && raw.date ? fmtShortDate(raw.date) : undefined;

  if (!whenText && amount == null) return null;
  return { whenText, amount: amount ?? undefined };
}

/* ========================================================================
   UI: Small building blocks
   ======================================================================== */

function ActionGrid({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  const n = Math.max(1, Math.min(5, items.length));
  return <div className={`actions actions--${n}`}>{items}</div>;
}

function Tile({
  to,
  title,
  value,
  sub,
  icon,
  tone,
  badge,
}: {
  to: string;
  title: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: string;
  badge?: React.ReactNode;
  tone?: "default" | "ok" | "warn" | "danger" | "accent";
}) {
  return (
    <Link to={to} className={`home-tile home-tile--${tone || "default"}`}>
      <div className="home-tile__head">
        <div className="home-tile__title">
          {icon ? (
            <span className="home-tile__icon" aria-hidden>
              {icon}
            </span>
          ) : null}
          <span>{title}</span>
        </div>

        {badge ? (
          <div className="home-tile__badge">{badge}</div>
        ) : (
          <div className="home-tile__chev">→</div>
        )}
      </div>

      <div className="home-tile__value">{value}</div>
      {sub ? (
        <div className="home-tile__sub">{sub}</div>
      ) : (
        <div className="home-tile__sub home-tile__sub--empty" />
      )}
    </Link>
  );
}

/* ========================================================================
   PAGE: Home
   ======================================================================== */

export function Home() {
  const { t } = useI18n();
  const { me, loading, error, refetch } = useMe();

  const [promo, setPromo] = useState<{ code: string; state: PromoState }>({
    code: "",
    state: { status: "idle" },
  });

  // services
  const [svcLoading, setSvcLoading] = useState(false);
  const [svcError, setSvcError] = useState<string | null>(null);
  const [svcSummary, setSvcSummary] = useState<ApiSummary | null>(null);
  const [svcForecast, setSvcForecast] = useState<ApiForecast | null>(null);

  // payments forecast
  const [payLoading, setPayLoading] = useState(false);
  const [payForecast, setPayForecast] = useState<{
    whenText?: string;
    amount?: number;
  } | null>(null);

  const inTelegramMiniApp = hasTelegramInitData();

  const profile = me?.profile;
  const balance = me?.balance;
  const displayName = profile?.displayName || profile?.login || "";

  const bonusValue =
    typeof (me as any)?.bonus === "number" ? (me as any).bonus : 0;

  const attentionCount = useMemo(() => {
    const s = svcSummary;
    if (!s) return 0;
    return Number(s.blocked || 0) + Number(s.notPaid || 0);
  }, [svcSummary]);

  /* ======================================================================
     ✅ TOASTS: react to bonus / balance changes (no spam, no first render)
     ====================================================================== */

  const prevBonusRef = useRef<number | null>(null);
  const prevBalRef = useRef<number | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    const curBonus =
      typeof (me as any)?.bonus === "number" ? Number((me as any).bonus) : null;

    const curBal =
      typeof balance?.amount === "number" ? Number(balance.amount) : null;

    // wait until we have at least something stable
    if (curBonus == null && curBal == null) return;

    // first paint: remember baseline, do not notify
    if (!initializedRef.current) {
      prevBonusRef.current = curBonus;
      prevBalRef.current = curBal;
      initializedRef.current = true;
      return;
    }

    // bonus delta
    if (curBonus != null && prevBonusRef.current != null && curBonus !== prevBonusRef.current) {
      const delta = curBonus - prevBonusRef.current;

      if (delta > 0) {
        toast.success("🎁 Бонусы начислены", { description: `+${delta}` });
      } else {
        toast.info("🎁 Бонусы изменились", { description: `${delta}` }); // already has "-"
      }

      prevBonusRef.current = curBonus;
    } else if (curBonus != null && prevBonusRef.current == null) {
      prevBonusRef.current = curBonus;
    }

    // balance delta (полезно после оплаты)
    if (curBal != null && prevBalRef.current != null && curBal !== prevBalRef.current) {
      const delta = curBal - prevBalRef.current;

      if (delta > 0) {
        const cur = String(balance?.currency || "RUB");
        toast.success("💰 Баланс пополнен", {
          description: `+${fmtMoney(delta, cur)}`,
        });
      } else {
        // списания можно не показывать, чтобы не шуметь
        // toast.info("💰 Баланс изменился", { description: fmtMoney(delta, String(balance?.currency || "RUB")) })
      }

      prevBalRef.current = curBal;
    } else if (curBal != null && prevBalRef.current == null) {
      prevBalRef.current = curBal;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bonusValue, balance?.amount, balance?.currency, me?.ok]);

  /* ======================================================================
     DATA: load services + payments forecast
     ====================================================================== */

  async function loadServicesSummary() {
    setSvcLoading(true);
    setSvcError(null);
    try {
      const r = (await apiFetch("/services", { method: "GET" })) as ApiServicesResponse;
      setSvcSummary(r?.summary ?? null);
      setSvcForecast((r as any)?.forecast ?? null);
    } catch (e: any) {
      setSvcError(e?.message || "Failed to load services");
      setSvcSummary(null);
      setSvcForecast(null);
    } finally {
      setSvcLoading(false);
    }
  }

  async function loadPaymentsForecast() {
    setPayLoading(true);
    try {
      const fc = (await apiFetch("/payments/forecast", { method: "GET" })) as ForecastResp;
      setPayForecast(parsePaymentsForecast(fc?.raw ?? null));
    } catch {
      setPayForecast(null);
    } finally {
      setPayLoading(false);
    }
  }

  useEffect(() => {
    if (me?.ok) {
      loadServicesSummary();
      loadPaymentsForecast();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.ok]);

  /* ======================================================================
     ACTION: promo stub
     ====================================================================== */

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
        message: t("promo.done.stub", "Бонус-коды скоро будут доступны прямо в приложении ✨"),
      },
    }));
  }

  /* ======================================================================
     STATES: loading / error
     ====================================================================== */

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
              <Link className="btn" to="/profile">
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

  /* ======================================================================
     DERIVED: values for tiles
     ====================================================================== */

  const s = svcSummary;
  const currencyFallback = s?.currency || balance?.currency || "RUB";

  const showBlocked = !!s && s.blocked > 0;

  const forecastAmountText =
    typeof payForecast?.amount === "number"
      ? fmtMoneyForecast(payForecast.amount, currencyFallback)
      : null;

  const forecastWhenText = payForecast?.whenText || null;

  const servicesForecastText =
    svcForecast &&
    (svcForecast.nextInDays != null ||
      svcForecast.nextDate ||
      svcForecast.nextAmount != null)
      ? `${
          svcForecast.nextInDays != null
            ? `через ${svcForecast.nextInDays} дн.`
            : svcForecast.nextDate
            ? fmtShortDate(svcForecast.nextDate)
            : "—"
        }${
          svcForecast.nextAmount != null
            ? ` · ~${fmtMoneyForecast(
                svcForecast.nextAmount,
                svcForecast.currency || currencyFallback
              )}`
            : ""
        }`
      : null;

  const forecastSub =
    forecastWhenText || servicesForecastText || (payLoading ? "Считаем…" : "—");

  const attentionSub = (() => {
    if (!s) return svcLoading ? "Проверяем…" : "—";
    const parts: string[] = [];
    if (s.notPaid > 0) parts.push(`Оплата: ${s.notPaid}`);
    if (s.blocked > 0) parts.push(`Блок: ${s.blocked}`);
    if (parts.length === 0) return "Всё в порядке";
    return parts.join(" · ");
  })();

  /* ======================================================================
     RENDER
     ====================================================================== */

  return (
    <div className="section">
      {/* ==================================================================
         MODULE: Header + Main tiles
         ================================================================== */}
      <div className="card">
        <div className="card__body">
          <div className="home-head">
            <div className="home-head__left">
              <div className="home-head__title">
                {t("home.hello", "Привет")}
                {displayName ? `, ${displayName}` : ""} 👋
              </div>
              <div className="home-head__sub">
                Аккаунт и услуги — самое важное. Плитки ведут в нужные разделы.
              </div>
            </div>
          </div>

          <div className="home-tiles">
            <Tile
              to="/payments"
              icon="💰"
              title="Баланс"
              value={balance ? <Money amount={balance.amount} currency={balance.currency} /> : "—"}
              sub="Пополнение и история"
              tone="accent"
            />

            <Tile
              to="/services"
              icon="🛰️"
              title="Услуги"
              value={svcLoading ? "…" : s ? `${s.active}/${s.total}` : "—"}
              sub="Список и статусы"
              tone="ok"
            />

            <Tile
              to="/services"
              icon={attentionCount > 0 ? "⚠️" : "✅"}
              title={attentionCount > 0 ? "Требуют действий" : "Состояние"}
              value={svcLoading ? "…" : s ? attentionCount : "—"}
              sub={attentionSub}
              tone={attentionCount > 0 ? "warn" : "ok"}
              badge={
                showBlocked ? (
                  <span className="home-badge home-badge--danger">есть блок</span>
                ) : null
              }
            />

            <Tile
              to="/services"
              icon="📦"
              title="В месяц"
              value={svcLoading ? "…" : s ? fmtMoney(s.monthlyCost || 0, currencyFallback) : "—"}
              sub="Плановый расход"
              tone="default"
            />

            <Tile
              to="/payments"
              icon="🎁"
              title="Бонусы"
              value={bonusValue}
              sub="Начисления и списания"
              tone="default"
            />

            <Tile
              to="/payments"
              icon="🗓️"
              title="Прогноз оплаты"
              value={forecastAmountText || (payLoading ? "…" : "—")}
              sub={forecastAmountText ? `${forecastSub}` : forecastSub}
              tone="default"
            />
          </div>

          {svcError ? (
            <div className="muted" style={{ marginTop: 10 }}>
              Не удалось обновить статусы услуг.
            </div>
          ) : null}
        </div>
      </div>

      {/* ==================================================================
         MODULE: Install CTA (only inside Telegram mini-app)
         ================================================================== */}
      {inTelegramMiniApp ? (
        <div className="section">
          <div className="card home-install">
            <div className="home-install__glow" />
            <div className="card__body">
              <div className="home-install__copy">
                <div className="home-install__title">🚀 Установить ShpunApp</div>
                <div className="home-install__sub">
                  Откроем приложение во внешнем браузере для входа через Telegram Widget.
                </div>
              </div>

              <div className="home-install__btnwrap">
                <button
                  className="btn btn--primary home-install__btn"
                  onClick={openExternalAuthPage}
                >
                  Открыть в браузере
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ==================================================================
         MODULE: News (single CTA button)
         ================================================================== */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="home-block-head">
              <div>
                <div className="h1">{t("home.news.title", "Новости")}</div>
                <div className="p">
                  {t("home.news.subtitle", "Коротко и по делу. Полная лента — в “Новости”.")}
                </div>
              </div>
            </div>

            <div className="list home-newsList">
              <Link to="/feed" className="home-link">
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">
                      {t("home.news.item1.title", "✅ Система стабильна — всё работает")}
                    </div>
                    <div className="list__sub">
                      {t(
                        "home.news.item1.sub",
                        "Если видишь “Can’t connect” — просто обнови страницу."
                      )}
                    </div>
                  </div>
                  <div className="list__side">
                    <span className="chip chip--ok">today</span>
                  </div>
                </div>
              </Link>

              <Link to="/feed" className="home-link">
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">
                      {t("home.news.item2.title", "🧭 Лента — в “Новости”")}
                    </div>
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
              </Link>
            </div>

            <div className="home-cta">
              <Link className="btn btn--accent home-cta__btn" to="/feed">
                {t("home.news.open", "Открыть")}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ==================================================================
         MODULE: Referrals
         ================================================================== */}
      <div className="section">
        <div className="card home-refcard">
          <div className="card__body">
            <div className="home-block-head">
              <div>
                <div className="h1">🤝 Реферальная программа</div>
                <div className="p">
                  Пригласи друзей — и получай бонусы с их пополнений.
                  <span className="dot" /> Это реально “пассивка”.
                </div>
              </div>
            </div>

            <div className="kv kv--3 home-refkv">
              <div className="kv__item">
                <div className="kv__k">🔗 Ссылка</div>
                <div className="kv__v">Поделись в чат</div>
              </div>
              <div className="kv__item">
                <div className="kv__k">👥 Приглашённые</div>
                <div className="kv__v">Список и статусы</div>
              </div>
              <div className="kv__item">
                <div className="kv__k">💸 Процент</div>
                <div className="kv__v">Правила и начисления</div>
              </div>
            </div>

            <div className="home-refactions">
              <div className="actions actions--3 home-refactions__grid">
                <Link className="btn" to="/referrals#link">
                  Скопировать ссылку
                </Link>
                <Link className="btn" to="/referrals#list">
                  Список
                </Link>
                <Link className="btn" to="/referrals#rules">
                  Правила
                </Link>
              </div>

              <div className="home-cta">
                <Link className="btn btn--accent home-cta__btn" to="/referrals">
                  Открыть
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ==================================================================
         MODULE: Promo codes
         ================================================================== */}
      <div className="section">
        <div className="card home-promocard">
          <div className="card__body">
            <div className="home-block-head">
              <div>
                <div className="h1">Бонус-коды</div>
                <div className="p">Введи код — бонусы или скидка применятся к аккаунту.</div>
              </div>
            </div>

            <div className="home-promoRow">
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
                placeholder="Например: SHPUN-2026"
                autoCapitalize="characters"
                spellCheck={false}
              />

              <button
                className="btn btn--accent home-cta__btn"
                onClick={applyPromoStub}
                disabled={promo.state.status === "applying"}
              >
                {promo.state.status === "applying" ? "Применяем…" : "Применить"}
              </button>
            </div>
            {promo.state.status === "done" && (
              <div className="home-alert home-alert--ok">{promo.state.message}</div>
            )}
            {promo.state.status === "error" && (
              <div className="home-alert home-alert--danger">{promo.state.message}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home;