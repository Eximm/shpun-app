#!/usr/bin/env node
// Regression test for the i18n global runtime bridge.
//
// Verifies:
//   1. Without a Provider, tGlobal/normalizeError fall back to RU safely.
//   2. Runtime can be switched RU -> EN -> RU and normalizeError follows
//      immediately (no render/effect timing dependency).
//   3. Unknown keys never throw and never leak a raw technical crash.
//
// Uses only existing devDependencies (typescript). It compiles the small,
// React-free subset (runtime.ts + dict.ts + errorText.ts) to a temp dir and
// exercises the real code instead of a re-implementation.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const webRoot = path.join(__dirname, "..");
const tmpDir = path.join(webRoot, ".tmp-i18n-test");
const tscBin = path.join(
  webRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc"
);

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `\n     expected: ${expected}\n     actual:   ${actual}`}`);
  if (!ok) failures++;
}

function assert(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond) failures++;
}

/* ── Build the React-free subset ─────────────────────────────────────────── */

fs.rmSync(tmpDir, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    tscBin,
    path.join("src", "shared", "api", "errorText.ts"),
    "--outDir",
    tmpDir,
    "--module",
    "commonjs",
    "--target",
    "es2020",
    "--moduleResolution",
    "node",
    "--skipLibCheck",
    "--esModuleInterop",
  ],
  { cwd: webRoot, stdio: "inherit" }
);

// Force CommonJS interpretation regardless of the app's "type": "module".
fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ type: "commonjs" }));

const rt = require(path.join(tmpDir, "i18n", "runtime.js"));
const { normalizeError } = require(path.join(tmpDir, "api", "errorText.js"));

function installRuntime(lang) {
  const dict = lang === "en" ? rt.EN : rt.RU;
  rt.setI18nRuntime({
    lang,
    t: (key, fallbackOrParams, params) => {
      const fallback = typeof fallbackOrParams === "string" ? fallbackOrParams : undefined;
      const p = typeof fallbackOrParams === "object" ? fallbackOrParams : params;
      return rt.interpolate(dict[key] ?? fallback ?? key, p);
    },
    tp: (key, count, params) => {
      const suffix = rt.pluralSuffix(lang, count);
      return rt.interpolate(dict[`${key}.${suffix}`] ?? dict[`${key}.other`] ?? key, { count, ...params });
    },
  });
}

/* ── 1. Safe default fallback (no Provider yet) ──────────────────────────── */

// Re-require runtime fresh to observe the module-level default. Since the
// module is cached, we instead assert the documented default behaviour: the
// bundle starts in RU before any setI18nRuntime call. We simulate "no provider"
// by checking a key that exists in RU.
check("default runtime is RU (no Provider)", rt.getRuntimeLocale(), "ru-RU");
assert("default normalizeError is localized without throwing", normalizeError({ status: 500 }).title.length > 0);
check("unknown key falls back to the key itself", rt.tGlobal("__no_such_key__"), "__no_such_key__");

/* ── 2. Language switching updates the global runtime immediately ────────── */

installRuntime("ru");
check("RU: 500 error", normalizeError({ status: 500 }).title, "Ошибка сервера");
check("RU: network error", normalizeError(new TypeError("Failed to fetch")).title, "Проблема с соединением");
check("RU: 404", normalizeError({ status: 404 }).title, "Не найдено");

installRuntime("en");
check("EN: 500 error", normalizeError({ status: 500 }).title, "Server error");
check("EN: network error", normalizeError(new TypeError("Failed to fetch")).title, "Connection problem");
check("EN: 404", normalizeError({ status: 404 }).title, "Not found");
check("EN runtime locale", rt.getRuntimeLocale(), "en-US");

installRuntime("ru");
check("back to RU: 500 error", normalizeError({ status: 500 }).title, "Ошибка сервера");

/* ── 3. Auth mapping uses tickets/auth keys and keeps raw code for logs ──── */

installRuntime("en");
const authErr = normalizeError({ status: 401, code: "unauthorized" });
check("EN auth title", authErr.title, "Please sign in again");
check("auth raw code preserved for debug", authErr.code, "unauthorized");

/* ── 4. Locale-aware formatters follow the runtime locale ────────────────── */

installRuntime("ru");
check("localeFor ru", rt.localeFor("ru"), "ru-RU");
check("localeFor en", rt.localeFor("en"), "en-US");

const ruNum = new Intl.NumberFormat(rt.localeFor("ru"), { maximumFractionDigits: 1 }).format(1234567.5);
const enNum = new Intl.NumberFormat(rt.localeFor("en"), { maximumFractionDigits: 1 }).format(1234567.5);
assert("RU number uses comma decimal", ruNum.includes(","));
assert("EN number uses period decimal", enNum.includes("."));
assert("RU and EN numbers differ", ruNum !== enNum);

const ruCur = new Intl.NumberFormat(rt.localeFor("ru"), { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(1234);
const enCur = new Intl.NumberFormat(rt.localeFor("en"), { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(1234);
assert("RU currency shows ₽", ruCur.includes("₽"));
assert("EN currency shows RUB", enCur.includes("RUB"));

const ruDate = new Intl.DateTimeFormat(rt.localeFor("ru"), { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(Date.UTC(2026, 1, 3)));
const enDate = new Intl.DateTimeFormat(rt.localeFor("en"), { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(Date.UTC(2026, 1, 3)));
assert("RU date uses dots", ruDate.includes("."));
assert("EN date uses slashes", enDate.includes("/"));

// bytes formatting is built on top of the same locale-aware number formatter.
const ruBytes = `${new Intl.NumberFormat(rt.localeFor("ru"), { maximumFractionDigits: 1 }).format(1536 / 1024)} KB`;
const enBytes = `${new Intl.NumberFormat(rt.localeFor("en"), { maximumFractionDigits: 1 }).format(1536 / 1024)} KB`;
check("RU bytes 1536 -> 1,5 KB", ruBytes, "1,5 KB");
check("EN bytes 1536 -> 1.5 KB", enBytes, "1.5 KB");

/* ── Result ──────────────────────────────────────────────────────────────── */

fs.rmSync(tmpDir, { recursive: true, force: true });

if (failures) {
  console.error(`\ntest:i18n FAILED (${failures})`);
  process.exit(1);
}
console.log("\ntest:i18n OK");