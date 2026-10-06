#!/usr/bin/env node
// Regression for the operator Monitoring layout model.
//
// Concept: infrastructure type -> operator order -> problems.
// No per-metric sort modes (CPU/RAM/Disk/Traffic stay indicators).
//
// Usage: npm run test:monitoring-layout

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(webRoot, rel), "utf8").replace(/\r\n?/g, "\n");

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "shpun-mon-layout-"));
const outfile = path.join(outDir, "layout.mjs");
await build({
  stdin: {
    contents: 'export * from "./src/pages/admin/monitoringLayout.ts";',
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

const L = await import(pathToFileURL(outfile).href);
const section = read("src/pages/admin/ServerStatusSection.tsx");
const moduleSrc = read("src/pages/admin/monitoringLayout.ts");
const css = read("src/index.css");

let failures = 0;
function ok(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond) failures++;
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(`${name}${a === e ? "" : ` (expected ${e}, got ${a})`}`, a === e);
}

const node = (id, title, health = "healthy") => ({ id, title, health });

/* ── A. grouped by real server type ───────────────────────────────────────── */

eq("A1 default type order = gateway, infra, vpn", L.DEFAULT_TYPE_ORDER, ["gateway", "infra", "vpn"]);
eq(
  "A2 group order follows saved type order, unknown kinds last",
  L.normalizeTypeOrder(["vpn", "infra", "gateway"], ["gateway", "infra", "vpn"]),
  ["vpn", "infra", "gateway"],
);
eq("A3 grouping keeps nodes of each kind together", L.orderGroups([
  { kind: "vpn", nodes: [node(1, "Moscow"), node(2, "Warsaw")] },
  { kind: "gateway", nodes: [node(3, "RU Gateway")] },
], "manual", ["gateway", "infra", "vpn"]).map((g) => g.kind), ["gateway", "vpn"]);

/* ── B. type order configurable ───────────────────────────────────────────── */

eq("B1 move a type up/down", L.moveInList(["gateway", "infra", "vpn"], 0, 2), ["infra", "vpn", "gateway"]);
eq("B2 move type to start", L.reorderById(["gateway", "infra", "vpn"], "vpn", "start"), ["vpn", "gateway", "infra"]);

/* ── C. type order persists reload ────────────────────────────────────────── */

eq("C1 sanitized type order round-trips through JSON", L.sanitizeTypeOrder(JSON.parse(JSON.stringify(["infra", "vpn"]))), ["infra", "vpn"]);
ok("C2 component persists type order", section.includes("writeLayoutJson(TYPE_ORDER_KEY") && section.includes("readLayoutJson(TYPE_ORDER_KEY"));

/* ── D. node order inside type configurable ───────────────────────────────── */

eq("D1 reorder node to start", L.reorderWithinType({}, "vpn", ["1", "2", "3"], "2", "start"), { vpn: ["2", "1", "3"] });
eq("D2 reorder node down", L.reorderWithinType({ vpn: ["1", "2", "3"] }, "vpn", ["1", "2", "3"], "1", "down"), { vpn: ["2", "1", "3"] });

/* ── E. node order persists ───────────────────────────────────────────────── */

eq("E1 node order sanitizes corruption", L.sanitizeNodeOrder({ vpn: ["1", "1", "2", null, ""] }), { vpn: ["1", "2"] });
ok("E2 component persists node order", section.includes("writeLayoutJson(NODE_ORDER_KEY") && section.includes("readLayoutJson(NODE_ORDER_KEY"));

/* ── F. node cannot change backend type ───────────────────────────────────── */

ok("F1 cross-kind reorder is rejected", L.canReorderAcrossKinds("vpn", "gateway") === false && L.canReorderAcrossKinds("vpn", "vpn") === true);
eq("F2 drop across kinds is a no-op", L.dropWithinType({ vpn: ["1", "2"] }, "vpn", "gateway", ["1", "2"], "1", "9"), { vpn: ["1", "2"] });
ok("F3 component guards drops by kind and never writes item.kind", section.includes("canReorderAcrossKinds(") && !/reorderNode[\s\S]{0,200}kind\s*=[^=]/.test(section));

/* ── G. problems first keeps type/manual ordering ─────────────────────────── */

eq(
  "G1 nodes sort critical > warning > healthy, manual within a tier",
  L.orderNodesWithinType([node(1, "A", "healthy"), node(2, "B", "critical"), node(3, "C", "warning")], "problems", []).map((n) => n.id),
  [2, 3, 1],
);
eq(
  "G2 problematic groups float while type order is preserved",
  L.orderGroups([
    { kind: "gateway", nodes: [node(1, "GW", "healthy")] },
    { kind: "vpn", nodes: [node(2, "VPN", "critical")] },
  ], "problems", ["gateway", "infra", "vpn"]).map((g) => g.kind),
  ["vpn", "gateway"],
);
eq("G3 worst tier helper", L.worstHealthTier(["healthy", "warning", "healthy"]), "warning");

/* ── H/I/J. search, type filter, collapse (integration) ───────────────────── */

ok("H1 search looks across all kinds (no kind gate before search)", section.includes('const hay = `${item.title} ${item.host}') && section.includes("if (!hay.includes(q)) return false;"));
ok("I1 type filter is applied", section.includes("typeFilter !== \"all\" && item.kind !== typeFilter"));
ok("J1 groups collapse via localStorage-backed state", section.includes("COLLAPSED_TYPES_KEY") && section.includes("toggleTypeCollapsed") && section.includes("? \"⌄\" : \"⌃\""));

/* ── K/L. new node / new type appended safely ─────────────────────────────── */

eq("K1 unseen node is appended to the manual order", L.reorderWithinType({ vpn: ["1"] }, "vpn", ["1", "2"], "1", "down"), { vpn: ["2", "1"] });
eq("L1 new type is appended at the end", L.normalizeTypeOrder(["gateway"], ["gateway", "infra", "vpn"]), ["gateway", "infra", "vpn"]);

/* ── M. removed node/type ─────────────────────────────────────────────────── */

eq("M1 removed type is dropped from saved order", L.normalizeTypeOrder(["gateway", "legacy"], ["gateway", "vpn"]), ["gateway", "vpn"]);
eq("M2 removed node is pruned from persisted order", L.pruneNodeOrder({ vpn: ["1", "9"], gateway: ["3"] }, ["1", "3"]), { vpn: ["1"], gateway: ["3"] });

/* ── N. localStorage corruption safe ──────────────────────────────────────── */

eq("N1 non-array type order falls back", L.sanitizeTypeOrder("garbage"), L.DEFAULT_TYPE_ORDER);
eq("N2 non-object node order falls back", L.sanitizeNodeOrder([1, 2, 3]), {});
eq("N3 non-array collapsed types fall back", L.sanitizeStringArray({ a: 1 }), []);
eq("N4 invalid selected node falls back", L.sanitizeSelectedNode("abc"), null);
ok("N5 invalid sort mode is rejected", L.isSortMode("cpu") === false && L.isSortMode("problems") === true);

/* ── O/P. mobile actions + selected node survives reorder ─────────────────── */

ok("O1 ActionMenu exposes reorder actions", section.includes("admin.monitoring.reorder.up") && section.includes("admin.monitoring.reorder.start"));
ok("P1 selected node is persisted by id", section.includes("SELECTED_NODE_KEY") && section.includes("sanitizeSelectedNode"));
ok("P2 reorder never clears selection", !/reorderNode[\s\S]{0,200}setExpandedId\(null\)/.test(section));

/* ── No metric sort modes ─────────────────────────────────────────────────── */

eq("metric sorts are not offered", L.SORT_MODES, ["manual", "type", "problems"]);
ok("module has no cpu/ram/disk/traffic sort symbols", !/(cpu|ram|disk|traffic|load|swap|filesystem)Sort/i.test(moduleSrc));
ok("component sort select has exactly 3 options", (section.match(/<option value=\"(manual|type|problems)\"/g) || []).length === 3);
ok("layout controls exist in CSS", css.includes(".mon-controls") && css.includes(".mon-orderRow") && css.includes(".mon-row__drag") && css.includes(".mon-row.is-dragOver"));

console.log(`\n${failures === 0 ? "OK" : "FAILED"}: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
