import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { shmShpunAppAdminStatus } from "../../shared/shm/shmClient.js";
import {
  createComment,
  createReview,
  getCommentById,
  getReviewById,
  hideComment,
  hideReview,
  listReviews,
  setCommentStatus,
  setReviewStatus,
} from "./repo.js";

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

function sessionUser(s: any) {
  const id = Number(s?.shmUserId ?? s?.userId ?? 0);
  if (!Number.isFinite(id) || id <= 0) return null;
  const login = text(s?.login, 120);
  const displayName = login ? login.replace(/^@/, "") : `Пользователь #${id}`;
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

function publicReview(row: any, currentUserId: number, isAdmin: boolean) {
  return {
    id: row.id,
    rating: row.rating,
    text: row.text,
    author: row.display_name || row.user_login || `Пользователь #${row.user_id}`,
    userId: row.user_id,
    status: row.status,
    mine: Number(row.user_id) === currentUserId,
    canModerate: isAdmin || Number(row.user_id) === currentUserId,
    canApprove: isAdmin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    comments: (row.comments ?? []).map((c: any) => ({
      id: c.id,
      reviewId: c.review_id,
      text: c.text,
      author: c.display_name || c.user_login || `Пользователь #${c.user_id}`,
      userId: c.user_id,
      status: c.status,
      mine: Number(c.user_id) === currentUserId,
      canModerate: isAdmin || Number(c.user_id) === currentUserId,
      canApprove: isAdmin,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })),
  };
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
    return reply.send({ ok: true, items, isAdmin: admin });
  });

  app.post("/reviews", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    const user = sessionUser(s);
    if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const body = (req.body ?? {}) as any;
    const reviewText = multiline(body.text, 1200);
    if (reviewText.length < 8) {
      return reply.code(400).send({ ok: false, error: "text_too_short", message: "Напишите чуть подробнее — отзыв совсем короткий." });
    }

    const rating = Math.min(Math.max(int(body.rating, 5), 1), 5);
    const created = createReview({
      userId: user.id,
      userLogin: user.login,
      displayName: user.displayName,
      rating,
      text: reviewText,
    });
    return reply.code(201).send({
      ok: true,
      item: publicReview({ ...created, comments: [] }, user.id, false),
      message: "Отзыв отправлен. После короткой проверки появится в общем списке.",
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

    setReviewStatus(id, status);
    return reply.send({ ok: true });
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
