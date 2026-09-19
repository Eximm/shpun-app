// api/src/modules/serverStatus/health.ts
//
// Public-safe system health aggregation.
//
// The rich server status snapshot contains internal hostnames, exporter URLs
// and raw Node Exporter metrics. That data must never be exposed just to draw
// a header badge or a public status line. This module derives an aggregated
// status and a minimal public projection from the existing monitor snapshot.
//
// Aggregation model (availability, not observability):
//   - kind = "infra"  -> critical tier (account / subscriptions / auth).
//   - kind = "vpn"    -> individual VPN node, non-critical on its own.
//   - loadPct          -> observability ONLY, intentionally ignored here.
//
// States:
//   unknown  -> no configured servers, or no server produced a known state yet.
//   down     -> the critical tier is fully offline, or the VPN infrastructure is
//               fully offline.
//   degraded -> the critical tier is partially offline or unverified, or a
//               significant share (>= 50%) of known VPN nodes is offline.
//   ok       -> at least one known state and no issue above. A single offline
//               VPN node or a busy node is NOT a service problem.
//
// A busy (high-load) node is normal operations and must never flip the public
// badge to "Eсть проблемы". Load/CPU/RAM/network stay in admin diagnostics.

export type SystemHealthStatus = "ok" | "degraded" | "down" | "unknown";

export type HealthCheckInput = {
  kind: "vpn" | "infra";
  online: boolean | null;
  /** Observability only — deliberately unused by public aggregation. */
  loadPct?: number | null;
};

export type PublicServerCheck = {
  id: number;
  title: string;
  kind: "vpn" | "infra";
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
  kind: "vpn" | "infra";
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

export function aggregateHealthStatus(checks: HealthCheckInput[]): SystemHealthStatus {
  if (checks.length === 0) return "unknown";

  const known = checks.filter((c) => c.online != null);
  if (known.length === 0) return "unknown";

  const infra = checks.filter((c) => c.kind === "infra");
  const vpn = checks.filter((c) => c.kind === "vpn");
  const infraKnown = infra.filter((c) => c.online != null);
  const vpnKnown = vpn.filter((c) => c.online != null);
  const infraOffline = infraKnown.filter((c) => c.online === false).length;
  const vpnOffline = vpnKnown.filter((c) => c.online === false).length;

  // Critical tier fully offline.
  if (infra.length > 0 && infraKnown.length > 0 && infraOffline === infraKnown.length) {
    return "down";
  }

  // VPN infrastructure fully offline (all known VPN nodes down).
  if (vpn.length > 0 && vpnKnown.length > 0 && vpnOffline === vpnKnown.length) {
    return "down";
  }

  // Critical tier exists but has no confirmed state yet -> be honest, not green.
  if (infra.length > 0 && infraKnown.length === 0) {
    return "degraded";
  }

  // Partially offline critical tier.
  if (infraOffline > 0) {
    return "degraded";
  }

  // Significant share of VPN nodes offline (>= 50% of known VPN nodes).
  if (vpnKnown.length > 0 && vpnOffline > 0 && vpnOffline / vpnKnown.length >= 0.5) {
    return "degraded";
  }

  return "ok";
}