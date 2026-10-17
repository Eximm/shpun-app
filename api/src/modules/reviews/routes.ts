import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import {
  shmShpunAppAdminReviewReward,
  shmShpunAppAdminStatus,
  shmShpunAppPromoOpportunities,
} from "../../shared/shm/shmClient.js";
import { notifyReviewReward } from "./notifications.js";
import {
  beginReviewReward,
  completeReviewReward,
  createComment,
  createReview,
  failReviewReward,
  getCommentById,
  getReviewById,
  hasReviewByUserId,
  hideComment,
  hideReview,
  listReviews,
  publishReviewWithoutReward,
  setCommentStatus,
  setReviewStatus,
  snapshotLegacyReviewReward,
} from "./repo.js";

type AuthorVisibility = "public" | "masked" | "hidden";

function text(v: unknown, max: number) {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function multiline(v: unknown, max: number) {
  return String(v ?? "").replace(/\r/g, "").trim().slice(0, max);
}

function int(v: unknown, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeAuthorVisibility(v: unknown): AuthorVisibility {
  const s = String(v ?? "").trim();
  return s === "public" || s === "hidden" || s === "masked" ? s : "masked";
}

function sessionUser(s: any) {
  const id = Number(s?.shmUserId ?? s?.userId ?? 0);
  if (!Number.isFinite(id) || id <= 0) return null;
  const login = text(s?.login, 120);
  const displayName = text(s?.name || s?.displayName || s?.clientName, 120) || (login ? login.replace(/^@/, "") : `Пользователь #${id}`);
  return { id, login, displayName };
}

async function isAdminSession(s: any) {
  const sid = String(s?.shmSessionId ?? "").trim();
  if (!sid) return false;
  try {
    const r = await shmShpunAppAdminStatus(sid);
    return r.ok && (r.json?.is_admin === 1 || r.json?.is_admin === true);
  } catch {
    return false;
  }
}

function maskAuthorName(value: unknown, userId: unknown) {
  const raw = String(value ?? "").replace(/^@/, "").trim();
  const fallback = `Пользователь #${Number(userId) || "?"}`;
  const name = raw || fallback;

  if (name.includes("@")) {
    const [left, domain] = name.split("@");
    const visible = left.slice(0, Math.min(3, Math.max(1, left.length)));
    return `${visible}${"•".repeat(Math.max(3, left.length - visible.length))}@${domain || "mail"}`;
  }

  if (name.length <= 3) return `${name[0] || "Г"}••`;
  if (name.length <= 6) return `${name.slice(0, 2)}••`;
  return `${name.slice(0, 3)}•••${name.slice(-1)}`;
}

function publicAuthor(row: any) {
  const visibility = normalizeAuthorVisibility(row.author_visibility);
  const raw = row.display_name || row.user_login || `Пользователь #${row.user_id}`;
  if (visibility === "hidden") return "Пользователь Shpun";
  if (visibility === "public") return String(raw);
  return maskAuthorName(raw, row.user_id);
}

function publicReview(row: any, currentUserId: number, isAdmin: boolean) {
  const mine = Number(row.user_id) === currentUserId;
  const item: any = {
    id: row.id,
    rating: row.rating,
    text: row.text,
    author: publicAuthor(row),
    authorVisibility: normalizeAuthorVisibility(row.author_visibility),
    userId: row.user_id,
    status: row.status,
    mine,
    canModerate: isAdmin || Number(row.user_id) === currentUserId,
    canApprove: isAdmin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    comments: (row.comments ?? []).map((c: any) => ({
      id: c.id,
      reviewId: c.review_id,
      text: c.text,
      author: publicAuthor(c),
      authorVisibility: normalizeAuthorVisibility(c.author_visibility),
      userId: c.user_id,
      status: c.status,
      mine: Number(c.user_id) === currentUserId,
      canModerate: isAdmin || Number(c.user_id) === currentUserId,
      canApprove: isAdmin,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })),
  };
  if (isAdmin) {
    item.rewardStatus = row.reward_status || "none";
    item.rewardAmount = row.reward_amount == null ? null : Number(row.reward_amount);
    item.rewardError = row.reward_error || null;
    item.rewardedAt = row.rewarded_at || null;
    item.rewardOfferStatus = row.reward_offer_status || null;
    item.rewardOfferAmount = row.reward_offer_amount == null ? null : Number(row.reward_offer_amount);
  } else if (mine && row.reward_status === "rewarded") {
    item.rewardStatus = "rewarded";
    item.rewardAmount = row.reward_amount == null ? null : Number(row.reward_amount);
    item.rewardedAt = row.rewarded_at || null;
  }
  return item;
}

export async function reviewsRoutes(app: FastifyInstance) {
  app.get("/reviews", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    const user = sessionUser(s);
    if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const q = (req.query ?? {}) as any;
    const limit = Math.min(Math.max(int(q.limit, 50), 1), 100);
    const admin = await isAdminSession(s);
    const items = listReviews({ limit, currentUserId: user.id, includeAll: admin }).map((r) => publicReview(r, user.id, admin));
    return reply.send({
      ok: true,
      items,
      isAdmin: admin,
      canCreateReview: !hasReviewByUserId(user.id),
    });
  });

  app.post("/reviews", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    const user = sessionUser(s);
    if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

    if (hasReviewByUserId(user.id)) {
      return reply.code(409).send({
        ok: false,
        error: "review_already_exists",
        message: "Вы уже оставили отзыв.",
      });
    }

    const body = (req.body ?? {}) as any;
    const reviewText = multiline(body.text, 1200);
    if (reviewText.length < 8) {
      return reply.code(400).send({ ok: false, error: "text_too_short", message: "Напишите чуть подробнее — отзыв совсем короткий." });
    }

    const rating = Math.min(Math.max(int(body.rating, 5), 1), 5);
    let rewardOfferStatus: "offered" | "none" = "none";
    let rewardOfferAmount: number | null = null;
    try {
      const billing = await shmShpunAppPromoOpportunities(String(s.shmSessionId || ""));
      const payload = billing.json?.data && typeof billing.json.data === "object"
        ? billing.json.data
        : billing.json;
      const offer = payload?.review_reward && typeof payload.review_reward === "object"
        ? payload.review_reward
        : null;
      if (!billing.ok || !(payload?.ok === 1 || payload?.ok === true) || !offer) {
        throw new Error("review_reward_status_unavailable");
      }
      const active = offer?.active === true || offer?.active === 1 || offer?.active === "1";
      const offerAmount = Math.round(Number(offer?.amount) * 100) / 100;
      if (active && (!Number.isFinite(offerAmount) || offerAmount < 1 || offerAmount > 500)) {
        throw new Error("review_reward_amount_invalid");
      }
      if (active) {
        rewardOfferStatus = "offered";
        rewardOfferAmount = offerAmount;
      }
    } catch {
      return reply.code(503).send({
        ok: false,
        error: "review_reward_status_unavailable",
        message: "Не удалось проверить условия бонуса. Повторите отправку через несколько секунд.",
      });
    }
    let created;
    try {
      created = createReview({
        userId: user.id,
        userLogin: user.login,
        displayName: user.displayName,
        authorVisibility: normalizeAuthorVisibility(body.authorVisibility),
        rating,
        text: reviewText,
        rewardOfferStatus,
        rewardOfferAmount,
      });
    } catch (error: any) {
      if (String(error?.message || "").includes("review_already_exists")) {
        return reply.code(409).send({
          ok: false,
          error: "review_already_exists",
          message: "Вы уже оставили отзыв.",
        });
      }
      throw error;
    }
    return reply.code(201).send({
      ok: true,
      item: publicReview({ ...created, comments: [] }, user.id, false),
      message: "Отзыв отправлен на проверку.",
    });
  });

  app.post("/reviews/:id/comments", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    const user = sessionUser(s);
    if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const reviewId = int((req.params as any)?.id, 0);
    const review = reviewId > 0 ? getReviewById(reviewId) : null;
    if (!review || review.status === "hidden") {
      return reply.code(404).send({ ok: false, error: "review_not_found" });
    }

    const body = (req.body ?? {}) as any;
    const commentText = multiline(body.text, 700);
    if (commentText.length < 2) {
      return reply.code(400).send({ ok: false, error: "text_too_short", message: "Комментарий получился слишком коротким." });
    }

    const created = createComment({
      reviewId,
      userId: user.id,
      userLogin: user.login,
      displayName: user.displayName,
      authorVisibility: normalizeAuthorVisibility(body.authorVisibility),
      text: commentText,
    });
    return reply.code(201).send({
      ok: true,
      item: publicReview({ ...review, comments: [created] }, user.id, false).comments[0],
      message: "Комментарий отправлен.",
    });
  });

  app.patch("/reviews/:id/status", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    const user = sessionUser(s);
    if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const admin = await isAdminSession(s);
    if (!admin) return reply.code(403).send({ ok: false, error: "forbidden" });

    const id = int((req.params as any)?.id, 0);
    const review = id > 0 ? getReviewById(id) : null;
    if (!review) return reply.code(404).send({ ok: false, error: "review_not_found" });

    const status = text((req.body as any)?.status, 20);
    if (!["pending", "published", "hidden"].includes(status)) {
      return reply.code(400).send({ ok: false, error: "bad_status" });
    }

    if (review.reward_status === "processing" && status !== review.status) {
      return reply.code(409).send({
        ok: false,
        error: "reward_in_progress",
        message: "Сначала дождитесь подтверждения начисления в биллинге.",
      });
    }

    setReviewStatus(id, status);
    return reply.send({ ok: true });
  });

  app.post("/reviews/:id/approve", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    const user = sessionUser(s);
    if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const admin = await isAdminSession(s);
    if (!admin) return reply.code(403).send({ ok: false, error: "forbidden" });

    const id = int((req.params as any)?.id, 0);
    let review = id > 0 ? getReviewById(id) : null;
    if (!review) return reply.code(404).send({ ok: false, error: "review_not_found" });
    const reviewUserId = Number(review.user_id);

    if (review.reward_status === "rewarded") {
      if (review.status !== "published") setReviewStatus(id, "published");
      review = getReviewById(id);
      const rewardAmount = Number(review?.reward_amount);
      if (review && Number.isFinite(rewardAmount) && rewardAmount > 0) {
        await notifyReviewReward({
          reviewId: id,
          userId: reviewUserId,
          amount: rewardAmount,
        });
      }
      return reply.send({
        ok: true,
        alreadyRewarded: true,
        item: publicReview({ ...review, comments: [] }, user.id, true),
        message: "Отзыв уже был оплачен и опубликован.",
      });
    }

    if (review.reward_offer_status === "none") {
      if (!publishReviewWithoutReward(id)) {
        return reply.code(409).send({ ok: false, error: "review_publish_not_available" });
      }
      review = getReviewById(id);
      return reply.send({
        ok: true,
        bonusAdded: 0,
        item: publicReview({ ...review, comments: [] }, user.id, true),
        message: "Отзыв опубликован без бонуса: при отправке акция не была активна.",
      });
    }

    if (!beginReviewReward(id)) {
      review = getReviewById(id);
      if (review?.reward_status !== "processing") {
        return reply.code(409).send({
          ok: false,
          error: "reward_not_available",
          message: "Этот отзыв уже опубликован или недоступен для начисления.",
        });
      }
    }

    const sid = String(s?.shmSessionId ?? "").trim();
    try {
      // Legacy pending reviews predate snapshots. Honour their existing promise
      // even when the campaign has since ended, using the configured reward amount.
      let promisedAmount = review.reward_offer_amount == null ? undefined : Number(review.reward_offer_amount);
      if (!review.reward_offer_status) {
        const status = await shmShpunAppPromoOpportunities(sid);
        const statusPayload = status.json?.data && typeof status.json.data === "object"
          ? status.json.data
          : status.json;
        const configuredAmount = Number(statusPayload?.review_reward?.amount);
        if (!status.ok || !Number.isFinite(configuredAmount) || configuredAmount < 1 || configuredAmount > 500) {
          return reply.code(502).send({ ok: false, error: "review_reward_status_unavailable" });
        }
        snapshotLegacyReviewReward(id, configuredAmount);
        review = getReviewById(id)!;
        promisedAmount = Number(review.reward_offer_amount);
      }
      const billing = await shmShpunAppAdminReviewReward(sid, {
        reviewId: id,
        userId: reviewUserId,
        amount: promisedAmount,
      });
      const payload = billing.json?.data && typeof billing.json.data === "object"
        ? billing.json.data
        : billing.json;
      const amount = Math.round(Number(payload?.amount) * 100) / 100;
      const logicalOk = payload?.ok === 1 || payload?.ok === true;
      const sameReview = Number(payload?.review_id) === id;
      const sameUser = Number(payload?.target_user_id) === reviewUserId;
      const validAmount = Number.isFinite(amount) && amount >= 1 && amount <= 500;
      const alreadyRewarded = payload?.already_rewarded === 1 || payload?.already_rewarded === true;
      const exactBonusAdded = Math.abs(Number(payload?.bonus_added) - amount) < 0.001;
      const promisedAmountMatches = promisedAmount == null || Math.abs(amount - promisedAmount) < 0.001;
      const rewarded = alreadyRewarded || (exactBonusAdded && promisedAmountMatches);

      if (!billing.ok || !logicalOk || !sameReview || !sameUser || !validAmount || !rewarded) {
        const code = text(payload?.error || `billing_${billing.status}`, 120) || "billing_error";
        if (code === "bonus_not_added") failReviewReward(id, code);
        return reply.code(502).send({
          ok: false,
          error: code,
          message: code === "reward_in_progress"
            ? "Биллинг ещё обрабатывает начисление. Проверьте его повторно через несколько секунд."
            : payload?.message || "Биллинг не подтвердил начисление. Отзыв не опубликован.",
        });
      }

      if (!completeReviewReward(id, amount)) {
        return reply.code(500).send({
          ok: false,
          error: "review_publish_not_saved",
          message: "Бонус подтверждён, но публикация не сохранена. Повторите проверку.",
        });
      }
      review = getReviewById(id);
      await notifyReviewReward({
        reviewId: id,
        userId: reviewUserId,
        amount,
      });
      return reply.send({
        ok: true,
        alreadyRewarded,
        bonusAdded: Number(payload?.bonus_added || 0),
        bonusAfter: Number(payload?.bonus_after || 0),
        item: publicReview({ ...review, comments: [] }, user.id, true),
        message: `Отзыв опубликован. Начислены бонусы: ${amount.toLocaleString("ru-RU")}.`,
      });
    } catch (error: any) {
      return reply.code(502).send({
        ok: false,
        error: "billing_request_failed",
        message: "Ответ биллинга не получен. Отзыв не опубликован; проверьте начисление повторно.",
      });
    }
  });

  app.patch("/reviews/comments/:id/status", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    const user = sessionUser(s);
    if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const admin = await isAdminSession(s);
    if (!admin) return reply.code(403).send({ ok: false, error: "forbidden" });

    const id = int((req.params as any)?.id, 0);
    const comment = id > 0 ? getCommentById(id) : null;
    if (!comment) return reply.code(404).send({ ok: false, error: "comment_not_found" });

    const status = text((req.body as any)?.status, 20);
    if (!["pending", "published", "hidden"].includes(status)) {
      return reply.code(400).send({ ok: false, error: "bad_status" });
    }

    setCommentStatus(id, status);
    return reply.send({ ok: true });
  });

  app.delete("/reviews/:id", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    const user = sessionUser(s);
    if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const id = int((req.params as any)?.id, 0);
    const review = id > 0 ? getReviewById(id) : null;
    if (!review) return reply.code(404).send({ ok: false, error: "review_not_found" });

    const admin = await isAdminSession(s);
    if (!admin && Number(review.user_id) !== user.id) {
      return reply.code(403).send({ ok: false, error: "forbidden" });
    }
    hideReview(id);
    return reply.send({ ok: true });
  });

  app.delete("/reviews/comments/:id", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    const user = sessionUser(s);
    if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const id = int((req.params as any)?.id, 0);
    const comment = id > 0 ? getCommentById(id) : null;
    if (!comment) return reply.code(404).send({ ok: false, error: "comment_not_found" });

    const admin = await isAdminSession(s);
    if (!admin && Number(comment.user_id) !== user.id) {
      return reply.code(403).send({ ok: false, error: "forbidden" });
    }
    hideComment(id);
    return reply.send({ ok: true });
  });
}
