import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../shared/api/client";
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

function money(value: number) {
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

function date(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ru-RU");
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function ReviewsSection() {
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
        throw new Error("Биллинг не вернул настройки награды.");
      }
      const nextAmount = Number(settings?.settings?.reviewRewardAmount ?? 100);
      const safeAmount = Number.isFinite(nextAmount) && nextAmount >= 1 && nextAmount <= 500 ? nextAmount : 100;
      setItems(reviews.items);
      setAmount(String(safeAmount));
      setSavedAmount(safeAmount);
    } catch (e: unknown) {
      setError(errorMessage(e, "Не удалось загрузить отзывы."));
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
      setMessage(`Награда за отзыв: ${money(next)}.`);
    } catch (e: unknown) {
      setError(errorMessage(e, "Не удалось сохранить сумму."));
    } finally {
      setSaving(false);
    }
  }

  async function approve(review: AdminReview) {
    if (amountChanged && review.rewardStatus !== "processing") {
      setError("Сначала сохраните новую сумму награды.");
      return;
    }
    setBusyId(review.id);
    setError("");
    setMessage("");
    try {
      const response = await apiFetch<{ ok: true; message?: string }>(`/reviews/${review.id}/approve`, {
        method: "POST",
      });
      setMessage(response.message || "Отзыв опубликован, бонусы начислены.");
      await load();
    } catch (e: unknown) {
      setError(errorMessage(e, "Начисление не выполнено. Отзыв не опубликован."));
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
      setMessage("Отзыв отклонён и скрыт.");
      await load();
    } catch (e: unknown) {
      setError(errorMessage(e, "Не удалось скрыть отзыв."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card"><div className="card__body">
      <div className="kicker">Отзывы и вознаграждения</div>
      <h2 className="h1">Проверка отзывов</h2>
      <p className="p">После подтверждения биллинг начислит бонусы, а отзыв будет опубликован.</p>

      <div className="list admin-gap-top-md">
        <div className="list__item admin-tightItem admin-reviewSetting">
          <div className="list__main">
            <div className="list__title">Награда за один отзыв</div>
            <div className="list__sub">От 1 до 500 ₽. Новая сумма применяется только после сохранения.</div>
          </div>
          <input
            className="input admin-reviewAmountInput"
            inputMode="decimal"
            value={amount}
            aria-label="Сумма награды за отзыв"
            onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
          />
        </div>
      </div>

      {!amountValid && <div className="pre admin-gap-top-md">Введите сумму от 1 до 500 ₽.</div>}
      <div className="actions actions--2 admin-gap-top-md">
        <button className="btn btn--soft" type="button" onClick={() => void load()} disabled={loading || saving || busyId !== null}>Обновить</button>
        <button className="btn btn--accent" type="button" onClick={() => void saveAmount()} disabled={saving || !amountChanged}>
          {saving ? "Сохраняю…" : "Сохранить сумму"}
        </button>
      </div>

      {message && <div className="pre admin-gap-top-md">{message}</div>}
      {error && <div className="pre admin-gap-top-md">{error}</div>}

      <h3 className="h2 admin-gap-top-md">Ожидают проверки</h3>
      {loading ? (
        <div className="list admin-gap-top-md"><div className="skeleton h1" /><div className="skeleton p" /></div>
      ) : pending.length === 0 ? (
        <p className="p">Новых отзывов нет.</p>
      ) : (
        <div className="list admin-gap-top-md">
          {pending.map((review) => (
            <div className="list__item admin-tightItem admin-reviewCard" key={review.id}>
              <div className="list__main">
                <div className="list__title">{review.author} · {"★".repeat(review.rating)} · #{review.id}</div>
                <div className="list__sub">Пользователь #{review.userId} · {date(review.createdAt)}</div>
                <div className="p admin-gap-top-sm">{review.text}</div>
                {review.rewardStatus === "failed" && (
                  <div className="list__sub admin-gap-top-sm">Предыдущее начисление не подтверждено. Можно повторить безопасно.</div>
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
                    ? "Проверяю…"
                    : review.rewardStatus === "processing"
                      ? "Проверить начисление"
                      : `Одобрить · +${money(savedAmount)}`}
                </button>
                <button className="btn btn--soft" type="button" disabled={busyId !== null || review.rewardStatus === "processing"} onClick={() => void hide(review.id)}>
                  Отклонить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="h2 admin-gap-top-md">Последние начисления</h3>
      {rewarded.length === 0 ? <p className="p">Начислений пока нет.</p> : (
        <div className="list admin-gap-top-md">
          {rewarded.slice(0, 20).map((review) => (
            <div className="list__item admin-tightItem" key={review.id}>
              <div className="list__main">
                <div className="list__title">{review.author} · отзыв #{review.id}</div>
                <div className="list__sub">Начислено {money(Number(review.rewardAmount || 0))} · {date(review.rewardedAt)}</div>
              </div>
              <div className="list__side"><span className="chip chip--ok">Опубликован</span></div>
            </div>
          ))}
        </div>
      )}
    </div></div>
  );
}
