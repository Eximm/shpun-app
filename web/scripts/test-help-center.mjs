#!/usr/bin/env node
// Regression for the Help Center / knowledge base.
//
// Locks in:
//   - public Help routes + block rendering (video is native, no autoplay/loop)
//   - admin "База знаний" section with a block editor and media upload
//   - API surface (public + admin) and the seeded iOS/Happ article
//   - contextual entry points (profile, iOS/Happ connector) and support CTA
//
// Usage: npm run test:help-center

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(webRoot, rel), "utf8").replace(/\r\n?/g, "\n");

let failures = 0;
function assert(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond) failures++;
}

const help = read("src/pages/Help.tsx");
const adminHelp = read("src/pages/admin/HelpSection.tsx");
const main = read("src/main.tsx");
const adminPage = read("src/pages/AdminPage.tsx");
const tabs = read("src/pages/admin/types.ts");
const iconMap = read("src/pages/admin/adminIconMap.ts");
const profile = read("src/pages/Profile.tsx");
const connector = read("src/pages/connect/ConnectMarzban.tsx");
const css = read("src/index.css");
const store = read("../api/src/modules/help/helpStore.ts");
const routes = read("../api/src/modules/help/helpRoutes.ts");

/* ── Public routes + navigation ───────────────────────────────────────────── */

assert("public help routes registered", ["/help", "/help/search", "/help/c/:categorySlug", "/help/a/:articleSlug"].every((r) => main.includes(`path="${r}"`)));
assert("help is reachable from profile", profile.includes('profile.help.title') && profile.includes('nav("/help")'));
assert("iOS/Happ contextual link exists", connector.includes("/help/a/ios-happ-not-in-app-store") && connector.includes("connect.happ_not_in_store"));

/* ── Public rendering ─────────────────────────────────────────────────────── */

assert("home has search + categories + featured", help.includes('t("help.search.placeholder")') && help.includes('t("help.categories")') && help.includes('t("help.featured")'));
assert("article renders steps and callouts", help.includes('case "steps"') && help.includes("help-callout--"));
assert("video is native, no autoplay/loop", help.includes("<video") && help.includes("playsInline") && help.includes('preload="metadata"') && !help.includes("autoPlay") && !help.includes("loop"));
assert("image lightbox exists", help.includes("ImageLightbox") && help.includes("createPortal"));
assert("article links to support", help.includes('to="/support"') && help.includes('t("help.create_ticket")'));

/* ── Admin section ────────────────────────────────────────────────────────── */

assert("admin tab registered", tabs.includes('"help"') && adminPage.includes("<HelpSection") && iconMap.includes("help: \"help\""));
assert("admin list has search + status filters", adminHelp.includes("admin.help.search_ph") && adminHelp.includes("admin.help.status.${s}"));
assert("article editor has core fields", ["admin.help.field.title", "admin.help.field.slug", "admin.help.field.category", "admin.help.field.status", "admin.help.field.summary", "admin.help.field.keywords"].every((k) => adminHelp.includes(`t("${k}")`)));
assert("block editor supports all block types", ["paragraph", "heading", "bullet_list", "numbered_list", "steps", "callout", "image", "video", "button", "faq", "divider"].every((b) => adminHelp.includes(`"${b}"`)));
assert("blocks can be moved and removed", adminHelp.includes("moveBlock") && adminHelp.includes("removeBlock") && adminHelp.includes("addBlock"));
assert("media is uploaded from the editor", adminHelp.includes("FormData") && adminHelp.includes('apiFetch<{ ok: true; item: HelpMedia }>("/admin/help/media"') && adminHelp.includes('fd.append("file"'));
assert("media picker reuses uploaded files", adminHelp.includes("admin.help.media.pick") && adminHelp.includes("options.map"));
assert("used media delete is blocked in UI", adminHelp.includes("disabled={m.usedBy > 0}"));
assert("categories CRUD present", adminHelp.includes("saveCategory") && adminHelp.includes("removeCategory") && adminHelp.includes('apiFetch("/admin/help/categories"'));

/* ── API surface ──────────────────────────────────────────────────────────── */

assert("public endpoints exist", ["/help/categories", "/help/articles", "/help/articles/:slug", "/help/search", "/help/media/:id"].every((p) => routes.includes(`"${p}"`)));
assert("admin endpoints exist", ["/admin/help/categories", "/admin/help/articles", "/admin/help/media"].every((p) => routes.includes(`"${p}"`)));
assert("media route supports Range (video seeking)", routes.includes("Accept-Ranges") && routes.includes("Content-Range"));
assert("admin upload is MIME-sniffed and size-limited", routes.includes("detectHelpMime") && routes.includes("file_too_large"));
assert("used media cannot be deleted server-side", routes.includes('error: "media_in_use"'));

/* ── Storage + seed ───────────────────────────────────────────────────────── */

assert("media stored under uploads/help namespace", store.includes('"uploads", "help"') || store.includes("uploads/help"));
assert("media filename is generated (original kept as metadata)", store.includes("storagePath") && store.includes("originalName"));
assert("seed creates the iOS/Happ article", store.includes("ios-happ-not-in-app-store") && store.includes("Happ недоступен в App Store"));
assert("seed contains the region-change steps", store.includes("Изменить страну или регион") && store.includes("Казахстан"));
assert("seed warns about false payment data", store.includes("ложные платёжные данные"));

/* ── Mobile safety ────────────────────────────────────────────────────────── */

assert("help page is width bounded", css.includes(".help-page { display: flex; flex-direction: column; gap: 14px; max-width: 820px;"));
assert("category cards stack on mobile", /@media \(max-width: 560px\) \{\s*\.help-categoryGrid \{ grid-template-columns: 1fr; \}/.test(css));
assert("media previews are responsive", css.includes(".admin-help-media__preview img, .admin-help-media__preview video { width: 100%;"));

/* ── Editor UX (CMS-style) ────────────────────────────────────────────────── */

assert("editor keeps only basic fields up front", adminHelp.includes('className="helpEditor__basics"'));
assert("advanced metadata is collapsible and closed by default", adminHelp.includes('className="helpEditor__advanced"') && adminHelp.includes("<details") && adminHelp.includes("open={advancedOpen}"));
assert("slug/keywords/featured live under advanced", /helpEditor__advanced[\s\S]*?admin.help.field.slug[\s\S]*?admin.help.field.keywords[\s\S]*?admin.help.field.featured/.test(adminHelp));
assert("no permanent move arrows", !adminHelp.includes('"↑"') && !adminHelp.includes('"↓"') && !adminHelp.includes("admin.help.block.up"));
assert("block delete is only in the block menu", /danger: true, onClick: \(\) => removeBlock/.test(adminHelp));
const helpBlockSlice = adminHelp.slice(adminHelp.indexOf('className="helpBlock"'), adminHelp.indexOf("<BlockBody"));
assert("helpBlock has no permanent delete button", helpBlockSlice.length > 0 && !helpBlockSlice.includes("refPartnerCard__delete"));
assert("block menu trigger exists", adminHelp.includes("helpBlock__menuBtn") && adminHelp.includes('aria-haspopup="menu"') && adminHelp.includes("admin.help.block.menu"));
assert("main add buttons are visible in the toolbar", ["paragraph", "heading", "image", "video", "callout"].every((b) => adminHelp.includes(`addBlock("${b}")`)));
assert("advanced block types live under the more menu", adminHelp.includes("setMoreAnchor") && ["bullet_list", "numbered_list", "steps", "faq", "button", "divider"].every((b) => adminHelp.includes(`addBlock("${b}")`)));
assert("video block shows a preview + replace", adminHelp.includes("helpEditor__mediaPreview") && adminHelp.includes("<video") && adminHelp.includes("admin.help.media.replace"));
assert("image block shows a preview + replace", adminHelp.includes("helpEditor__mediaPreview") && adminHelp.includes("<img") && adminHelp.includes("admin.help.media.replace"));
assert("steps are edited as numbered rows", adminHelp.includes("helpEditor__itemMark") && adminHelp.includes("admin.help.block.step_ph"));
assert("save semantics unchanged", adminHelp.includes("saveArticle") && adminHelp.includes('apiFetch("/admin/help/articles"') && adminHelp.includes("admin.help.action.publish"));

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nOK: Help Center (public + admin CMS + media upload + seed) verified");