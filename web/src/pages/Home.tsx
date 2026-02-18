// web/src/pages/Home.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { useI18n } from "../shared/i18n";
import { apiFetch } from "../shared/api/client";

function Money({ amount, currency }: { amount: number; currency: string }) {
  const formatted =
    currency === "RUB"
      ? new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
      : new Intl.NumberFormat("ru-RU").format(amount) + ` ${currency}`;
  return <>{formatted}</>;
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

/** ===== Payments ===== */
type PaySystem = {
  name?: string;
  shm_url?: string;
  recurring?: string | number;
  amount?: number;
};
type PaysystemsResp = { ok: true; items: PaySystem[]; raw?: any };
type ForecastResp = { ok: true; raw: any };

function pickDefaultPayAmount(items: PaySystem[]) {
  const v = items.find((x) => Number(x?.amount || 0) > 0)?.amount;
  const n = v ? Math.round(Number(v)) : null;
  return Number.isFinite(n as any) && (n as any) > 0 ? (n as number) : null;
}

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

function fmtShortDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

/**
 * We treat /payments/forecast as the primary "ready sum" source (per your billing template logic).
 * We do NOT assume exact schema; parse common variants.
 */
function parsePaymentsForecast(raw: any): { whenText?: string; amount?: number } | null {
  if (!raw || typeof raw !== "object") return null;

  const amount =
    Number(raw.amount ?? raw.next_amount ?? raw.nextAmount ?? raw.sum ?? raw.to_pay ?? raw.pay_amount) || null;

  const nextInDays =
    raw.next_in_days ?? raw.nextInDays ?? raw.in_days ?? raw.days_left ?? raw.daysLeft ?? null;

  const nextDate =
    raw.next_date ?? raw.nextDate ?? raw.date ?? raw.pay_date ?? raw.payment_date ?? null;

  let whenText: string | undefined;
  if (typeof nextInDays === "number" && Number.isFinite(nextInDays)) {
    whenText = `через ${Math.max(0, Math.round(nextInDays))} дн.`;
  } else if (typeof nextDate === "string" && nextDate) {
    whenText = fmtShortDate(nextDate);
  }

  if (!whenText && !amount) return null;
  return { whenText, amount: amount ?? undefined };
}

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
    <Link to={to} className={`home-tile home-tile--${tone || "default"}`} style={{ textDecoration: "none" }}>
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

export function Home() {
  const { t } = useI18n();
  const { me, loading, error, refetch } = useMe();

  const [transfer, setTransfer] = useState<TransferState>({ status: "idle" });

  const [promo, setPromo] = useState<{ code: string; state: PromoState }>({
    code: "",
    state: { status: "idle" },
  });

  // services
  const [svcLoading, setSvcLoading] = useState(false);
  const [svcError, setSvcError] = useState<string | null>(null);
  const [svcSummary, setSvcSummary] = useState<ApiSummary | null>(null);
  const [svcForecast, setSvcForecast] = useState<ApiForecast | null>(null);

  // payments
  const [payLoading, setPayLoading] = useState(false);
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [payForecast, setPayForecast] = useState<{ whenText?: string; amount?: number } | null>(null);

  const inTelegramMiniApp = hasTelegramInitData();
  const transferBusy = transfer.status === "loading";

  const profile = me?.profile;
  const balance = me?.balance;

  const displayName = profile?.displayName || profile?.login || "";

  // existing code uses me.bonus; keep safe default
  const bonusValue = typeof (me as any)?.bonus === "number" ? (me as any).bonus : 0;

  // referral count already used in your code
  const referralsCount: number | null =
    typeof (me as any)?.referralsCount === "number" ? (me as any).referralsCount : null;

  // partner percent from billing: user.income_percent (but name in API may vary)
  const incomePercentRaw =
    (me as any)?.income_percent ??
    (me as any)?.incomePercent ??
    (me as any)?.partner_income_percent ??
    (me as any)?.partnerIncomePercent ??
    null;

  const incomePercent: number | null = (() => {
    const n = Number(incomePercentRaw);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const attentionCount = useMemo(() => {
    const s = svcSummary;
    if (!s) return 0;
    return Number(s.blocked || 0) + Number(s.notPaid || 0);
  }, [svcSummary]);

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

  async function loadPaymentsLite() {
    setPayLoading(true);
    try {
      const ps = (await apiFetch("/payments/paysystems", { method: "GET" })) as PaysystemsResp;
      const items = ps?.items || [];
      setPayAmount(pickDefaultPayAmount(items));

      try {
        const fc = (await apiFetch("/payments/forecast", { method: "GET" })) as ForecastResp;
        setPayForecast(parsePaymentsForecast(fc?.raw ?? null));
      } catch {
        setPayForecast(null);
      }
    } catch {
      setPayAmount(null);
      setPayForecast(null);
    } finally {
      setPayLoading(false);
    }
  }

  useEffect(() => {
    if (me?.ok) {
      loadServicesSummary();
      loadPaymentsLite();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.ok]);

  async function hardRefresh() {
    await Promise.resolve(refetch?.());
    await Promise.all([loadServicesSummary(), loadPaymentsLite()]);
  }

  async function startTransferAndOpen() {
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
        setTransfer({
          status: "error",
          message: t("home.install.error", "Не удалось открыть в браузере. Попробуйте ещё раз."),
        });
        return;
      }

      const rawConsumeUrl = String(json.consume_url || "").trim();
      if (!rawConsumeUrl) {
        setTransfer({
          status: "error",
          message: t("home.install.error", "Не удалось открыть в браузере. Попробуйте ещё раз."),
        });
        return;
      }

      const consumeUrl = normalizeConsumeUrl(rawConsumeUrl);
      setTransfer({ status: "ready", consumeUrl });
      openInBrowser(consumeUrl);
    } catch {
      setTransfer({
        status: "error",
        message: t("home.install.error", "Не удалось открыть в браузере. Попробуйте ещё раз."),
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
      state: { status: "done", message: t("promo.done.stub", "Бонус-коды скоро будут доступны прямо в приложении ✨") },
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

  const showNotPaid = !!s && s.notPaid > 0;
  const showBlocked = !!s && s.blocked > 0;

  // "Forecast payment" per your request: use ready sum from payments forecast
  const forecastAmountText =
    typeof payForecast?.amount === "number" ? fmtMoney(payForecast.amount, currencyFallback) : null;

  const forecastWhenText = payForecast?.whenText || null;

  // service forecast fallback (only if payments forecast absent)
  const servicesForecastText =
    svcForecast && (svcForecast.nextInDays != null || svcForecast.nextDate || svcForecast.nextAmount != null)
      ? `${svcForecast.nextInDays != null ? `через ${svcForecast.nextInDays} дн.` : svcForecast.nextDate ? fmtShortDate(svcForecast.nextDate) : "—"}${
          svcForecast.nextAmount != null ? ` · ~${fmtMoney(svcForecast.nextAmount, svcForecast.currency || currencyFallback)}` : ""
        }`
      : null;

  // For tile sub: show payment "when", else service forecast, else placeholder
  const forecastSub = forecastWhenText || servicesForecastText || (payLoading ? "Считаем…" : "—");

  // Nice compact sub for "actions needed"
  const attentionSub = (() => {
    if (!s) return svcLoading ? "Проверяем…" : "—";
    const parts: string[] = [];
    if (s.notPaid > 0) parts.push(`Оплата: ${s.notPaid}`);
    if (s.blocked > 0) parts.push(`Блок: ${s.blocked}`);
    if (parts.length === 0) return "Всё в порядке";
    return parts.join(" · ");
  })();

  return (
    <div className="section">
      {/* ===== Header / Accent: Account + Services (tiles) ===== */}
      <div className="card">
        <div className="card__body">
          <div className="home-head">
            <div className="home-head__left">
              <div className="home-head__title">
                {t("home.hello", "Привет")}
                {displayName ? `, ${displayName}` : ""} 👋
              </div>
              <div className="home-head__sub">Аккаунт и услуги — самое важное. Плитки ведут в нужные разделы.</div>
            </div>

            <button className="btn" onClick={hardRefresh} title={t("home.refresh", "⟳ Обновить")}>
              {t("home.refresh", "⟳ Обновить")}
            </button>
          </div>

          <div className="home-tiles">
            {/* 1) Balance */}
            <Tile
              to="/payments"
              icon="💰"
              title="Баланс"
              value={balance ? <Money amount={balance.amount} currency={balance.currency} /> : "—"}
              sub="Пополнение и история"
              tone="accent"
            />

            {/* 2) Services */}
            <Tile
              to="/services"
              icon="🛰️"
              title="Услуги"
              value={svcLoading ? "…" : s ? `${s.active}/${s.total}` : "—"}
              sub="Список и статусы"
              tone="ok"
            />

            {/* 3) Attention */}
            <Tile
              to={showNotPaid ? "/payments" : "/services"}
              icon={attentionCount > 0 ? "⚠️" : "✅"}
              title={attentionCount > 0 ? "Требуют действий" : "Состояние"}
              value={svcLoading ? "…" : s ? attentionCount : "—"}
              sub={attentionSub}
              tone={attentionCount > 0 ? "warn" : "ok"}
              badge={showBlocked ? <span className="home-badge home-badge--danger">есть блок</span> : null}
            />

            {/* 4) Monthly */}
            <Tile
              to="/services"
              icon="📦"
              title="В месяц"
              value={svcLoading ? "…" : s ? fmtMoney(s.monthlyCost || 0, currencyFallback) : "—"}
              sub="Плановый расход"
              tone="default"
            />

            {/* 5) Bonus */}
            <Tile
              to="/payments"
              icon="🎁"
              title="Бонусы"
              value={bonusValue}
              sub="Начисления и списания"
              tone="default"
            />

            {/* 6) Forecast payment (from payments forecast ready amount) */}
            <Tile
              to="/payments"
              icon="🗓️"
              title="Прогноз оплаты"
              value={forecastAmountText || (payLoading ? "…" : "—")}
              sub={forecastAmountText ? `Когда: ${forecastSub}` : forecastSub}
              tone="default"
            />
          </div>

          {svcError ? (
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.72 }}>Не удалось обновить статусы услуг.</div>
          ) : null}
        </div>
      </div>

      {/* Install CTA — ONLY inside Telegram MiniApp */}
      {inTelegramMiniApp ? (
        <div className="section">
          <div className="card home-install">
            <div className="home-install__glow" />
            <div className="card__body">
              <div className="home-install__copy">
                <div className="home-install__title">🚀 Установить ShpunApp</div>
                <div className="home-install__sub">Откроем приложение во внешнем браузере для установки.</div>
                {transfer.status === "error" && <div className="pre home-install__error">{transfer.message}</div>}
              </div>

              <div className="home-install__btnwrap">
                <button className="btn btn--primary home-install__btn" onClick={startTransferAndOpen} disabled={transferBusy}>
                  {transferBusy ? "Открываем…" : "Открыть в браузере"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ===== Referrals ===== */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="home-block-head">
              <div>
                <div className="h1" style={{ margin: 0 }}>Реферальная программа</div>
                <div className="p" style={{ marginTop: 6 }}>
                  Получай процент от пополнений твоих рефералов
                  {incomePercent ? (
                    <>
                      {" "}
                      <span className="dot" />
                      <span style={{ color: "rgba(255,255,255,0.86)", fontWeight: 900 }}>
                        {incomePercent}%
                      </span>
                    </>
                  ) : null}
                </div>
              </div>

              <Link className="btn" to="/referrals">
                Открыть
              </Link>
            </div>

            <div className="home-ref">
              <div className="home-ref__kpi">
                <div className="home-ref__k">Приглашено</div>
                <div className="home-ref__v">{typeof referralsCount === "number" ? referralsCount : "—"}</div>
              </div>

              <div className="home-ref__cta">
                <Link className="btn btn--primary" to="/referrals">
                  Получить ссылку
                </Link>
                <div className="home-ref__hint">
                  {incomePercent
                    ? `Партнёрские бонусы: ${incomePercent}% от пополнений рефералов`
                    : "Поделись ссылкой — получи бонус от пополнений друзей"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== News ===== */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="home-block-head">
              <div>
                <div className="h1" style={{ margin: 0 }}>{t("home.news.title", "Новости")}</div>
                <div className="p" style={{ marginTop: 6 }}>{t("home.news.subtitle", "Коротко и по делу. Полная лента — в “Новости”.")}</div>
              </div>
              <Link className="btn" to="/feed">
                {t("home.news.open", "Открыть")}
              </Link>
            </div>

            <div className="list">
              <Link to="/feed" style={{ textDecoration: "none", color: "inherit" }}>
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">{t("home.news.item1.title", "✅ Система стабильна — всё работает")}</div>
                    <div className="list__sub">{t("home.news.item1.sub", "Если видишь “Can’t connect” — просто обнови страницу.")}</div>
                  </div>
                  <div className="list__side">
                    <span className="chip chip--ok">today</span>
                  </div>
                </div>
              </Link>

              <Link to="/feed" style={{ textDecoration: "none", color: "inherit" }}>
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">{t("home.news.item2.title", "🧭 Лента — в “Новости”")}</div>
                    <div className="list__sub">{t("home.news.item2.sub", "Главная — витрина. Новости — лента. Дальше подключим реальные данные.")}</div>
                  </div>
                  <div className="list__side">
                    <span className="chip chip--soft">new</span>
                  </div>
                </div>
              </Link>
            </div>

            <ActionGrid>
              <Link className="btn" to="/feed">
                {t("home.news.open_full", "Открыть новости")}
              </Link>
            </ActionGrid>
          </div>
        </div>
      </div>

      {/* ===== Bonus codes (footer) ===== */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="home-block-head">
              <div>
                <div className="h1" style={{ margin: 0 }}>Бонус-коды</div>
                <div className="p" style={{ marginTop: 6 }}>Введи код — бонусы или скидка применятся к аккаунту.</div>
              </div>
            </div>

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
                  placeholder="Например: SHPUN-2026"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </div>

              <button className="btn btn--primary" onClick={applyPromoStub} disabled={promo.state.status === "applying"}>
                {promo.state.status === "applying" ? "Применяем…" : "Применить"}
              </button>
            </div>

            {promo.state.status === "done" && <div className="pre">{promo.state.message}</div>}
            {promo.state.status === "error" && <div className="pre">{promo.state.message}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home;
