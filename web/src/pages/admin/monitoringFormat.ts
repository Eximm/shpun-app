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

/** Percentage value. 0 -> "0%", null -> "—". Values >100 are preserved. */
export function formatPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${trim(Math.max(0, v), 1)}%`;
}

/** Load average (1/5/15). 0 -> "0", null -> "—". */
export function formatLoad(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return trim(v, 2);
}

/**
 * Visual tone for the four explicit current states. Config existence is never
 * "online": no_data is neutral/soft, never green.
 */
export function stateTone(state: string | null | undefined): "ok" | "warn" | "bad" | "soft" {
  if (state === "fresh") return "ok";
  if (state === "stale") return "warn";
  if (state === "offline") return "bad";
  return "soft";
}
/** Duration in seconds -> compact human string (uses the shared style). */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Axis tick label depending on the selected range. */
export function formatAxisTime(ts: number, range: "1h" | "24h" | "7d" | "30d"): string {
  const d = new Date(ts * 1000);
  if (range === "1h" || range === "24h") {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/** Full timestamp for tooltips. */
export function formatTimestamp(ts: number, range: "1h" | "24h" | "7d" | "30d"): string {
  const d = new Date(ts * 1000);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (range === "1h" || range === "24h") return time;
  return `${d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })} ${time}`;
}

/** Format a metric value according to its unit. 0 -> "0", null -> "—". */
export function formatMetricValue(value: number | null | undefined, unit: "percent" | "bitrate" | "load"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "percent") return formatPct(value);
  if (unit === "bitrate") return formatBitrate(value);
  return formatLoad(value);
}

/** Compact "current / average / max" summary value. */
export function formatIncidentValue(value: number | null | undefined, unit: "percent" | "bitrate" | "load" | "count"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "count") return trim(value, 0);
  return formatMetricValue(value, unit);
}

/**
 * Y-axis ceiling for a metric. Percentage metrics are anchored at 0 so small
 * changes are not exaggerated; if a value exceeds 100 the ceiling expands.
 */
export function percentCeiling(max: number | null | undefined): number {
  if (max == null || !Number.isFinite(max) || max <= 100) return 100;
  return Math.ceil(max / 25) * 25;
}

/** Rule type -> i18n key (only real rule types produced by the engine). */
export function incidentRuleKey(ruleType: string): string {
  switch (ruleType) {
    case "offline": return "admin.monitoring.incident.rule.offline";
    case "stale_scrape": return "admin.monitoring.incident.rule.stale";
    case "high_cpu": return "admin.monitoring.incident.rule.cpu";
    case "high_memory": return "admin.monitoring.incident.rule.memory";
    case "high_disk": return "admin.monitoring.incident.rule.disk";
    case "high_inode": return "admin.monitoring.incident.rule.inode";
    case "uplink_saturation": return "admin.monitoring.incident.rule.uplink";
    case "network_errors": return "admin.monitoring.incident.rule.network";
    case "remnawave_offline": return "admin.monitoring.incident.rule.remnawave";
    default: return "admin.monitoring.incident.rule.unknown";
  }
}

/** Rule type -> graph metric key (null when no metric graph applies). */
export function incidentMetricKey(ruleType: string): "cpu" | "ram" | "disk" | "uplink" | "rx" | "tx" | null {
  switch (ruleType) {
    case "high_cpu": return "cpu";
    case "high_memory": return "ram";
    case "high_disk":
    case "high_inode": return "disk";
    case "uplink_saturation": return "uplink";
    case "network_errors": return "rx";
    default: return null;
  }
}
