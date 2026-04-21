// FILE: web/src/pages/Home.tsx

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { useI18n } from "../shared/i18n";
import { apiFetch } from "../shared/api/client";
import { toast } from "../shared/ui/toast";
import { buildHomeNewsPreview } from "../shared/ui/newsPreview";
import { PromoModal } from "./PromoModal";

/* ─── Types ─────────────────────────────────────────────────────────────── */

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

type ApiServicesResponse = { ok: true; summary: ApiSummary; forecast?: ApiForecast };
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
type FeedResp = { ok: true; items: NotifEvent[]; nextBefore: any };
type Category = "all" | "money" | "services" | "news";

/* ─── Utils ─────────────────────────────────────────────────────────────── */

function getTelegramWebApp(): any | null {
  return (window as any)?.Telegram?.WebApp ?? null;
}

function hasTelegramInitData(): boolean {
  const tg = getTelegramWebApp();
  return String(tg?.initData ?? "").trim().length > 0;
}

function openExternalAuthPage() {
  const url = new URL(window.location.origin);
  const tg  = getTelegramWebApp();
  try {
    if (tg?.openLink) { tg.openLink(url.toString(), { try_instant_view: false }); return; }
  } catch { /* ignore */ }
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function fmtMoney(n: number, cur: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "RUB", maximumFractionDigits: 0 }).format(Number(n || 0));
  } catch { return `${n} ${cur || "RUB"}`; }
}

function fmtMoneyForecast(n: number, cur: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "RUB", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n || 0));
  } catch { return `${n} ${cur || "RUB"}`; }
}

function fmtShortDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function fmtFeedDate(tsSec: number, todayLabel: string) {
  const d   = new Date(tsSec * 1000);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? todayLabel : d.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

function categoryOf(e: NotifEvent): Category {
  const t = String(e.type || "").trim().toLowerCase();
  if (t.startsWith("balance.") || t.startsWith("payment.") || t.startsWith("invoice.")) return "money";
  if (t.startsWith("service.") || t.startsWith("services.")) return "services";
  if (t === "broadcast.news" || t.startsWith("broadcast.")) return "news";
  if (t.includes("news")) return "news";
  const text = `${e.title || ""} ${e.message || ""}`.toLowerCase();
  if (text.includes("пополн") || text.includes("оплат") || text.includes("баланс")) return "money";
  if (text.includes("услуг") || text.includes("продл") || text.includes("блок")) return "services";
  if (text.includes("новост") || text.includes("обновлен")) return "news";
  return "all";
}

function parsePaymentsForecast(raw: any): { whenText?: string; amount?: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const data0 = Array.isArray(raw.data) && raw.data.length ? raw.data[0] : null;
  const amount = typeof data0?.total === "number" && Number.isFinite(data0.total) ? data0.total : null;
  const whenText = typeof raw.date === "string" && raw.date ? fmtShortDate(raw.date) : undefined;
  if (!whenText && amount == null) return null;
  return { whenText, amount: amount ?? undefined };
}

function tr(template: string, params: Record<string, string | number>) {
  return Object.entries(params).reduce(
    (acc, [key, val]) => acc.replace(new RegExp(`\\{${key}\\}`, "g"), String(val)),
    template
  );
}

/* ─── Tile ───────────────────────────────────────────────────────────────── */

function Tile({
  to, title, value, sub, icon, tone,
}: {
  to: string;
  title: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: string;
  tone?: "default" | "ok" | "warn" | "danger" | "accent";
}) {
  return (
    <Link to={to} className={`home-tile home-tile--${tone || "default"}`}>
      <div className="home-tile__head">
        <div className="home-tile__title">
          {icon && <span className="home-tile__icon" aria-hidden>{icon}</span>}
          <span>{title}</span>
        </div>
        <div className="home-tile__chev">→</div>
      </div>
      <div className="home-tile__value">{value}</div>
      {sub
        ? <div className="home-tile__sub">{sub}</div>
        : <div className="home-tile__sub home-tile__sub--empty" />}
    </Link>
  );
}

/* ─── Money ──────────────────────────────────────────────────────────────── */

function Money({ amount, currency }: { amount: number; currency: string }) {
  const formatted = currency === "RUB"
    ? new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
    : new Intl.NumberFormat("ru-RU").format(amount) + ` ${currency}`;
  return <>{formatted}</>;
}

/* ─── Home ───────────────────────────────────────────────────────────────── */

export function Home() {
  const { t } = useI18n();
  const { me, loading, error, refetch } = useMe();

  // Промокод — только флаг открытия модалки
  const [promoOpen, setPromoOpen] = useState(false);

  const [svcLoading, setSvcLoading] = useState(false);
  const [svcError,   setSvcError]   = useState<string | null>(null);
  const [svcSummary, setSvcSummary] = useState<ApiSummary | null>(null);
  const [svcForecast, setSvcForecast] = useState<ApiForecast | null>(null);

  const [payLoading,  setPayLoading]  = useState(false);
  const [payForecast, setPayForecast] = useState<{ whenText?: string; amount?: number } | null>(null);

  const [newsLoading, setNewsLoading] = useState(false);
  const [newsItems,   setNewsItems]   = useState<NotifEvent[]>([]);

  const inTelegramMiniApp = hasTelegramInitData();
  const profile     = me?.profile;
  const balance     = me?.balance;
  const displayName = profile?.displayName || profile?.login || "";
  const bonusValue  = typeof (me as any)?.bonus === "number" ? (me as any).bonus : 0;

  const attentionCount = useMemo(() => {
    const s = svcSummary;
    return s ? Number(s.blocked || 0) + Number(s.notPaid || 0) : 0;
  }, [svcSummary]);

  // Toast on balance/bonus change
  const prevBonusRef = useRef<number | null>(null);
  const prevBalRef   = useRef<number | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    const curBonus = typeof (me as any)?.bonus === "number" ? Number((me as any).bonus) : null;
    const curBal   = typeof balance?.amount === "number" ? Number(balance.amount) : null;
    if (curBonus == null && curBal == null) return;

    if (!initializedRef.current) {
      prevBonusRef.current = curBonus;
      prevBalRef.current   = curBal;
      initializedRef.current = true;
      return;
    }

    if (curBonus != null && prevBonusRef.current != null && curBonus !== prevBonusRef.current) {
      const delta = curBonus - prevBonusRef.current;
      delta > 0
        ? toast.success(t("home.toast.bonus_added.title"), { description: `+${delta}` })
        : toast.info(t("home.toast.bonus_changed.title"), { description: `${delta}` });
      prevBonusRef.current = curBonus;
    } else if (curBonus != null && prevBonusRef.current == null) {
      prevBonusRef.current = curBonus;
    }

    if (curBal != null && prevBalRef.current != null && curBal !== prevBalRef.current) {
      const delta = curBal - prevBalRef.current;
      if (delta > 0) toast.success(t("home.toast.balance_added.title"), { description: `+${fmtMoney(delta, String(balance?.currency || "RUB"))}` });
      prevBalRef.current = curBal;
    } else if (curBal != null && prevBalRef.current == null) {
      prevBalRef.current = curBal;
    }
  }, [bonusValue, balance?.amount, balance?.currency, me?.ok]); // eslint-disable-line react-hooks/exhaustive-deps

  // Data loading
  async function loadServicesSummary() {
    setSvcLoading(true); setSvcError(null);
    try {
      const r = await apiFetch("/services", { method: "GET" }) as ApiServicesResponse;
      setSvcSummary(r?.summary ?? null);
      setSvcForecast((r as any)?.forecast ?? null);
    } catch (e: any) {
      setSvcError(e?.message || "Failed to load services");
      setSvcSummary(null); setSvcForecast(null);
    } finally { setSvcLoading(false); }
  }

  async function loadPaymentsForecast() {
    setPayLoading(true);
    try {
      const fc = await apiFetch("/payments/forecast", { method: "GET" }) as ForecastResp;
      setPayForecast(parsePaymentsForecast(fc?.raw ?? null));
    } catch { setPayForecast(null); }
    finally { setPayLoading(false); }
  }

  async function loadHomeNews() {
    setNewsLoading(true);
    try {
      const r = await apiFetch<FeedResp>(`/notifications/feed?onlyNews=1&limit=5`);
      setNewsItems((Array.isArray(r.items) ? r.items : []).filter((x) => categoryOf(x) === "news").slice(0, 5));
    } catch { setNewsItems([]); }
    finally { setNewsLoading(false); }
  }

  useEffect(() => {
    if (me?.ok) { void loadServicesSummary(); void loadPaymentsForecast(); void loadHomeNews(); }
  }, [me?.ok]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading ───────────────────────────────────────────────────────────────
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

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error || !me?.ok) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("home.error.title", "Shpun")}</h1>
            <p className="p">{t("home.error.text")}</p>
            <div className="actions actions--2" style={{ marginTop: 12 }}>
              <button className="btn btn--primary" onClick={() => refetch?.()}>{t("home.error.retry")}</button>
              <Link className="btn" to="/profile">{t("home.actions.profile")}</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const s = svcSummary;
  const currencyFallback = s?.currency || balance?.currency || "RUB";

  const forecastAmountText = typeof payForecast?.amount === "number"
    ? fmtMoneyForecast(payForecast.amount, currencyFallback) : null;

  const forecastWhenText   = payForecast?.whenText || null;

  const servicesForecastText = svcForecast && (svcForecast.nextInDays != null || svcForecast.nextDate || svcForecast.nextAmount != null)
    ? `${svcForecast.nextInDays != null
        ? tr(t("home.tiles.services_in_days"), { days: svcForecast.nextInDays })
        : svcForecast.nextDate ? fmtShortDate(svcForecast.nextDate) : "—"
      }${svcForecast.nextAmount != null ? ` · ~${fmtMoneyForecast(svcForecast.nextAmount, svcForecast.currency || currencyFallback)}` : ""}`
    : null;

  const forecastSub = forecastWhenText || servicesForecastText || (payLoading ? t("home.tiles.forecast.loading") : "—");

  const attentionSub = (() => {
    if (!s) return svcLoading ? t("home.tiles.forecast.loading") : "—";
    const parts: string[] = [];
    if (s.notPaid > 0) parts.push(tr(t("home.tiles.state.pay"), { count: s.notPaid }));
    if (s.blocked > 0) parts.push(tr(t("home.tiles.state.block"), { count: s.blocked }));
    return parts.length === 0 ? t("home.tiles.state.ok") : parts.join(" · ");
  })();

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="section">

      {/* Main card — greeting + tiles */}
      <div className="card">
        <div className="card__body">
          <div className="home-head">
            <div className="home-head__left">
              <div className="home-head__title">
                {t("home.hello")}{displayName ? `, ${displayName}` : ""} 👋
              </div>
              <div className="home-head__sub">{t("home.head.sub")}</div>
            </div>
          </div>

          <div className="home-tiles">
            <Tile to="/payments" icon="💰" title={t("home.tiles.balance")}
              value={balance ? <Money amount={balance.amount} currency={balance.currency} /> : "—"}
              sub={t("home.tiles.balance.sub")} tone="accent" />

            <Tile to="/services" icon="🛰️" title={t("home.tiles.services")}
              value={svcLoading ? "…" : s ? `${s.active}/${s.total}` : "—"}
              sub={t("home.tiles.services.sub")} tone="ok" />

            <Tile to="/services"
              icon={attentionCount > 0 ? "⚠️" : "✅"}
              title={attentionCount > 0 ? t("home.tiles.attention") : t("home.tiles.state")}
              value={svcLoading ? "…" : s ? attentionCount : "—"}
              sub={attentionSub}
              tone={attentionCount > 0 ? "warn" : "ok"} />

            <Tile to="/services" icon="📦" title={t("home.tiles.monthly")}
              value={svcLoading ? "…" : s ? fmtMoney(s.monthlyCost || 0, currencyFallback) : "—"}
              sub={t("home.tiles.monthly.sub")} tone="default" />

            <Tile to="/payments" icon="🎁" title={t("home.tiles.bonus")}
              value={bonusValue} sub={t("home.tiles.bonus.sub")} tone="default" />

            <Tile to="/payments" icon="🗓️" title={t("home.tiles.forecast")}
              value={forecastAmountText || (payLoading ? "…" : "—")}
              sub={forecastSub} tone="default" />
          </div>

          {svcError && <div className="muted" style={{ marginTop: 10 }}>{t("home.services.error")}</div>}
        </div>
      </div>

      {/* Открыть в браузере — только в Telegram Mini App */}
      {inTelegramMiniApp && (
        <div className="section">
          <div className="card home-install">
            <div className="home-install__glow" />
            <div className="card__body">
              <div className="home-install__copy">
                <div className="home-install__title">{t("home.install.card.title")}</div>
              </div>
              <div className="home-install__btnwrap">
                <button className="btn btn--primary home-install__btn home-install__cta" onClick={openExternalAuthPage}>
                  <span className="home-install__ctaIcon" aria-hidden>🌐</span>
                  <span className="home-install__ctaText">
                    <span className="home-install__ctaTitle">{t("home.install.card.open")}</span>
                    <span className="home-install__ctaSub">{t("home.install.card.sub")}</span>
                  </span>
                  <span className="home-install__ctaArrow" aria-hidden>↗</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Новости */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="home-block-head">
              <div>
                <div className="h1">{t("home.news.title")}</div>
                <div className="p">{t("home.news.subtitle")}</div>
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
                          <div className="home-newsCard__title">{n.title || t("home.news.item.fallback")}</div>
                          <span className="chip chip--soft home-newsCard__date">
                            {fmtFeedDate(n.ts, t("home.news.today"))}
                          </span>
                        </div>
                        {preview && <div className="list__sub home-news__preview home-newsCard__preview">{preview}</div>}
                      </div>
                    </Link>
                  );
                })
              ) : (
                <Link to="/feed" className="home-link">
                  <div className="list__item home-newsCard">
                    <div className="home-newsCard__head">
                      <div className="home-newsCard__title">{t("home.news.empty.title")}</div>
                      <span className="chip chip--soft home-newsCard__date">—</span>
                    </div>
                    <div className="list__sub home-news__preview home-newsCard__preview">
                      {t("home.news.empty.sub")}
                    </div>
                  </div>
                </Link>
              )}
            </div>

            <div className="home-cta">
              <Link className="btn btn--accent home-cta__btn" to="/feed">{t("home.news.open")}</Link>
            </div>
          </div>
        </div>
      </div>

      {/* Реферальная программа — баннер */}
      <div className="section">
        <div className="card" style={{ background: "linear-gradient(135deg, rgba(124,92,255,0.15), rgba(77,215,255,0.08))", borderColor: "rgba(124,92,255,0.3)" }}>
          <div className="card__body">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 28, lineHeight: 1 }}>🤝</span>
              <div className="h1">{t("home.ref.title")}</div>
            </div>
            <p className="p">{t("home.ref.sub")}</p>

            <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
              <div className="pre" style={{ flex: "1 1 auto", minWidth: 0, margin: 0, padding: "8px 12px" }}>
                <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 2 }}>{t("home.ref.link.k")}</div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{t("home.ref.link.v")}</div>
              </div>
              <div className="pre" style={{ flex: "1 1 auto", minWidth: 0, margin: 0, padding: "8px 12px" }}>
                <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 2 }}>{t("home.ref.percent.k")}</div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{t("home.ref.percent.v")}</div>
              </div>
            </div>

            <div className="actions actions--1" style={{ marginTop: 14 }}>
              <Link className="btn btn--primary" to="/referrals">
                {t("home.ref.open")}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Промокод */}
      <div className="section">
        <div className="card home-promocard">
          <div className="card__body">
            <div className="home-block-head">
              <div>
                <div className="h1">{t("home.promo.title")}</div>
                <div className="p">{t("home.promo.sub")}</div>
              </div>
            </div>
            <button
              className="btn btn--accent home-promoBtn"
              onClick={() => setPromoOpen(true)}
            >
              🎁 {t("promo.apply")}
            </button>
          </div>
        </div>
      </div>

      {/* Модальное окно промокода */}
      <PromoModal
        open={promoOpen}
        onClose={() => setPromoOpen(false)}
        onSuccess={() => {
          // Обновляем данные пользователя после успешного применения
          void refetch?.()
        }}
      />

    </div>
  );
}

export default Home;