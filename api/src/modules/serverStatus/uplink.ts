// api/src/modules/serverStatus/uplink.ts
//
// Uplink utilization is the operational metric behind the `uplink_saturation`
// incident. Pure function so the formula is unit tested and reported.
//
// Capacity priority (explicit config wins over NIC auto-detection):
//   1. configured `uplink_mbps` (>0)   -> "configured"
//   2. detected `node_network_speed_bytes` (>0) -> "detected"
//   3. otherwise null                  -> "unknown"
//
// Utilization uses full-duplex semantics: RX and TX have independent capacity,
// so the load of the link is max(rx, tx) / capacity — NOT (rx + tx) / capacity.
//
// The result is NOT clamped at 100: values like 117% / 184% are diagnostically
// important (configured capacity lower than actual traffic). Only NaN/Infinity
// and negative values are guarded.

export type UplinkCapacitySource = "configured" | "detected" | "unknown";

export type UplinkInput = {
  rxBps: number | null | undefined;
  txBps: number | null | undefined;
  configuredUplinkMbps: number | null | undefined;
  detectedUplinkSpeedBytes: number | null | undefined;
};

export type UplinkResult = {
  /** Utilization in percent, or null when capacity/traffic is unavailable. */
  pct: number | null;
  /** Effective capacity in bytes/sec, or null. */
  capacityBps: number | null;
  capacitySource: UplinkCapacitySource;
};

function finitePositive(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function finiteOrNull(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function resolveUplinkCapacity(input: UplinkInput): {
  capacityBps: number | null;
  capacitySource: UplinkCapacitySource;
} {
  const configured = finitePositive(input.configuredUplinkMbps);
  if (configured != null) {
    return { capacityBps: (configured * 1_000_000) / 8, capacitySource: "configured" };
  }
  const detected = finitePositive(input.detectedUplinkSpeedBytes);
  if (detected != null) {
    return { capacityBps: detected, capacitySource: "detected" };
  }
  return { capacityBps: null, capacitySource: "unknown" };
}

export function computeUplink(input: UplinkInput): UplinkResult {
  const { capacityBps, capacitySource } = resolveUplinkCapacity(input);

  // A provided-but-non-finite reading (NaN/Infinity) is invalid telemetry, not
  // a zero. Treat the whole sample as unavailable so it never hides an anomaly.
  const rxInvalid = input.rxBps != null && !Number.isFinite(Number(input.rxBps));
  const txInvalid = input.txBps != null && !Number.isFinite(Number(input.txBps));
  if (rxInvalid || txInvalid) return { pct: null, capacityBps, capacitySource };

  const rx = finiteOrNull(input.rxBps);
  const tx = finiteOrNull(input.txBps);
  if (capacityBps == null || (rx == null && tx == null)) {
    return { pct: null, capacityBps, capacitySource };
  }

  const peak = Math.max(rx ?? 0, tx ?? 0);
  const raw = (peak / capacityBps) * 100;
  if (!Number.isFinite(raw)) return { pct: null, capacityBps, capacitySource };

  return {
    pct: Math.max(0, Math.round(raw)),
    capacityBps,
    capacitySource,
  };
}