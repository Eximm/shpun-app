// api/src/modules/serverStatus/health.ts
//
// Public-safe system health aggregation.
//
// The rich server status snapshot contains internal hostnames, exporter URLs
// and raw Node Exporter metrics. That data must never be exposed just to draw
// a header badge or a public status line. This module derives an aggregated
// status and a minimal public projection from the existing monitor snapshot.
//
// Aggregation model (critical vs non-critical):
//   - kind = "infra"  -> critical tier (account / subscriptions / auth).
//   - kind = "vpn"    -> individual VPN node, non-critical on its own.
//   - loadPct >= 85   -> degraded (node overloaded).
//
// States:
//   unknown  -> no configured servers, or no server produced a known state yet.
//   down     -> the critical tier is fully offline, or (when no infra is
//               configured) all known nodes are offline.
//   degraded -> the critical tier is partially offline or unverified, any VPN
//               node is offline, or any node is overloaded.
//   ok       -> at least one known state and no issues above.
//
// A single offline test/VPN node is NEVER treated as a full outage.

export type SystemHealthStatus = "ok" | "degraded" | "down" | "unknown";

export type HealthCheckInput = {
  kind: "vpn" | "infra";
  online: boolean | null;
  loadPct: number | null;
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
  const infraKnown = infra.filter((c) => c.online != null);
  const infraOffline = infraKnown.filter((c) => c.online === false).length;

  // Critical tier fully offline.
  if (infra.length > 0 && infraKnown.length > 0 && infraOffline === infraKnown.length) {
    return "down";
  }

  // No critical tier configured: a full wipe-out of all known nodes is an outage.
  if (infra.length === 0 && known.length > 0 && known.every((c) => c.online === false)) {
    return "down";
  }

  // Critical tier exists but has no confirmed state yet -> be honest, not green.
  if (infra.length > 0 && infraKnown.length === 0) {
    return "degraded";
  }

  const vpnOffline = checks.filter((c) => c.kind === "vpn" && c.online === false).length;
  const overloaded = checks.filter((c) => (c.loadPct ?? 0) >= 85).length;

  if (infraOffline > 0 || vpnOffline > 0 || overloaded > 0) {
    return "degraded";
  }

  return "ok";
}