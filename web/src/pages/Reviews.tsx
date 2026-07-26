import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../shared/api/client";
import { PageBackButton } from "../shared/ui/PageBackButton";

type ReviewStatus = "pending" | "published" | "hidden";
type AuthorVisibility = "public" | "masked" | "hidden";

type ReviewComment = {
  id: number;
  reviewId: number;
  text: string;
  author: string;
  authorVisibility?: AuthorVisibility;
  status: ReviewStatus;
  mine?: boolean;
  canModerate?: boolean;
  canApprove?: boolean;
  createdAt: string;
};

type Review = {
  id: number;
  rating: number;
  text: string;
  author: string;
  authorVisibility?: AuthorVisibility;
  status: ReviewStatus;
  mine?: boolean;
  canModerate?: boolean;
  canApprove?: boolean;
  createdAt: string;
  comments: ReviewComment[];
};

type ReviewFilter = "public" | "pending" | "hidden" | "all";

const AUTHOR_OPTIONS: { value: AuthorVisibility; title: string; hint: string }[] = [
  { value: "masked", title: "Скрыть часть имени", hint: "Ник будет выглядеть мягко и без лишней публичности." },
  { value: "public", title: "Показать имя", hint: "Покажем имя так, как оно записано в кабинете." },
  { value: "hidden", title: "Без имени", hint: "Будет просто «Пользователь Shpun»." },
];

function fmtDate(v: string) {
  try {
    return new Date(v.replace(" ", "T") + "Z").toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return String(v || "").slice(0, 10);
  }
}

function statusLabel(status: ReviewStatus) {
  if (status === "published") return "Опубликовано";
  if (status === "hidden") return "Скрыто";
  return "Ждёт модерации";
}

function visibilityLabel(value?: AuthorVisibility) {
  if (value === "public") return "имя открыто";
  if (value === "hidden") return "без имени";
  return "имя скрыто";
}

function authorInitial(author: string) {
  const clean = String(author || "").replace(/^@/, "").trim();
  return (clean[0] || "S").toUpperCase();
}

function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="reviews-stars" aria-label={`Оценка ${value} из 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`reviews-star${n <= value ? " is-on" : ""}`}
          onClick={onChange ? () => onChange(n) : undefined}
          disabled={!onChange}
          aria-label={`${n} из 5`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  return <span className={`reviews-status reviews-status--${status}`}>{statusLabel(status)}</span>;
}

function AuthorVisibilityPicker({
  value,
  onChange,
}: {
  value: AuthorVisibility;
  onChange: (value: AuthorVisibility) => void;
}) {
  const current = AUTHOR_OPTIONS.find((x) => x.value === value) ?? AUTHOR_OPTIONS[0];

  return (
    <div className="reviews-privacy">
      <div className="reviews-privacy__label">Как подписать отзыв</div>
      <div className="reviews-privacy__options" role="radiogroup" aria-label="Отображение имени автора">
        {AUTHOR_OPTIONS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={`reviews-privacy__option${value === item.value ? " is-active" : ""}`}
            onClick={() => onChange(item.value)}
          >
            {item.title}
          </button>
        ))}
      </div>
      <div className="reviews-muted">{current.hint}</div>
    </div>
  );
}

export function Reviews() {
  const [items, setItems] = useState<Review[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [filter, setFilter] = useState<ReviewFilter>("public");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [authorVisibility, setAuthorVisibility] = useState<AuthorVisibility>("masked");
  const [busy, setBusy] = useState(false);
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({});
  const [commentBusy, setCommentBusy] = useState<Record<number, boolean>>({});
  const [moderationBusy, setModerationBusy] = useState<Record<string, boolean>>({});

  const publishedItems = useMemo(() => items.filter((x) => x.status === "published"), [items]);
  const pendingCount = useMemo(() => {
    const reviewCount = items.filter((x) => x.status === "pending").length;
    const commentCount = items.reduce((sum, x) => sum + (x.comments ?? []).filter((c) => c.status === "pending").length, 0);
    return reviewCount + commentCount;
  }, [items]);
  const avgRating = useMemo(() => {
    if (!publishedItems.length) return 0;
    return publishedItems.reduce((sum, x) => sum + Number(x.rating || 0), 0) / publishedItems.length;
  }, [publishedItems]);
  const visibleItems = useMemo(() => {
    if (!isAdmin) return items;
    if (filter === "pending") return items.filter((x) => x.status === "pending" || (x.comments ?? []).some((c) => c.status === "pending"));
    if (filter === "hidden") return items.filter((x) => x.status === "hidden" || (x.comments ?? []).some((c) => c.status === "hidden"));
    if (filter === "all") return items;
    return items.filter((x) => x.status === "published");
  }, [filter, isAdmin, items]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ ok: true; items: Review[]; isAdmin?: boolean }>("/reviews", { method: "GET" });
      setItems(data.items ?? []);
      setIsAdmin(Boolean(data.isAdmin));
    } catch (e: any) {
      setError(String(e?.message || "Не удалось загрузить отзывы."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submitReview() {
    const body = text.trim();
    if (body.length < 8 || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await apiFetch<{ ok: true; item: Review; message?: string }>("/reviews", {
        method: "POST",
        body: { rating, text: body, authorVisibility },
      });
      setItems((prev) => [data.item, ...prev]);
      setText("");
      setRating(5);
      setNotice(data.message || "Отзыв отправлен. Не потерялся — просто ждёт зелёный свет.");
    } catch (e: any) {
      setError(String(e?.message || "Не удалось сохранить отзыв."));
    } finally {
      setBusy(false);
    }
  }

  async function submitComment(reviewId: number) {
    const body = String(commentDrafts[reviewId] || "").trim();
    if (body.length < 2 || commentBusy[reviewId]) return;
    setCommentBusy((prev) => ({ ...prev, [reviewId]: true }));
    setError(null);
    setNotice(null);
    try {
      const data = await apiFetch<{ ok: true; item: ReviewComment; message?: string }>(`/reviews/${reviewId}/comments`, {
        method: "POST",
        body: { text: body, authorVisibility: "masked" },
      });
      setItems((prev) => prev.map((r) => r.id === reviewId ? { ...r, comments: [...(r.comments ?? []), data.item] } : r));
      setCommentDrafts((prev) => ({ ...prev, [reviewId]: "" }));
      setNotice(data.message || "Комментарий отправлен.");
    } catch (e: any) {
      setError(String(e?.message || "Не удалось добавить комментарий."));
    } finally {
      setCommentBusy((prev) => ({ ...prev, [reviewId]: false }));
    }
  }

  async function setReviewModerationStatus(id: number, status: ReviewStatus) {
    const key = `review:${id}`;
    if (moderationBusy[key]) return;
    setModerationBusy((prev) => ({ ...prev, [key]: true }));
    try {
      await apiFetch(`/reviews/${id}/status`, { method: "PATCH", body: { status } });
      setItems((prev) => prev.map((x) => x.id === id ? { ...x, status } : x).filter((x) => isAdmin || x.status !== "hidden"));
    } catch (e: any) {
      setError(String(e?.message || "Не удалось изменить статус отзыва."));
    } finally {
      setModerationBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function setCommentModerationStatus(reviewId: number, commentId: number, status: ReviewStatus) {
    const key = `comment:${commentId}`;
    if (moderationBusy[key]) return;
    setModerationBusy((prev) => ({ ...prev, [key]: true }));
    try {
      await apiFetch(`/reviews/comments/${commentId}/status`, { method: "PATCH", body: { status } });
      setItems((prev) => prev.map((r) => r.id === reviewId ? {
        ...r,
        comments: r.comments.map((c) => c.id === commentId ? { ...c, status } : c).filter((c) => isAdmin || c.status !== "hidden"),
      } : r));
    } catch (e: any) {
      setError(String(e?.message || "Не удалось изменить статус комментария."));
    } finally {
      setModerationBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function removeReview(id: number) {
    if (!confirm("Скрыть этот отзыв?")) return;
    if (isAdmin) {
      await setReviewModerationStatus(id, "hidden");
      return;
    }
    await apiFetch(`/reviews/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((x) => x.id !== id));
  }

  async function removeComment(reviewId: number, commentId: number) {
    if (!confirm("Скрыть этот комментарий?")) return;
    if (isAdmin) {
      await setCommentModerationStatus(reviewId, commentId, "hidden");
      return;
    }
    await apiFetch(`/reviews/comments/${commentId}`, { method: "DELETE" });
    setItems((prev) => prev.map((r) => r.id === reviewId ? { ...r, comments: r.comments.filter((c) => c.id !== commentId) } : r));
  }

  return (
    <div className="section reviews-page">
      <PageBackButton />

      <div className="card reviews-hero">
        <div className="card__body reviews-hero__body">
          <div>
            <div className="reviews-hero__kicker">Отзывы</div>
            <h1 className="h1">Что говорят про Shpun</h1>
            <p className="p">Живой уголок пользовательских историй: без пресс-релизов, зато с честным вайбом и лёгкой модерацией — чтобы уют не превращался в подъезд.</p>
          </div>
          <div className="reviews-hero__stats">
            <span>{publishedItems.length} опубликовано</span>
            <span>Оценка {avgRating ? avgRating.toFixed(1) : "—"}</span>
            {isAdmin && <span>{pendingCount} ждёт</span>}
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="reviews-filter" role="tablist" aria-label="Фильтр отзывов">
          {[
            ["public", "Опубликованные"],
            ["pending", "На проверке"],
            ["hidden", "Скрытые"],
            ["all", "Все"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`reviews-filter__btn${filter === value ? " is-active" : ""}`}
              type="button"
              onClick={() => setFilter(value as ReviewFilter)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="card reviews-compose">
        <div className="card__body">
          <div className="reviews-compose__head">
            <div>
              <div className="reviews-card-title">Оставить отзыв</div>
              <div className="reviews-muted">Пишите по-человечески: что понравилось, где Shpun красавчик, а где ещё просит напильник.</div>
            </div>
            <Stars value={rating} onChange={setRating} />
          </div>
          <textarea
            className="input reviews-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1200}
            placeholder="Например: YouTube ожил, мобильный интернет перестал изображать улитку..."
          />
          <AuthorVisibilityPicker value={authorVisibility} onChange={setAuthorVisibility} />
          <div className="reviews-compose__actions">
            <span className="reviews-muted">{text.trim().length}/1200</span>
            <button className="btn btn--primary" type="button" onClick={() => void submitReview()} disabled={busy || text.trim().length < 8}>
              {busy ? "Отправляем…" : "Отправить"}
            </button>
          </div>
          {notice && <div className="pre reviews-notice">{notice}</div>}
          {error && <div className="pre reviews-error">{error}</div>}
        </div>
      </div>

      {loading ? (
        <div className="card"><div className="card__body"><p className="p">Загружаем отзывы…</p></div></div>
      ) : visibleItems.length === 0 ? (
        <div className="card reviews-empty"><div className="card__body">
          <div className="reviews-card-title">{isAdmin && filter !== "public" ? "Тут чисто" : "Пока тихо"}</div>
          <p className="p">Можно быть первым. Да, это редкий шанс зайти в историю без особого риска.</p>
        </div></div>
      ) : (
        <div className="reviews-list">
          {visibleItems.map((r) => (
            <article className={`card reviews-card reviews-card--${r.status}`} key={r.id}>
              <div className="card__body">
                <div className="reviews-card__top">
                  <div className="reviews-authorBlock">
                    <div className="reviews-avatar">{authorInitial(r.author)}</div>
                    <div>
                      <div className="reviews-authorLine">
                        <span className="reviews-author">{r.author}</span>
                        <span className="reviews-authorMode">{visibilityLabel(r.authorVisibility)}</span>
                      </div>
                      <div className="reviews-muted">{fmtDate(r.createdAt)}</div>
                    </div>
                  </div>
                  <div className="reviews-card__meta">
                    <StatusBadge status={r.status} />
                    <Stars value={r.rating} />
                  </div>
                </div>
                <p className="reviews-text">{r.text}</p>
                <div className="reviews-moderation">
                  {r.canApprove && r.status !== "published" && (
                    <button className="btn btn--primary" type="button" onClick={() => void setReviewModerationStatus(r.id, "published")}>
                      Опубликовать
                    </button>
                  )}
                  {r.canApprove && r.status !== "pending" && (
                    <button className="btn btn--soft" type="button" onClick={() => void setReviewModerationStatus(r.id, "pending")}>
                      На проверку
                    </button>
                  )}
                  {r.canModerate && r.status !== "hidden" && (
                    <button className="btn btn--soft reviews-card__remove" type="button" onClick={() => void removeReview(r.id)}>
                      Скрыть отзыв
                    </button>
                  )}
                </div>

                {r.status !== "hidden" && (
                  <div className="reviews-comments">
                    <div className="reviews-comments__title">
                      <span>Комментарии</span>
                      <small>{(r.comments ?? []).length}</small>
                    </div>
                    {(r.comments ?? []).map((c) => (
                      <div className={`reviews-comment reviews-comment--${c.status}`} key={c.id}>
                        <div className="reviews-comment__meta">
                          <b>{c.author}</b>
                          <span>{fmtDate(c.createdAt)}</span>
                          <StatusBadge status={c.status} />
                        </div>
                        <div className="reviews-comment__text">{c.text}</div>
                        <div className="reviews-moderation reviews-moderation--comment">
                          {c.canApprove && c.status !== "published" && (
                            <button className="reviews-linkBtn" type="button" onClick={() => void setCommentModerationStatus(r.id, c.id, "published")}>Опубликовать</button>
                          )}
                          {c.canApprove && c.status !== "pending" && (
                            <button className="reviews-linkBtn" type="button" onClick={() => void setCommentModerationStatus(r.id, c.id, "pending")}>На проверку</button>
                          )}
                          {c.canModerate && c.status !== "hidden" && (
                            <button className="reviews-linkBtn" type="button" onClick={() => void removeComment(r.id, c.id)}>Скрыть</button>
                          )}
                        </div>
                      </div>
                    ))}

                    <div className="reviews-commentForm">
                      <input
                        className="input"
                        value={commentDrafts[r.id] ?? ""}
                        onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        maxLength={700}
                        placeholder="Добавить комментарий"
                      />
                      <button className="btn" type="button" onClick={() => void submitComment(r.id)} disabled={commentBusy[r.id] || !String(commentDrafts[r.id] || "").trim()}>
                        Отправить
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
