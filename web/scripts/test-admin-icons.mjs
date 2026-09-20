#!/usr/bin/env node
// Static checks for the admin icon registry: every admin section has a
// canonical icon, activity event types resolve to a canonical icon, and the
// "one entity -> one icon" mapping is stable.
//
// Usage: npm run test:admin-icons

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "shpun-admin-icons-"));
const outfile = path.join(outDir, "icons.mjs");

await build({
  stdin: {
    contents: [
      'export { ADMIN_SECTION_ICON, activityIconName } from "./src/pages/admin/adminIconMap.ts";',
      'export { AdminSectionIcon } from "./src/pages/admin/icons.tsx";',
      'export { ADMIN_TABS } from "./src/pages/admin/types.ts";',
    ].join("\n"),
    resolveDir: webRoot,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  jsx: "automatic",
  outfile,
  logLevel: "silent",
});

const { ADMIN_SECTION_ICON, activityIconName, AdminSectionIcon, ADMIN_TABS } = await import(pathToFileURL(outfile).href);

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

// Every admin tab has a canonical icon.
for (const tab of ADMIN_TABS) {
  check(`section icon [${tab}]`, typeof ADMIN_SECTION_ICON[tab], "string");
}

// Canonical one-entity-one-icon mapping (must stay stable across the app).
check("support -> lifebuoy", ADMIN_SECTION_ICON.support, "lifebuoy");
check("reviews -> star", ADMIN_SECTION_ICON.reviews, "star");
check("serverStatus -> server", ADMIN_SECTION_ICON.serverStatus, "server");
check("referralAliases -> share", ADMIN_SECTION_ICON.referralAliases, "share");
check("broadcasts -> megaphone", ADMIN_SECTION_ICON.broadcasts, "megaphone");
check("trialProtection -> shield", ADMIN_SECTION_ICON.trialProtection, "shield");
check("overview -> dashboard", ADMIN_SECTION_ICON.overview, "dashboard");

// Unique icons per section (no accidental duplicates).
const sectionIcons = ADMIN_TABS.map((tab) => ADMIN_SECTION_ICON[tab]);
check("section icons are unique", new Set(sectionIcons).size, sectionIcons.length);

// Activity event types map to canonical icons.
check("activity support.ticket", activityIconName("support.ticket"), "lifebuoy");
check("activity partnership.ticket", activityIconName("partnership.ticket"), "handshake");
check("activity review.new", activityIconName("review.new"), "star");
check("activity referral.registration", activityIconName("referral.registration"), "share");
check("activity unknown fallback", activityIconName("something.else"), "activity");

// The component resolves every canonical name (no empty render).
for (const name of new Set([...sectionIcons, "activity", "clock", "refresh", "check", "handshake"])) {
  check(`icon renders [${name}]`, Boolean(AdminSectionIcon({ name })), true);
}

fs.rmSync(outDir, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\nFAIL: ${failures} admin icon assertion(s) failed`);
  process.exit(1);
}
console.log("\nOK: admin icon registry is canonical");