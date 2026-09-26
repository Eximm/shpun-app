// api/src/modules/help/helpRoutes.ts
//
// Help Center API.
//
// Public (published only):
//   GET  /help/categories
//   GET  /help/articles
//   GET  /help/articles/:slug
//   GET  /help/search?q=
//   GET  /help/media/:id
//
// Admin (existing admin check):
//   CRUD /admin/help/categories (+ /reorder)
//   CRUD /admin/help/articles
//   POST/GET/DELETE /admin/help/media

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { isSupportAdmin } from "../support/adminGuard.js";
import { sessionUser } from "../support/http.js";
import {
  createMedia,
  deleteArticle,
  deleteCategory,
  deleteMedia,
  detectHelpMime,
  getArticleById,
  getArticleBySlug,
  getCategory,
  getCategoryBySlug,
  getHelpStorage,
  getMedia,
  helpImageMaxBytes,
  helpMediaMaxBytes,
  helpVideoMaxBytes,
  listArticles,
  listBlocks,
  listCategories,
  listMedia,
  recordArticleView,
  reorderCategories,
  sanitizeMediaName,
  saveArticle,
  saveCategory,
  searchPublishedArticles,
} from "./helpStore.js";

const MEDIA_URL = "/api/help/media";

function toMediaDto(media: ReturnType<typeof getMedia>): Record<string, unknown> | null {
  if (!media) return null;
  return {
    id: media.id,
    kind: media.kind,
    originalName: media.originalName,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    width: media.width,
    height: media.height,
    duration: media.duration,
    createdAt: media.createdAt,
    url: `${MEDIA_URL}/${media.id}`,
  };
}

function articleSummary(article: any): Record<string, unknown> {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    categoryId: article.categoryId,
    categoryTitle: article.categoryTitle ?? null,
    categorySlug: article.categorySlug ?? null,
    status: article.status,
    isFeatured: article.isFeatured,
    sortOrder: article.sortOrder,
    updatedAt: article.updatedAt,
    publishedAt: article.publishedAt,
  };
}

async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<number | null> {
  const session = getSessionFromRequest(req as any);
  const shmSessionId = String(session?.shmSessionId ?? "").trim();
  if (!shmSessionId) {
    reply.code(401).send({ ok: false, error: "unauthorized" });
    return null;
  }
  if (!(await isSupportAdmin(shmSessionId))) {
    reply.code(403).send({ ok: false, error: "not_admin" });
    return null;
  }
  return sessionUser(session)?.userId ?? null;
}

function readBody(req: any): Record<string, any> {
  const body = req?.body;
  if (!body) return {};
  if (typeof body === "object") return body as Record<string, any>;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseId(value: unknown): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function readOneUpload(req: any): Promise<{ filename: string; buffer: Buffer } | null> {
  const parts = req.parts({ limits: { fileSize: helpMediaMaxBytes(), files: 1 } });
  for await (const part of parts) {
    if (part.type === "file") {
      const buffer = await part.toBuffer();
      return { filename: String(part.filename ?? "file"), buffer };
    }
  }
  return null;
}

export async function helpRoutes(app: FastifyInstance) {
  /* ── Public ─────────────────────────────────────────────────────────────── */

  app.get("/help/categories", async (_req, reply) => {
    return reply.send({ ok: true, items: listCategories(false) });
  });

  app.get("/help/articles", async (req, reply) => {
    const q = (req.query as any) ?? {};
    const categorySlug = String(q.category ?? "").trim();
    const category = categorySlug ? getCategoryBySlug(categorySlug) : null;
    if (categorySlug && !category) return reply.send({ ok: true, items: [] });
    const items = listArticles({
      publishedOnly: true,
      categoryId: category?.id ?? null,
      q: String(q.q ?? ""),
    });
    return reply.send({ ok: true, items: items.map(articleSummary) });
  });

  app.get("/help/search", async (req, reply) => {
    const q = String((req.query as any)?.q ?? "");
    const items = searchPublishedArticles(q);
    return reply.send({ ok: true, items: items.map(articleSummary) });
  });

  app.get("/help/articles/:slug", async (req, reply) => {
    const article = getArticleBySlug((req.params as any)?.slug);
    if (!article || article.status !== "published") {
      return reply.code(404).send({ ok: false, error: "article_not_found" });
    }
    const blocks = listBlocks(article.id).map((block) => {
      const media = (block.type === "image" || block.type === "video")
        ? getMedia((block.payload as any)?.mediaId)
        : null;
      return {
        id: block.id,
        type: block.type,
        sortOrder: block.sortOrder,
        payload: block.payload,
        media: media
          ? { id: media.id, kind: media.kind, mimeType: media.mimeType, width: media.width, height: media.height, url: `${MEDIA_URL}/${media.id}` }
          : null,
      };
    });
    const category = article.categoryId ? getCategory(article.categoryId) : null;
    const viewer = sessionUser(getSessionFromRequest(req as any) as any);
    recordArticleView(article.id, viewer?.userId ?? null);
    return reply.send({ ok: true, article: articleSummary({ ...article, categoryTitle: category?.title ?? null, categorySlug: category?.slug ?? null }), category, blocks });
  });

  app.get("/help/media/:id", async (req, reply) => {
    const media = getMedia((req.params as any)?.id);
    if (!media) return reply.code(404).send({ ok: false, error: "media_not_found" });
    const buffer = getHelpStorage().read(media.storagePath);
    if (!buffer) return reply.code(404).send({ ok: false, error: "media_file_missing" });

    const total = buffer.length;
    const range = String((req.headers as any)?.range ?? "");
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    reply.header("Accept-Ranges", "bytes");
    reply.header("Content-Type", media.mimeType);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header(
      "Content-Disposition",
      `${media.kind === "file" ? "attachment" : "inline"}; filename="${sanitizeMediaName(media.originalName).replace(/["\\]/g, "")}"`,
    );

    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
      if (!Number.isFinite(start) || start > end || start >= total) {
        reply.header("Content-Range", `bytes */${total}`);
        return reply.code(416).send();
      }
      const chunk = buffer.subarray(start, end + 1);
      reply.header("Content-Range", `bytes ${start}-${end}/${total}`);
      reply.header("Content-Length", String(chunk.length));
      return reply.code(206).send(chunk);
    }

    reply.header("Content-Length", String(total));
    return reply.send(buffer);
  });

  /* ── Admin: categories ──────────────────────────────────────────────────── */

  app.get("/admin/help/categories", async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;
    return reply.send({ ok: true, items: listCategories(true) });
  });

  app.put("/admin/help/categories/reorder", async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;
    reorderCategories((readBody(req) as any).ids);
    return reply.send({ ok: true, items: listCategories(true) });
  });

  app.post("/admin/help/categories", async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;
    try {
      const body = readBody(req);
      return reply.send({ ok: true, item: saveCategory({ ...body, id: 0 }) });
    } catch (error: any) {
      return reply.code(400).send({ ok: false, error: String(error?.message ?? "invalid_category") });
    }
  });

  app.put("/admin/help/categories/:id", async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;
    try {
      const body = readBody(req);
      return reply.send({ ok: true, item: saveCategory({ ...body, id: parseId((req.params as any)?.id) }) });
    } catch (error: any) {
      const code = String(error?.message ?? "invalid_category");
      return reply.code(code === "category_not_found" ? 404 : 400).send({ ok: false, error: code });
    }
  });

  app.delete("/admin/help/categories/:id", async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;
    const deleted = deleteCategory(parseId((req.params as any)?.id));
    return deleted
      ? reply.send({ ok: true })
      : reply.code(404).send({ ok: false, error: "category_not_found" });
  });

  /* ── Admin: articles ───────────────────────────────────────────────────── */

  app.get("/admin/help/articles", async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;
    const q = (req.query as any) ?? {};
    const status = String(q.status ?? "all") as any;
    const categoryId = parseId(q.categoryId);
    const items = listArticles({ status, categoryId: categoryId || null, q: String(q.q ?? "") });
    return reply.send({ ok: true, items: items.map((a) => ({ ...articleSummary(a), blocksCount: listBlocks(a.id).length })) });
  });

  app.get("/admin/help/articles/:id", async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;
    const article = getArticleById(parseId((req.params as any)?.id));
    if (!article) return reply.code(404).send({ ok: false, error: "article_not_found" });
    return reply.send({ ok: true, article, blocks: listBlocks(article.id) });
  });

  app.post("/admin/help/articles", async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;
    try {
      const body = readBody(req);
      const { article, blocks } = saveArticle({ ...body, id: 0 });
      return reply.send({ ok: true, article, blocks });
    } catch (error: any) {
      return reply.code(400).send({ ok: false, error: String(error?.message ?? "invalid_article") });
    }
  });

  app.put("/admin/help/articles/:id", async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;
    try {
      const body = readBody(req);
      const { article, blocks } = saveArticle({ ...body, id: parseId((req.params as any)?.id) });
      return reply.send({ ok: true, article, blocks });
    } catch (error: any) {
      const code = String(error?.message ?? "invalid_article");
      return reply.code(code === "article_not_found" ? 404 : 400).send({ ok: false, error: code });
    }
  });

  app.delete("/admin/help/articles/:id", async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;
    const deleted = deleteArticle(parseId((req.params as any)?.id));
    return deleted
      ? reply.send({ ok: true })
      : reply.code(404).send({ ok: false, error: "article_not_found" });
  });

  /* ── Admin: media ───────────────────────────────────────────────────────── */

  app.get("/admin/help/media", async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;
    return reply.send({ ok: true, items: listMedia().map((m) => ({ ...toMediaDto(m), usedBy: m.usedBy })) });
  });

  app.post("/admin/help/media", async (req, reply) => {
    const userId = await requireAdmin(req, reply);
    if (userId === null) return;
    let upload: { filename: string; buffer: Buffer } | null = null;
    try {
      upload = await readOneUpload(req);
    } catch (error: any) {
      const tooLarge = String(error?.code ?? "").includes("TooLarge") || String(error?.message ?? "").toLowerCase().includes("too large");
      return reply.code(tooLarge ? 413 : 400).send({ ok: false, error: tooLarge ? "file_too_large" : "upload_failed" });
    }
    if (!upload || upload.buffer.length === 0) {
      return reply.code(400).send({ ok: false, error: "empty_file" });
    }
    const detected = detectHelpMime(upload.buffer);
    if (!detected) {
      return reply.code(415).send({ ok: false, error: "unsupported_file_type" });
    }
    const maxBytes = detected.kind === "video" ? helpVideoMaxBytes() : helpImageMaxBytes();
    if (upload.buffer.length > maxBytes) {
      return reply.code(413).send({ ok: false, error: "file_too_large" });
    }
    const stored = getHelpStorage().save(upload.buffer, detected.ext);
    const media = createMedia({
      kind: detected.kind,
      originalName: sanitizeMediaName(upload.filename),
      storagePath: stored.storageKey,
      mimeType: detected.mime,
      sizeBytes: upload.buffer.length,
      uploadedBy: userId,
    });
    return reply.send({ ok: true, item: toMediaDto(media) });
  });

  app.delete("/admin/help/media/:id", async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;
    const result = deleteMedia(parseId((req.params as any)?.id));
    if (result === "not_found") return reply.code(404).send({ ok: false, error: "media_not_found" });
    if (result === "in_use") {
      const media = getMedia(parseId((req.params as any)?.id));
      return reply.code(409).send({
        ok: false,
        error: "media_in_use",
        usedBy: listMedia().find((m) => m.id === media?.id)?.usedBy ?? 0,
      });
    }
    return reply.send({ ok: true });
  });
}
