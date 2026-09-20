// web/src/pages/admin/monitoringFormat.ts
//
// Shared, single-source formatters for the admin monitoring compact rows.
// `null`/`undefined` means "metric unavailable" (render as "—"); a numeric 0 is
// a real value and must render as "0", never as "—".

function trim(n: number, digits: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = n.toFixed(digits);
  return rounded.includes(".") ? rounded.replace(/\.?0+$/, "") : rounded;
}

/** Human-readable bitrate from a Mbps value. 0 -> "0 Kbps", null -> "—". */
export function formatBitrate(mbps: number | null | undefined): string {
  if (mbps == null || !Number.isFinite(mbps)) return "—";
  const v = Math.max(0, mbps);
  if (v === 0) return "0 Kbps";
  if (v >= 1000) return `${trim(v / 1000, 2)} Gbps`;
  if (v >= 0.1) return `${trim(v, 2)} Mbps`;
  if (v >= 0.0001) return `${trim(v * 1000, 1)} Kbps`;
  return `${trim(v * 1_000_000, 0)} bps`;
}

/** Percentage value. 0 -> "0%", null -> "—". */
export function formatPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${trim(Math.min(100, Math.max(0, v)), 1)}%`;
}

/** Load average (1/5/15). 0 -> "0", null -> "—". */
export function formatLoad(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return trim(v, 2);
}

/**
 * Remnawave users/connections are shown only when the server is mapped AND the
 * value is actually known. An unmapped node must not show a fake "0".
 */
export function shouldShowRemnawaveUsers(mapped: boolean, onlineUsers: number | null | undefined): boolean {
  return mapped && onlineUsers != null && Number.isFinite(onlineUsers);
}