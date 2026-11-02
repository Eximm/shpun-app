// api/src/modules/serverStatus/health.ts
//
// Public-safe system health aggregation.
//
// The rich server status snapshot contains internal hostnames, exporter URLs
// and raw Node Exporter metrics. That data must never be exposed just to draw
// a header badge or a public status line. This module derives an aggregated
// status and a minimal public projection from the existing monitor snapshot.
//
// Explicit healthGroup replicas are evaluated as one service: any fresh online
// replica is sufficient. Losing redundancy remains an admin incident.
// Aggregation model (availability, not observability):
//   - kind = "infra" | "gateway"  -> critical tier (account / auth / edge).
//   - kind = "vpn"                -> individual VPN node, non-critical on its own.
//   - loadPct                     -> observability ONLY, intentionally ignored.
//
// Visibility vs health impact are independent:
//   - `visibility = admin_only` hides a server from every public payload.
//   - `affectsPublicHealth = true` lets a hidden server still influence the
//     aggregate badge WITHOUT revealing its identity, count or topology.
//
// States:
//   unknown  -> no effective servers, or none produced a known state yet.
//   down     -> the critical tier is fully offline, or the VPN infrastructure is
//               fully offline.
//   degraded -> the critical tier is partially offline or unverified, or a
//               significant share (>= 50%) of known VPN nodes is offline.
//   ok       -> at least one known state and no issue above.
//
// A busy (high-load) node is normal operations and must never flip the public
// badge to "Есть проблемы". Load/CPU/RAM/network stay in admin diagnostics.

export type SystemHealthStatus = "ok" | "degraded" | "down" | "unknown";

export type HealthCheckInput = {
  kind: "vpn" | "gateway" | "infra";
  online: boolean | null;
  /** Observability only — deliberately unused by public aggregation. */
  loadPct?: number | null;
  /** `admin_only` servers are hidden from public payloads. */
  visibility?: "public" | "admin_only";
  /** Whether a server participates in the aggregate public health. */
  affectsPublicHealth?: boolean;
  /** Explicit critical-tier override (defaults from `kind`). */
  critical?: boolean;
  /** Explicit interchangeable replicas of one service; never inferred from kind/name. */
  healthGroup?: string | null;
  state?: "fresh" | "stale" | "offline" | "no_data";

};

export type PublicServerCheck = {
  id: number;
  title: string;
  kind: "vpn" | "gateway" | "infra";
  countryCode: string | null;
  online: boolean | null;
  uptime: string | null;
  loadPct: number | null;
  checkedAt: string | null;
};

/** Full monitor check -> minimal public projection (no host / exporter / raw metrics). */
export function toPublicCheck(check: {
  id: number;
  title: string;
  kind: "vpn" | "gateway" | "infra";
  countryCode: string | null;
  online: boolean | null;
  uptime: string | null;
  loadPct: number | null;
  checkedAt: string | null;
}): PublicServerCheck {
  return {
    id: check.id,
    title: check.title,
    kind: check.kind,
    countryCode: check.countryCode,
    online: check.online,
    uptime: check.uptime,
    loadPct: check.loadPct,
    checkedAt: check.checkedAt,
  };
}

function isCritical(c: HealthCheckInput): boolean {
  if (c.critical === true) return true;
  if (c.critical === false) return false;
  return c.kind !== "vpn";
}

/** Hidden servers only affect aggregate health when explicitly opted in. */
function isEffective(c: HealthCheckInput): boolean {
  if (c.affectsPublicHealth === false) return false;
  if (c.visibility === "admin_only" && c.affectsPublicHealth !== true) return false;
  return true;
}

export function aggregateHealthStatus(input: HealthCheckInput[]): SystemHealthStatus {
  const effective = input.filter(isEffective).map((c) => ({
    ...c,
    online: c.state === "stale" || c.state === "no_data" ? null : c.online,
  }));
  const groups = new Map<string, HealthCheckInput[]>();
  const checks = effective.filter((c) => {
    if (!c.healthGroup?.trim()) return true;
    // Critical dependencies and VPN capacity must never mask each other.
    const key = `${isCritical(c) ? "critical" : "vpn"}:${c.healthGroup.trim()}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
    return false;
  });
  for (const members of groups.values()) {
    const online = members.some((c) => c.online === true) ? true
      : members.every((c) => c.online === false) ? false : null;
    // Loss of a named critical service is an outage even if other services work.
    if (isCritical(members[0]) && online === false) return "down";
    checks.push({ ...members[0], online });
  }
  if (checks.length === 0) return "unknown";

  const known = checks.filter((c) => c.online != null);
  if (known.length === 0) return "unknown";

  const critical = checks.filter(isCritical);
  const vpn = checks.filter((c) => !isCritical(c));
  const criticalKnown = critical.filter((c) => c.online != null);
  const vpnKnown = vpn.filter((c) => c.online != null);
  const criticalOffline = criticalKnown.filter((c) => c.online === false).length;
  const vpnOffline = vpnKnown.filter((c) => c.online === false).length;

  // Critical tier fully offline.
  if (critical.length > 0 && criticalKnown.length > 0 && criticalOffline === criticalKnown.length) {
    return "down";
  }

  // VPN infrastructure fully offline (all known VPN nodes down).
  if (vpn.length > 0 && vpnKnown.length > 0 && vpnOffline === vpnKnown.length) {
    return "down";
  }

  // Critical tier exists but has no confirmed state yet -> be honest, not green.
  if (critical.some((c) => c.online == null)) {
    return "degraded";
  }

  // Partially offline critical tier.
  if (criticalOffline > 0) {
    return "degraded";
  }

  // Significant share of VPN nodes offline (>= 50% of known VPN nodes).
  if (vpnKnown.length > 0 && vpnOffline > 0 && vpnOffline / vpnKnown.length >= 0.5) {
    return "degraded";
  }

  return "ok";
}