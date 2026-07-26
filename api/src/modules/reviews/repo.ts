import { linkDb } from "../../shared/linkdb/db.js";

export type ReviewRow = {
  id: number;
  user_id: number;
  user_login: string;
  display_name: string;
  author_visibility?: string;
  rating: number;
  text: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ReviewCommentRow = {
  id: number;
  review_id: number;
  user_id: number;
  user_login: string;
  display_name: string;
  author_visibility?: string;
  text: string;
  status: string;
  created_at: string;
  updated_at: string;
};

linkDb.exec(`
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  user_login TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  author_visibility TEXT NOT NULL DEFAULT 'masked',
  rating INTEGER NOT NULL DEFAULT 5,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_status_created
  ON reviews(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_user
  ON reviews(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS review_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  user_login TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  author_visibility TEXT NOT NULL DEFAULT 'masked',
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(review_id) REFERENCES reviews(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_review_comments_review
  ON review_comments(review_id, status, created_at ASC);
`);

try {
  linkDb.exec(`ALTER TABLE reviews ADD COLUMN author_visibility TEXT NOT NULL DEFAULT 'masked';`);
} catch {}

try {
  linkDb.exec(`ALTER TABLE review_comments ADD COLUMN author_visibility TEXT NOT NULL DEFAULT 'masked';`);
} catch {}

function toInt(v: unknown, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

export function listReviews(options: { limit?: number; currentUserId?: number; includeAll?: boolean } = {}) {
  const limit = options.limit ?? 50;
  const currentUserId = Number(options.currentUserId ?? 0);
  const includeAll = Boolean(options.includeAll);
  const safeLimit = Math.min(Math.max(toInt(limit, 50), 1), 100);
  const reviewsSql = includeAll
    ? `
    SELECT id, user_id, user_login, display_name, author_visibility, rating, text, status, created_at, updated_at
    FROM reviews
    ORDER BY
      CASE status WHEN 'pending' THEN 0 WHEN 'published' THEN 1 ELSE 2 END,
      datetime(created_at) DESC,
      id DESC
    LIMIT ?
  `
    : currentUserId > 0
      ? `
    SELECT id, user_id, user_login, display_name, author_visibility, rating, text, status, created_at, updated_at
    FROM reviews
    WHERE status = 'published' OR (user_id = ? AND status <> 'hidden')
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `
      : `
    SELECT id, user_id, user_login, display_name, author_visibility, rating, text, status, created_at, updated_at
    FROM reviews
    WHERE status = 'published'
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `;

  const reviews = (includeAll || currentUserId <= 0
    ? linkDb.prepare(reviewsSql).all(safeLimit)
    : linkDb.prepare(reviewsSql).all(currentUserId, safeLimit)) as ReviewRow[];

  if (reviews.length === 0) return [];

  const ids = reviews.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const commentsSql = includeAll
    ? `
    SELECT id, review_id, user_id, user_login, display_name, author_visibility, text, status, created_at, updated_at
    FROM review_comments
    WHERE review_id IN (${placeholders})
    ORDER BY datetime(created_at) ASC, id ASC
  `
    : currentUserId > 0
      ? `
    SELECT id, review_id, user_id, user_login, display_name, author_visibility, text, status, created_at, updated_at
    FROM review_comments
    WHERE review_id IN (${placeholders}) AND (status = 'published' OR (user_id = ? AND status <> 'hidden'))
    ORDER BY datetime(created_at) ASC, id ASC
  `
      : `
    SELECT id, review_id, user_id, user_login, display_name, author_visibility, text, status, created_at, updated_at
    FROM review_comments
    WHERE status = 'published' AND review_id IN (${placeholders})
    ORDER BY datetime(created_at) ASC, id ASC
  `;
  const comments = (includeAll || currentUserId <= 0
    ? linkDb.prepare(commentsSql).all(...ids)
    : linkDb.prepare(commentsSql).all(...ids, currentUserId)) as ReviewCommentRow[];

  const byReview = new Map<number, ReviewCommentRow[]>();
  for (const c of comments) {
    const arr = byReview.get(c.review_id) ?? [];
    arr.push(c);
    byReview.set(c.review_id, arr);
  }

  return reviews.map((r) => ({ ...r, comments: byReview.get(r.id) ?? [] }));
}

export function getReviewById(id: number) {
  return linkDb.prepare(`
    SELECT id, user_id, user_login, display_name, author_visibility, rating, text, status, created_at, updated_at
    FROM reviews
    WHERE id = ?
  `).get(id) as ReviewRow | undefined;
}

export function createReview(input: {
  userId: number;
  userLogin: string;
  displayName: string;
  authorVisibility?: string;
  rating: number;
  text: string;
  status?: string;
}) {
  const rating = Math.min(Math.max(toInt(input.rating, 5), 1), 5);
  const status = normalizeStatus(input.status, "pending");
  const authorVisibility = normalizeAuthorVisibility(input.authorVisibility);
  const info = linkDb.prepare(`
    INSERT INTO reviews (user_id, user_login, display_name, author_visibility, rating, text, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(input.userId, input.userLogin, input.displayName, authorVisibility, rating, input.text, status);
  return getReviewById(Number(info.lastInsertRowid));
}

export function createComment(input: {
  reviewId: number;
  userId: number;
  userLogin: string;
  displayName: string;
  authorVisibility?: string;
  text: string;
  status?: string;
}) {
  const status = normalizeStatus(input.status, "pending");
  const authorVisibility = normalizeAuthorVisibility(input.authorVisibility);
  const info = linkDb.prepare(`
    INSERT INTO review_comments (review_id, user_id, user_login, display_name, author_visibility, text, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(input.reviewId, input.userId, input.userLogin, input.displayName, authorVisibility, input.text, status);
  return linkDb.prepare(`
    SELECT id, review_id, user_id, user_login, display_name, author_visibility, text, status, created_at, updated_at
    FROM review_comments
    WHERE id = ?
  `).get(Number(info.lastInsertRowid)) as ReviewCommentRow | undefined;
}

export function hideReview(id: number) {
  return setReviewStatus(id, "hidden");
}

export function hideComment(id: number) {
  return setCommentStatus(id, "hidden");
}

export function getCommentById(id: number) {
  return linkDb.prepare(`
    SELECT id, review_id, user_id, user_login, display_name, author_visibility, text, status, created_at, updated_at
    FROM review_comments
    WHERE id = ?
  `).get(id) as ReviewCommentRow | undefined;
}

function normalizeStatus(v: unknown, fallback: "pending" | "published" | "hidden") {
  const s = String(v ?? "").trim();
  return s === "pending" || s === "published" || s === "hidden" ? s : fallback;
}

function normalizeAuthorVisibility(v: unknown) {
  const s = String(v ?? "").trim();
  return s === "public" || s === "hidden" || s === "masked" ? s : "masked";
}

export function setReviewStatus(id: number, status: unknown) {
  const next = normalizeStatus(status, "pending");
  return linkDb.prepare(`
    UPDATE reviews
    SET status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(next, id).changes > 0;
}

export function setCommentStatus(id: number, status: unknown) {
  const next = normalizeStatus(status, "pending");
  return linkDb.prepare(`
    UPDATE review_comments
    SET status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(next, id).changes > 0;
}
