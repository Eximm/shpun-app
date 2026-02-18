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

function ActionGrid({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  const n = Math.max(1, Math.min(5, items.length));
  return <div className={`actions actions--${n}`}>{items}</div>;
}

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

/** ===== Referrals (from /api/referrals/summary) ===== */
type ApiReferralsSummary = {
  ok: true;
  invited: number;
  ref_link?: string | null;
  ref_code?: string | null;
  earned_bonus?: number | null;
  paid_count?: number | null;
};

/** ===== Payments (reuse what you already have in Payments module) ===== */
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

function PillBase({
  icon,
  label,
  value,
  tone,
}: {
  icon?: string;
  label: string;
  value: React.ReactNode;
  tone?: "default" | "warn" | "danger" | "ok" | "accent";
}) {
  const bg =
    tone === "danger"
      ? "rgba(255, 80, 80, 0.10)"
      : tone === "warn"
      ? "rgba(255, 200, 60, 0.10)"
      : tone === "ok"
      ? "rgba(80, 255, 170, 0.10)"
      : tone === "accent"
      ? "rgba(110, 140, 255, 0.12)"
      : "rgba(255,255,255,0.06)";

  const border =
    tone === "danger"
      ? "rgba(255, 90, 90, 0.20)"
      : tone === "warn"
      ? "rgba(255, 210, 80, 0.18)"
      : tone === "ok"
      ? "rgba(120, 255, 190, 0.18)"
      : tone === "accent"
      ? "rgba(140, 160, 255, 0.22)"
      : "rgba(255,255,255,0.10)";

  return (
    <div
      className="home-pill"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 999,
        border: `1px solid ${border}`,
        background: bg,
        whiteSpace: "nowrap",
        userSelect: "none",
      }}
    >
      {icon ? (
        <span
          aria-hidden
          style={{
            width: 20,
            height: 20,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 999,
            background: "rgba(255,255,255,0.08)",
            fontSize: 12,
          }}
        >
          {icon}
        </span>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
        <span style={{ fontSize: 11, opacity: 0.75 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 900, opacity: 0.95 }}>{value}</span>
      </div>
    </div>
  );
}

function Pill({
  to,
  icon,
  label,
  value,
  tone,
  title,
}: {
  to?: string;
  icon?: string;
  label: string;
  value: React.ReactNode;
  tone?: "default" | "warn" | "danger" | "ok" | "accent";
  title?: string;
}) {
  if (!to) return <PillBase icon={icon} label={label} value={value} tone={tone} />;

  return (
    <Link
      to={to}
      title={title}
      style={{
        textDecoration: "none",
        display: "inline-flex",
        borderRadius: 999,
        outline: "none",
      }}
      onMouseDown={(e) => {
        // tiny pressed feel (without CSS files)
        const el = (e.currentTarget.firstChild as HTMLElement) || null;
        if (el) el.style.transform = "translateY(1px)";
      }}
      onMouseUp={(e) => {
        const el = (e.currentTarget.firstChild as HTMLElement) || null;
        if (el) el.style.transform = "";
      }}
      onMouseLeave={(e) => {
        const el = (e.currentTarget.firstChild as HTMLElement) || null;
        if (el) el.style.transform = "";
      }}
    >
      <div
        style={{
          borderRadius: 999,
          transition: "filter 120ms ease, transform 120ms ease",
          filter: "brightness(1)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.filter = "brightness(1.08)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.filter = "brightness(1)";
        }}
      >
        <PillBase icon={icon} label={label} value={value} tone={tone} />
      </div>
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

  // referrals
  const [refLoading, setRefLoading] = useState(false);
  const [refSummary, setRefSummary] = useState<ApiReferralsSummary | null>(null);

  // payments (for forecast + default amount)
  const [payLoading, setPayLoading] = useState(false);
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [payForecast, setPayForecast] = useState<{ whenText?: string; amount?: number } | null>(null);

  const inTelegramMiniApp = hasTelegramInitData();
  const transferBusy = transfer.status === "loading";

  const profile = me?.profile;
  const balance = me?.balance;
  const displayName = profile?.displayName || profile?.login || "";

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

  async function loadReferralsSummary() {
    setRefLoading(true);
    try {
      const r = (await apiFetch("/referrals/summary", { method: "GET" })) as ApiReferralsSummary;
      if (r?.ok) setRefSummary(r);
      else setRefSummary(null);
    } catch {
      setRefSummary(null);
    } finally {
      setRefLoading(false);
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
      loadReferralsSummary();
      loadPaymentsLite();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.ok]);

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
      state: { status: "done", message: t("promo.done.stub", "Промокоды скоро будут доступны прямо в приложении ✨") },
    }));
  }

  async function hardRefresh() {
    await Promise.resolve(refetch?.());
    await Promise.all([loadServicesSummary(), loadReferralsSummary(), loadPaymentsLite()]);
  }

  // --- no hooks below ---
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

  // show only meaningful pills (avoid noise)
  const showAttention = !!s && attentionCount > 0;
  const showNotPaid = !!s && s.notPaid > 0;
  const showBlocked = !!s && s.blocked > 0;
  const showPending = !!s && s.pending > 0;
  const showExpSoon = !!s && s.expiringSoon > 0;

  // forecast: prefer payments forecast, fallback to services forecast
  const paymentForecastText = payForecast
    ? `${payForecast.whenText ?? "—"}${payForecast.amount ? ` · ~${fmtMoney(payForecast.amount, currencyFallback)}` : ""}`
    : null;

  const servicesForecastText =
    svcForecast && (svcForecast.nextInDays != null || svcForecast.nextDate || svcForecast.nextAmount != null)
      ? `${svcForecast.nextInDays != null ? `через ${svcForecast.nextInDays} дн.` : svcForecast.nextDate ? fmtShortDate(svcForecast.nextDate) : "—"}${
          svcForecast.nextAmount != null ? ` · ~${fmtMoney(svcForecast.nextAmount, svcForecast.currency || currencyFallback)}` : ""
        }`
      : null;

  const forecastText = paymentForecastText || servicesForecastText;

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
              <p className="p">{t("home.subtitle", "SDN System — баланс, услуги и управление подпиской.")}</p>
            </div>

            <button className="btn" onClick={hardRefresh} title={t("home.refresh", "⟳ Обновить")}>
              {t("home.refresh", "⟳ Обновить")}
            </button>
          </div>

          <div className="kv kv--3">
            <Link className="kv__item" to="/payments" style={{ textDecoration: "none" }}>
              <div className="kv__k">Баланс</div>
              <div className="kv__v">
                {balance ? <Money amount={balance.amount} currency={balance.currency} /> : "—"}
              </div>
            </Link>

            <Link className="kv__item" to="/payments" style={{ textDecoration: "none" }}>
              <div className="kv__k">Бонусы</div>
              <div className="kv__v">{typeof me.bonus === "number" ? me.bonus : 0}</div>
            </Link>

            <Link className="kv__item" to="/services" style={{ textDecoration: "none" }}>
              <div className="kv__k">Услуги</div>
              <div className="kv__v">{svcLoading ? "…" : s ? `${s.active}/${s.total}` : "—"}</div>
            </Link>
          </div>

          {/* Summary tile */}
          <Link to="/services" style={{ textDecoration: "none" }}>
            <div
              className="kv__item"
              style={{
                marginTop: 14,
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.10)",
                background:
                  "radial-gradient(900px 220px at 18% 0%, rgba(130,160,255,0.14), transparent 55%), rgba(255,255,255,0.03)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div>
                  <div className="kv__k" style={{ fontSize: 12, opacity: 0.8 }}>
                    Состояние услуг
                  </div>
                  <div className="kv__v" style={{ marginTop: 6 }}>
                    {showAttention ? (
                      <>
                        ⚠️ Требуют действий: <span style={{ opacity: 0.95 }}>{attentionCount}</span>
                      </>
                    ) : (
                      <>Сводка статусов и прогноз оплаты</>
                    )}
                  </div>
                </div>

                <div style={{ opacity: 0.75, fontWeight: 800 }}>Открыть →</div>
              </div>

              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  gap: 10,
                  overflowX: "auto",
                  paddingBottom: 4,
                  WebkitOverflowScrolling: "touch",
                }}
              >
                <Pill to="/services" icon="✅" label="Активные" value={svcLoading ? "…" : s ? s.active : "—"} tone="ok" />
                {showNotPaid ? (
                  <Pill to="/payments" icon="💳" label="Требуют оплаты" value={s!.notPaid} tone="warn" />
                ) : null}
                {showBlocked ? (
                  <Pill to="/services" icon="⛔" label="Заблокированы" value={s!.blocked} tone="danger" />
                ) : null}
                {showPending ? <Pill to="/services" icon="⏳" label="Подключаются" value={s!.pending} /> : null}
                {s ? (
                  <Pill
                    to="/services"
                    icon="📦"
                    label="В месяц"
                    value={fmtMoney(s.monthlyCost || 0, s.currency || currencyFallback)}
                    tone="accent"
                  />
                ) : null}
                {showExpSoon ? (
                  <Pill to="/services" icon="🕒" label="Скоро истекают" value={s!.expiringSoon} tone="warn" />
                ) : null}
                {forecastText ? (
                  <Pill to="/payments" icon="🗓️" label="Прогноз оплаты" value={forecastText} tone="accent" />
                ) : null}
              </div>

              {payAmount ? (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.78 }}>
                  К оплате обычно: <b style={{ opacity: 0.95 }}>{fmtMoney(payAmount, "RUB")}</b>{" "}
                  <span style={{ opacity: 0.8 }}>·</span>{" "}
                  <Link to="/payments" style={{ textDecoration: "underline", color: "rgba(255,255,255,0.85)" }}>
                    перейти в оплату
                  </Link>
                </div>
              ) : payLoading ? (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>Считаем сумму для оплаты…</div>
              ) : null}

              {svcError ? (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>Не удалось обновить статусы услуг.</div>
              ) : null}
            </div>
          </Link>

          {/* Referrals */}
          <Link to="/referrals" style={{ textDecoration: "none" }}>
            <div
              className="kv__item"
              style={{
                marginTop: 12,
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.10)",
                background:
                  "radial-gradient(900px 200px at 20% 0%, rgba(170,120,255,0.12), transparent 55%), rgba(255,255,255,0.03)",
              }}
            >
              <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                <div className="kv__k">Рефералы</div>
                <span className="badge" style={{ opacity: 0.9 }}>
                  важно
                </span>
              </div>

              <div className="kv__v" style={{ marginTop: 6 }}>
                Приглашайте друзей → получайте бонусы
              </div>

              {refSummary ? (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                  Приглашено: <b style={{ opacity: 0.95 }}>{refSummary.invited}</b> · открыть детали
                </div>
              ) : refLoading ? (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>Обновляем статистику…</div>
              ) : (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                  Открыть, чтобы получить ссылку для приглашений
                </div>
              )}
            </div>
          </Link>
        </div>
      </div>

      {/* Install CTA — ONLY inside Telegram MiniApp */}
      {inTelegramMiniApp && (
        <div className="section">
          <div className="card home-install">
            <div className="home-install__glow" />
            <div className="card__body">
              <div className="home-install__copy">
                <div className="home-install__title">🚀 Установить ShpunApp</div>
                <div className="home-install__sub">Откроем приложение во внешнем браузере для установки.</div>

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
                  {transferBusy ? "Открываем…" : "Открыть в браузере"}
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
                <p className="p">{t("home.news.subtitle", "Коротко и по делу. Полная лента — в “Новости”.")}</p>
              </div>
              <Link className="btn" to="/feed">
                {t("home.news.open", "Открыть")}
              </Link>
            </div>

            <div className="list">
              <div className="list__item">
                <div className="list__main">
                  <div className="list__title">{t("home.news.item1.title", "✅ Система стабильна — всё работает")}</div>
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
                    {t("home.news.item2.sub", "Главная — витрина. Новости — лента. Дальше подключим реальные данные.")}
                  </div>
                </div>
                <div className="list__side">
                  <span className="chip chip--soft">new</span>
                </div>
              </div>
            </div>

            <ActionGrid>
              <Link className="btn" to="/feed">
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
              <Link className="btn" to="/profile">
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
