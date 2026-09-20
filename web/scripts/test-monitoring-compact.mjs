#!/usr/bin/env node
// Regression for the admin Monitoring compact rows.
//
// Verifies:
//   1. Shared formatters: null -> "—", zero -> "0" (never "—"), auto units.
//   2. Remnawave users are shown only when mapped AND the value is known.
//   3. Compact rows read `item.current` (the list snapshot) instead of gating
//      metrics on expansion.
//   4. Mobile action buttons collapse into an overflow menu.
//   5. Expanded diagnostics/history still exist.
//
// Usage: npm run test:monitoring-compact

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "shpun-mon-compact-"));
const outfile = path.join(outDir, "format.mjs");

await build({
  stdin: {
    contents: 'export * from "./src/pages/admin/monitoringFormat.ts";',
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

const { formatBitrate, formatPct, formatLoad, shouldShowRemnawaveUsers } = await import(pathToFileURL(outfile).href);

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

/* ── Formatters ──────────────────────────────────────────────────────────── */

check("bitrate 0.67 -> Mbps", formatBitrate(0.67), "0.67 Mbps");
check("bitrate 0.842 -> Mbps", formatBitrate(0.842), "0.84 Mbps");
check("bitrate 0.02 -> Kbps", formatBitrate(0.02), "20 Kbps");
check("bitrate 1500 -> Gbps", formatBitrate(1500), "1.5 Gbps");
check("bitrate 0 is a real value", formatBitrate(0), "0 Kbps");
check("bitrate null -> dash", formatBitrate(null), "—");
check("bitrate undefined -> dash", formatBitrate(undefined), "—");

check("pct 0 -> 0%", formatPct(0), "0%");
check("pct 52.4 -> 52.4%", formatPct(52.4), "52.4%");
check("pct null -> dash", formatPct(null), "—");

check("load 0 -> 0", formatLoad(0), "0");
check("load 0.0123 -> 0.01", formatLoad(0.0123), "0.01");
check("load null -> dash", formatLoad(null), "—");

check("remnawave users shown for mapped real zero", shouldShowRemnawaveUsers(true, 0), true);
check("remnawave users hidden when unknown", shouldShowRemnawaveUsers(true, null), false);
check("remnawave users hidden when unmapped", shouldShowRemnawaveUsers(false, 5), false);

/* ─ Component wiring (static) ───────────────────────────────────────────── */

const src = fs.readFileSync(path.join(webRoot, "src", "pages", "admin", "ServerStatusSection.tsx"), "utf8");

assert(
  "compact row reads item.current from the list snapshot",
  src.includes("const current = expanded ? detail?.current ?? item.current ?? null : item.current ?? null"),
);
assert(
  "old expand-gated metrics pattern is gone",
  !src.includes("const current = expanded ? detail?.current ?? null : null"),
);
assert("compact uses shared formatBitrate", src.includes("formatBitrate(current?.rxMbps)"));
assert("compact uses shared formatLoad", src.includes('formatLoad(current?.load1)'));
assert("compact does not hardcode Mbps decimals", !src.includes("rxMbps.toFixed(1)"));
assert("remnawave users gated by mapping helper", src.includes("shouldShowRemnawaveUsers(Boolean(item.remnawave_node_uuid), users)"));
assert("mobile actions use an overflow menu", src.includes("mon-row__overflow") && src.includes('aria-haspopup="menu"'));
assert("desktop actions kept separate", src.includes("mon-row__actions--desktop"));
assert("expanded diagnostics still present", src.includes("admin.monitoring.section.history") && src.includes("mon-detail"));
assert("expansion still lazy-loads detail", src.includes("/admin/monitoring/servers/${id}/detail"));

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nOK: compact monitoring rows + formatters verified");