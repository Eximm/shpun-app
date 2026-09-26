#!/usr/bin/env node
// Behavioral regression for the Help editor model (pure logic) + static checks
// that the editor cannot shrink the article on a failed media upload.
//
// Usage: npm run test-help-editor

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "shpun-help-editor-"));
const outfile = path.join(outDir, "model.mjs");

await build({
  entryPoints: [path.join(webRoot, "src", "pages", "admin", "helpEditorModel.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  logLevel: "silent",
});

const model = await import(pathToFileURL(outfile).href);

let failures = 0;
function assert(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond) failures++;
}

const form = (over = {}) => ({ title: "T", slug: "s", summary: "sum", categoryId: "3", status: "draft", isFeatured: false, searchKeywords: "", ...over });
const blocks = [
  { type: "paragraph", payload: { text: "a" } },
  { type: "heading", payload: { text: "h" } },
  { type: "steps", payload: { items: ["1", "2"] } },
];

/* ── Payload: failed upload can never shrink the article ──────────────────── */

const payload = model.buildArticlePayload(form(), blocks);
assert("payload keeps every block", payload.blocks.length === 3 && payload.blocks[1].type === "heading");
assert("payload carries title/summary/category/status", payload.title === "T" && payload.summary === "sum" && payload.categoryId === 3 && payload.status === "draft");
assert("payload blocks are copies (no shared refs)", payload.blocks[0].payload !== blocks[0].payload);
assert("empty block list still yields an array", Array.isArray(model.buildArticlePayload(form(), []).blocks));
assert("payload defaults placements to an array", Array.isArray(payload.placements) && payload.placements.length === 0);
assert("payload carries placements", model.buildArticlePayload(form(), blocks, undefined, ["connect_ios_happ_install"]).placements[0] === "connect_ios_happ_install");
assert("placement change marks the editor dirty", model.editorSnapshot(form(), blocks, ["connect_ios_happ_install"]) !== model.editorSnapshot(form(), blocks, []));

const published = model.buildArticlePayload(form(), blocks, "published");
assert("publish override does not mutate the form status", published.status === "published" && form().status === "draft");

assert("cannot save without a title", model.canSavePayload(model.buildArticlePayload(form({ title: "  " }), blocks)) === false);
assert("can save a valid payload", model.canSavePayload(payload) === true);

/* ── Upload validation / normalization ───────────────────────────────────── */

assert("image over 10 MB is rejected client-side", model.validateFileSize(11 * 1024 * 1024, "image")?.code === "image_too_large");
assert("video over 100 MB is rejected client-side", model.validateFileSize(101 * 1024 * 1024, "video")?.code === "video_too_large");
assert("image under the limit passes", model.validateFileSize(5 * 1024 * 1024, "image") === null);
assert("2 MB file passes client-side validation", model.validateFileSize(2068774, "video") === null);

// Regression: a 2 MB file that gets a 413 must NOT be reported as "> 100 MB".
assert("413 is a server-limit error, not a Help-limit error", model.normalizeUploadError(413, "video").code === "server_rejected_size");
assert("server-limit error is distinct from video_too_large", model.normalizeUploadError(413, "video").code !== "video_too_large");
assert("413 keeps the max for the message context", model.normalizeUploadError(413, "image").maxMb === 10);
assert("non-413 is a generic upload failure", model.normalizeUploadError(500, "video").code === "upload_failed");

// A 101 MB file is rejected BEFORE any request is made.
const oversized = model.validateFileSize(101 * 1024 * 1024, "video");
assert("101 MB is rejected client-side with the 100 MB limit", oversized?.code === "video_too_large" && oversized?.maxMb === 100);

/* ── Dirty state ─────────────────────────────────────────────────────────── */

const snap = model.editorSnapshot(form(), blocks);
assert("identical state is not dirty", model.isEditorDirty(model.editorSnapshot(form(), blocks), snap) === false);
assert("changed state is dirty", model.isEditorDirty(model.editorSnapshot(form({ title: "changed" }), blocks), snap) === true);
assert("no saved baseline counts as dirty", model.isEditorDirty(snap, null) === true);

/* ── Autosave decisions ──────────────────────────────────────────────────── */

assert("autosave is off for a new (unsaved) article", model.shouldAutosave({ dirty: true, saving: false, articleId: null, title: "T" }) === false);
assert("autosave runs for a dirty existing article", model.shouldAutosave({ dirty: true, saving: false, articleId: 7, title: "T" }) === true);
assert("autosave skips a clean article", model.shouldAutosave({ dirty: false, saving: false, articleId: 7, title: "T" }) === false);
assert("autosave does not overlap a running save", model.shouldAutosave({ dirty: true, saving: true, articleId: 7, title: "T" }) === false);

/* ── Local draft recovery ────────────────────────────────────────────────── */

assert("local draft newer than server is offered", model.isDraftNewerThanServer(Date.now(), "2000-01-01 00:00:00") === true);
assert("older local draft is ignored", model.isDraftNewerThanServer(0, "2999-01-01 00:00:00") === false);

/* ── Static: editor wiring prevents data loss ────────────────────────────── */

const read = (rel) => fs.readFileSync(path.join(webRoot, rel), "utf8").replace(/\r\n?/g, "\n");
const editor = read("src/pages/admin/HelpSection.tsx");
const renderer = read("src/shared/help/HelpArticleRenderer.tsx");
const publicPage = read("src/pages/Help.tsx");

assert("upload failure only touches upload state", /catch[\s\S]*?setUploadState[\s\S]*?lastFile: file/.test(editor) && !/catch[\s\S]*?setBlocks\(\[\]/.test(editor));
assert("save builds payload from the full editor state", editor.includes("buildArticlePayload(form, blocks") && editor.includes("editorSnapshot(form, blocks, formPlacements)"));
assert("save is disabled until hydrated", editor.includes("disabled={!hydrated") );
assert("autosave uses a debounce + sequence guard", editor.includes("AUTOSAVE_MS") && editor.includes("shouldAutosave") && editor.includes("saveSeqRef"));
assert("save state indicator is rendered, not only a toast", editor.includes("saveLabel") && editor.includes("helpEditor__status"));
assert("leave-page guard exists", editor.includes("beforeunload") && editor.includes("admin.help.unsaved_confirm"));
assert("admin section switch is guarded too", read("src/pages/AdminPage.tsx").includes("isHelpEditorDirty") && editor.includes("setHelpEditorDirty"));
assert("local draft recovery exists", editor.includes("loadLocalDraft") && editor.includes("saveLocalDraft") && editor.includes("clearLocalDraft"));
assert("preview uses the shared renderer", editor.includes("HelpArticleRenderer") && editor.includes("resolvePreviewBlocks"));
assert("public page uses the same shared renderer", publicPage.includes("HelpArticleRenderer"));
assert("shared renderer is the only block renderer", publicPage.includes("from \"../shared/help/HelpArticleRenderer\"") && !publicPage.includes("function HelpBlockView"));
assert("upload errors are normalized (no raw proxy HTML)", editor.includes("normalizeUploadError") && editor.includes("validateFileSize"));
assert("server 413 shows a server-limit message, not the 100 MB one", editor.includes("server_rejected_size") && editor.includes("admin.help.upload.server_rejected"));
assert("missing media has a placeholder in preview", renderer.includes("showMissingMedia") && renderer.includes("help.media.video_missing"));

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nOK: help editor reliability (payload, autosave, preview, upload) verified");
