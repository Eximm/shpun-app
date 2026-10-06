#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const login = fs.readFileSync(path.join(root, "src/pages/Login.tsx"), "utf8");
const dict = fs.readFileSync(path.join(root, "src/shared/i18n/dict.ts"), "utf8");

let failures = 0;
function assert(name, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} ${name}`);
  if (!condition) failures += 1;
}

assert(
  "forgot success is not restored from stale localStorage",
  login.includes("const [forgotSent,     setForgotSent]     = useState(false);")
    && !login.includes("wasForgotSent"),
);
assert(
  "opening password recovery starts from the form",
  /if \(next === "forgot"\) \{\s*setForgotSent\(false\);/.test(login),
);

const handlerStart = login.indexOf("async function forgotPassword()");
const handlerEnd = login.indexOf("// ── Telegram", handlerStart);
const handler = login.slice(handlerStart, handlerEnd);
const requestAt = handler.indexOf('await apiFetch("/auth/password-reset"');
const sentAt = handler.indexOf("setForgotSent(true)");
const catchAt = handler.indexOf("} catch {");

assert("sent screen follows the current request", requestAt >= 0 && sentAt > requestAt);
assert("sent screen is not entered from finally", sentAt >= 0 && catchAt > sentAt);
assert("network failure keeps the form and explains retry", handler.includes('toast.error(t("login.forgot.failed"))'));
assert(
  "password recovery failure is translated",
  (dict.match(/"login\.forgot\.failed"/g) ?? []).length === 2,
);

if (failures) {
  console.error(`\nFAILED: ${failures} password-reset check(s)`);
  process.exit(1);
}

console.log("\nOK: password recovery only confirms a completed request");
