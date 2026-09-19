#!/usr/bin/env node
// Lightweight static guard for frontend security invariants.
//
// The real boundary is server-side (see api tests). This script only protects
// against accidental frontend regressions:
//   1. SupportBell renders nothing and issues no admin request for non-admins.
//   2. The header health badge talks ONLY to the public /health endpoint.
//   3. /admin redirects non-admins instead of rendering the admin shell.
//   4. The legacy "Бета" badge is gone.
//
// It is intentionally simple string matching — no parser, no new dependencies.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(__dirname, "..", "src");

const problems = [];

function read(rel) {
  const file = path.join(srcRoot, rel);
  if (!fs.existsSync(file)) {
    problems.push(`missing file: src/${rel}`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function expect(rel, ok, message) {
  if (!ok) problems.push(`${rel}: ${message}`);
}

/* 1. SupportBell — admin only, no admin fetch for regular users. */
{
  const rel = "app/layout/SupportBell.tsx";
  const src = read(rel);
  expect(rel, /if\s*\(!isAdmin\)\s*return null;/.test(src), "must return null for non-admins");
  expect(rel, /useSupportUnread\(\s*isAdmin\s*\)/.test(src), "unread hook must be gated by isAdmin");
  expect(rel, /\/admin\?tab=support/.test(src), "expected admin deep-link for the bell");
}

/* 2. Health badge — public-safe endpoint only. */
{
  const rel = "app/layout/SystemHealthBadge.tsx";
  const src = read(rel);
  expect(rel, /"\/health"/.test(src), "must call the public /health endpoint");
  expect(rel, !/\/admin/.test(src), "must not call any /admin endpoint");
  expect(rel, !/supportUnread|useSupportUnread/.test(src), "must not read support unread counts");
}

/* 3. /admin redirects non-admins (no admin shell flash). */
{
  const rel = "pages/AdminPage.tsx";
  const src = read(rel);
  expect(rel, /if\s*\(!isAdmin\)\s*return\s*<Navigate\s+to="\/profile"\s+replace\s*\/>/.test(src), "must redirect non-admins");
  expect(rel, /useSupportUnread\(\s*isAdmin\s*\)/.test(src), "unread polling must be gated by isAdmin");
}

/* 4. Legacy beta badge removed, health badge wired into the header. */
{
  const rel = "main.tsx";
  const src = read(rel);
  expect(rel, /<SystemHealthBadge\s*\/>/.test(src), "header must render SystemHealthBadge");
  expect(rel, !/app\.beta/.test(src), "legacy app.beta badge must be removed");
}

if (problems.length) {
  console.log("=== frontend security invariants ===");
  for (const p of problems) console.log(`- ${p}`);
  console.log(`\nFAIL: ${problems.length} invariant(s) violated`);
  process.exit(1);
}

console.log("=== frontend security invariants ===");
console.log("OK: SupportBell admin-gated, health badge public-only, /admin redirects, beta removed");