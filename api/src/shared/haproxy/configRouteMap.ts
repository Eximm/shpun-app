// api/src/shared/haproxy/configRouteMap.ts
//
// Phase 3: parse the editable SNI->country route map from haproxy.cfg and
// perform a surgical, single-line repoint of one `use_backend <X> if <acl>`
// rule to a different backend. Only simple SNI ACL rules are exposed as
// editable; complex conditions (path/var based, `if { ... }`) are ignored.
//
// The actual validate + reload happens server-side via the bridge; this module
// produces the exact new config text and is covered by tests so the single
// changed token is provably the only difference.

const NAME_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

export type RouteRule = {
  frontend: string;
  acl: string;
  backend: string;
  family: string; // e.g. "reality" / "router" — the backend name prefix
  domains: string[];
};

export type RouteMap = {
  backends: string[];
  rules: RouteRule[];
};

function familyOf(backend: string): string {
  const i = backend.indexOf("_");
  return i > 0 ? backend.slice(0, i) : backend;
}

export function parseRouteMap(config: string): RouteMap {
  const lines = String(config ?? "").split(/\r?\n/);

  const backends: string[] = [];
  const aclDomains = new Map<string, string[]>();
  type Raw = { frontend: string; acl: string; backend: string };
  const rawRules: Raw[] = [];

  let frontend = "";
  for (const line of lines) {
    const section = /^(frontend|backend|listen|defaults|global)\b\s*(\S*)/.exec(line);
    if (section) {
      if (section[1] === "frontend") frontend = section[2];
      else {
        if (section[1] === "backend" && section[2]) backends.push(section[2]);
        frontend = "";
      }
      continue;
    }

    const acl = /^\s+acl\s+(\S+)\s+req\.ssl_sni\s+-i\s+(.+?)\s*$/.exec(line);
    if (acl) {
      aclDomains.set(acl[1], acl[2].split(/\s+/).filter(Boolean));
      continue;
    }

    // Only a single bareword condition is an editable rule.
    const ub = /^\s+use_backend\s+(\S+)\s+if\s+([A-Za-z0-9_.:-]+)\s*$/.exec(line);
    if (ub && frontend) {
      rawRules.push({ frontend, acl: ub[2], backend: ub[1] });
    }
  }

  const rules: RouteRule[] = rawRules
    .filter((r) => aclDomains.has(r.acl))
    .map((r) => ({
      frontend: r.frontend,
      acl: r.acl,
      backend: r.backend,
      family: familyOf(r.backend),
      domains: aclDomains.get(r.acl) ?? [],
    }));

  return { backends, rules };
}

export type RepointResult =
  | { ok: true; config: string; from: string }
  | { ok: false; error: string };

/**
 * Repoint the single `use_backend <X> if <acl>` rule to <newBackend>.
 * Fails unless exactly one matching rule line exists and <newBackend> is a
 * defined backend. Returns the new config text (only that token changed).
 */
export function repointRoute(config: string, acl: string, newBackend: string): RepointResult {
  if (!NAME_RE.test(acl)) return { ok: false, error: "invalid_acl" };
  if (!NAME_RE.test(newBackend)) return { ok: false, error: "invalid_backend" };

  const map = parseRouteMap(config);
  if (!map.backends.includes(newBackend)) return { ok: false, error: "backend_not_found" };

  const escaped = acl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^(\\s*use_backend\\s+)(\\S+)(\\s+if\\s+${escaped}\\s*)$`, "gm");

  let count = 0;
  let from = "";
  const next = config.replace(re, (_m, pre: string, cur: string, post: string) => {
    count += 1;
    from = cur;
    return `${pre}${newBackend}${post}`;
  });

  if (count !== 1) return { ok: false, error: count === 0 ? "rule_not_found" : "ambiguous_rule" };
  if (from === newBackend) return { ok: true, config: next, from };
  return { ok: true, config: next, from };
}
