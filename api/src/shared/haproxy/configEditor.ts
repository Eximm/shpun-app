// api/src/shared/haproxy/configEditor.ts
//
// Structural editor for a gateway's haproxy.cfg. Parses the config into a
// line-anchored model (frontends with their SNI ACLs / use_backend rules /
// default_backend, backends with their `server` lines, and "nodes" = server
// lines grouped by host) and applies surgical, validated edit operations that
// touch only the lines they must. Everything outside the edited lines is kept
// byte-for-byte (comments, ordering, unrelated directives, line endings).
//
// Validation here is strict (names, hosts, ports, domains) so no edit can
// smuggle a newline or an extra directive into the config. The resulting text
// is then validated again server-side by the bridge helper (`haproxy -c`)
// before it is installed and HAProxy is gracefully reloaded.

import { createHash } from "node:crypto";

export const NAME_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const HOST_V4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOST_V6_RE = /^[0-9A-Fa-f:.]{2,45}$/;
const HOST_DNS_RE = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const DOMAIN_RE = /^(?=.{1,253}$)(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
// Server params copied from a template server line. Restricted charset: no
// newline, no `#` (comment), no quotes.
const PARAMS_RE = /^[A-Za-z0-9_.:,/=()@+\- ]{0,512}$/;
export const MAX_DOMAINS = 64;

export function familyOf(backend: string): string {
  const i = backend.indexOf("_");
  return i > 0 ? backend.slice(0, i) : backend;
}

export function configHash(config: string): string {
  return createHash("sha256").update(String(config ?? ""), "utf8").digest("hex");
}

/* ─── Address helpers ─────────────────────────────────────────────────────── */

export type ParsedAddr = { host: string; port: number | null; bracketed: boolean };

/** Parses `host:port`, `[v6]:port`, `host` (no port). Returns null if invalid. */
export function parseAddr(raw: string): ParsedAddr | null {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 300) return null;
  let host = s;
  let portStr: string | null = null;
  let bracketed = false;
  const br = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(s);
  if (br) {
    host = br[1];
    portStr = br[2] ?? null;
    bracketed = true;
  } else {
    const colons = (s.match(/:/g) ?? []).length;
    if (colons === 1) {
      const i = s.lastIndexOf(":");
      host = s.slice(0, i);
      portStr = s.slice(i + 1);
    } else if (colons > 1) {
      // Bare IPv6 with a trailing :port is ambiguous; HAProxy reads the last
      // group as the port. Require brackets for v6 to keep it unambiguous.
      return null;
    }
  }
  if (!isValidHost(host)) return null;
  let port: number | null = null;
  if (portStr != null) {
    if (!/^\d{1,5}$/.test(portStr)) return null;
    port = Number(portStr);
    if (port < 1 || port > 65535) return null;
  }
  if (bracketed && !host.includes(":")) return null;
  return { host, port, bracketed };
}

export function isValidHost(host: string): boolean {
  const h = String(host ?? "");
  if (HOST_V4_RE.test(h)) return true;
  if (h.includes(":")) return HOST_V6_RE.test(h) && h.includes("::") || /^([0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}$/.test(h);
  if (/^\d+(\.\d+)*$/.test(h)) return false; // malformed dotted number
  return HOST_DNS_RE.test(h);
}

export function formatAddr(host: string, port: number | null): string {
  const h = host.includes(":") ? `[${host}]` : host;
  return port == null ? h : `${h}:${port}`;
}

export function normalizeDomains(input: unknown): string[] | null {
  const list = Array.isArray(input)
    ? input
    : String(input ?? "").split(/[\s,;]+/);
  const out: string[] = [];
  for (const raw of list) {
    const d = String(raw ?? "").trim().toLowerCase();
    if (!d) continue;
    if (!DOMAIN_RE.test(d)) return null;
    if (!out.includes(d)) out.push(d);
  }
  if (out.length === 0 || out.length > MAX_DOMAINS) return null;
  return out;
}

/** HAProxy ACL flags that consume the following token as their argument. */
const ACL_FLAGS_WITH_ARG = new Set(["-m", "-f", "-u"]);

/**
 * Splits the arguments after `acl <name> <fetch>` into leading flags (with
 * their arguments, e.g. `-i -m end`) and the matched values. Everything after
 * the first value, or after `--`, is a value.
 */
export function splitAclArgs(rest: string[]): { flags: string[]; values: string[] } {
  const flags: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "--") return { flags: [...flags, t], values: rest.slice(i + 1) };
    if (!t.startsWith("-")) return { flags, values: rest.slice(i) };
    flags.push(t);
    if (ACL_FLAGS_WITH_ARG.has(t) && i + 1 < rest.length) flags.push(rest[++i]);
  }
  return { flags, values: [] };
}

/* ─── Model ──────────────────────────────────────────────────────────────── */

type SectionKind = "global" | "defaults" | "frontend" | "backend" | "listen" | "other";

type Section = { kind: SectionKind; name: string; header: number; end: number };

export type ServerLine = {
  backend: string;
  name: string;
  addr: string;
  host: string;
  port: number | null;
  params: string;
  isBackup: boolean;
  isDisabled: boolean;
  weight: number | null;
  line: number;
};

export type BackendModel = {
  name: string;
  family: string;
  line: number;
  servers: ServerLine[];
  /** Frontends + ACLs that send traffic here (use_backend / default_backend). */
  usedBy: { frontend: string; acl: string | null }[];
};

export type AclModel = { name: string; domains: string[]; line: number; sni: boolean };

export type RuleModel = {
  frontend: string;
  acl: string;
  backend: string;
  family: string;
  domains: string[];
  line: number;
  /** Simple `use_backend X if <sni-acl>` — editable. */
  editable: boolean;
};

export type FrontendModel = {
  name: string;
  line: number;
  binds: string[];
  acls: AclModel[];
  rules: RuleModel[];
  defaultBackend: { backend: string; line: number } | null;
};

export type NodeModel = {
  host: string;
  members: { backend: string; server: string; port: number | null; isBackup: boolean }[];
};

export type ConfigModel = {
  backends: BackendModel[];
  frontends: FrontendModel[];
  nodes: NodeModel[];
};

type Parsed = {
  lines: string[];
  eol: string;
  sections: Section[];
  model: ConfigModel;
};

const SECTION_RE = /^(global|defaults|frontend|backend|listen|resolvers|peers|userlist|cache|program|http-errors|ring|mailers)\b\s*(\S*)/;

function splitLines(config: string): { lines: string[]; eol: string } {
  const text = String(config ?? "");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return { lines: text.split(/\r?\n/), eol };
}

function stripComment(line: string): string {
  const i = line.indexOf("#");
  return i >= 0 ? line.slice(0, i) : line;
}

function parse(config: string): Parsed {
  const { lines, eol } = splitLines(config);
  const sections: Section[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = SECTION_RE.exec(lines[i]);
    if (!m) continue;
    const kind = (["global", "defaults", "frontend", "backend", "listen"].includes(m[1]) ? m[1] : "other") as SectionKind;
    if (sections.length) sections[sections.length - 1].end = i;
    sections.push({ kind, name: m[2] ?? "", header: i, end: lines.length });
  }

  const backends: BackendModel[] = [];
  const frontends: FrontendModel[] = [];

  for (const sec of sections) {
    if (sec.kind === "backend") {
      const b: BackendModel = { name: sec.name, family: familyOf(sec.name), line: sec.header, servers: [], usedBy: [] };
      for (let i = sec.header + 1; i < sec.end; i++) {
        const sm = /^\s+server\s+(\S+)\s+(\S+)(.*)$/.exec(stripComment(lines[i]));
        if (!sm) continue;
        const addr = parseAddr(sm[2]);
        const params = sm[3].trim();
        const tokens = params.split(/\s+/);
        const wi = tokens.indexOf("weight");
        const w = wi >= 0 ? Number(tokens[wi + 1]) : NaN;
        b.servers.push({
          backend: sec.name,
          name: sm[1],
          addr: sm[2],
          host: addr?.host ?? sm[2],
          port: addr?.port ?? null,
          params,
          isBackup: tokens.includes("backup"),
          isDisabled: tokens.includes("disabled"),
          weight: Number.isFinite(w) ? w : null,
          line: i,
        });
      }
      backends.push(b);
    } else if (sec.kind === "frontend" || sec.kind === "listen") {
      const f: FrontendModel = { name: sec.name, line: sec.header, binds: [], acls: [], rules: [], defaultBackend: null };
      const raw: { acl: string; backend: string; line: number; editable: boolean }[] = [];
      for (let i = sec.header + 1; i < sec.end; i++) {
        const line = stripComment(lines[i]);
        const bind = /^\s+bind\s+(\S+)/.exec(line);
        if (bind) { f.binds.push(bind[1]); continue; }
        const acl = /^\s+acl\s+(\S+)\s+(\S+)(?:\s+(.*?))?\s*$/.exec(line);
        if (acl) {
          const sni = acl[2] === "req.ssl_sni" || acl[2] === "req_ssl_sni";
          const rest = (acl[3] ?? "").split(/\s+/).filter(Boolean);
          const { flags, values } = splitAclArgs(rest);
          const domains = sni ? values : [];
          // Values loaded from a file (-f) are not editable inline.
          f.acls.push({ name: acl[1], domains, line: i, sni: sni && rest[0] === "-i" && !flags.includes("-f") });
          continue;
        }
        const ub = /^\s+use_backend\s+(\S+)\s+(?:if|unless)\s+(.+?)\s*$/.exec(line);
        if (ub) {
          const simple = /^\s+use_backend\s+\S+\s+if\s+([A-Za-z0-9_.:-]+)\s*$/.exec(line);
          raw.push({ acl: simple ? simple[1] : ub[2], backend: ub[1], line: i, editable: !!simple });
          continue;
        }
        const db = /^\s+default_backend\s+(\S+)/.exec(line);
        if (db) f.defaultBackend = { backend: db[1], line: i };
      }
      for (const r of raw) {
        const acl = f.acls.find((a) => a.name === r.acl);
        f.rules.push({
          frontend: f.name,
          acl: r.acl,
          backend: r.backend,
          family: familyOf(r.backend),
          domains: acl?.domains ?? [],
          line: r.line,
          editable: r.editable && !!acl?.sni,
        });
      }
      frontends.push(f);
    }
  }

  const byName = new Map(backends.map((b) => [b.name, b]));
  for (const f of frontends) {
    for (const r of f.rules) byName.get(r.backend)?.usedBy.push({ frontend: f.name, acl: r.acl });
    if (f.defaultBackend) byName.get(f.defaultBackend.backend)?.usedBy.push({ frontend: f.name, acl: null });
  }

  const nodeMap = new Map<string, NodeModel>();
  for (const b of backends) {
    for (const s of b.servers) {
      const key = s.host;
      if (!nodeMap.has(key)) nodeMap.set(key, { host: key, members: [] });
      nodeMap.get(key)!.members.push({ backend: b.name, server: s.name, port: s.port, isBackup: s.isBackup });
    }
  }

  return { lines, eol, sections, model: { backends, frontends, nodes: [...nodeMap.values()] } };
}

export function parseConfigModel(config: string): ConfigModel {
  return parse(config).model;
}

/* ─── Edit operations ────────────────────────────────────────────────────── */

export type EditOp =
  | { type: "route.repoint"; frontend: string; acl: string; backend: string }
  | { type: "route.domains"; frontend: string; acl: string; domains: string[] | string }
  | { type: "route.add"; frontend: string; acl: string; domains: string[] | string; backend: string }
  | { type: "route.remove"; frontend: string; acl: string }
  | { type: "frontend.default"; frontend: string; backend: string }
  | { type: "server.add"; backend: string; name: string; addr: string; template?: string; backup?: boolean }
  | { type: "server.update"; backend: string; server: string; addr?: string; name?: string; backup?: boolean }
  | { type: "server.remove"; backend: string; server: string }
  | { type: "node.readdress"; host: string; newHost: string }
  | { type: "node.add"; host: string; name: string; targets: { backend: string; port?: number | null; backup?: boolean }[] }
  | { type: "node.remove"; host: string }
  | { type: "backend.add"; name: string; cloneFrom?: string; server?: { name: string; addr: string } }
  | { type: "backend.remove"; name: string };

export const EDIT_OP_TYPES = [
  "route.repoint", "route.domains", "route.add", "route.remove", "frontend.default",
  "server.add", "server.update", "server.remove",
  "node.readdress", "node.add", "node.remove",
  "backend.add", "backend.remove",
] as const;

export type EditResult =
  | { ok: true; config: string; summary: string; target: { backend: string; server: string }; from?: string }
  | { ok: false; error: string; detail?: Record<string, unknown> };

function fail(error: string, detail?: Record<string, unknown>): EditResult {
  return { ok: false, error, detail };
}

function indentOf(line: string | undefined, fallback = "    "): string {
  const m = /^(\s+)\S/.exec(line ?? "");
  return m ? m[1] : fallback;
}

function nameOk(v: unknown): v is string {
  return typeof v === "string" && NAME_RE.test(v);
}

/** Last non-blank, non-comment line index inside a section (or the header). */
function lastContentLine(lines: string[], sec: Section): number {
  for (let i = sec.end - 1; i > sec.header; i--) {
    const t = lines[i].trim();
    if (t && !t.startsWith("#")) return i;
  }
  return sec.header;
}

function replaceToken(line: string, from: string, to: string, occurrence: number): string {
  // Replace the Nth whitespace-delimited token equal to `from`.
  let seen = 0;
  return line.replace(/(\S+)/g, (tok) => {
    if (tok === from) {
      seen += 1;
      if (seen === occurrence) return to;
    }
    return tok;
  });
}

/** Rewrites a `server <name> <addr> <params…>` line keeping its indentation. */
function rewriteServerLine(line: string, name: string, addr: string, params: string): string {
  const indent = indentOf(line);
  const commentIdx = line.indexOf("#");
  const comment = commentIdx >= 0 ? `  ${line.slice(commentIdx).trimStart()}` : "";
  return `${indent}server ${name} ${addr}${params ? ` ${params}` : ""}${comment}`;
}

function toggleBackup(params: string, backup: boolean): string {
  const tokens = params.split(/\s+/).filter(Boolean).filter((t) => t !== "backup");
  if (backup) tokens.push("backup");
  return tokens.join(" ");
}

function templateParams(b: BackendModel, template?: string): string | null {
  const src = template ? b.servers.find((s) => s.name === template) : b.servers[0];
  if (template && !src) return null;
  const p = (src?.params ?? "check").split(/\s+/).filter(Boolean).filter((t) => t !== "backup" && t !== "disabled");
  const out = p.join(" ");
  return PARAMS_RE.test(out) ? out : null;
}

/** Backends that would be left with no server while still receiving traffic. */
function orphanedBackends(model: ConfigModel, removed: Set<string>): string[] {
  const out: string[] = [];
  for (const b of model.backends) {
    if (b.servers.length === 0 || b.usedBy.length === 0) continue;
    const left = b.servers.filter((s) => !removed.has(`${b.name}/${s.name}`));
    if (left.length === 0) out.push(b.name);
  }
  return out;
}

export function applyEdit(config: string, op: EditOp): EditResult {
  const p = parse(config);
  const { lines, model } = p;
  const findBackend = (n: string) => model.backends.find((b) => b.name === n);
  const findFrontend = (n: string) => model.frontends.find((f) => f.name === n);
  const sectionOf = (kind: SectionKind, name: string) =>
    p.sections.find((s) => s.name === name && (s.kind === kind || (kind === "frontend" && s.kind === "listen")));

  // Each op produces a list of line mutations: replace / delete / insert-after.
  const replace = new Map<number, string>();
  const del = new Set<number>();
  const insertAfter = new Map<number, string[]>();
  const addAfter = (i: number, text: string) => {
    if (!insertAfter.has(i)) insertAfter.set(i, []);
    insertAfter.get(i)!.push(text);
  };
  let summary = "";
  let target = { backend: "", server: "" };
  let from: string | undefined;

  switch (op?.type) {
    case "route.repoint": {
      if (!nameOk(op.frontend) || !nameOk(op.acl) || !nameOk(op.backend)) return fail("invalid_name");
      const f = findFrontend(op.frontend);
      if (!f) return fail("frontend_not_found");
      const rules = f.rules.filter((r) => r.acl === op.acl && r.editable);
      if (rules.length === 0) return fail("rule_not_found");
      if (rules.length > 1) return fail("ambiguous_rule");
      if (!findBackend(op.backend)) return fail("backend_not_found");
      const rule = rules[0];
      if (familyOf(op.backend) !== rule.family) return fail("family_mismatch", { expected: rule.family });
      if (rule.backend === op.backend) return fail("unchanged");
      replace.set(rule.line, replaceToken(lines[rule.line], rule.backend, op.backend, 1));
      summary = `${f.name}: ${op.acl} ${rule.backend} → ${op.backend}`;
      from = rule.backend;
      target = { backend: op.backend, server: op.acl };
      break;
    }
    case "route.domains": {
      if (!nameOk(op.frontend) || !nameOk(op.acl)) return fail("invalid_name");
      const f = findFrontend(op.frontend);
      if (!f) return fail("frontend_not_found");
      const acl = f.acls.find((a) => a.name === op.acl);
      if (!acl || !acl.sni) return fail("rule_not_found");
      const domains = normalizeDomains(op.domains);
      if (!domains) return fail("invalid_domains");
      if (domains.join(" ") === acl.domains.join(" ")) return fail("unchanged");
      const sameName = f.acls.filter((a) => a.name === op.acl);
      if (sameName.length > 1) return fail("ambiguous_rule");
      // Keep the original fetch, flags (e.g. `-m end`) and trailing comment;
      // only the matched values are replaced.
      const orig = lines[acl.line];
      const body = stripComment(orig);
      const am = /^(\s+)acl\s+(\S+)\s+(\S+)(?:\s+(.*?))?\s*$/.exec(body);
      if (!am) return fail("rule_not_found");
      const { flags } = splitAclArgs((am[4] ?? "").split(/\s+/).filter(Boolean));
      const comment = orig.slice(body.length);
      replace.set(
        acl.line,
        `${am[1]}acl ${acl.name} ${am[3]} ${[...flags, ...domains].join(" ")}${comment ? ` ${comment.trimStart()}` : ""}`,
      );
      summary = `${f.name}: ${op.acl} domains = ${domains.join(", ")}`;
      target = { backend: f.name, server: op.acl };
      break;
    }
    case "route.add": {
      if (!nameOk(op.frontend) || !nameOk(op.acl) || !nameOk(op.backend)) return fail("invalid_name");
      const f = findFrontend(op.frontend);
      const sec = sectionOf("frontend", op.frontend);
      if (!f || !sec) return fail("frontend_not_found");
      if (f.acls.some((a) => a.name === op.acl) || f.rules.some((r) => r.acl === op.acl)) return fail("acl_exists");
      if (!findBackend(op.backend)) return fail("backend_not_found");
      const domains = normalizeDomains(op.domains);
      if (!domains) return fail("invalid_domains");
      const lastAcl = f.acls.length ? f.acls[f.acls.length - 1].line : -1;
      const editableRules = f.rules.filter((r) => r.editable);
      const lastRule = editableRules.length ? editableRules[editableRules.length - 1].line : -1;
      const refLine = lastRule >= 0 ? lastRule : (f.defaultBackend?.line ?? lastContentLine(lines, sec) + 1);
      const indent = indentOf(lines[lastAcl >= 0 ? lastAcl : refLine] ?? lines[sec.header + 1]);
      const aclText = `${indent}acl ${op.acl} req.ssl_sni -i ${domains.join(" ")}`;
      const useText = `${indent}use_backend ${op.backend} if ${op.acl}`;
      if (lastAcl >= 0) {
        addAfter(lastAcl, aclText);
      }
      if (lastRule >= 0) {
        addAfter(lastRule, useText);
      } else if (f.defaultBackend) {
        // Insert before default_backend (= after the line preceding it).
        addAfter(f.defaultBackend.line - 1, useText);
      } else {
        addAfter(lastContentLine(lines, sec), useText);
      }
      if (lastAcl < 0) {
        // No ACLs yet: declare it right before its use.
        const useAnchor = lastRule >= 0 ? lastRule : f.defaultBackend ? f.defaultBackend.line - 1 : lastContentLine(lines, sec);
        insertAfter.get(useAnchor)!.unshift(aclText);
      }
      summary = `${f.name}: + ${op.acl} (${domains.join(", ")}) → ${op.backend}`;
      target = { backend: op.backend, server: op.acl };
      break;
    }
    case "route.remove": {
      if (!nameOk(op.frontend) || !nameOk(op.acl)) return fail("invalid_name");
      const f = findFrontend(op.frontend);
      if (!f) return fail("frontend_not_found");
      const rules = f.rules.filter((r) => r.acl === op.acl);
      if (rules.length === 0 || rules.some((r) => !r.editable)) return fail("rule_not_found");
      for (const r of rules) del.add(r.line);
      // Drop the ACL too unless something else in the frontend references it.
      const otherRefs = lines.some((l, i) => {
        if (i <= f.line || del.has(i)) return false;
        const sec = p.sections.find((s) => s.header === f.line);
        if (!sec || i >= sec.end) return false;
        const body = stripComment(l);
        if (/^\s+acl\s/.test(body)) return false;
        return new RegExp(`(^|[\\s!{(])${op.acl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[\\s})])`).test(body);
      });
      if (!otherRefs) {
        for (const a of f.acls.filter((a) => a.name === op.acl)) del.add(a.line);
      }
      summary = `${f.name}: − ${op.acl}`;
      target = { backend: rules[0].backend, server: op.acl };
      break;
    }
    case "frontend.default": {
      if (!nameOk(op.frontend) || !nameOk(op.backend)) return fail("invalid_name");
      const f = findFrontend(op.frontend);
      const sec = sectionOf("frontend", op.frontend);
      if (!f || !sec) return fail("frontend_not_found");
      if (!findBackend(op.backend)) return fail("backend_not_found");
      if (f.defaultBackend?.backend === op.backend) return fail("unchanged");
      if (f.defaultBackend) {
        replace.set(f.defaultBackend.line, replaceToken(lines[f.defaultBackend.line], f.defaultBackend.backend, op.backend, 1));
      } else {
        const last = lastContentLine(lines, sec);
        addAfter(last, `${indentOf(lines[last])}default_backend ${op.backend}`);
      }
      summary = `${f.name}: default ${f.defaultBackend?.backend ?? "—"} → ${op.backend}`;
      target = { backend: op.backend, server: "default" };
      break;
    }
    case "server.add": {
      if (!nameOk(op.backend) || !nameOk(op.name)) return fail("invalid_name");
      const b = findBackend(op.backend);
      const sec = sectionOf("backend", op.backend);
      if (!b || !sec) return fail("backend_not_found");
      if (b.servers.some((s) => s.name === op.name)) return fail("server_exists");
      const addr = parseAddr(op.addr);
      if (!addr || addr.port == null) return fail("invalid_addr");
      let params = templateParams(b, op.template);
      if (params == null) return fail("template_not_found");
      params = toggleBackup(params, op.backup === true);
      const anchor = b.servers.length ? b.servers[b.servers.length - 1].line : lastContentLine(lines, sec);
      const tmpl = b.servers.length ? lines[b.servers[b.servers.length - 1].line] : lines[anchor];
      addAfter(anchor, rewriteServerLine(tmpl.replace(/#.*$/, ""), op.name, formatAddr(addr.host, addr.port), params));
      summary = `${b.name}: + ${op.name} ${formatAddr(addr.host, addr.port)}`;
      target = { backend: b.name, server: op.name };
      break;
    }
    case "server.update": {
      if (!nameOk(op.backend) || !nameOk(op.server)) return fail("invalid_name");
      const b = findBackend(op.backend);
      if (!b) return fail("backend_not_found");
      const s = b.servers.find((x) => x.name === op.server);
      if (!s) return fail("server_not_found");
      let name = s.name;
      if (op.name != null && op.name !== s.name) {
        if (!nameOk(op.name)) return fail("invalid_name");
        if (b.servers.some((x) => x.name === op.name)) return fail("server_exists");
        name = op.name;
      }
      let addr = s.addr;
      if (op.addr != null && op.addr !== s.addr) {
        const a = parseAddr(op.addr);
        if (!a || a.port == null) return fail("invalid_addr");
        addr = formatAddr(a.host, a.port);
      }
      let params = s.params.replace(/#.*$/, "").trim();
      if (typeof op.backup === "boolean" && op.backup !== s.isBackup) params = toggleBackup(params, op.backup);
      if (name === s.name && addr === s.addr && params === s.params.replace(/#.*$/, "").trim()) return fail("unchanged");
      if (!PARAMS_RE.test(params)) return fail("invalid_params");
      if (op.backup === true && !s.isBackup) {
        const activeLeft = b.servers.filter((x) => !x.isBackup && x.name !== s.name);
        if (activeLeft.length === 0 && b.usedBy.length > 0) return fail("last_active_server", { backend: b.name });
      }
      replace.set(s.line, rewriteServerLine(lines[s.line], name, addr, params));
      const parts = [
        name !== s.name ? `${s.name} → ${name}` : s.name,
        addr !== s.addr ? `${s.addr} → ${addr}` : "",
        typeof op.backup === "boolean" && op.backup !== s.isBackup ? (op.backup ? "backup" : "active") : "",
      ].filter(Boolean);
      summary = `${b.name}: ${parts.join(", ")}`;
      target = { backend: b.name, server: name };
      break;
    }
    case "server.remove": {
      if (!nameOk(op.backend) || !nameOk(op.server)) return fail("invalid_name");
      const b = findBackend(op.backend);
      if (!b) return fail("backend_not_found");
      const s = b.servers.find((x) => x.name === op.server);
      if (!s) return fail("server_not_found");
      const orphans = orphanedBackends(model, new Set([`${b.name}/${s.name}`]));
      if (orphans.length) return fail("backend_would_be_empty", { backends: orphans });
      del.add(s.line);
      summary = `${b.name}: − ${s.name} ${s.addr}`;
      target = { backend: b.name, server: s.name };
      break;
    }
    case "node.readdress": {
      const node = model.nodes.find((n) => n.host === op.host);
      if (!node) return fail("node_not_found");
      if (!isValidHost(String(op.newHost ?? "")) || String(op.newHost).includes("/")) return fail("invalid_addr");
      if (op.newHost === op.host) return fail("unchanged");
      for (const b of model.backends) {
        for (const s of b.servers) {
          if (s.host !== op.host) continue;
          const addr = formatAddr(op.newHost, s.port);
          replace.set(s.line, rewriteServerLine(lines[s.line], s.name, addr, s.params.replace(/#.*$/, "").trim()));
        }
      }
      summary = `${op.host} → ${op.newHost} (${node.members.length})`;
      target = { backend: "*", server: op.newHost };
      break;
    }
    case "node.add": {
      if (!nameOk(op.name)) return fail("invalid_name");
      if (!isValidHost(String(op.host ?? ""))) return fail("invalid_addr");
      const targets = Array.isArray(op.targets) ? op.targets : [];
      if (targets.length === 0 || targets.length > 64) return fail("no_targets");
      const seen = new Set<string>();
      for (const t of targets) {
        if (!nameOk(t?.backend)) return fail("invalid_name");
        if (seen.has(t.backend)) return fail("duplicate_target");
        seen.add(t.backend);
        const b = findBackend(t.backend);
        const sec = sectionOf("backend", t.backend);
        if (!b || !sec) return fail("backend_not_found", { backend: t.backend });
        if (b.servers.some((s) => s.name === op.name)) return fail("server_exists", { backend: b.name });
        const port = t.port == null || t.port === ("" as unknown) ? (b.servers[0]?.port ?? null) : Number(t.port);
        if (port == null || !Number.isInteger(port) || port < 1 || port > 65535) return fail("invalid_addr", { backend: b.name });
        let params = templateParams(b);
        if (params == null) return fail("invalid_params", { backend: b.name });
        params = toggleBackup(params, t.backup === true);
        const anchor = b.servers.length ? b.servers[b.servers.length - 1].line : lastContentLine(lines, sec);
        const tmpl = b.servers.length ? lines[b.servers[b.servers.length - 1].line] : "    ";
        addAfter(anchor, rewriteServerLine(tmpl.replace(/#.*$/, ""), op.name, formatAddr(op.host, port), params));
      }
      summary = `+ ${op.name} ${op.host} → ${[...seen].join(", ")}`;
      target = { backend: [...seen].join(","), server: op.name };
      break;
    }
    case "node.remove": {
      const node = model.nodes.find((n) => n.host === op.host);
      if (!node) return fail("node_not_found");
      const keys = new Set(node.members.map((m) => `${m.backend}/${m.server}`));
      const orphans = orphanedBackends(model, keys);
      if (orphans.length) return fail("backend_would_be_empty", { backends: orphans });
      for (const b of model.backends) for (const s of b.servers) if (s.host === op.host) del.add(s.line);
      summary = `− ${op.host} (${node.members.length})`;
      target = { backend: "*", server: op.host };
      break;
    }
    case "backend.add": {
      if (!nameOk(op.name)) return fail("invalid_name");
      if (findBackend(op.name) || p.sections.some((s) => s.name === op.name && (s.kind === "backend" || s.kind === "listen"))) {
        return fail("backend_exists");
      }
      let body: string[] = [];
      let anchor = lastContentLine(lines, p.sections[p.sections.length - 1] ?? { kind: "other", name: "", header: lines.length - 1, end: lines.length });
      let indent = "    ";
      if (op.cloneFrom) {
        if (!nameOk(op.cloneFrom)) return fail("invalid_name");
        const src = sectionOf("backend", op.cloneFrom);
        if (!src || src.kind !== "backend") return fail("backend_not_found");
        for (let i = src.header + 1; i < src.end; i++) {
          const l = lines[i];
          if (/^\s+server\s/.test(stripComment(l))) { indent = indentOf(l, indent); continue; }
          if (!l.trim() || l.trim().startsWith("#")) continue;
          body.push(l);
        }
        anchor = lastContentLine(lines, src);
      }
      if (op.server) {
        if (!nameOk(op.server.name)) return fail("invalid_name");
        const a = parseAddr(op.server.addr);
        if (!a || a.port == null) return fail("invalid_addr");
        const src = op.cloneFrom ? findBackend(op.cloneFrom) : undefined;
        const params = src && src.servers.length ? templateParams(src) : "check";
        if (params == null) return fail("invalid_params");
        body.push(`${indent}server ${op.server.name} ${formatAddr(a.host, a.port)}${params ? ` ${params}` : ""}`);
      }
      body = ["", `backend ${op.name}`, ...body];
      for (const l of body) addAfter(anchor, l);
      summary = `+ backend ${op.name}${op.cloneFrom ? ` (${op.cloneFrom})` : ""}`;
      target = { backend: op.name, server: op.server?.name ?? "" };
      break;
    }
    case "backend.remove": {
      if (!nameOk(op.name)) return fail("invalid_name");
      const b = findBackend(op.name);
      const sec = sectionOf("backend", op.name);
      if (!b || !sec || sec.kind !== "backend") return fail("backend_not_found");
      if (b.usedBy.length) return fail("backend_in_use", { usedBy: b.usedBy });
      // Any other textual reference (e.g. use_backend with a complex condition).
      const refRe = new RegExp(`(^|\\s)${op.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
      const refs = lines.some((l, i) => (i < sec.header || i >= sec.end) && /^\s+(use_backend|default_backend|use-server)\b/.test(l) && refRe.test(stripComment(l)));
      if (refs) return fail("backend_in_use");
      let end = sec.end;
      // Keep trailing blank lines/comments that belong to the next section.
      while (end - 1 > sec.header && (!lines[end - 1].trim() || lines[end - 1].trim().startsWith("#"))) end -= 1;
      for (let i = sec.header; i < end; i++) del.add(i);
      // Swallow one preceding blank separator line so blank lines don't pile up.
      if (sec.header > 0 && !lines[sec.header - 1].trim()) del.add(sec.header - 1);
      summary = `− backend ${op.name}`;
      target = { backend: op.name, server: "" };
      break;
    }
    default:
      return fail("invalid_op");
  }

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!del.has(i)) out.push(replace.has(i) ? replace.get(i)! : lines[i]);
    const extra = insertAfter.get(i);
    if (extra) out.push(...extra);
  }
  const next = out.join(p.eol);
  if (next === config) return fail("unchanged");
  return { ok: true, config: next, summary, target, ...(from ? { from } : {}) };
}

/* ─── Diff ───────────────────────────────────────────────────────────────── */

export type DiffLine = { kind: "ctx" | "add" | "del" | "gap"; text: string; oldNo?: number; newNo?: number };

/** Compact line diff (LCS) with `context` unchanged lines around each change. */
export function diffConfigs(before: string, after: string, context = 2): DiffLine[] {
  const a = splitLines(before).lines;
  const b = splitLines(after).lines;
  // Trim common prefix/suffix first: edits are local, so the LCS core is tiny.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);

  const ops: DiffLine[] = [];
  for (let i = 0; i < pre; i++) ops.push({ kind: "ctx", text: a[i], oldNo: i + 1, newNo: i + 1 });
  if (A.length * B.length <= 4_000_000) {
    const n = A.length, m = B.length;
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { ops.push({ kind: "ctx", text: A[i], oldNo: pre + i + 1, newNo: pre + j + 1 }); i++; j++; }
      // Prefer deletions first so a replaced line reads "− old / + new".
      else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) { ops.push({ kind: "del", text: A[i], oldNo: pre + i + 1 }); i++; }
      else { ops.push({ kind: "add", text: B[j], newNo: pre + j + 1 }); j++; }
    }
  } else {
    A.forEach((t, i) => ops.push({ kind: "del", text: t, oldNo: pre + i + 1 }));
    B.forEach((t, j) => ops.push({ kind: "add", text: t, newNo: pre + j + 1 }));
  }
  for (let k = 0; k < suf; k++) {
    ops.push({ kind: "ctx", text: a[a.length - suf + k], oldNo: a.length - suf + k + 1, newNo: b.length - suf + k + 1 });
  }

  // Keep only `context` lines around changes, collapse the rest into gaps.
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, idx) => {
    if (o.kind === "ctx") return;
    for (let d = -context; d <= context; d++) if (ops[idx + d]) keep[idx + d] = true;
  });
  const result: DiffLine[] = [];
  let gap = false;
  ops.forEach((o, idx) => {
    if (keep[idx]) { result.push(o); gap = false; }
    else if (!gap) { result.push({ kind: "gap", text: "" }); gap = true; }
  });
  if (result[0]?.kind === "gap") result.shift();
  if (result[result.length - 1]?.kind === "gap") result.pop();
  return result;
}
