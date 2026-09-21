// web/src/pages/admin/MonitoringGraph.tsx
//
// Operational history graph for a single metric. Anchored percentage scales,
// effective threshold lines, incident intervals, time axis, viewport-safe
// tooltip and human-readable units. Pure SVG, no chart dependency.

import { useMemo, useRef, useState } from "react";
import { useI18n } from "../../shared/i18n";
import {
  formatAxisTime,
  formatMetricValue,
  formatTimestamp,
  percentCeiling,
} from "./monitoringFormat";

export type GraphUnit = "percent" | "bitrate" | "load";
export type GraphMetricKey = "cpu" | "ram" | "uplink" | "rx" | "tx" | "disk";

export type GraphPoint = {
  ts: number;
  cpuAvg: number | null; cpuMax: number | null;
  memAvg: number | null; memMax: number | null;
  diskAvg: number | null; diskMax: number | null;
  rxAvg: number | null; rxMax: number | null;
  txAvg: number | null; txMax: number | null;
  uplinkAvg: number | null; uplinkMax: number | null;
};

export type GraphIncident = {
  id: number;
  ruleType: string;
  severity: "info" | "warning" | "critical";
  openedAt: number;
  resolvedAt: number | null;
};

export type GraphMetricDef = {
  key: GraphMetricKey;
  labelKey: string;
  unit: GraphUnit;
  pickAvg: (p: GraphPoint) => number | null;
  pickMax: (p: GraphPoint) => number | null;
};

const toMbps = (bytesPerSec: number | null) =>
  bytesPerSec == null ? null : (bytesPerSec * 8) / 1_000_000;

export const MONITORING_METRICS: GraphMetricDef[] = [
  { key: "cpu", labelKey: "admin.monitoring.metric.cpu", unit: "percent", pickAvg: (p) => p.cpuAvg, pickMax: (p) => p.cpuMax },
  { key: "ram", labelKey: "admin.monitoring.metric.ram", unit: "percent", pickAvg: (p) => p.memAvg, pickMax: (p) => p.memMax },
  { key: "uplink", labelKey: "admin.monitoring.metric.uplink_load", unit: "percent", pickAvg: (p) => p.uplinkAvg, pickMax: (p) => p.uplinkMax },
  { key: "rx", labelKey: "admin.monitoring.metric.rx", unit: "bitrate", pickAvg: (p) => toMbps(p.rxAvg), pickMax: (p) => toMbps(p.rxMax) },
  { key: "tx", labelKey: "admin.monitoring.metric.tx", unit: "bitrate", pickAvg: (p) => toMbps(p.txAvg), pickMax: (p) => toMbps(p.txMax) },
  { key: "disk", labelKey: "admin.monitoring.metric.disk", unit: "percent", pickAvg: (p) => p.diskAvg, pickMax: (p) => p.diskMax },
];

const W = 300;
const H = 88;

export function MonitoringGraph({
  metric, points, current, threshold, thresholdCrit, incidents, range, isFocus, note,
}: {
  metric: GraphMetricDef;
  points: GraphPoint[];
  current: number | null;
  threshold?: number | null;
  thresholdCrit?: number | null;
  incidents: GraphIncident[];
  range: "1h" | "24h" | "7d" | "30d";
  isFocus?: boolean;
  note?: string;
}) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const values = points.map(metric.pickAvg);
  const nums = values.filter((v): v is number => v != null);
  const maxVal = nums.length ? Math.max(...nums, threshold ?? 0, thresholdCrit ?? 0) : 0;
  const yMax = metric.unit === "percent" ? percentCeiling(maxVal) : maxVal > 0 ? maxVal * 1.05 : 1;

  const stats = useMemo(() => {
    if (!nums.length) return { avg: null as number | null, max: null as number | null };
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    return { avg, max: Math.max(...nums) };
  }, [values.join("|")]);

  const tsMin = points.length ? points[0].ts : 0;
  const tsMax = points.length ? points[points.length - 1].ts : 1;
  const span = Math.max(1, tsMax - tsMin);
  const x = (ts: number) => Math.min(W, Math.max(0, ((ts - tsMin) / span) * W));
  const y = (v: number) => H - Math.min(H, Math.max(0, (v / yMax) * H));

  // Break the line on null gaps so missing telemetry is visible.
  const segments: string[] = [];
  let seg: string[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (seg.length > 1) segments.push(seg.join(" "));
      seg = [];
      return;
    }
    seg.push(`${x(points[i].ts).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (seg.length > 1) segments.push(seg.join(" "));

  const axisTs = points.length
    ? [tsMin, tsMin + span / 3, tsMin + (2 * span) / 3, tsMax]
    : [];

  function onPointer(ev: React.PointerEvent<SVGSVGElement>) {
    if (!points.length) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const frac = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    const target = tsMin + frac * span;
    let best = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p.ts - target);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    setHoverIdx(best);
  }

  const hover = hoverIdx != null ? points[hoverIdx] : null;
  const hoverVal = hoverIdx != null ? metric.pickAvg(points[hoverIdx]) : null;
  const hoverFrac = hover ? (x(hover.ts) / W) : 0;

  const incidentRects = incidents
    .map((inc) => {
      const start = x(Math.max(inc.openedAt, tsMin));
      const end = x(Math.min(inc.resolvedAt ?? tsMax, tsMax));
      if (end < 0 || start > W) return null;
      return { id: inc.id, x: start, w: Math.max(1.5, end - start), severity: inc.severity };
    })
    .filter((r): r is { id: number; x: number; w: number; severity: "info" | "warning" | "critical" } => r !== null);

  return (
    <div className={`mon-graph${isFocus ? " is-focus" : ""}`} ref={wrapRef}>
      <div className="mon-graph__head">
        <span className="mon-graph__title">
          {isFocus ? "⚠ " : ""}{t(metric.labelKey)}
        </span>
        {threshold != null && <span className="mon-graph__threshold">{`${t("admin.monitoring.graph.threshold")} ${formatMetricValue(threshold, metric.unit)}`}</span>}
      </div>
      <div className="mon-graph__stats">
        <span>{t("admin.monitoring.graph.now")} <b>{formatMetricValue(current, metric.unit)}</b></span>
        <span>{t("admin.monitoring.graph.avg")} <b>{formatMetricValue(stats.avg, metric.unit)}</b></span>
        <span>{t("admin.monitoring.graph.max")} <b>{formatMetricValue(stats.max, metric.unit)}</b></span>
      </div>
      {note && <div className="mon-graph__note">{note}</div>}
      {points.length < 2 ? (
        <div className="mon-graph__empty">{t("admin.monitoring.history.empty")}</div>
      ) : (
        <div className="mon-graph__plot">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${t(metric.labelKey)}`}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setHoverIdx(null)}
          >
            {incidentRects.map((r) => (
              <rect
                key={r.id}
                x={r.x}
                y={0}
                width={r.w}
                height={H}
                className={`mon-graph__incident mon-graph__incident--${r.severity}`}
              />
            ))}
            {threshold != null && threshold <= yMax && (
              <line x1={0} x2={W} y1={y(threshold)} y2={y(threshold)} className="mon-graph__thresholdLine" />
            )}
            {thresholdCrit != null && thresholdCrit <= yMax && (
              <line x1={0} x2={W} y1={y(thresholdCrit)} y2={y(thresholdCrit)} className="mon-graph__thresholdLine is-critical" />
            )}
            {segments.map((pts, i) => (
              <polyline key={i} points={pts} className="mon-graph__line" />
            ))}
            {hover && hoverVal != null && (
              <circle cx={x(hover.ts)} cy={y(hoverVal)} r={2.5} className="mon-graph__cursor" />
            )}
          </svg>
          <div className="mon-graph__axis">
            {axisTs.map((ts, i) => <span key={i}>{formatAxisTime(ts, range)}</span>)}
          </div>
          {hover && (
            <div
              className="mon-graph__tooltip"
              style={{ left: `${Math.min(85, Math.max(0, hoverFrac * 100))}%` }}
            >
              <div className="mon-graph__tooltipTime">{formatTimestamp(hover.ts, range)}</div>
              <div>{`${t(metric.labelKey)}: ${hoverVal == null ? t("admin.monitoring.graph.no_data") : formatMetricValue(hoverVal, metric.unit)}`}</div>
              {threshold != null && <div>{`${t("admin.monitoring.graph.threshold")}: ${formatMetricValue(threshold, metric.unit)}`}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}