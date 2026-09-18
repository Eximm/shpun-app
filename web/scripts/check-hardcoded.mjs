#!/usr/bin/env node
// UI hardcoded-string audit for ShpunApp web.
//
// This is deliberately separate from check:i18n (locale parity). Parity can be
// 100% while UI-visible strings are still hardcoded in components.
//
// Heuristic (TypeScript AST, no extra deps):
//   - JSX text nodes that contain letters
//   - string literals with Cyrillic that live inside a JSX subtree
//     (covers `{cond ? "Да" : "Нет"}`), excluding t()/tp() arguments
//   - JSX attributes from a small user-visible set (placeholder/title/aria-label/...)
//   - literals passed to known UI helpers (toast.*, showToast, confirm, alert,
//     and the common setXxx message setters)
//
// Raw diagnostics / protocol / brand / user-data strings can be allowlisted
// below. The exit code is 1 when findings exist, so CI can gate on coverage.
//
// Usage: node scripts/check-hardcoded.mjs [--list]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");
const srcRoot = path.join(webRoot, "src");
const listAll = process.argv.includes("--list");

const CYRILLIC = /[\u0400-\u04FF]/;

// File-level allowlist: matched against the relative path.
// Keep this list short and explain every entry in the report.
const ALLOWLIST = [
  // Intentional Russian-only legal documents (not translated on purpose).
  /^src[\/]pages[\/]LegalDocs\.tsx$/,
  // Payment toast "mood" flavour is intentionally RU-only.
  /^src[\/]shared[\/]payments-mood[\/]/,
  // Localized dictionaries themselves.
  /^src[\/]shared[\/]i18n[\/]dict\.ts$/,
];

// Finding-level allowlist: matched against `${relativePath}:${line}:${text}`.
const FINDING_ALLOWLIST = [
  // main.tsx runs before React/i18n is mounted and is intentionally bilingual.
  /^src[\\/]main\.tsx:\d+:Открываем Happ$/,
  /^src[\\/]main\.tsx:\d+:Если Happ не открылся, нажмите кнопку\.$/,
  /^src[\\/]main\.tsx:\d+:Открыть Happ$/,
];

const VISIBLE_ATTRS = new Set(["placeholder", "title", "aria-label", "label", "alt"]);
const UI_HELPERS = new Set([
  "showToast", "confirm", "alert",
  "setMessage", "setError", "setNotice", "setOkText", "setCreateError",
  "setSaveError", "setListError", "setOpenedError", "setTgError", "setSaveMessage",
]);
const UI_HELPER_OBJECTS = new Set(["toast"]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

function hasLetters(text) {
  return /[A-Za-z\u0400-\u04FF]/.test(text);
}

function isTArg(node) {
  const parent = node.parent;
  if (!parent || parent.kind !== ts.SyntaxKind.CallExpression) return false;
  const call = parent;
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text === "t" || callee.text === "tp";
  return false;
}

function hasJsxAncestor(node) {
  let cur = node.parent;
  while (cur) {
    if (
      ts.isJsxElement(cur) || ts.isJsxSelfClosingElement(cur) ||
      ts.isJsxFragment(cur) || ts.isJsxExpression(cur) || ts.isJsxAttribute(cur)
    ) {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}

function uiHelperName(node) {
  const parent = node.parent;
  if (!parent || parent.kind !== ts.SyntaxKind.CallExpression) return null;
  const call = parent;
  const callee = call.expression;
  if (ts.isIdentifier(callee) && UI_HELPERS.has(callee.text)) return callee.text;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && UI_HELPER_OBJECTS.has(callee.expression.text)) {
    return `${callee.expression.text}.${callee.name.text}`;
  }
  return null;
}

const findings = [];

for (const file of walk(srcRoot)) {
  const rel = path.relative(webRoot, file).split(path.sep).join("/");
  if (ALLOWLIST.some((re) => re.test(rel))) continue;

  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function record(kind, node, value) {
    const trimmed = String(value).trim();
    if (!trimmed || !CYRILLIC.test(trimmed)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const entry = { file: rel, line: line + 1, kind, text: trimmed };
    if (FINDING_ALLOWLIST.some((re) => re.test(`${entry.file}:${entry.line}:${entry.text}`))) return;
    findings.push(entry);
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      const value = node.getText(sf).replace(/\s+/g, " ").trim();
      if (value && hasLetters(value)) record("jsx-text", node, value);
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      if (VISIBLE_ATTRS.has(name) && node.initializer && ts.isStringLiteral(node.initializer)) {
        record("jsx-attr", node.initializer, node.initializer.text);
      }
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isTArg(node) && hasJsxAncestor(node)) {
        record("jsx-expr", node, node.text);
      } else if (!isTArg(node) && uiHelperName(node)) {
        record(`ui:${uiHelperName(node)}`, node, node.text);
      }
    } else if (ts.isTemplateExpression(node)) {
      const combined = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join("{...}");
      if (!isTArg(node) && hasJsxAncestor(node)) {
        record("jsx-template", node, combined);
      } else if (!isTArg(node) && uiHelperName(node)) {
        record(`ui:${uiHelperName(node)}`, node, combined);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
}

const byFile = new Map();
for (const f of findings) {
  byFile.set(f.file, (byFile.get(f.file) || 0) + 1);
}

console.log("=== UI hardcoded-string audit ===");
console.log(`findings: ${findings.length}`);
console.log(`files:    ${byFile.size}`);

if (byFile.size) {
  console.log("\nTop files:");
  for (const [file, count] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`  ${String(count).padStart(4)}  ${file}`);
  }
}

if (listAll && findings.length) {
  console.log("\nAll findings:");
  for (const f of findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    console.log(`  ${f.file}:${f.line}  [${f.kind}]  ${f.text}`);
  }
}

if (findings.length) {
  console.log(`\nFAIL: ${findings.length} UI-visible hardcoded string(s) found`);
  process.exit(1);
}
console.log("\nOK: no UI-visible hardcoded strings found");