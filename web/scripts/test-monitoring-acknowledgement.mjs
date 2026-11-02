import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(path.join(tmpdir(), "shpun-ack-ui-"));
try {
  const outfile = path.join(dir, "render.mjs");
  await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { MonitoringIncidents } from "./src/pages/admin/MonitoringIncidents";
      export const render = (active, acknowledging = []) => renderToStaticMarkup(<MonitoringIncidents
        active={active} history={[]} counts={{critical: active.length, warning: 0, total: active.length}}
        total={0} tab="active" onTab={()=>{}} severity="all" onSeverity={()=>{}} range="7d" onRange={()=>{}}
        onOpenIncident={()=>{}} onAcknowledge={()=>{}} acknowledging={acknowledging} refreshing={false} />);
    ` },
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    outfile, bundle: true, platform: "node", format: "esm", jsx: "automatic",
    plugins: [{ name: "test-labels", setup(b) {
      b.onResolve({ filter: /^\.\.\/\.\.\/shared\/i18n$/ }, () => ({ path: "labels", namespace: "test" }));
      b.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const useI18n = () => ({t: (key) => key});" }));
    } }],
  });
  const { render } = await import(pathToFileURL(outfile).href);
  const incident = { id: 1, serverId: 8, serverTitle: "SPB", severity: "critical", state: "alerting", ruleType: "offline", openedAt: 1700000000, durationSec: 60, acknowledgedAt: null };
  const cardCount = html => (html.match(/class="mon-incidentCard mon-incidentCard--critical"/g) ?? []).length;
  const fresh = render([incident]);
  assert.equal(cardCount(fresh), 1);
  assert.ok(fresh.includes("admin.monitoring.incidents.acknowledge"));
  const acknowledged = { ...incident, acknowledgedAt: 1700000060 };
  const seen = render([acknowledged]);
  assert.equal(cardCount(seen), 0, "acknowledged outage must leave the prominent area");
  assert.ok(seen.includes("<details class=\"mon-incidents__acknowledged\""));
  assert.ok(!seen.includes("<details open"), "acknowledged list must start collapsed");
  assert.ok(seen.includes("SPB"), "acknowledged incident remains reachable");
  assert.ok(seen.includes("admin.monitoring.incidents.empty.attention"));
  const next = render([acknowledged, { ...incident, id: 2, serverTitle: "MSK" }]);
  assert.equal(cardCount(next), 1, "new incident must still stand out");
  assert.ok(render([incident], [1]).includes("disabled=\"\""));
  assert.ok(render([]).includes("admin.monitoring.incidents.empty.active"));
  console.log("PASS: acknowledgement hides only the prominent card; new incidents, collapsed access and pending controls remain correct");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
