#!/usr/bin/env node
// Locale parity + usage checker for ShpunApp web.
//
// Usage: npm run check:i18n
//
// Verifies:
//   1. RU and EN have exactly the same key set (parity).
//   2. No duplicate keys inside a locale.
//   3. No empty translation values.
//   4. Every statically used t("key") / tp("key") exists in RU (and therefore EN).
//
// Dynamic keys built with template literals (e.g. `pwa.install.${guide}.title`)
// are intentionally skipped: they cannot be resolved statically.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");
const srcRoot = path.join(webRoot, "src");
const dictPath = path.join(srcRoot, "shared", "i18n", "dict.ts");

const problems = [];
const notes = [];

/* ── Parse dict.ts ───────────────────────────────────────────────────────── */

const dictSrc = fs.readFileSync(dictPath, "utf8");
const ruStart = dictSrc.indexOf("export const RU");
const enStart = dictSrc.indexOf("export const EN");
if (ruStart === -1 || enStart === -1) {
  console.error("check:i18n: could not locate RU/EN blocks in dict.ts");
  process.exit(1);
}

function parseLocale(block) {
  const entries = [];
  const re = /^\s*"((?:[^"\\]|\\.)+)"\s*:\s*"((?:[^"\\]|\\.)*)"/gm;
  let m;
  while ((m = re.exec(block))) entries.push({ key: m[1], value: m[2] });
  return entries;
}

const ru = parseLocale(dictSrc.slice(ruStart, enStart));
const en = parseLocale(dictSrc.slice(enStart));
const ruMap = new Map(ru.map((e) => [e.key, e.value]));
const enMap = new Map(en.map((e) => [e.key, e.value]));

/* ── 1/2/3. Structure checks ─────────────────────────────────────────────── */

function duplicates(entries) {
  const seen = new Set();
  const dup = new Set();
  for (const e of entries) {
    if (seen.has(e.key)) dup.add(e.key);
    seen.add(e.key);
  }
  return [...dup];
}

const dupRu = duplicates(ru);
const dupEn = duplicates(en);
if (dupRu.length) problems.push(`RU duplicate keys: ${dupRu.join(", ")}`);
if (dupEn.length) problems.push(`EN duplicate keys: ${dupEn.join(", ")}`);

const missingEn = ru.filter((e) => !enMap.has(e.key)).map((e) => e.key);
const extraEn = en.filter((e) => !ruMap.has(e.key)).map((e) => e.key);
if (missingEn.length) problems.push(`keys missing in EN (${missingEn.length}):\n  ${missingEn.join("\n  ")}`);
if (extraEn.length) problems.push(`keys only in EN (${extraEn.length}):\n  ${extraEn.join("\n  ")}`);

const emptyRu = ru.filter((e) => e.value.trim() === "").map((e) => e.key);
const emptyEn = en.filter((e) => e.value.trim() === "").map((e) => e.key);
if (emptyRu.length) problems.push(`empty RU values: ${emptyRu.join(", ")}`);
if (emptyEn.length) problems.push(`empty EN values: ${emptyEn.join(", ")}`);

/* ── 4. Static usage ─────────────────────────────────────────────────────── */

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const files = walk(srcRoot).filter((f) => f !== dictPath);
const usedT = new Map();
const usedTp = new Map();

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(webRoot, file);

  for (const m of src.matchAll(/(?<![\w.])t\(\s*"((?:[^"\\]|\\.)+)"/g)) {
    if (!usedT.has(m[1])) usedT.set(m[1], rel);
  }
  for (const m of src.matchAll(/(?<![\w.])tp\(\s*"((?:[^"\\]|\\.)+)"/g)) {
    if (!usedTp.has(m[1])) usedTp.set(m[1], rel);
  }
}

const usedMissing = [];
for (const [key, rel] of usedT) {
  if (!ruMap.has(key)) usedMissing.push(`${key}  (${rel})`);
}
for (const [base, rel] of usedTp) {
  const hasPlural = ["one", "few", "many", "other"].some((s) => ruMap.has(`${base}.${s}`));
  if (!hasPlural && !ruMap.has(base)) usedMissing.push(`${base}.{plural}  (${rel})`);
}
if (usedMissing.length) {
  problems.push(`keys used in code but missing in RU (${usedMissing.length}):\n  ${usedMissing.join("\n  ")}`);
}

// Informational only: keys that are not referenced statically. Dynamic keys
// built with template literals (e.g. `pwa.install.${guide}.title`) show up
// here as false positives, so this never fails the build.
const usedStatic = new Set(usedT.keys());
const unused = ru.filter((e) => {
  if (usedStatic.has(e.key)) return false;
  // treat `foo.one/.few/.many/.other` as used when tp("foo") exists
  const base = e.key.replace(/\.(one|few|many|other)$/, "");
  if (usedTp.has(base)) return false;
  return true;
}).map((e) => e.key);

/* ── Report ──────────────────────────────────────────────────────────────── */

notes.push(`RU keys: ${ru.length}`);
notes.push(`EN keys: ${en.length}`);
notes.push(`statically used t(): ${usedT.size}`);
notes.push(`statically used tp(): ${usedTp.size}`);
notes.push(`not referenced statically (may be dynamic/legacy): ${unused.length}`);
if (process.argv.includes("--list-unused") && unused.length) {
  console.log("\nUnused (static) keys:");
  for (const key of unused.sort()) console.log(`  ${key}`);
}

console.log(notes.join("\n"));
console.log("(locale parity != localization coverage: run `npm run check:hardcoded` for UI-visible strings)");

if (problems.length) {
  console.log("\nFAIL:");
  for (const p of problems) console.log(`- ${p}`);
  process.exit(1);
}

console.log("\nOK: locales are in sync");