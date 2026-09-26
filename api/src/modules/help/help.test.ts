// api/src/modules/help/help.test.ts
//
// Coverage for the Help Center API + storage:
//   - seed data (categories + featured iOS/Happ article)
//   - category CRUD + reorder
//   - article CRUD + block roundtrip + transaction safety
//   - draft/hidden are not public, published is
//   - slug uniqueness
//   - media upload MIME validation, size limits, path-traversal rejection
//   - media reuse + used media cannot be deleted
//   - admin-only access

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-help-"));
process.env.NODE_ENV = "test";

const Fastify = (await import("fastify")).default;
const multipart = (await import("@fastify/multipart")).default;
const { helpRoutes } = await import("./helpRoutes.js");
const { setSupportAdminChecker } = await import("../support/adminGuard.js");
const { putSession } = await import("../../shared/session/sessionStore.js");

setSupportAdminChecker(async (sid) => sid === "admin-session");
putSession("admin-sid", { shmSessionId: "admin-session", shmUserId: 1, login: "admin", createdAt: Date.now() });
putSession("user-sid", { shmSessionId: "user-session", shmUserId: 2, login: "user", createdAt: Date.now() });

const app = Fastify();
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 5 } });
await app.register(async (api) => { await helpRoutes(api); }, { prefix: "/api" });
await app.ready();

after(async () => { await app.close(); });

const admin = { "x-app-sid": "admin-sid" };
const asUser = { "x-app-sid": "user-sid" };

function get(url: string, headers?: Record<string, string>) {
  return app.inject({ method: "GET", url, headers });
}
function adminGet(url: string) {
  return get(url, admin);
}
function send(method: "POST" | "PUT" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = admin) {
  return app.inject({ method, url, headers, payload: payload as any });
}

function multipartPng(filename: string, buffer?: Buffer) {
  const boundary = "----shpunhelpboundary";
  const data = buffer ?? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { boundary, body: Buffer.concat([head, data, tail]) };
}

/* ── Seed + public visibility ─────────────────────────────────────────────── */

test("seed creates categories and the featured iOS/Happ article", async () => {
  const cats = JSON.parse((await get("/api/help/categories")).body);
  assert.equal(cats.ok, true);
  assert.ok(cats.items.length >= 8);

  const list = JSON.parse((await get("/api/help/articles")).body);
  const happ = list.items.find((a: any) => a.slug === "ios-happ-not-in-app-store");
  assert.ok(happ, "featured Happ article must be published");
  assert.equal(happ.isFeatured, true);

  const detail = JSON.parse((await get("/api/help/articles/ios-happ-not-in-app-store")).body);
  assert.equal(detail.ok, true);
  assert.ok(detail.blocks.some((b: any) => b.type === "steps"));
  assert.ok(detail.blocks.some((b: any) => b.type === "callout"));
});

test("draft and hidden articles are not public, published are", async () => {
  const created = JSON.parse((await send("POST", "/api/admin/help/articles", {
    title: "Draft article",
    slug: "draft-article",
    summary: "not ready",
    status: "draft",
    blocks: [{ type: "paragraph", payload: { text: "hidden body" } }],
  })).body);
  assert.equal(created.ok, true);
  const draftId = created.article.id;
  assert.equal(created.article.status, "draft");

  assert.equal((await get("/api/help/articles/draft-article")).statusCode, 404);
  assert.ok(!JSON.parse((await get("/api/help/articles")).body).items.some((a: any) => a.slug === "draft-article"));
  assert.ok(!JSON.parse((await get("/api/help/search?q=hidden body")).body).items.some((a: any) => a.slug === "draft-article"));

  await send("PUT", `/api/admin/help/articles/${draftId}`, { title: "Draft article", status: "published", blocks: [] });
  assert.equal((await get("/api/help/articles/draft-article")).statusCode, 200);

  await send("PUT", `/api/admin/help/articles/${draftId}`, { title: "Draft article", status: "hidden", blocks: [] });
  assert.equal((await get("/api/help/articles/draft-article")).statusCode, 404);
});

/* ── Categories CRUD ──────────────────────────────────────────────────────── */

test("category CRUD + reorder + non-admin denied", async () => {
  assert.equal((await send("POST", "/api/admin/help/categories", { title: "X" }, asUser)).statusCode, 403);
  assert.equal((await send("POST", "/api/admin/help/categories", { title: "X" }, {})).statusCode, 401);

  const created = JSON.parse((await send("POST", "/api/admin/help/categories", { title: "Тестовая категория" })).body);
  assert.equal(created.ok, true);
  assert.ok(created.item.slug);

  const updated = JSON.parse((await send("PUT", `/api/admin/help/categories/${created.item.id}`, { title: "Обновлённая" })).body);
  assert.equal(updated.item.title, "Обновлённая");

  const reordered = JSON.parse((await send("PUT", "/api/admin/help/categories/reorder", { ids: [created.item.id] })).body);
  assert.equal(reordered.items.find((c: any) => c.id === created.item.id).sortOrder, 1);

  assert.equal((await send("DELETE", `/api/admin/help/categories/${created.item.id}`)).statusCode, 200);
  assert.equal((await send("DELETE", `/api/admin/help/categories/${created.item.id}`)).statusCode, 404);
});

/* ── Article CRUD + blocks + transaction ──────────────────────────────────── */

test("article CRUD keeps blocks in order and replaces them atomically", async () => {
  const created = JSON.parse((await send("POST", "/api/admin/help/articles", {
    title: "Block article",
    slug: "block-article",
    summary: "s",
    status: "published",
    blocks: [
      { type: "heading", payload: { text: "H" } },
      { type: "paragraph", payload: { text: "P" } },
      { type: "divider", payload: {} },
      { type: "not_a_block", payload: { text: "ignored" } },
    ],
  })).body);
  assert.equal(created.ok, true);
  assert.equal(created.blocks.length, 3);
  assert.deepEqual(created.blocks.map((b: any) => b.type), ["heading", "paragraph", "divider"]);
  assert.deepEqual(created.blocks.map((b: any) => b.sortOrder), [1, 2, 3]);

  const updated = JSON.parse((await send("PUT", `/api/admin/help/articles/${created.article.id}`, {
    title: "Block article",
    status: "published",
    blocks: [{ type: "paragraph", payload: { text: "only" } }],
  })).body);
  assert.equal(updated.blocks.length, 1);
  assert.equal(updated.blocks[0].payload.text, "only");
});

test("empty title never creates a partial article", async () => {
  const before = JSON.parse((await adminGet("/api/admin/help/articles")).body).items.length;
  const res = await send("POST", "/api/admin/help/articles", { title: "   ", blocks: [{ type: "paragraph", payload: { text: "x" } }] });
  assert.equal(res.statusCode, 400);
  const afterCount = JSON.parse((await adminGet("/api/admin/help/articles")).body).items.length;
  assert.equal(afterCount, before);
});

test("slug uniqueness is enforced on create", async () => {
  await send("POST", "/api/admin/help/articles", { title: "Slug A", slug: "slug-unique", status: "draft", blocks: [] });
  const second = JSON.parse((await send("POST", "/api/admin/help/articles", { title: "Slug B", slug: "slug-unique", status: "draft", blocks: [] })).body);
  assert.notEqual(second.article.slug, "slug-unique");
});

/* ── Media ────────────────────────────────────────────────────────────────── */

test("media upload validates MIME, sanitizes path and is admin-only", async () => {
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/help/media", headers: asUser })).statusCode, 403);

  const bad = multipartPng("note.txt", Buffer.from("hello text"));
  const badRes = await app.inject({
    method: "POST",
    url: "/api/admin/help/media",
    headers: { ...admin, "content-type": `multipart/form-data; boundary=${bad.boundary}` },
    payload: bad.body,
  });
  assert.equal(badRes.statusCode, 415);

  const good = multipartPng("../../etc/passwd.png");
  const goodRes = await app.inject({
    method: "POST",
    url: "/api/admin/help/media",
    headers: { ...admin, "content-type": `multipart/form-data; boundary=${good.boundary}` },
    payload: good.body,
  });
  const body = JSON.parse(goodRes.body);
  assert.equal(goodRes.statusCode, 200);
  assert.equal(body.item.kind, "image");
  assert.ok(body.item.url.includes(`/api/help/media/${body.item.id}`));

  // Served file exists and original filename is metadata only.
  const served = await get(`/api/help/media/${body.item.id}`);
  assert.equal(served.statusCode, 200);
  assert.equal(served.headers["content-type"], "image/png");
  return body.item;
});

test("image size limit is enforced (configurable)", async () => {
  process.env.HELP_MEDIA_IMAGE_MAX_MB = "1";
  const big = multipartPng("big.png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2 * 1024 * 1024)]));
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/help/media",
    headers: { ...admin, "content-type": `multipart/form-data; boundary=${big.boundary}` },
    payload: big.body,
  });
  assert.equal(res.statusCode, 413);
  delete process.env.HELP_MEDIA_IMAGE_MAX_MB;
});

test("used media cannot be deleted until references are removed", async () => {
  const media = JSON.parse((await app.inject({
    method: "POST",
    url: "/api/admin/help/media",
    headers: { ...admin, "content-type": `multipart/form-data; boundary=${multipartPng("pic.png").boundary}` },
    payload: multipartPng("pic.png").body,
  })).body);

  const article = JSON.parse((await send("POST", "/api/admin/help/articles", {
    title: "Media article",
    slug: "media-article",
    status: "published",
    blocks: [{ type: "image", payload: { mediaId: media.item.id } }],
  })).body);

  const inUse = await send("DELETE", `/api/admin/help/media/${media.item.id}`);
  assert.equal(inUse.statusCode, 409);

  await send("PUT", `/api/admin/help/articles/${article.article.id}`, { title: "Media article", status: "published", blocks: [] });
  const deleted = await send("DELETE", `/api/admin/help/media/${media.item.id}`);
  assert.equal(deleted.statusCode, 200);
});

/* ── Search ───────────────────────────────────────────────────────────────── */

test("public search finds published articles by title/keywords/body", async () => {
  await send("POST", "/api/admin/help/articles", {
    title: "Уникальная инструкция про роутер",
    slug: "router-unique",
    status: "published",
    searchKeywords: "роутер маршрутизатор",
    blocks: [{ type: "paragraph", payload: { text: "Особенное содержимое xyzzy" } }],
  });
  const byTitle = JSON.parse((await get("/api/help/search?q=роутер")).body);
  assert.ok(byTitle.items.some((a: any) => a.slug === "router-unique"));
  const byBody = JSON.parse((await get("/api/help/search?q=xyzzy")).body);
  assert.ok(byBody.items.some((a: any) => a.slug === "router-unique"));
});

/* ── Seed safety (restart must not overwrite admin content) ──────────────── */

function multipartVideo(filename: string) {
  const boundary = "----shpunhelpvideoboundary";
  const data = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(32, 0)]);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: video/mp4\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { boundary, body: Buffer.concat([head, data, tail]) };
}

test("restart does not overwrite admin edits to the seeded article", async () => {
  const store = await import("./helpStore.js");

  const video = multipartVideo("demo.mp4");
  const mediaRes = await app.inject({
    method: "POST",
    url: "/api/admin/help/media",
    headers: { ...admin, "content-type": `multipart/form-data; boundary=${video.boundary}` },
    payload: video.body,
  });
  const media = JSON.parse(mediaRes.body).item;
  assert.equal(media.kind, "video");

  const seeded = store.getArticleBySlug("ios-happ-not-in-app-store");
  assert.ok(seeded);

  const put = await send("PUT", `/api/admin/help/articles/${seeded!.id}`, {
    title: "Admin edited title",
    summary: "Admin edited summary",
    status: "draft",
    isFeatured: false,
    categoryId: null,
    blocks: [
      { type: "paragraph", payload: { text: "admin body" } },
      { type: "video", payload: { mediaId: media.id } },
    ],
  });
  assert.equal(put.statusCode, 200);

  // Simulate an API restart / repository re-init.
  store.seedHelp();

  const after = store.getArticleBySlug("ios-happ-not-in-app-store");
  assert.ok(after, "canonical slug must still resolve");
  assert.equal(after!.id, seeded!.id, "seed must not create a duplicate article");
  assert.equal(after!.title, "Admin edited title");
  assert.equal(after!.summary, "Admin edited summary");
  assert.equal(after!.status, "draft");
  assert.equal(after!.isFeatured, false);
  assert.equal(after!.categoryId, null);

  const blocks = store.listBlocks(after!.id);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].payload.text, "admin body");
  assert.equal(blocks[1].type, "video");
  assert.equal(Number(blocks[1].payload.mediaId), media.id, "admin mediaId must survive restart");
});

test("restart does not reset admin category edits", async () => {
  const store = await import("./helpStore.js");
  const target = store.listCategories(true)[0];
  store.saveCategory({ id: target.id, title: "Renamed by admin", icon: "🔥", description: "custom", sortOrder: 42 });

  store.seedHelp();

  const after = store.getCategory(target.id);
  assert.equal(after!.title, "Renamed by admin");
  assert.equal(after!.icon, "🔥");
  assert.equal(after!.description, "custom");
  assert.equal(after!.sortOrder, 42);
  // No duplicate seed categories appear either.
  assert.equal(store.listCategories(true).filter((c) => c.slug === target.slug).length, 1);
});

/* ── Article views are best-effort ───────────────────────────────────────── */

test("article view telemetry never breaks article opening", async () => {
  const { linkDb } = await import("../../shared/linkdb/db.js");
  const store = await import("./helpStore.js");
  const created = JSON.parse((await send("POST", "/api/admin/help/articles", {
    title: "Telemetry article",
    slug: "telemetry-article",
    status: "published",
    blocks: [{ type: "paragraph", payload: { text: "telemetry" } }],
  })).body);
  const article = store.getArticleById(created.article.id)!;
  assert.equal(article.status, "published");

  linkDb.exec("ALTER TABLE help_article_views RENAME TO help_article_views_bak");
  try {
    // Recording telemetry with the table missing must not throw...
    assert.doesNotThrow(() => store.recordArticleView(article.id, null));
    // ...and the public GET must still return the article.
    const res = await get(`/api/help/articles/${article.slug}`);
    assert.equal(res.statusCode, 200);
  } finally {
    linkDb.exec("ALTER TABLE help_article_views_bak RENAME TO help_article_views");
  }
});
