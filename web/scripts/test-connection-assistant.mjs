#!/usr/bin/env node
// Regression guard for the complete first-client connection assistant.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(webRoot, rel), "utf8").replace(/\r\n?/g, "\n");

const assistant = read("src/pages/ConnectionAssistant.tsx");
const order = read("src/pages/ServicesOrder.tsx");
const services = read("src/pages/Services.tsx");
const connector = read("src/pages/connect/ConnectMarzban.tsx");
const authGate = read("src/app/auth/AuthGate.tsx");
const appShell = read("src/main.tsx");
const emailState = read("src/shared/emailVerificationState.ts");
const dict = read("src/shared/i18n/dict.ts");

let failures = 0;
function assert(name, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} ${name}`);
  if (!condition) failures += 1;
}

/* Entry and prompt ordering. */
assert("assistant route exists", appShell.includes('<Route path="/assistant"'));
assert("assistant hides bottom navigation and global prompts", appShell.includes("const hideNav") && appShell.includes("assistantFlow") && appShell.includes("<PwaInstallPrompt enabled={!hideNav}"));
assert("profile onboarding is suppressed inside assistant", authGate.includes("needsFirstLoginOnboarding && !assistantFlow"));
assert("bonus prompt is suppressed inside assistant", authGate.includes("showFirstPayBonus && !assistantFlow"));
assert("push prompt is suppressed inside assistant", authGate.includes("!showFirstPayBonus && !assistantFlow && pushPromptOpen"));

/* Email save and verification continuity. */
assert("assistant reuses the billing-backed email modal", assistant.includes("<EmailVerifyModal"));
assert("saving email requests a code", assistant.includes('apiFetch("/user/email/send-code"'));
assert("sent-code state is persisted", assistant.includes("markPendingEmailVerification()") && emailState.includes("localStorage.setItem(EMAIL_CODE_SENT_KEY"));
assert("changing email clears the old code state", assistant.includes("clearPendingEmailVerification()"));
assert("email step has back and later exits", assistant.includes("onBack={") && assistant.includes("onLater={snooze}"));

/* Ordering, payment, service creation and subscription readiness. */
assert("device choice keeps assistant mode", assistant.includes("&assistant=1&device="));
assert("order continuation keeps the created service id", order.includes("/assistant?usi=${encodeURIComponent(String(created.userServiceId))}"));
assert("payment return targets the assistant", assistant.includes('return: "/assistant"'));
assert("payment state is polled after returning", order.includes("window.setInterval(check, 4000)") && /window\.addEventListener\(["']focus["'], check\)/.test(order));
assert("pending service stays on the waiting screen", assistant.includes('status === "pending" || status === "init"'));
assert("active Flex waits for a real subscription URL", assistant.includes("subscriptionReadyUsi !== current.userServiceId") && assistant.includes("subscriptionUrl"));
assert("connector opens only after subscription readiness", assistant.includes("/services?usi=${encodeURIComponent(String(current.userServiceId))}&connect=1&assistant=1"));

/* Guided connector and safe exits. */
assert("connector remembers step A or B", connector.includes("assistantStepKey") && connector.includes("sessionStorage.setItem(assistantStepKey"));
assert("each connector step scrolls into view", connector.includes("installStepRef") && connector.includes("importStepRef") && connector.includes("scrollIntoView"));
assert("assistant has explicit install and import actions", connector.includes('t("connect.assistant.download_happ")') && connector.includes('t("connect.assistant.import_key")'));
assert("connector offers an exit to Home", services.includes('t("assistant.connect.exit")') && services.includes('window.location.assign("/home")'));
assert("waiting screens offer an exit to Home", assistant.includes("onClick={exitToHome}"));
assert("finish screen can leave the assistant", services.includes('t("assistant.finish.done")') && services.includes('window.location.assign("/home")'));
assert("optional mobile key reminder remains", services.includes('t("assistant.finish.mobile_key.button")'));

/* Required localized copy exists in both dictionaries. */
for (const key of [
  "assistant.offer.title",
  "assistant.email.verify_title",
  "assistant.wait.subscription_title",
  "assistant.connect.exit",
  "connect.assistant.install_title",
  "connect.assistant.import_title",
]) {
  const occurrences = dict.split(`"${key}"`).length - 1;
  assert(`${key} exists in RU and EN`, occurrences === 2);
}

if (failures) {
  console.error(`\nFAILED: ${failures} connection-assistant regression check(s)`);
  process.exit(1);
}

console.log("\nOK: complete connection-assistant route is guarded");
