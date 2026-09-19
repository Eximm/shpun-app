#!/usr/bin/env node
// Regression tests for registration error classification + i18n coverage.
//
// The mapper is pure TypeScript, so we bundle it (together with the dictionary)
// with the already-present esbuild and assert against the real translations.
//
// Usage: npm run test:register-errors

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "shpun-register-errors-"));
const outfile = path.join(outDir, "register-errors.mjs");

await build({
  stdin: {
    contents: [
      'export * from "./src/shared/auth/registerErrors.ts";',
      'export { RU, EN } from "./src/shared/i18n/dict.ts";',
    ].join("\n"),
    resolveDir: webRoot,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  outfile,
  logLevel: "silent",
});

const mod = await import(pathToFileURL(outfile).href);
const { registerErrorInfo, classifyRegisterError, emailErrorKey, RU, EN } = mod;

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
  }
}

const t = (key) => key; // identity translator -> returns i18n key

const CASES = [
  // email
  ["email_required", "email", "login.err.email_required"],
  ["email_non_ascii", "email", "login.err.email_non_ascii"],
  ["email_invalid_format", "email", "login.err.email_invalid_format"],
  ["email_local_too_short", "email", "login.err.email_local_too_short"],
  ["email_local_invalid", "email", "login.err.email_local_invalid"],
  ["email_domain_invalid", "email", "login.err.email_domain_invalid"],
  ["email_domain_numeric", "email", "login.err.email_domain_invalid"],
  ["email_domain_not_allowed", "email", "login.err.email_domain_not_allowed"],
  ["login_taken", "email", "login.err.login_taken"],
  ["user_exists", "email", "login.err.login_taken"],
  ["telegram_login_not_allowed_in_regular_register", "email", "login.err.telegram_login_not_allowed"],
  // password
  ["password_too_short", "password", "login.err.password_too_short"],
  ["password_too_short_or_weak", "password", "login.err.password_too_short"],
  ["invalid_password", "password", "login.err.password_invalid"],
  // referral
  ["invalid_referral_alias", "referral", "login.partner.not_found"],
  ["alias_not_found", "referral", "login.partner.not_found"],
  ["referral_not_found", "referral", "login.partner.not_found"],
  // form / server
  ["registration_limited", "form", "login.err.registration_limited"],
  ["network_error", "form", "login.err.register_network"],
  ["shm_register_exception", "form", "login.err.register_unavailable"],
  ["shm_auth_exception", "form", "login.err.register_unavailable"],
  ["shm_auth_unavailable", "form", "login.err.register_unavailable"],
  ["shm_register_failed", "form", "login.err.register_unavailable"],
  // unknown / empty -> registration-specific fallback (never generic)
  ["some_unknown_code", "form", "login.err.register_failed"],
  ["", "form", "login.err.register_failed"],
];

for (const [raw, field, key] of CASES) {
  const info = registerErrorInfo(raw);
  check(`info[${raw || "<empty>"}]`, { field: info.field, key: info.key }, { field, key });
  const classified = classifyRegisterError(raw, t);
  check(`classify[${raw || "<empty>"}]`, { field: classified.field, message: classified.message }, { field, message: key });
}

check("emailErrorKey(unknown)", emailErrorKey("nope"), null);
check("human message passthrough", classifyRegisterError("Понятное сообщение сервера", t), {
  field: "form",
  message: "Понятное сообщение сервера",
});

// Every key we can emit must exist in both locales and must never be the
// generic sign-in message.
const keys = [...new Set(CASES.map(([, , key]) => key))];
for (const key of keys) {
  check(`RU[${key}] exists`, typeof RU[key] === "string" && RU[key].trim().length > 0, true);
  check(`EN[${key}] exists`, typeof EN[key] === "string" && EN[key].trim().length > 0, true);
  check(`key[${key}] not generic`, key === "login.err.generic", false);
}

check("generic is never the registration fallback", registerErrorInfo("totally_unknown").key === "login.err.generic", false);
check(
  "register_failed RU text",
  RU["login.err.register_failed"],
  "Не удалось создать учётную запись. Попробуйте ещё раз."
);
check(
  "register_failed EN text",
  EN["login.err.register_failed"],
  "Could not create the account. Please try again."
);
check("register panel title RU exists", RU["login.register.error.title"].trim().length > 0, true);
check("register panel title EN exists", EN["login.register.error.title"].trim().length > 0, true);

fs.rmSync(outDir, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\nFAIL: ${failures} registration error assertion(s) failed`);
  process.exit(1);
}
console.log("\nOK: registration error mapping + i18n coverage verified");