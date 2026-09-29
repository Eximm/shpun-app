import assert from "node:assert/strict";
import test from "node:test";

import { NODE_EXPORTER_COLLECTORS, nodeExporterScrapeUrl } from "./nodeExporterUrl.js";

test("node exporter scrape URL requests only the collectors used by monitoring", () => {
  const url = new URL(nodeExporterScrapeUrl("http://fi.shpyn.online:9100/metrics"));

  assert.equal(url.origin, "http://fi.shpyn.online:9100");
  assert.equal(url.pathname, "/metrics");
  assert.deepEqual(url.searchParams.getAll("collect[]"), [...NODE_EXPORTER_COLLECTORS]);
});

test("node exporter scrape URL preserves unrelated parameters and replaces stale collector filters", () => {
  const url = new URL(
    nodeExporterScrapeUrl("https://example.test/metrics?site=fi&collect%5B%5D=systemd"),
  );

  assert.equal(url.searchParams.get("site"), "fi");
  assert.deepEqual(url.searchParams.getAll("collect[]"), [...NODE_EXPORTER_COLLECTORS]);
  assert.equal(url.searchParams.has("systemd"), false);
});
