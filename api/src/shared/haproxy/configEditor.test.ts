import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyEdit,
  configHash,
  diffConfigs,
  normalizeDomains,
  parseAddr,
  parseConfigModel,
  splitAclArgs,
  type EditOp,
} from "./configEditor.js";

const CFG = [
  "global",
  "    log /dev/log local0 info",
  "",
  "frontend rf_reality_443",
  "    bind *:443",
  "    acl canary_rt1 req.ssl_sni -i rt1.shpyn.online img1.avito.ru",
  "    acl canary_rt2 req.ssl_sni -i rt2.shpyn.online",
  "    use_backend reality_fi    if canary_rt1",
  "    use_backend reality_ro    if canary_rt2",
  "    use_backend reality_de    if { req.ssl_sni -m end .de }",
  "    default_backend reality_fi",
  "",
  "backend reality_fi",
  "    mode tcp",
  "    server fi_real_v4 194.48.143.19:8443 check inter 5s",
  "    server fi_real_bk 10.0.0.1:8443 check backup # spare",
  "",
  "backend reality_ro",
  "    server ro_real 178.214.211.121:8443 check",
  "",
  "backend reality_de",
  "    server de_real 185.143.238.197:8443 check",
  "",
  "backend router_fi",
  "    server fi_router 194.48.143.19:2096 check",
  "",
  "# trailing comment",
  "backend reality_unused",
  "    server x 9.9.9.9:8443 check",
  "",
].join("\n");

function ok(op: EditOp, cfg = CFG) {
  const r = applyEdit(cfg, op);
  assert.equal(r.ok, true, r.ok ? "" : `${r.error} ${JSON.stringify(r.detail ?? {})}`);
  if (!r.ok) throw new Error("unreachable");
  return r;
}
function err(op: EditOp, code: string, cfg = CFG) {
  const r = applyEdit(cfg, op);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, code);
}
const changed = (a: string, b: string) => diffConfigs(a, b, 0).filter((d) => d.kind !== "ctx" && d.kind !== "gap");

test("model: frontends, rules, backends, nodes", () => {
  const m = parseConfigModel(CFG);
  const f = m.frontends[0];
  assert.equal(f.name, "rf_reality_443");
  assert.deepEqual(f.binds, ["*:443"]);
  assert.equal(f.defaultBackend?.backend, "reality_fi");
  assert.equal(f.rules.length, 3);
  assert.equal(f.rules.filter((r) => r.editable).length, 2);
  const fi = m.backends.find((b) => b.name === "reality_fi")!;
  assert.equal(fi.servers.length, 2);
  assert.equal(fi.servers[1].isBackup, true);
  assert.equal(fi.servers[1].params, "check backup");
  assert.equal(fi.usedBy.length, 2);
  const node = m.nodes.find((n) => n.host === "194.48.143.19")!;
  assert.deepEqual(node.members.map((x) => x.backend), ["reality_fi", "router_fi"]);
});

test("addr + domains validation", () => {
  assert.deepEqual(parseAddr("1.2.3.4:443"), { host: "1.2.3.4", port: 443, bracketed: false });
  assert.equal(parseAddr("[2a00::1]:443")?.host, "2a00::1");
  assert.equal(parseAddr("node.example.com:8443")?.port, 8443);
  assert.equal(parseAddr("1.2.3.4:70000"), null);
  assert.equal(parseAddr("1.2.3.4:443\nglobal"), null);
  assert.equal(parseAddr("2a00::1:443"), null);
  assert.equal(parseAddr("999.1.1.1:443"), null);
  assert.deepEqual(normalizeDomains("A.example.com, b.example.com a.example.com"), ["a.example.com", "b.example.com"]);
  assert.equal(normalizeDomains("bad domain#x"), null);
  assert.equal(normalizeDomains(""), null);
});

test("route.repoint changes one token and keeps family", () => {
  const r = ok({ type: "route.repoint", frontend: "rf_reality_443", acl: "canary_rt1", backend: "reality_de" });
  assert.match(r.config, /use_backend reality_de\s+if canary_rt1/);
  assert.equal(changed(CFG, r.config).length, 2);
  err({ type: "route.repoint", frontend: "rf_reality_443", acl: "canary_rt1", backend: "router_fi" }, "family_mismatch");
  err({ type: "route.repoint", frontend: "rf_reality_443", acl: "canary_rt1", backend: "reality_fi" }, "unchanged");
});

test("route.domains keeps the fetch, extra flags and comment", () => {
  const cfg = [
    "frontend f",
    "    acl a1 req_ssl_sni -i -m end example.com other.example.com # keep me",
    "    use_backend b if a1",
    "backend b",
    "    server s 1.1.1.1:1 check",
    "",
  ].join("\n");
  const m = parseConfigModel(cfg);
  // `end` is the -m argument, not a domain.
  assert.deepEqual(m.frontends[0].acls[0].domains, ["example.com", "other.example.com"]);
  const r = applyEdit(cfg, { type: "route.domains", frontend: "f", acl: "a1", domains: "new.example.com" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.config.split("\n")[1], "    acl a1 req_ssl_sni -i -m end new.example.com # keep me");
  }
});

test("acls loaded from a file (-f) are not editable", () => {
  const cfg = "frontend f\n    acl a1 req.ssl_sni -i -f /etc/haproxy/sni.lst\n    use_backend b if a1\nbackend b\n    server s 1.1.1.1:1\n";
  const m = parseConfigModel(cfg);
  assert.equal(m.frontends[0].acls[0].sni, false);
  assert.equal(m.frontends[0].rules[0].editable, false);
});

test("splitAclArgs separates flags (with arguments) from values", () => {
  assert.deepEqual(splitAclArgs(["-i", "-m", "end", "a.com", "-x"]), { flags: ["-i", "-m", "end"], values: ["a.com", "-x"] });
  assert.deepEqual(splitAclArgs(["-i", "--", "-weird"]), { flags: ["-i", "--"], values: ["-weird"] });
  assert.deepEqual(splitAclArgs(["-i"]), { flags: ["-i"], values: [] });
});

test("route.domains rewrites the acl line only", () => {
  const r = ok({ type: "route.domains", frontend: "rf_reality_443", acl: "canary_rt2", domains: "rt2.shpyn.online, img2.avito.ru" });
  assert.match(r.config, /acl canary_rt2 req\.ssl_sni -i rt2\.shpyn\.online img2\.avito\.ru\n/);
  err({ type: "route.domains", frontend: "rf_reality_443", acl: "canary_rt2", domains: "x y\nz" }, "invalid_domains");
});

test("route.add inserts acl after acls and use_backend after rules", () => {
  const r = ok({ type: "route.add", frontend: "rf_reality_443", acl: "canary_rt3", domains: ["rt3.shpyn.online"], backend: "reality_de" });
  const lines = r.config.split("\n");
  const aclIdx = lines.indexOf("    acl canary_rt3 req.ssl_sni -i rt3.shpyn.online");
  const useIdx = lines.indexOf("    use_backend reality_de if canary_rt3");
  assert.equal(aclIdx, 7);
  assert.equal(useIdx, 10); // right after the last editable rule
  assert.ok(useIdx < lines.indexOf("    default_backend reality_fi"));
  err({ type: "route.add", frontend: "rf_reality_443", acl: "canary_rt1", domains: ["a.b.c"], backend: "reality_de" }, "acl_exists");
});

test("route.add into a frontend without acls", () => {
  const cfg = "frontend f\n    bind *:443\n    default_backend b\nbackend b\n    server s 1.1.1.1:1 check\n";
  const r = ok({ type: "route.add", frontend: "f", acl: "a1", domains: "x.example.com", backend: "b" }, cfg);
  assert.equal(r.config, "frontend f\n    bind *:443\n    acl a1 req.ssl_sni -i x.example.com\n    use_backend b if a1\n    default_backend b\nbackend b\n    server s 1.1.1.1:1 check\n");
});

test("route.remove drops rule and its acl", () => {
  const r = ok({ type: "route.remove", frontend: "rf_reality_443", acl: "canary_rt2" });
  assert.doesNotMatch(r.config, /canary_rt2/);
  assert.equal(changed(CFG, r.config).length, 2);
});

test("frontend.default", () => {
  const r = ok({ type: "frontend.default", frontend: "rf_reality_443", backend: "reality_de" });
  assert.match(r.config, /default_backend reality_de/);
});

test("server.add copies template params and preserves layout", () => {
  const r = ok({ type: "server.add", backend: "reality_fi", name: "fi_new", addr: "5.5.5.5:8443" });
  assert.match(r.config, /server fi_real_bk 10\.0\.0\.1:8443 check backup # spare\n    server fi_new 5\.5\.5\.5:8443 check inter 5s\n/);
  const b = ok({ type: "server.add", backend: "reality_fi", name: "fi_b", addr: "[2a00::5]:8443", backup: true });
  assert.match(b.config, /server fi_b \[2a00::5\]:8443 check inter 5s backup/);
  err({ type: "server.add", backend: "reality_fi", name: "fi_real_v4", addr: "5.5.5.5:8443" }, "server_exists");
  err({ type: "server.add", backend: "reality_fi", name: "fi_x", addr: "5.5.5.5" }, "invalid_addr");
  err({ type: "server.add", backend: "reality_fi", name: "bad name", addr: "5.5.5.5:1" }, "invalid_name");
});

test("server.update changes address / name / backup, keeps comment", () => {
  const r = ok({ type: "server.update", backend: "reality_fi", server: "fi_real_bk", addr: "10.0.0.2:9443" });
  assert.match(r.config, /    server fi_real_bk 10\.0\.0\.2:9443 check backup  # spare\n/);
  const n = ok({ type: "server.update", backend: "reality_fi", server: "fi_real_bk", backup: false });
  assert.match(n.config, /server fi_real_bk 10\.0\.0\.1:8443 check  # spare/);
  err({ type: "server.update", backend: "reality_ro", server: "ro_real", backup: true }, "last_active_server");
  err({ type: "server.update", backend: "reality_fi", server: "fi_real_v4", addr: "194.48.143.19:8443" }, "unchanged");
});

test("server.remove refuses to empty a used backend", () => {
  ok({ type: "server.remove", backend: "reality_fi", server: "fi_real_bk" });
  err({ type: "server.remove", backend: "reality_ro", server: "ro_real" }, "backend_would_be_empty");
  ok({ type: "server.remove", backend: "reality_unused", server: "x" });
});

test("node.readdress updates every backend, keeps ports", () => {
  const r = ok({ type: "node.readdress", host: "194.48.143.19", newHost: "194.48.143.20" });
  assert.match(r.config, /server fi_real_v4 194\.48\.143\.20:8443 check inter 5s/);
  assert.match(r.config, /server fi_router 194\.48\.143\.20:2096 check/);
  assert.equal(changed(CFG, r.config).length, 4);
  err({ type: "node.readdress", host: "194.48.143.19", newHost: "1.2.3.4:5" }, "invalid_addr");
});

test("node.add adds a server to several backends", () => {
  const r = ok({ type: "node.add", host: "7.7.7.7", name: "de2", targets: [{ backend: "reality_de" }, { backend: "router_fi", port: 2097, backup: true }] });
  assert.match(r.config, /server de_real 185\.143\.238\.197:8443 check\n    server de2 7\.7\.7\.7:8443 check\n/);
  assert.match(r.config, /server de2 7\.7\.7\.7:2097 check backup/);
  err({ type: "node.add", host: "7.7.7.7", name: "de2", targets: [] }, "no_targets");
});

test("node.remove refuses if a used backend would empty", () => {
  err({ type: "node.remove", host: "178.214.211.121" }, "backend_would_be_empty");
  const r = ok({ type: "node.remove", host: "10.0.0.1" });
  assert.doesNotMatch(r.config, /10\.0\.0\.1/);
});

test("backend.add clones directives, backend.remove refuses used ones", () => {
  const r = ok({ type: "backend.add", name: "reality_nl", cloneFrom: "reality_fi", server: { name: "nl_real", addr: "8.8.4.4:8443" } });
  assert.match(r.config, /backend reality_fi\n    mode tcp\n[\s\S]*?\n\nbackend reality_nl\n    mode tcp\n    server nl_real 8\.8\.4\.4:8443 check inter 5s\n/);
  assert.equal(parseConfigModel(r.config).backends.some((b) => b.name === "reality_nl"), true);
  err({ type: "backend.add", name: "reality_fi" }, "backend_exists");
  err({ type: "backend.remove", name: "reality_fi" }, "backend_in_use");
  const d = ok({ type: "backend.remove", name: "reality_unused" });
  assert.doesNotMatch(d.config, /reality_unused/);
  assert.match(d.config, /# trailing comment/);
});

test("CRLF configs keep CRLF", () => {
  const crlf = CFG.replace(/\n/g, "\r\n");
  const r = ok({ type: "server.add", backend: "reality_de", name: "de2", addr: "7.7.7.7:8443" }, crlf);
  assert.doesNotMatch(r.config.replace(/\r\n/g, ""), /\n/);
});

test("invalid op is rejected", () => {
  err({ type: "nope" } as any, "invalid_op");
});

test("diff shows changes with context and hash is stable", () => {
  const r = ok({ type: "server.add", backend: "reality_de", name: "de2", addr: "7.7.7.7:8443" });
  const d = diffConfigs(CFG, r.config);
  assert.equal(d.filter((x) => x.kind === "add").length, 1);
  assert.equal(d.filter((x) => x.kind === "del").length, 0);
  assert.ok(d.length <= 6);
  assert.equal(configHash(CFG), configHash(CFG));
  assert.notEqual(configHash(CFG), configHash(r.config));
});
