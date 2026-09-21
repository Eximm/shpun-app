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

const { formatBitrate, formatPct, formatLoad, shouldShowRemnawaveUsers, stateTone, formatDuration, formatIncidentValue, percentCeiling, incidentRuleKey, incidentMetricKey } = await import(pathToFileURL(outfile).href);

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
check("pct above 100 is preserved", formatPct(150), "150%");

check("load 0 -> 0", formatLoad(0), "0");
check("load 0.0123 -> 0.01", formatLoad(0.0123), "0.01");
check("load null -> dash", formatLoad(null), "—");

check("remnawave users shown for mapped real zero", shouldShowRemnawaveUsers(true, 0), true);
check("remnawave users hidden when unknown", shouldShowRemnawaveUsers(true, null), false);
check("remnawave users hidden when unmapped", shouldShowRemnawaveUsers(false, 5), false);

check("state fresh -> ok", stateTone("fresh"), "ok");
check("state stale -> warn", stateTone("stale"), "warn");
check("state offline -> bad", stateTone("offline"), "bad");
check("state no_data -> soft (never green)", stateTone("no_data"), "soft");
check("state null -> soft", stateTone(null), "soft");

check("duration 300s -> 5m", formatDuration(300), "5m 0s");
check("incident value 0 is zero, not dash", formatIncidentValue(0, "percent"), "0%");
check("incident value null -> dash", formatIncidentValue(null, "percent"), "—");
check("percent ceiling stays 100 for small values", percentCeiling(17), 100);
check("percent ceiling stays 100 at 100", percentCeiling(100), 100);
check("percent ceiling expands above 100", percentCeiling(120), 125);
check("percent ceiling expands for 184", percentCeiling(184), 200);
check("rule label maps only real rule types", incidentRuleKey("uplink_saturation"), "admin.monitoring.incident.rule.uplink");
check("unknown rule type falls back safely", incidentRuleKey("made_up"), "admin.monitoring.incident.rule.unknown");
check("uplink incident maps to the uplink graph", incidentMetricKey("uplink_saturation"), "uplink");
check("offline incident has no metric graph", incidentMetricKey("offline"), null);

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

// Stabilization: stale-while-revalidate mutation flow + explicit force check.
assert("loader uses Promise.allSettled (partial failure keeps data)", src.includes("Promise.allSettled"));
assert("loader never clears the list", !src.includes("setItems([])"));
assert("mutations revalidate silently", src.includes("loadAll({ silent: true })"));
assert("explicit force-check endpoint is separate", src.includes("/admin/monitoring/collect-now"));
assert("compact row uses the explicit persisted state", src.includes("currentStateChip(current?.state)"));
assert("polling only refetches persisted state", src.includes("setInterval(() => void loadAll({ silent: true })"));
assert("collector observability surfaced", src.includes("admin.monitoring.collector.title"));

const shared = fs.readFileSync(path.join(webRoot, "src", "pages", "admin", "shared.tsx"), "utf8");
const actionMenu = fs.readFileSync(path.join(webRoot, "src", "pages", "admin", "ActionMenu.tsx"), "utf8");
assert("modal captures viewport before locking", shared.includes("const scrollY = window.scrollY"));
assert("modal restores the exact viewport", shared.includes("window.scrollTo({ left: scrollX, top: scrollY"));
assert("modal restores focus without scrolling", shared.includes("preventScroll: true"));
assert("modal lock effect is stable across renders", shared.includes("onCloseRef.current"));

// Mobile interaction model: explicit chevron + separate actions menu.
assert("explicit chevron control exists", src.includes("mon-row__chevron") && src.includes("aria-controls={`mon-detail-${item.id}`}"));
assert("card header exposes aria-expanded", src.includes("aria-expanded={expanded}"));
assert("overflow button opens the action menu without expanding", src.includes("setActionAnchor(e.currentTarget)"));
assert("actions stop propagation", src.includes("mon-row__overflow") && src.includes("onClick={(e) => e.stopPropagation()}"));
assert("focus restore after menu uses preventScroll", src.includes("preventScroll: true"));
assert("action menu is a viewport-aware portal", actionMenu.includes("createPortal") && actionMenu.includes("getBoundingClientRect") && actionMenu.includes("window.innerHeight"));

// Global incidents + graph integration.
assert("global incidents section wired in", src.includes("<MonitoringIncidents") && src.includes("openIncident"));
assert("summary incident cards are clickable", src.includes("focusIncidents") && src.includes("mon-summary__stat is-clickable"));
assert("compact row shows the top active issue", src.includes("mon-row__issue") && src.includes("globalActive.filter"));
assert("incident click targets the server card", src.includes("mon-server-${inc.serverId}"));
assert("graph focuses the incident metric", src.includes("incidentMetricKey(inc.ruleType)"));
assert("uplink diagnostics show the capacity source", src.includes("admin.monitoring.capacity.source") && src.includes("admin.monitoring.metric.capacity"));
assert("above-100 hint is wired", src.includes("admin.monitoring.graph.above100"));

const graph = fs.readFileSync(path.join(webRoot, "src", "pages", "admin", "MonitoringGraph.tsx"), "utf8");
assert("graph has percentage-anchored ceilings", graph.includes("percentCeiling"));
assert("graph renders threshold lines", graph.includes("mon-graph__thresholdLine"));
assert("graph renders incident intervals", graph.includes("mon-graph__incident"));
assert("graph has a time axis", graph.includes("formatAxisTime"));
assert("graph has a tooltip", graph.includes("mon-graph__tooltip"));
assert("graph includes the uplink metric", graph.includes('key: "uplink"'));
assert("graph gaps on null samples", graph.includes("segments"));

const css = fs.readFileSync(path.join(webRoot, "src", "index.css"), "utf8");
assert("mobile single-column details", css.includes(".mon-detail { grid-template-columns: 1fr; }"));
assert("safe-area bottom padding for the bottom nav", css.includes("var(--nav-h) + env(safe-area-inset-bottom)"));
assert("no horizontal overflow guard", css.includes(".admin-stack, .mon-row, .mon-detail, .mon-graph, .mon-kv, .mon-incidentCard { min-width: 0; }"));

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nOK: compact monitoring rows + formatters verified");