// api/src/modules/help/helpStore.ts
//
// Help Center / knowledge base storage layer.
//
// Reuses the support attachment storage abstraction (LocalAttachmentStorage):
// binaries live under a separate namespace (DATA_DIR/uploads/help) and original
// filenames are never used as filesystem paths.
//
// Schema is additive (CREATE TABLE IF NOT EXISTS) so existing DBs migrate
// without data loss and a fresh DB boots with the same structure.

import { linkDb } from "../../shared/linkdb/db.js";
import { LocalAttachmentStorage, type AttachmentStorage } from "../support/attachmentStorage.js";
import path from "node:path";

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type HelpCategory = {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type HelpArticleStatus = "draft" | "published" | "hidden";

export type HelpArticle = {
  id: number;
  slug: string;
  title: string;
  summary: string;
  categoryId: number | null;
  status: HelpArticleStatus;
  sortOrder: number;
  isFeatured: boolean;
  searchKeywords: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type HelpBlockType =
  | "paragraph"
  | "heading"
  | "bullet_list"
  | "numbered_list"
  | "steps"
  | "callout"
  | "image"
  | "video"
  | "button"
  | "faq"
  | "divider";

export const HELP_BLOCK_TYPES: readonly HelpBlockType[] = [
  "paragraph",
  "heading",
  "bullet_list",
  "numbered_list",
  "steps",
  "callout",
  "image",
  "video",
  "button",
  "faq",
  "divider",
] as const;

export type HelpBlock = {
  id: number;
  articleId: number;
  type: HelpBlockType;
  sortOrder: number;
  payload: Record<string, unknown>;
};

export type HelpMediaKind = "image" | "video" | "file";

export type HelpMedia = {
  id: number;
  kind: HelpMediaKind;
  originalName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  createdAt: string;
  uploadedBy: number | null;
};

/* ─── Schema ─────────────────────────────────────────────────────────────── */

linkDb.exec(`
CREATE TABLE IF NOT EXISTS help_categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL COLLATE NOCASE UNIQUE,
  title         TEXT NOT NULL,
  description   TEXT,
  icon          TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS help_articles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL COLLATE NOCASE UNIQUE,
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL DEFAULT '',
  category_id     INTEGER,
  status          TEXT NOT NULL DEFAULT 'draft',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_featured     INTEGER NOT NULL DEFAULT 0,
  search_keywords TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  published_at    TEXT
);

CREATE TABLE IF NOT EXISTS help_article_blocks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id   INTEGER NOT NULL,
  type         TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS help_media (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  storage_path  TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  width         INTEGER,
  height        INTEGER,
  duration      INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  uploaded_by   INTEGER
);

CREATE TABLE IF NOT EXISTS help_article_views (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  viewed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  user_id    INTEGER
);

CREATE TABLE IF NOT EXISTS help_article_placements (
  placement_key TEXT PRIMARY KEY,
  article_id    INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_help_placements_article ON help_article_placements(article_id);

CREATE INDEX IF NOT EXISTS idx_help_articles_category ON help_articles(category_id, status);
CREATE INDEX IF NOT EXISTS idx_help_articles_status ON help_articles(status, sort_order);
CREATE INDEX IF NOT EXISTS idx_help_blocks_article ON help_article_blocks(article_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_help_media_created ON help_media(created_at);
`);

/* ─── Mapping helpers ────────────────────────────────────────────────────── */

function mapCategory(row: any): HelpCategory {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: row.description == null ? null : String(row.description),
    icon: row.icon == null ? null : String(row.icon),
    sortOrder: Number(row.sort_order ?? 0),
    isActive: Number(row.is_active ?? 1) === 1,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function normalizeStatus(value: unknown): HelpArticleStatus {
  const s = String(value ?? "").trim().toLowerCase();
  return s === "published" || s === "hidden" ? s : "draft";
}

function mapArticle(row: any): HelpArticle {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    summary: String(row.summary ?? ""),
    categoryId: row.category_id == null ? null : Number(row.category_id),
    status: normalizeStatus(row.status),
    sortOrder: Number(row.sort_order ?? 0),
    isFeatured: Number(row.is_featured ?? 0) === 1,
    searchKeywords: row.search_keywords == null ? null : String(row.search_keywords),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    publishedAt: row.published_at == null ? null : String(row.published_at),
  };
}

function safePayload(raw: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(raw ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function mapBlock(row: any): HelpBlock {
  return {
    id: Number(row.id),
    articleId: Number(row.article_id),
    type: String(row.type) as HelpBlockType,
    sortOrder: Number(row.sort_order ?? 0),
    payload: safePayload(row.payload_json),
  };
}

function mapMedia(row: any): HelpMedia {
  return {
    id: Number(row.id),
    kind: String(row.kind) as HelpMediaKind,
    originalName: String(row.original_name ?? ""),
    storagePath: String(row.storage_path),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes ?? 0),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    duration: row.duration == null ? null : Number(row.duration),
    createdAt: String(row.created_at ?? ""),
    uploadedBy: row.uploaded_by == null ? null : Number(row.uploaded_by),
  };
}

/* ─── Slug ───────────────────────────────────────────────────────────────── */

export function slugify(input: unknown): string {
  const raw = String(input ?? "").trim().toLowerCase();
  const translit: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
    э: "e", ю: "yu", я: "ya",
  };
  const mapped = raw.replace(/[а-яё]/g, (ch) => translit[ch] ?? "");
  const slug = mapped.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return slug;
}

function uniqueSlug(table: "help_categories" | "help_articles", base: string, excludeId?: number): string {
  const seed = base || "item";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? seed : `${seed}-${i + 1}`;
    const row = excludeId
      ? linkDb.prepare(`SELECT id FROM ${table} WHERE slug = ? COLLATE NOCASE AND id != ?`).get(candidate, excludeId)
      : linkDb.prepare(`SELECT id FROM ${table} WHERE slug = ? COLLATE NOCASE`).get(candidate);
    if (!row) return candidate;
  }
  return `${seed}-${Date.now().toString(36)}`;
}

export function isValidSlug(value: unknown): boolean {
  return /^[a-z0-9][a-z0-9-]{1,80}$/.test(String(value ?? "").trim());
}

/* ─── Categories ─────────────────────────────────────────────────────────── */

export function listCategories(includeInactive = true): HelpCategory[] {
  const rows = (includeInactive
    ? linkDb.prepare(`SELECT * FROM help_categories ORDER BY sort_order ASC, title ASC`).all()
    : linkDb.prepare(`SELECT * FROM help_categories WHERE is_active = 1 ORDER BY sort_order ASC, title ASC`).all()) as any[];
  return rows.map(mapCategory);
}

export function getCategory(id: unknown): HelpCategory | null {
  const n = Math.trunc(Number(id));
  if (!Number.isFinite(n) || n <= 0) return null;
  const row = linkDb.prepare(`SELECT * FROM help_categories WHERE id = ?`).get(n);
  return row ? mapCategory(row) : null;
}

export function getCategoryBySlug(slug: unknown): HelpCategory | null {
  const s = String(slug ?? "").trim();
  if (!s) return null;
  const row = linkDb.prepare(`SELECT * FROM help_categories WHERE slug = ? COLLATE NOCASE`).get(s);
  return row ? mapCategory(row) : null;
}

export function saveCategory(input: {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  description?: unknown;
  icon?: unknown;
  sortOrder?: unknown;
  isActive?: unknown;
}): HelpCategory {
  const id = Math.trunc(Number(input.id ?? 0));
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("title_required");
  const description = String(input.description ?? "").trim() || null;
  const icon = String(input.icon ?? "").trim() || null;
  const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : 0;
  const isActive = input.isActive === false || input.isActive === 0 ? 0 : 1;

  if (id > 0) {
    const existing = getCategory(id);
    if (!existing) throw new Error("category_not_found");
    const slug = input.slug == null || String(input.slug).trim() === ""
      ? existing.slug
      : (isValidSlug(input.slug) ? String(input.slug).trim() : uniqueSlug("help_categories", slugify(input.slug), id));
    linkDb.prepare(`
      UPDATE help_categories SET slug = ?, title = ?, description = ?, icon = ?, sort_order = ?, is_active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(slug, title, description, icon, sortOrder, isActive, id);
    return getCategory(id) as HelpCategory;
  }

  const slug = input.slug != null && isValidSlug(input.slug)
    ? String(input.slug).trim()
    : uniqueSlug("help_categories", slugify(input.slug ?? title));
  const nextSort = sortOrder || (linkDb.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM help_categories`).get() as any)?.m + 1 || 1;
  const info = linkDb.prepare(`
    INSERT INTO help_categories (slug, title, description, icon, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(slug, title, description, icon, nextSort, isActive);
  return getCategory(Number(info.lastInsertRowid)) as HelpCategory;
}

export function deleteCategory(id: unknown): boolean {
  const n = Math.trunc(Number(id));
  if (!Number.isFinite(n) || n <= 0) return false;
  return linkDb.transaction(() => {
    linkDb.prepare(`UPDATE help_articles SET category_id = NULL, updated_at = datetime('now') WHERE category_id = ?`).run(n);
    return linkDb.prepare(`DELETE FROM help_categories WHERE id = ?`).run(n).changes > 0;
  })();
}

export function reorderCategories(ids: unknown): void {
  const list = Array.isArray(ids) ? ids : [];
  linkDb.transaction(() => {
    list.forEach((id, index) => {
      const n = Math.trunc(Number(id));
      if (Number.isFinite(n) && n > 0) {
        linkDb.prepare(`UPDATE help_categories SET sort_order = ?, updated_at = datetime('now') WHERE id = ?`).run(index + 1, n);
      }
    });
  })();
}

/* ─── Articles ───────────────────────────────────────────────────────────── */

export type ArticleListRow = HelpArticle & { categoryTitle: string | null; categorySlug: string | null };

export function listArticles(opts?: {
  status?: HelpArticleStatus | "all";
  categoryId?: number | null;
  q?: string;
  publishedOnly?: boolean;
}): ArticleListRow[] {
  const where: string[] = [];
  const params: any[] = [];
  if (opts?.publishedOnly) {
    where.push(`a.status = 'published'`);
  } else if (opts?.status && opts.status !== "all") {
    where.push(`a.status = ?`);
    params.push(opts.status);
  }
  if (opts?.categoryId) {
    where.push(`a.category_id = ?`);
    params.push(Math.trunc(opts.categoryId));
  }
  const q = String(opts?.q ?? "").trim();
  if (q) {
    where.push(`(a.title LIKE ? OR a.summary LIKE ? OR a.search_keywords LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const sql = `
    SELECT a.*, c.title AS category_title, c.slug AS category_slug
    FROM help_articles a
    LEFT JOIN help_categories c ON c.id = a.category_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY a.is_featured DESC, a.sort_order ASC, datetime(a.updated_at) DESC
  `;
  return (linkDb.prepare(sql).all(...params) as any[]).map((row) => ({
    ...mapArticle(row),
    categoryTitle: row.category_title == null ? null : String(row.category_title),
    categorySlug: row.category_slug == null ? null : String(row.category_slug),
  }));
}

export function getArticleById(id: unknown): HelpArticle | null {
  const n = Math.trunc(Number(id));
  if (!Number.isFinite(n) || n <= 0) return null;
  const row = linkDb.prepare(`SELECT * FROM help_articles WHERE id = ?`).get(n);
  return row ? mapArticle(row) : null;
}

export function getArticleBySlug(slug: unknown): HelpArticle | null {
  const s = String(slug ?? "").trim();
  if (!s) return null;
  const row = linkDb.prepare(`SELECT * FROM help_articles WHERE slug = ? COLLATE NOCASE`).get(s);
  return row ? mapArticle(row) : null;
}

export function listBlocks(articleId: unknown): HelpBlock[] {
  const n = Math.trunc(Number(articleId));
  if (!Number.isFinite(n) || n <= 0) return [];
  const rows = linkDb.prepare(`SELECT * FROM help_article_blocks WHERE article_id = ? ORDER BY sort_order ASC, id ASC`).all(n) as any[];
  return rows.map(mapBlock);
}

export type SaveBlockInput = { type: HelpBlockType; payload?: Record<string, unknown> };

function sanitizeBlocks(input: unknown): SaveBlockInput[] {
  const list = Array.isArray(input) ? input : [];
  const out: SaveBlockInput[] = [];
  for (const raw of list) {
    const block = (raw ?? {}) as any;
    const type = String(block.type ?? "").trim() as HelpBlockType;
    if (!HELP_BLOCK_TYPES.includes(type)) continue;
    const payload = block.payload && typeof block.payload === "object" && !Array.isArray(block.payload)
      ? (block.payload as Record<string, unknown>)
      : {};
    out.push({ type, payload });
  }
  return out;
}

export type SaveArticleInput = {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  summary?: unknown;
  categoryId?: unknown;
  status?: unknown;
  sortOrder?: unknown;
  isFeatured?: unknown;
  searchKeywords?: unknown;
  blocks?: unknown;
  placements?: unknown;
};

/**
 * Create or update an article and replace its blocks atomically. Never leaves a
 * partially saved article: the whole operation runs in one SQLite transaction.
 */
export function saveArticle(input: SaveArticleInput): { article: HelpArticle; blocks: HelpBlock[] } {
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("title_required");
  const summary = String(input.summary ?? "").trim();
  const categoryIdRaw = input.categoryId;
  const categoryId = categoryIdRaw == null || categoryIdRaw === "" ? null : Math.trunc(Number(categoryIdRaw));
  if (categoryId != null && (!Number.isFinite(Number(categoryId)) || categoryId <= 0)) throw new Error("invalid_category");
  const status = normalizeStatus(input.status);
  const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : 0;
  const isFeatured = input.isFeatured === true || input.isFeatured === 1 ? 1 : 0;
  const searchKeywords = String(input.searchKeywords ?? "").trim() || null;
  const blocks = sanitizeBlocks(input.blocks);

  const id = Math.trunc(Number(input.id ?? 0));
  return linkDb.transaction(() => {
    let articleId = id;
    if (id > 0) {
      const existing = getArticleById(id);
      if (!existing) throw new Error("article_not_found");
      const requestedSlug = String(input.slug ?? "").trim();
      const slug = requestedSlug && isValidSlug(requestedSlug) ? requestedSlug : existing.slug;
      const finalSlug = slug === existing.slug ? slug : uniqueSlug("help_articles", slug, id);
      const publishedAt = status === "published" ? (existing.publishedAt ?? existing.updatedAt) : existing.publishedAt;
      linkDb.prepare(`
        UPDATE help_articles
        SET slug = ?, title = ?, summary = ?, category_id = ?, status = ?, sort_order = ?, is_featured = ?,
            search_keywords = ?, published_at = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(finalSlug, title, summary, categoryId, status, sortOrder, isFeatured, searchKeywords, publishedAt, id);
    } else {
      const requestedSlug = String(input.slug ?? "").trim();
      const slug = requestedSlug && isValidSlug(requestedSlug)
        ? uniqueSlug("help_articles", requestedSlug)
        : uniqueSlug("help_articles", slugify(requestedSlug || title));
      const publishedAt = status === "published" ? new Date().toISOString().slice(0, 19).replace("T", " ") : null;
      const info = linkDb.prepare(`
        INSERT INTO help_articles (slug, title, summary, category_id, status, sort_order, is_featured, search_keywords, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(slug, title, summary, categoryId, status, sortOrder, isFeatured, searchKeywords, publishedAt);
      articleId = Number(info.lastInsertRowid);
    }

    linkDb.prepare(`DELETE FROM help_article_blocks WHERE article_id = ?`).run(articleId);
    const insert = linkDb.prepare(`
      INSERT INTO help_article_blocks (article_id, type, sort_order, payload_json)
      VALUES (?, ?, ?, ?)
    `);
    blocks.forEach((block, index) => {
      insert.run(articleId, block.type, index + 1, JSON.stringify(block.payload ?? {}));
    });

    // Only touch placements when the caller explicitly sends the set; status
    // toggles from the list must not silently drop a placement.
    if (input.placements !== undefined) syncArticlePlacements(articleId, input.placements);

    return { article: getArticleById(articleId) as HelpArticle, blocks: listBlocks(articleId) };
  })();
}

export function deleteArticle(id: unknown): boolean {
  const n = Math.trunc(Number(id));
  if (!Number.isFinite(n) || n <= 0) return false;
  return linkDb.transaction(() => {
    linkDb.prepare(`DELETE FROM help_article_blocks WHERE article_id = ?`).run(n);
    linkDb.prepare(`DELETE FROM help_article_views WHERE article_id = ?`).run(n);
    linkDb.prepare(`DELETE FROM help_article_placements WHERE article_id = ?`).run(n);
    return linkDb.prepare(`DELETE FROM help_articles WHERE id = ?`).run(n).changes > 0;
  })();
}

export function recordArticleView(articleId: number, userId: number | null): void {
  try {
    linkDb.prepare(`INSERT INTO help_article_views (article_id, user_id) VALUES (?, ?)`).run(Math.trunc(articleId), userId ?? null);
  } catch {
    // telemetry is best-effort
  }
}

/* ─── Search ─────────────────────────────────────────────────────────────── */

export function searchPublishedArticles(q: string): ArticleListRow[] {
  const needle = String(q ?? "").trim();
  if (!needle) return [];
  const like = `%${needle}%`;
  // v1: LIKE across structured fields + plain-text parts of blocks. The API
  // shape is stable, so this can be swapped for FTS later without UI changes.
  const sql = `
    SELECT DISTINCT a.*, c.title AS category_title, c.slug AS category_slug
    FROM help_articles a
    LEFT JOIN help_categories c ON c.id = a.category_id
    LEFT JOIN help_article_blocks b ON b.article_id = a.id
    WHERE a.status = 'published' AND (
      a.title LIKE ? OR a.summary LIKE ? OR a.search_keywords LIKE ? OR b.payload_json LIKE ?
    )
    ORDER BY a.is_featured DESC, datetime(a.updated_at) DESC
    LIMIT 50
  `;
  return (linkDb.prepare(sql).all(like, like, like, like) as any[]).map((row) => ({
    ...mapArticle(row),
    categoryTitle: row.category_title == null ? null : String(row.category_title),
    categorySlug: row.category_slug == null ? null : String(row.category_slug),
  }));
}

/* ─── Media storage ──────────────────────────────────────────────────────── */

export const HELP_IMAGE_MAX_MB = 10;
export const HELP_VIDEO_MAX_MB = 100;

function envInt(name: string, def: number): number {
  const n = Number(String(process.env[name] ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : def;
}

export function helpImageMaxBytes(): number {
  return envInt("HELP_MEDIA_IMAGE_MAX_MB", HELP_IMAGE_MAX_MB) * 1024 * 1024;
}
export function helpVideoMaxBytes(): number {
  return envInt("HELP_MEDIA_VIDEO_MAX_MB", HELP_VIDEO_MAX_MB) * 1024 * 1024;
}
export function helpMediaMaxBytes(): number {
  return Math.max(helpImageMaxBytes(), helpVideoMaxBytes());
}

export function helpMediaRoot(): string {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  return process.env.HELP_MEDIA_DIR || path.join(dataDir, "uploads", "help");
}

const helpStorage: AttachmentStorage = new LocalAttachmentStorage(helpMediaRoot());
export function getHelpStorage(): AttachmentStorage {
  return helpStorage;
}

export type DetectedHelpMime = { kind: HelpMediaKind; mime: string; ext: string };

function startsWith(buf: Buffer, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[offset + i] !== sig[i]) return false;
  return true;
}

/** MIME sniffing for help media. Never trusts filename or browser content-type. */
export function detectHelpMime(buf: Buffer): DetectedHelpMime | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { kind: "image", mime: "image/jpeg", ext: "jpg" };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "image", mime: "image/png", ext: "png" };
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return { kind: "image", mime: "image/webp", ext: "webp" };
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(buf, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) {
    return { kind: "image", mime: "image/gif", ext: "gif" };
  }
  // ISO-BMFF video (mp4/m4v/mov): ....ftyp
  if (startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4)) return { kind: "video", mime: "video/mp4", ext: "mp4" };
  // Matroska / WebM: EBML header
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: "video", mime: "video/webm", ext: "webm" };
  return null;
}

export function sanitizeMediaName(name: unknown): string {
  const raw = String(name ?? "").replace(/\\/g, "/");
  const base = raw.split("/").pop() || "file";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200) || "file";
}

export function getMedia(id: unknown): HelpMedia | null {
  const n = Math.trunc(Number(id));
  if (!Number.isFinite(n) || n <= 0) return null;
  const row = linkDb.prepare(`SELECT * FROM help_media WHERE id = ?`).get(n);
  return row ? mapMedia(row) : null;
}

export function listMedia(): Array<HelpMedia & { usedBy: number }> {
  const rows = linkDb.prepare(`SELECT * FROM help_media ORDER BY datetime(created_at) DESC, id DESC`).all() as any[];
  return rows.map((row) => ({ ...mapMedia(row), usedBy: countMediaReferences(Number(row.id)) }));
}

export function countMediaReferences(mediaId: number): number {
  const id = Math.trunc(Number(mediaId));
  if (!Number.isFinite(id) || id <= 0) return 0;
  const row = linkDb.prepare(`
    SELECT COUNT(*) AS n FROM help_article_blocks
    WHERE type IN ('image','video') AND payload_json LIKE ?
  `).get(`%"mediaId":${id}%`) as any;
  return Number(row?.n ?? 0) || 0;
}

export type SaveMediaInput = {
  kind: HelpMediaKind;
  originalName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  uploadedBy?: number | null;
};

export function createMedia(input: SaveMediaInput): HelpMedia {
  const info = linkDb.prepare(`
    INSERT INTO help_media (kind, original_name, storage_path, mime_type, size_bytes, width, height, duration, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.kind,
    sanitizeMediaName(input.originalName),
    input.storagePath,
    input.mimeType,
    Math.trunc(input.sizeBytes),
    input.width ?? null,
    input.height ?? null,
    input.duration ?? null,
    input.uploadedBy ?? null,
  );
  return getMedia(Number(info.lastInsertRowid)) as HelpMedia;
}

export function deleteMedia(id: unknown): "deleted" | "not_found" | "in_use" {
  const media = getMedia(id);
  if (!media) return "not_found";
  if (countMediaReferences(media.id) > 0) return "in_use";
  linkDb.prepare(`DELETE FROM help_media WHERE id = ?`).run(media.id);
  getHelpStorage().remove(media.storagePath);
  return "deleted";
}

/* ─── Placements ─────────────────────────────────────────────────────────── */

/**
 * Registry of known placement keys. The client can never invent a key: only
 * these are accepted, and each has a human-readable i18n label for Admin.
 */
export type HelpPlacementDef = { key: string; titleKey: string };
export const HELP_PLACEMENTS: readonly HelpPlacementDef[] = [
  { key: "connect_ios_happ_install", titleKey: "admin.help.placement.connect_ios_happ_install" },
];

export function isValidPlacementKey(value: unknown): boolean {
  const key = String(value ?? "");
  return HELP_PLACEMENTS.some((p) => p.key === key);
}

export type HelpPlacementRow = HelpPlacementDef & {
  articleId: number | null;
  articleTitle: string | null;
  articleStatus: HelpArticleStatus | null;
};

/** Registry + current holder, for Admin (never exposes extra article data). */
export function listPlacements(): HelpPlacementRow[] {
  const rows = linkDb.prepare(`
    SELECT p.placement_key, p.article_id, a.title, a.status
    FROM help_article_placements p
    LEFT JOIN help_articles a ON a.id = p.article_id
  `).all() as any[];
  const byKey = new Map(rows.map((r) => [String(r.placement_key), r]));
  return HELP_PLACEMENTS.map((def) => {
    const row = byKey.get(def.key);
    return {
      ...def,
      articleId: row ? Number(row.article_id) : null,
      articleTitle: row?.title == null ? null : String(row.title),
      articleStatus: row?.status == null ? null : normalizeStatus(row.status),
    };
  });
}

/** Published article for a placement, or null (draft/hidden/deleted all -> null). */
export function getPlacementArticle(placementKey: unknown): HelpArticle | null {
  if (!isValidPlacementKey(placementKey)) return null;
  const row = linkDb.prepare(`
    SELECT a.* FROM help_article_placements p
    JOIN help_articles a ON a.id = p.article_id
    WHERE p.placement_key = ?
  `).get(String(placementKey));
  if (!row) return null;
  const article = mapArticle(row);
  return article.status === "published" ? article : null;
}

/** Placement keys currently assigned to a specific article. */
export function placementsForArticle(articleId: unknown): string[] {
  const n = Math.trunc(Number(articleId));
  if (!Number.isFinite(n) || n <= 0) return [];
  const rows = linkDb.prepare(`SELECT placement_key FROM help_article_placements WHERE article_id = ?`).all(n) as any[];
  return rows.map((r) => String(r.placement_key)).filter(isValidPlacementKey);
}

/**
 * Replace the placement set of one article atomically. Assigning a placement
 * that another article holds moves it (single row per placement_key).
 */
function syncArticlePlacements(articleId: number, keys: unknown): void {
  const wanted = new Set((Array.isArray(keys) ? keys : []).map((k) => String(k)).filter(isValidPlacementKey));
  linkDb.prepare(`DELETE FROM help_article_placements WHERE article_id = ?`).run(articleId);
  const upsert = linkDb.prepare(`
    INSERT INTO help_article_placements (placement_key, article_id)
    VALUES (?, ?)
    ON CONFLICT(placement_key) DO UPDATE SET article_id = excluded.article_id, updated_at = datetime('now')
  `);
  for (const key of wanted) upsert.run(key, articleId);
}

export function setPlacement(placementKey: unknown, articleId: unknown): boolean {
  if (!isValidPlacementKey(placementKey)) return false;
  const id = Math.trunc(Number(articleId));
  if (!Number.isFinite(id) || id <= 0 || !getArticleById(id)) return false;
  linkDb.prepare(`
    INSERT INTO help_article_placements (placement_key, article_id)
    VALUES (?, ?)
    ON CONFLICT(placement_key) DO UPDATE SET article_id = excluded.article_id, updated_at = datetime('now')
  `).run(String(placementKey), id);
  return true;
}

export function clearPlacement(placementKey: unknown): void {
  if (!isValidPlacementKey(placementKey)) return;
  linkDb.prepare(`DELETE FROM help_article_placements WHERE placement_key = ?`).run(String(placementKey));
}

/* ─── Seed (idempotent) ──────────────────────────────────────────────────── */

export function seedHelp(): void {
  // INSERT-ONLY seed. The guard checks by slug so an existing canonical record
  // is never touched again — admin edits survive every process restart.
  // (Never upsert: that would roll back renamed titles, reordered categories,
  // changed descriptions/icons and admin-edited article blocks.)
  const existing = listCategories(true);
  if (existing.length === 0) {
    const categories: Array<{ slug: string; title: string; icon: string; description: string }> = [
      { slug: "start", title: "Начало работы", icon: "🚀", description: "Первые шаги, установка и базовые понятия." },
      { slug: "ios", title: "iPhone / iPad", icon: "🍎", description: "Установка приложений и настройка на iOS и iPadOS." },
      { slug: "android", title: "Android", icon: "🤖", description: "Подключение на телефонах и планшетах Android." },
      { slug: "windows", title: "Windows", icon: "💻", description: "Настройка подключения на компьютере." },
      { slug: "keys", title: "Подключение и ключи", icon: "🔑", description: "Ссылки, ключи и импорт подписки." },
      { slug: "payments", title: "Оплата и баланс", icon: "💳", description: "Баланс, бонусы и способы оплаты." },
      { slug: "troubleshooting", title: "Проблемы с подключением", icon: "🛠", description: "Что делать, если не работает подключение." },
      { slug: "faq", title: "Частые вопросы", icon: "❓", description: "Короткие ответы на популярные вопросы." },
    ];
    categories.forEach((c, index) => {
      linkDb.prepare(`
        INSERT OR IGNORE INTO help_categories (slug, title, description, icon, sort_order, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(c.slug, c.title, c.description, c.icon, index + 1);
    });
  }

  // Articles are intentionally NOT seeded. The whole Help content is
  // managed manually from Admin; a fresh DB starts with zero articles.

}

seedHelp();
