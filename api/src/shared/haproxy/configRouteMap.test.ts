import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRouteMap, repointRoute } from "./configRouteMap.js";

// Condensed real-shaped haproxy.cfg fragment from ruin.
const CFG = `
global
    log /dev/log local0 info

frontend rf_reality_canary_443
    bind *:443
    acl canary_rt1 req.ssl_sni -i rt1.shpyn.online img1.avito.ru
    acl canary_rt2 req.ssl_sni -i rt2.shpyn.online img2.avito.ru
    acl sni_shared_xhttp req.ssl_sni -i cache.shpyn.online
    use_backend cdn_tls_terminate if sni_shared_xhttp
    use_backend reality_fi    if canary_rt1
    use_backend reality_ro    if canary_rt2
    default_backend reality_fi

frontend rf_reality_8443
    acl sni_rt1 req.ssl_sni -i rt1.shpyn.online img1.avito.ru
    use_backend reality_fi    if sni_rt1
    default_backend reality_fi

backend reality_fi
    server fi_real_v4 194.48.143.19:8443 check
backend reality_ro
    server ro_real 178.214.211.121:8443 check
backend reality_de
    server de_real 185.143.238.197:8443 check
backend cdn_tls_terminate
    server local_tls 127.0.0.1:10443
`;

test("parses editable SNI rules with domains and family", () => {
  const map = parseRouteMap(CFG);
  assert.ok(map.backends.includes("reality_fi"));
  assert.ok(map.backends.includes("reality_de"));
  // Editable rules: canary_rt1, canary_rt2 (443), sni_rt1 (8443).
  // The sni_shared_xhttp rule is a defined ssl_sni acl too, so it is included.
  const byAcl = new Map(map.rules.map((r) => [r.acl, r]));
  assert.equal(byAcl.get("canary_rt1")?.backend, "reality_fi");
  assert.equal(byAcl.get("canary_rt1")?.family, "reality");
  assert.deepEqual(byAcl.get("canary_rt1")?.domains, ["rt1.shpyn.online", "img1.avito.ru"]);
  assert.equal(byAcl.get("sni_rt1")?.frontend, "rf_reality_8443");
});

test("repoint changes exactly the one rule's backend token", () => {
  const r = repointRoute(CFG, "canary_rt1", "reality_de");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.from, "reality_fi");
  assert.match(r.config, /use_backend reality_de\s+if canary_rt1/);
  // The 8443 sni_rt1 rule and default_backend stay on reality_fi.
  assert.match(r.config, /use_backend reality_fi\s+if sni_rt1/);
  assert.match(r.config, /default_backend reality_fi/);
  // Only one line differs.
  const before = CFG.split("\n");
  const after = r.config.split("\n");
  const diff = before.filter((l, i) => l !== after[i]);
  assert.equal(diff.length, 1);
});

test("rejects unknown backend", () => {
  const r = repointRoute(CFG, "canary_rt1", "reality_xx");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "backend_not_found");
});

test("rejects unknown acl / rule", () => {
  const r = repointRoute(CFG, "canary_rt9", "reality_de");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "rule_not_found");
});

test("rejects injection in acl / backend", () => {
  assert.equal(repointRoute(CFG, "a b", "reality_de").ok, false);
  assert.equal(repointRoute(CFG, "canary_rt1", "x\nglobal").ok, false);
});
