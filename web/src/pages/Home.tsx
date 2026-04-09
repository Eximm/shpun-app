import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { useI18n } from "../shared/i18n";
import { apiFetch } from "../shared/api/client";
import { toast } from "../shared/ui/toast";
import { buildHomeNewsPreview } from "../shared/ui/newsPreview";

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
 * Open browser auth page from Telegram Mini App.
 */
function openExternalAuthPage() {
  const url = new URL(window.location.origin); // 👈 только домен

  const tg = getTelegramWebApp();

  try {
    if (tg?.openLink) {
      tg.openLink(url.toString(), { try_instant_view: false });
      return;
    }
  } catch {}

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

type ForecastResp = { ok: true; raw: any };

type NotifLevel = "info" | "success" | "error";
type NotifEvent = {
  event_id: string;
  ts: number;
  type?: string;
  level?: NotifLevel;
  title?: string;
  message?: string;
  meta?: any;
};
type Cursor = { ts: number; id: string };
type FeedResp = { ok: true; items: NotifEvent[]; nextBefore: Cursor };

type Category = "all" | "money" | "services" | "news";

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

function fmtFeedDate(tsSec: number, todayLabel: string) {
  const d = new Date(tsSec * 1000);
  const now = new Date();

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (sameDay) return todayLabel;
  return d.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

function categoryOf(e: NotifEvent): Category {
  const t = String(e.type || "").trim().toLowerCase();

  if (t.startsWith("balance.") || t.startsWith("payment.") || t.startsWith("invoice.")) return "money";
  if (t.startsWith("service.") || t.startsWith("services.")) return "services";

  if (t === "broadcast.news" || t.startsWith("broadcast.news.")) return "news";
  if (t.startsWith("broadcast.")) return "news";
  if (t.includes("news")) return "news";

  const text = `${e.title || ""} ${e.message || ""}`.toLowerCase();

  if (text.includes("пополн") || text.includes("оплат") || text.includes("баланс") || text.includes("зачисл"))
    return "money";
  if (text.includes("услуг") || text.includes("продл") || text.includes("ключ") || text.includes("блок"))
    return "services";
  if (text.includes("работ") || text.includes("новост") || text.includes("перебои") || text.includes("обновлен"))
    return "news";

  return "all";
}

function parsePaymentsForecast(raw: any): { whenText?: string; amount?: number } | null {
  if (!raw || typeof raw !== "object") return null;

  const data0 = Array.isArray(raw.data) && raw.data.length ? raw.data[0] : null;

  const amount =
    typeof data0?.total === "number" && Number.isFinite(data0.total) ? data0.total : null;

  const whenText =
    typeof raw.date === "string" && raw.date ? fmtShortDate(raw.date) : undefined;

  if (!whenText && amount == null) return null;
  return { whenText, amount: amount ?? undefined };
}

function tr(template: string, params: Record<string, string | number>) {
  return Object.entries(params).reduce(
    (acc, [key, value]) => acc.replace(new RegExp(`\\{${key}\\}`, "g"), String(value)),
    template
  );
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

        {badge ? <div className="home-tile__badge">{badge}</div> : <div className="home-tile__chev">→</div>}
      </div>

      <div className="home-tile__value">{value}</div>
      {sub ? <div className="home-tile__sub">{sub}</div> : <div className="home-tile__sub home-tile__sub--empty" />}
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

  const [svcLoading, setSvcLoading] = useState(false);
  const [svcError, setSvcError] = useState<string | null>(null);
  const [svcSummary, setSvcSummary] = useState<ApiSummary | null>(null);
  const [svcForecast, setSvcForecast] = useState<ApiForecast | null>(null);

  const [payLoading, setPayLoading] = useState(false);
  const [payForecast, setPayForecast] = useState<{ whenText?: string; amount?: number } | null>(null);

  const [newsLoading, setNewsLoading] = useState(false);
  const [newsItems, setNewsItems] = useState<NotifEvent[]>([]);

  const inTelegramMiniApp = hasTelegramInitData();

  const profile = me?.profile;
  const balance = me?.balance;
  const displayName = profile?.displayName || profile?.login || "";

  const bonusValue = typeof (me as any)?.bonus === "number" ? (me as any).bonus : 0;

  const attentionCount = useMemo(() => {
    const s = svcSummary;
    if (!s) return 0;
    return Number(s.blocked || 0) + Number(s.notPaid || 0);
  }, [svcSummary]);

  const prevBonusRef = useRef<number | null>(null);
  const prevBalRef = useRef<number | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    const curBonus = typeof (me as any)?.bonus === "number" ? Number((me as any).bonus) : null;
    const curBal = typeof balance?.amount === "number" ? Number(balance.amount) : null;

    if (curBonus == null && curBal == null) return;

    if (!initializedRef.current) {
      prevBonusRef.current = curBonus;
      prevBalRef.current = curBal;
      initializedRef.current = true;
      return;
    }

    if (curBonus != null && prevBonusRef.current != null && curBonus !== prevBonusRef.current) {
      const delta = curBonus - prevBonusRef.current;

      if (delta > 0) {
        toast.success(t("home.toast.bonus_added.title", "Бонусы начислены"), {
          description: `+${delta}`,
        });
      } else {
        toast.info(t("home.toast.bonus_changed.title", "Бонусы обновлены"), {
          description: `${delta}`,
        });
      }

      prevBonusRef.current = curBonus;
    } else if (curBonus != null && prevBonusRef.current == null) {
      prevBonusRef.current = curBonus;
    }

    if (curBal != null && prevBalRef.current != null && curBal !== prevBalRef.current) {
      const delta = curBal - prevBalRef.current;

      if (delta > 0) {
        const cur = String(balance?.currency || "RUB");
        toast.success(t("home.toast.balance_added.title", "Баланс пополнен"), {
          description: `+${fmtMoney(delta, cur)}`,
        });
      }

      prevBalRef.current = curBal;
    } else if (curBal != null && prevBalRef.current == null) {
      prevBalRef.current = curBal;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bonusValue, balance?.amount, balance?.currency, me?.ok]);

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

  async function loadHomeNews() {
    setNewsLoading(true);
    try {
      const r = await apiFetch<FeedResp>(`/notifications/feed?onlyNews=1&limit=5`);
      const arr = Array.isArray(r.items) ? r.items : [];
      const news = arr.filter((x) => categoryOf(x) === "news").slice(0, 5);
      setNewsItems(news);
    } catch {
      setNewsItems([]);
    } finally {
      setNewsLoading(false);
    }
  }

  useEffect(() => {
    if (me?.ok) {
      loadServicesSummary();
      loadPaymentsForecast();
      loadHomeNews();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.ok]);

  async function applyPromoStub() {
    const code = promo.code.trim();
    if (!code) {
      setPromo((p) => ({
        ...p,
        state: { status: "error", message: t("promo.err.empty", "Введите код.") },
      }));
      return;
    }

    setPromo((p) => ({ ...p, state: { status: "applying" } }));
    await new Promise((r) => setTimeout(r, 450));

    setPromo((p) => ({
      ...p,
      state: {
        status: "done",
        message: t("promo.done.stub", "Бонус-коды скоро появятся в приложении."),
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
            <p className="p">{t("home.error.text", "Не удалось загрузить профиль.")}</p>

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

  const s = svcSummary;
  const currencyFallback = s?.currency || balance?.currency || "RUB";

  const showBlocked = !!s && s.blocked > 0;

  const forecastAmountText =
    typeof payForecast?.amount === "number" ? fmtMoneyForecast(payForecast.amount, currencyFallback) : null;

  const forecastWhenText = payForecast?.whenText || null;

  const servicesForecastText =
    svcForecast && (svcForecast.nextInDays != null || svcForecast.nextDate || svcForecast.nextAmount != null)
      ? `${
          svcForecast.nextInDays != null
            ? tr(t("home.tiles.services_in_days", "через {days} дн."), { days: svcForecast.nextInDays })
            : svcForecast.nextDate
              ? fmtShortDate(svcForecast.nextDate)
              : "—"
        }${
          svcForecast.nextAmount != null
            ? ` · ~${fmtMoneyForecast(svcForecast.nextAmount, svcForecast.currency || currencyFallback)}`
            : ""
        }`
      : null;

  const forecastSub = forecastWhenText || servicesForecastText || (payLoading ? t("home.tiles.forecast.loading", "Считаем…") : "—");

  const attentionSub = (() => {
    if (!s) return svcLoading ? t("home.tiles.forecast.loading", "Считаем…") : "—";
    const parts: string[] = [];
    if (s.notPaid > 0) parts.push(tr(t("home.tiles.state.pay", "К оплате: {count}"), { count: s.notPaid }));
    if (s.blocked > 0) parts.push(tr(t("home.tiles.state.block", "Заблокировано: {count}"), { count: s.blocked }));
    if (parts.length === 0) return t("home.tiles.state.ok", "Всё в порядке");
    return parts.join(" · ");
  })();

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div className="home-head">
            <div className="home-head__left">
              <div className="home-head__title">
                {t("home.hello", "Привет")}
                {displayName ? `, ${displayName}` : ""} 👋
              </div>
              <div className="home-head__sub">{t("home.head.sub", "Самое важное по аккаунту — на одной странице.")}</div>
            </div>
          </div>

          <div className="home-tiles">
            <Tile
              to="/payments"
              icon="💰"
              title={t("home.tiles.balance", "Баланс")}
              value={balance ? <Money amount={balance.amount} currency={balance.currency} /> : "—"}
              sub={t("home.tiles.balance.sub", "Пополнение и история")}
              tone="accent"
            />

            <Tile
              to="/services"
              icon="🛰️"
              title={t("home.tiles.services", "Услуги")}
              value={svcLoading ? "…" : s ? `${s.active}/${s.total}` : "—"}
              sub={t("home.tiles.services.sub", "Список и статусы")}
              tone="ok"
            />

            <Tile
              to="/services"
              icon={attentionCount > 0 ? "⚠️" : "✅"}
              title={attentionCount > 0 ? t("home.tiles.attention", "Требуют внимания") : t("home.tiles.state", "Состояние")}
              value={svcLoading ? "…" : s ? attentionCount : "—"}
              sub={attentionSub}
              tone={attentionCount > 0 ? "warn" : "ok"}
              badge={
                showBlocked ? (
                  <span className="home-badge home-badge--danger">
                    {t("home.tiles.state.block_badge", "есть блок")}
                  </span>
                ) : null
              }
            />

            <Tile
              to="/services"
              icon="📦"
              title={t("home.tiles.monthly", "В месяц")}
              value={svcLoading ? "…" : s ? fmtMoney(s.monthlyCost || 0, currencyFallback) : "—"}
              sub={t("home.tiles.monthly.sub", "Плановый расход")}
              tone="default"
            />

            <Tile
              to="/payments"
              icon="🎁"
              title={t("home.tiles.bonus", "Бонусы")}
              value={bonusValue}
              sub={t("home.tiles.bonus.sub", "Начисления и списания")}
              tone="default"
            />

            <Tile
              to="/payments"
              icon="🗓️"
              title={t("home.tiles.forecast", "Следующая оплата")}
              value={forecastAmountText || (payLoading ? "…" : "—")}
              sub={forecastAmountText ? `${forecastSub}` : forecastSub}
              tone="default"
            />
          </div>

          {svcError ? <div className="muted" style={{ marginTop: 10 }}>{t("home.services.error", "Не удалось обновить статусы услуг.")}</div> : null}
        </div>
      </div>

      {inTelegramMiniApp ? (
        <div className="section">
          <div className="card home-install">
            <div className="home-install__glow" />
            <div className="card__body">
              <div className="home-install__copy">
                <div className="home-install__title">{t("home.install.card.title", "Открыть ShpunApp в браузере")}</div>
              </div>

            <div className="home-install__btnwrap">
              <button
                className="btn btn--primary home-install__btn home-install__cta"
                onClick={openExternalAuthPage}
              >
                <span className="home-install__ctaIcon" aria-hidden>🌐</span>

                <span className="home-install__ctaText">
                  <span className="home-install__ctaTitle">
                    {t("home.install.card.open", "Открыть в браузере")}
                  </span>
                  <span className="home-install__ctaSub">
                    {t("home.install.card.sub", "В браузере доступны все функции приложения.")}
                  </span>
                </span>

                <span className="home-install__ctaArrow" aria-hidden>↗</span>
              </button>
            </div>
            </div>
          </div>
        </div>
      ) : null}

        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="home-block-head">
                <div>
                  <div className="h1">{t("home.news.title", "Новости")}</div>
                  <div className="p">{t("home.news.subtitle", "Короткие обновления и важные сообщения.")}</div>
                </div>
              </div>

              <div className="list home-newsList">
                {newsLoading ? (
                  <>
                    <div className="skeleton h1" />
                    <div className="skeleton p" />
                  </>
                ) : newsItems.length ? (
                  newsItems.map((n) => {
                    const preview = buildHomeNewsPreview(n);

                    return (
                      <Link key={n.event_id} to="/feed" className="home-link">
                        <div className="list__item home-newsCard">
                          <div className="home-newsCard__head">
                            <div className="home-newsCard__title">
                              {n.title || t("home.news.item.fallback", "Сообщение")}
                            </div>

                            <span className="chip chip--soft home-newsCard__date">
                              {fmtFeedDate(n.ts, t("home.news.today", "Сегодня"))}
                            </span>
                          </div>

                          {preview ? (
                            <div className="list__sub home-news__preview home-newsCard__preview">
                              {preview}
                            </div>
                          ) : null}
                        </div>
                      </Link>
                    );
                  })
                ) : (
                  <Link to="/feed" className="home-link">
                    <div className="list__item home-newsCard">
                      <div className="home-newsCard__head">
                        <div className="home-newsCard__title">
                          {t("home.news.empty.title", "Пока новостей нет")}
                        </div>

                        <span className="chip chip--soft home-newsCard__date">—</span>
                      </div>

                      <div className="list__sub home-news__preview home-newsCard__preview">
                        {t("home.news.empty.sub", "Когда появятся обновления, они будут здесь.")}
                      </div>
                    </div>
                  </Link>
                )}
              </div>

              <div className="home-cta">
                <Link className="btn btn--accent home-cta__btn" to="/feed">
                  {t("home.news.open", "Открыть")}
                </Link>
              </div>
            </div>
          </div>
        </div>

      <div className="section">
        <div className="card home-refcard">
          <div className="card__body">
            <div className="home-block-head">
              <div>
                <div className="h1">{t("home.ref.title", "Реферальная программа")}</div>
                <div className="p">{t("home.ref.sub", "Приглашайте друзей и получайте бонусы за их пополнения.")}</div>
              </div>
            </div>

            <div className="kv kv--3 home-refkv">
              <div className="kv__item">
                <div className="kv__k">{t("home.ref.link.k", "Ссылка")}</div>
                <div className="kv__v">{t("home.ref.link.v", "Поделиться с друзьями")}</div>
              </div>
              <div className="kv__item">
                <div className="kv__k">{t("home.ref.list.k", "Приглашённые")}</div>
                <div className="kv__v">{t("home.ref.list.v", "Список и статусы")}</div>
              </div>
              <div className="kv__item">
                <div className="kv__k">{t("home.ref.percent.k", "Начисления")}</div>
                <div className="kv__v">{t("home.ref.percent.v", "Правила и проценты")}</div>
              </div>
            </div>

            <div className="home-refactions">
              <div className="actions actions--3 home-refactions__grid">
                <Link className="btn" to="/referrals#link">{t("home.ref.copy_link", "Ссылка")}</Link>
                <Link className="btn" to="/referrals#list">{t("home.ref.list_btn", "Список")}</Link>
                <Link className="btn" to="/referrals#rules">{t("home.ref.rules", "Правила")}</Link>
              </div>

              <div className="home-cta">
                <Link className="btn btn--accent home-cta__btn" to="/referrals">{t("home.ref.open", "Открыть")}</Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card home-promocard">
          <div className="card__body">
            <div className="home-block-head">
              <div>
                <div className="h1">{t("home.promo.title", "Бонус-код")}</div>
                <div className="p">{t("home.promo.sub", "Введите код, чтобы получить бонус или скидку.")}</div>
              </div>
            </div>

            <div className="home-promoRow">
              <input
                className="input"
                value={promo.code}
                onChange={(e) =>
                  setPromo((p) => ({ ...p, code: e.target.value, state: { status: "idle" } }))
                }
                placeholder={t("promo.input_ph", "Например: SHPUN-2026")}
                autoCapitalize="characters"
                spellCheck={false}
              />

              <button
                className="btn btn--accent home-cta__btn"
                onClick={applyPromoStub}
                disabled={promo.state.status === "applying"}
              >
                {promo.state.status === "applying"
                  ? t("promo.applying", "Применяем…")
                  : t("promo.apply", "Применить")}
              </button>
            </div>

            {promo.state.status === "done" && <div className="home-alert home-alert--ok">{promo.state.message}</div>}
            {promo.state.status === "error" && <div className="home-alert home-alert--danger">{promo.state.message}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home;