import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-mon-fetch-deadline-"));
process.env.NODE_ENV = "development";

const { probeNodeExporter } = await import("./monitor.js");
const { linkDb } = await import("../../shared/linkdb/db.js");

test("a fetch implementation that ignores abort cannot freeze the collector", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
  const started = Date.now();
  try {
    const result = await probeNodeExporter({
      id: 1,
      title: "Hung exporter",
      host: "hung.example",
      exporter_url: "http://hung.example:9100/metrics",
      kind: "gateway",
      country_code: null,
      active: 1,
      sort_order: 1,
      uplink_mbps: null,
      visibility: "admin_only",
      affects_public_health: 1,
      node_exporter_enabled: 1,
      exporter_auth_type: "none",
      exporter_username: "",
      exporter_password_encrypted: null,
      remnawave_integration_id: null,
      remnawave_node_uuid: null,
      thresholds_json: null,
      created_at: "",
      updated_at: "",
    }, 30);

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "timeout");
    assert.ok(Date.now() - started < 500, "hard deadline must settle promptly");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.after(() => linkDb.close());
