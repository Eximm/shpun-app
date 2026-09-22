#!/usr/bin/env node
// Regression for the admin Monitoring compact rows.
//
// Verifies:
//   1. Shared formatters: null -> "—", zero -> "0" (never "—"), auto units.
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
// Windows checkouts may carry CRLF. Normalize line endings once so that
// multiline `includes(...)` assertions behave identically on every OS.
const readNormalized = (relPath) =>
  fs.readFileSync(path.join(webRoot, relPath), "utf8").replace(/\r\n?/g, "\n");
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

const { formatBitrate, formatPct, formatLoad, stateTone, formatDuration, formatIncidentValue, percentCeiling, incidentRuleKey, incidentMetricKey } = await import(pathToFileURL(outfile).href);

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

const src = readNormalized("src/pages/admin/ServerStatusSection.tsx");

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
assert("mobile actions use an overflow menu", src.includes("mon-row__overflow") && src.includes('aria-haspopup="menu"'));
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
assert("top panel uses grouped dashboard panels", src.includes("mon-dashboard") && src.includes("mon-panel__label"));
assert("action toolbar is one grouped control row", src.includes("mon-toolbar") && src.includes("mon-btn--quiet"));
assert("server summary is one grouped block", src.includes("mon-panel__big") && src.includes("mon-panel__sub"));
assert("collector status is a compact operational row", src.includes("mon-collectorRow") && src.includes("mon-statusDot"));
assert("collapsed card uses compact metrics, not gauges", !src.includes("Gauge") && src.includes("mon-metric") && src.includes("mon-row__traffic"));

const shared = readNormalized("src/pages/admin/shared.tsx");
const actionMenu = readNormalized("src/pages/admin/ActionMenu.tsx");
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
assert("summary incident cards are clickable", src.includes("focusIncidents") && src.includes("mon-stat"));
assert("compact row shows the top active issue", src.includes("mon-row__issue") && src.includes("globalActive.filter"));
assert("incident click targets the server card", src.includes("mon-server-${inc.serverId}"));
assert("graph focuses the incident metric", src.includes("incidentMetricKey(inc.ruleType)"));
assert("uplink diagnostics show the capacity source", src.includes("admin.monitoring.capacity.source") && src.includes("admin.monitoring.metric.capacity"));
assert("above-100 hint is wired", src.includes("admin.monitoring.graph.above100"));

const graph = readNormalized("src/pages/admin/MonitoringGraph.tsx");
assert("graph has percentage-anchored ceilings", graph.includes("percentCeiling"));
assert("graph renders threshold lines", graph.includes("mon-graph__thresholdLine"));
assert("graph renders incident intervals", graph.includes("mon-graph__incident"));
assert("graph has a time axis", graph.includes("formatAxisTime"));
assert("graph has a tooltip", graph.includes("mon-graph__tooltip"));
assert("graph includes the uplink metric", graph.includes('key: "uplink"'));
assert("graph gaps on null samples", graph.includes("segments"));

const css = readNormalized("src/index.css");
const incidentsComp = readNormalized("src/pages/admin/MonitoringIncidents.tsx");
assert("mobile single-column details", css.includes(".mon-detail { grid-template-columns: 1fr; }"));
assert("safe-area bottom padding for the bottom nav", css.includes("var(--nav-h) + env(safe-area-inset-bottom)"));
assert("no horizontal overflow guard", css.includes(".admin-stack, .mon-row, .mon-detail, .mon-graph, .mon-kv, .mon-incidentCard { min-width: 0; }"));
assert("dashboard groups side-by-side on wide screens", css.includes("grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr)") && css.includes("mon-panel--collector"));
assert("old summary tiles and gauges removed", !css.includes(".mon-summary__stat") && !css.includes(".mon-gauge"));
assert("collapsed card has compact metric + traffic rows", css.includes(".mon-metric") && css.includes(".mon-row__traffic"));
assert("metric pills separate label and value", css.includes(".mon-metric__label") && css.includes(".mon-metric__value"));
assert("traffic row has distinct tokens", css.includes(".mon-traffic__value") && css.includes(".mon-fresh"));
assert("toolbar buttons share one height", css.includes(".mon-toolbar .btn { min-height: 36px; height: 36px;"));

// Mobile-only composition (desktop pills retained).
assert("mobile top summary is one bounded block", css.includes(".mon-dashboard {\n    gap: 0;") && css.includes("border-top: 1px solid var(--border);"));
assert("mobile toolbar collapses refresh to an icon", css.includes(".mon-toolbar .mon-btn--quiet .mon-btn__text { display: none; }") && css.includes('.mon-toolbar .mon-btn--quiet::before { content: "↻"'));
assert("mobile metrics drop bordered pills", css.includes(".mon-row__metrics .mon-metric,\n  .mon-row__traffic .mon-metric {"));
assert("mobile badges become separator text", css.includes(".mon-row__badges .chip + .chip::before") && css.includes('content: "·"'));
assert("desktop metric pills are retained", css.includes("border: 1px solid var(--border); border-radius: 8px;"));
assert("mobile collapsed card keeps 3-4 logical rows", css.includes(".mon-row__main { padding: 9px 10px; gap: 5px; }") && src.includes("mon-row__metrics") && src.includes("mon-row__traffic"));

// Mobile mini-dashboard composition.
assert("mobile card is a 4-zone grid", css.includes('"title  title  title  title  chev   more"') && css.includes('"rx     rx     tx     tx     uplink uplink"'));
assert("mobile actions live in the header zone", css.includes(".mon-row__chevron { grid-area: chev") && css.includes(".mon-row__overflow { grid-area: more"));
assert("mobile freshness sits in the meta row", css.includes(".mon-fresh { grid-area: fresh"));
assert("mobile system metrics use a 4-column grid", css.includes("grid-template-columns: repeat(4, minmax(0, 1fr))"));
assert("mobile network uses rx/tx/uplink areas", css.includes(".mon-row__traffic > .mon-traffic:nth-child(1) { grid-area: rx; }") && css.includes(".mon-row__traffic > .mon-metric { grid-area: uplink; }"));
assert("mobile percentage metrics have a thin accent bar", css.includes(".mon-metric__barFill") && css.includes(".mon-metric.is-warn .mon-metric__barFill"));
assert("desktop hides the mobile bar and traffic labels", css.includes(".mon-metric__bar { display: none; }") && css.includes(".mon-traffic__label { display: none; }"));
assert("no plain-text wall: label/value spans kept", src.includes("mon-metric__label") && src.includes("mon-metric__value") && src.includes("mon-traffic__value"));

// Incident/history mobile isolation + richer history.
assert("incident meta no longer refuses to wrap", !css.includes(".mon-incident__meta { color: var(--muted); font-size: 11px; white-space: nowrap; }"));
assert("detail grid children can shrink", css.includes(".mon-detail > * { min-width: 0; }"));
assert("incident and history sections are separated on mobile", css.includes(".mon-detail__section + .mon-detail__section"));
assert(
  "history section spans the detail grid so graphs get real width",
  css.includes(".mon-detail__section--history { grid-column: 1 / -1; container-type: inline-size; container-name: mon-history; }"),
);
assert(
  "history graphs switch to two columns by container width",
  css.includes("@container mon-history (min-width: 560px)") && css.includes("grid-template-columns: repeat(2, minmax(0, 1fr));"),
);
assert("history graph layout has a no-container-query fallback", css.includes("@supports not (container-type: inline-size)"));
assert("history section carries the responsive modifier", src.includes("mon-detail__section mon-detail__section--history"));
assert("history shows peak and threshold", incidentsComp.includes("incident.peak") && incidentsComp.includes("incident.threshold"));
assert("active incidents distinguish was/now", incidentsComp.includes("incident.was") && incidentsComp.includes("incident.now"));
assert("history marks the final state", incidentsComp.includes("incident.state.resolved"));
assert("uplink diagnostics collapse into details", incidentsComp.includes("UplinkDiagnostics") && incidentsComp.includes("mon-incidentCard__details"));
assert("cards are not nested buttons", incidentsComp.includes("mon-incidentCard__main"));

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nOK: compact monitoring rows + formatters verified");