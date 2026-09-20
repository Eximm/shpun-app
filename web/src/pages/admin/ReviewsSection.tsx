import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { useI18n } from "../../shared/i18n";
import { refreshAdminOverview } from "../../app/notifications/adminOverview";
import { AdminSectionHeader } from "./shared";
import type { AdminSettingsResp } from "./types";

type RewardStatus = "none" | "processing" | "rewarded" | "failed";

type AdminReview = {
  id: number;
  userId: number;
  author: string;
  rating: number;
  text: string;
  status: "pending" | "published" | "hidden";
  rewardStatus?: RewardStatus;
  rewardAmount?: number | null;
  rewardError?: string | null;
  rewardedAt?: string | null;
  createdAt: string;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function ReviewsSection() {
  const { t, formatCurrency, formatDate } = useI18n();

  const fmtDate = (value?: string | null) => {
    if (!value) return "";
    const parsed = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
    return Number.isNaN(parsed.getTime())
      ? value
      : formatDate(parsed, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const [items, setItems] = useState<AdminReview[]>([]);
  const [amount, setAmount] = useState("100");
  const [savedAmount, setSavedAmount] = useState(100);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const pending = useMemo(() => items.filter((item) => item.status === "pending"), [items]);
  const rewarded = useMemo(
    () => items.filter((item) => item.rewardStatus === "rewarded"),
    [items],
  );
  const numericAmount = Math.round(Number(amount) * 100) / 100;
  const amountValid = Number.isFinite(numericAmount) && numericAmount >= 1 && numericAmount <= 500;
  const amountChanged = amountValid && numericAmount !== savedAmount;

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [reviews, settings] = await Promise.all([
        apiFetch<{ ok: true; items: AdminReview[] }>("/reviews?limit=100", { method: "GET" }),
        apiFetch<AdminSettingsResp>("/admin/settings", { method: "GET" }),
      ]);
      if (settings?.ok !== 1 && settings?.ok !== true) {
        throw new Error(t("admin.reviews.err.billing"));
      }
      const nextAmount = Number(settings?.settings?.reviewRewardAmount ?? 100);
      const safeAmount = Number.isFinite(nextAmount) && nextAmount >= 1 && nextAmount <= 500 ? nextAmount : 100;
      setItems(reviews.items);
      setAmount(String(safeAmount));
      setSavedAmount(safeAmount);
    } catch (e: unknown) {
      setError(errorMessage(e, t("admin.reviews.err.load")));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function saveAmount() {
    if (!amountValid) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await apiFetch<{ ok: 1 | true; reviewRewardAmount?: number }>(
        "/admin/settings/review-reward",
        { method: "PUT", body: { reviewRewardAmount: numericAmount } },
      );
      const next = Number(response.reviewRewardAmount ?? numericAmount);
      setSavedAmount(next);
      setAmount(String(next));
      setMessage(t("admin.reviews.reward.saved", { amount: formatCurrency(next) }));
    } catch (e: unknown) {
      setError(errorMessage(e, t("admin.reviews.err.save")));
    } finally {
      setSaving(false);
    }
  }

  async function approve(review: AdminReview) {
    if (amountChanged && review.rewardStatus !== "processing") {
      setError(t("admin.reviews.err.save_amount"));
      return;
    }
    setBusyId(review.id);
    setError("");
    setMessage("");
    try {
      const response = await apiFetch<{ ok: true; message?: string }>(`/reviews/${review.id}/approve`, {
        method: "POST",
      });
      setMessage(response.message || t("admin.reviews.approved_fallback"));
      await load();
      void refreshAdminOverview();
    } catch (e: unknown) {
      setError(errorMessage(e, t("admin.reviews.err.accrual")));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function hide(id: number) {
    setBusyId(id);
    setError("");
    setMessage("");
    try {
      await apiFetch(`/reviews/${id}/status`, { method: "PATCH", body: { status: "hidden" } });
      setMessage(t("admin.reviews.msg.rejected"));
      await load();
      void refreshAdminOverview();
    } catch (e: unknown) {
      setError(errorMessage(e, t("admin.reviews.err.hide")));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card"><div className="card__body">
      <AdminSectionHeader
        kicker={t("admin.tab.reviews")}
        title={t("admin.section.reviews.title")}
        subtitle={t("admin.section.reviews.subtitle")}
        actions={
          <button className="btn btn--soft" type="button" onClick={() => void load()} disabled={loading || saving || busyId !== null}>
            {t("common.refresh")}
          </button>
        }
      />

      <div className="list admin-gap-top-md">
        <div className="list__item admin-tightItem admin-reviewSetting">
          <div className="list__main">
            <div className="list__title">{t("admin.reviews.reward.title")}</div>
            <div className="list__sub">{t("admin.reviews.reward.subtitle")}</div>
          </div>
          <div className="admin-reviewSetting__controls">
            <input
              className="input admin-reviewAmountInput"
              inputMode="decimal"
              value={amount}
              aria-label={t("admin.reviews.reward.aria")}
              onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
            />
            <button className="btn btn--accent" type="button" onClick={() => void saveAmount()} disabled={saving || !amountChanged}>
              {saving ? t("admin.reviews.reward.saving") : t("admin.reviews.reward.save")}
            </button>
          </div>
        </div>
      </div>

      {!amountValid && <div className="pre admin-gap-top-md">{t("admin.reviews.reward.invalid")}</div>}

      {message && <div className="pre admin-gap-top-md">{message}</div>}
      {error && <div className="pre admin-gap-top-md">{error}</div>}

      <h3 className="h2 admin-gap-top-md">{t("admin.reviews.pending_title", { count: pending.length })}</h3>
      {loading ? (
        <div className="list admin-gap-top-md"><div className="skeleton h1" /><div className="skeleton p" /></div>
      ) : pending.length === 0 ? (
        <p className="p">{t("admin.reviews.empty")}</p>
      ) : (
        <div className="list admin-gap-top-md">
          {pending.map((review) => (
            <div className="list__item admin-tightItem admin-reviewCard" key={review.id}>
              <div className="list__main">
                <div className="list__title">{review.author} · {"★".repeat(review.rating)} · #{review.id}</div>
                <div className="list__sub">{t("admin.reviews.user_ref", { id: review.userId })} · {fmtDate(review.createdAt)}</div>
                <div className="p admin-gap-top-sm">{review.text}</div>
                {review.rewardStatus === "failed" && (
                  <div className="list__sub admin-gap-top-sm">{t("admin.reviews.reward.failed_note")}</div>
                )}
              </div>
              <div className="actions actions--2 admin-reviewActions">
                <button
                  className="btn btn--accent"
                  type="button"
                  disabled={busyId !== null || (review.rewardStatus !== "processing" && (amountChanged || !amountValid))}
                  onClick={() => void approve(review)}
                >
                  {busyId === review.id
                    ? t("admin.reviews.action.checking")
                    : review.rewardStatus === "processing"
                      ? t("admin.reviews.action.check_reward")
                      : t("admin.reviews.action.approve", { amount: formatCurrency(savedAmount) })}
                </button>
                <button className="btn btn--soft" type="button" disabled={busyId !== null || review.rewardStatus === "processing"} onClick={() => void hide(review.id)}>
                  {t("admin.reviews.action.reject")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <details className="admin-details admin-gap-top-md">
        <summary className="admin-details__summary">{t("admin.reviews.rewarded_title", { count: rewarded.length })}</summary>
        {rewarded.length === 0 ? <p className="p admin-gap-top-sm">{t("admin.reviews.rewarded_empty")}</p> : (
          <div className="list admin-gap-top-sm">
            {rewarded.slice(0, 20).map((review) => (
              <div className="list__item admin-tightItem" key={review.id}>
                <div className="list__main">
                  <div className="list__title">{review.author} {t("admin.reviews.rewarded.review_ref", { id: review.id })}</div>
                  <div className="list__sub">{t("admin.reviews.rewarded.credited", { amount: formatCurrency(Number(review.rewardAmount || 0)), date: fmtDate(review.rewardedAt) })}</div>
                </div>
                <div className="list__side"><span className="chip chip--ok">{t("admin.reviews.rewarded.published")}</span></div>
              </div>
            ))}
          </div>
        )}
      </details>
    </div></div>
  );
}
