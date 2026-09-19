#!/usr/bin/env node
// Regression tests for the client referral capture layer.
//
// The module under test is plain TypeScript with no runtime dependencies, so we
// transpile it with the already-present esbuild and import the result. This keeps
// the test runnable on any Node version the web build supports.
//
// Usage: npm run test:referral

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");
const entry = path.join(webRoot, "src", "shared", "referrals", "capture.ts");

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "shpun-referral-capture-"));
const outfile = path.join(outDir, "capture.mjs");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  logLevel: "silent",
});

// Minimal localStorage/window shim so bootstrap capture can be tested.
function installWindow(initialHref, storage) {
  const store = storage ?? new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const state = { url: new URL(initialHref).pathname + new URL(initialHref).search + new URL(initialHref).hash };
  globalThis.window = {
    location: { href: initialHref, search: new URL(initialHref).search, hash: new URL(initialHref).hash },
    localStorage,
    history: {
      replaceState: (_s, _t, url) => {
        state.url = String(url);
        globalThis.window.location = {
          href: `https://app.shpun.net${url}`,
          search: new URL(`https://app.shpun.net${url}`).search,
          hash: new URL(`https://app.shpun.net${url}`).hash,
        };
      },
    },
    __state: state,
  };
  return store;
}

const mod = await import(pathToFileURL(outfile).href);

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

/* 1. Canonical bare alias link */
check("bare ?alias", mod.parseReferralFromHref("https://app.shpun.net/?druni4"), { partnerId: 0, alias: "druni4" });

/* 2. ?ref= and ?referral= and ?alias= */
check("?ref=", mod.parseReferralFromHref("https://app.shpun.net/?ref=druni4"), { partnerId: 0, alias: "druni4" });
check("?referral=", mod.parseReferralFromHref("https://app.shpun.net/?referral=druni4"), { partnerId: 0, alias: "druni4" });
check("?alias=", mod.parseReferralFromHref("https://app.shpun.net/?alias=druni4"), { partnerId: 0, alias: "druni4" });

/* 3. Legacy numeric partner link */
check("?partner_id=", mod.parseReferralFromHref("https://app.shpun.net/?partner_id=777"), { partnerId: 777, alias: "" });
check(
  "?partner_id= plus alias",
  mod.parseReferralFromHref("https://app.shpun.net/?partner_id=777&ref=druni4"),
  { partnerId: 777, alias: "druni4" }
);

/* 4. Digit-leading alias must still be captured */
check("digit-leading alias", mod.parseReferralFromHref("https://app.shpun.net/?4you"), { partnerId: 0, alias: "4you" });

/* 5. Unrelated query params are NOT treated as an alias */
check("assistant param", mod.parseReferralFromHref("https://app.shpun.net/?assistant=1"), { partnerId: 0, alias: "" });
check("payment param", mod.parseReferralFromHref("https://app.shpun.net/?payment=success"), { partnerId: 0, alias: "" });
check("token param", mod.parseReferralFromHref("https://app.shpun.net/login?token=abc123"), { partnerId: 0, alias: "" });
check("no params", mod.parseReferralFromHref("https://app.shpun.net/"), { partnerId: 0, alias: "" });

/* 6. Invalid alias shapes are ignored */
check("too short", mod.parseReferralFromHref("https://app.shpun.net/?a"), { partnerId: 0, alias: "" });
check("has spaces", mod.parseReferralFromHref("https://app.shpun.net/?bad%20alias"), { partnerId: 0, alias: "" });

/* 7. Hash query fallback */
check(
  "hash query",
  mod.parseReferralFromHref("https://app.shpun.net/#/login?ref=druni4"),
  { partnerId: 0, alias: "druni4" }
);

/* 8. Persistence: capture survives and is readable */
const store = installWindow("https://app.shpun.net/?druni4", null);
mod.captureReferralFromLocation();
check("persisted alias", mod.readPendingReferralAlias(), "druni4");
check("no partner persisted", mod.readPendingPartnerId(), 0);

/* 9. Ordinary visit must NOT clobber an existing attribution */
installWindow("https://app.shpun.net/?assistant=1", store);
mod.captureReferralFromLocation();
check("attribution survives ordinary visit", mod.readPendingReferralAlias(), "druni4");

/* 10. A new referral link overwrites the previous one (last-touch) */
installWindow("https://app.shpun.net/?newpartner", store);
mod.captureReferralFromLocation();
check("new link overwrites alias", mod.readPendingReferralAlias(), "newpartner");

/* 11. Numeric persistence + payload builder drops empty/invalid values */
mod.savePendingPartnerId(777);
check("persist partner id", mod.readPendingPartnerId(), 777);
check("payload valid", mod.buildReferralPayload(777, "druni4"), { partner_id: 777, referral_alias: "druni4" });
check("payload no referral", mod.buildReferralPayload(0, ""), {});
check("payload drops invalid alias", mod.buildReferralPayload(0, "  "), {});
check("payload numeric string partner", mod.buildReferralPayload("777", "x1"), { partner_id: 777, referral_alias: "x1" });

/* 12. clear helpers */
mod.clearPendingPartnerId();
mod.clearPendingReferralAlias();
check("cleared partner", mod.readPendingPartnerId(), 0);
check("cleared alias", mod.readPendingReferralAlias(), "");

/* 13. Manual override replaces the referral in the URL (manual wins) */
installWindow("https://app.shpun.net/login?druni4&e=not_authenticated", store);
mod.replaceReferralInUrl("partner", "777");
check(
  "manual numeric overrides url alias",
  mod.parseReferralFromHref(globalThis.window.location.href),
  { partnerId: 777, alias: "" }
);
check("unrelated params preserved", globalThis.window.location.search.includes("e=not_authenticated"), true);

mod.replaceReferralInUrl("alias", "newref");
check(
  "manual alias overrides url partner",
  mod.parseReferralFromHref(globalThis.window.location.href),
  { partnerId: 0, alias: "newref" }
);

fs.rmSync(outDir, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\nFAIL: ${failures} referral capture assertion(s) failed`);
  process.exit(1);
}
console.log("\nOK: referral capture layer behaves as expected");