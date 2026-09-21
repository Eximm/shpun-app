// web/src/pages/admin/MonitoringIncidents.tsx
//
// Global incident surface for Admin Monitoring: Active / History tabs, light
// severity + range filters, human rule labels, click-through to the server card
// and its relevant graph.

import { useI18n } from "../../shared/i18n";
import { formatBitrate, formatDuration, formatIncidentValue, incidentRuleKey } from "./monitoringFormat";

export type IncidentContext = {
  rxBps: number | null;
  txBps: number | null;
  capacityBps: number | null;
  capacitySource: "configured" | "detected" | "unknown";
  calculatedPct: number | null;
  threshold: number | null;
};

export type IncidentDto = {
  id: number;
  serverId: number;
  serverTitle: string;
  serverKind: string | null;
  ruleType: string;
  severity: "info" | "warning" | "critical";
  state: string;
  openedAt: number;
  confirmedAt: number | null;
  resolvedAt: number | null;
  lastSeenAt: number;
  value: number | null;
  triggerValue: number | null;
  peakValue: number | null;
  threshold: number | null;
  message: string;
  context?: IncidentContext | null;
  durationSec: number;
};

export type IncidentCounts = { critical: number; warning: number; total: number };
export type IncidentTab = "active" | "history";
export type IncidentSeverityFilter = "all" | "critical" | "warning";
export type IncidentRange = "24h" | "7d" | "30d";

function unitFor(ruleType: string): "percent" | "count" {
  return ruleType === "network_errors" ? "count" : "percent";
}

function severityIcon(severity: string) {
  return severity === "critical" ? "🔴" : severity === "warning" ? "⚠" : "ℹ";
}

function fmtClock(ts: number) {
  const d = new Date(ts * 1000);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function capacityLabel(bps: number | null): string {
  return bps != null ? formatBitrate((bps * 8) / 1_000_000) : "—";
}

/** Whitelisted uplink diagnostics, collapsed by default. */
function UplinkDiagnostics({ context }: { context: IncidentContext }) {
  const { t } = useI18n();
  return (
    <details className="mon-incidentCard__details">
      <summary>{t("admin.monitoring.incident.diagnostics")}</summary>
      <div className="mon-kv">
        <span>{t("admin.monitoring.metric.rx")}</span><b>{capacityLabel(context.rxBps)}</b>
        <span>{t("admin.monitoring.metric.tx")}</span><b>{capacityLabel(context.txBps)}</b>
        <span>{t("admin.monitoring.metric.capacity")}</span><b>{capacityLabel(context.capacityBps)}</b>
        <span>{t("admin.monitoring.capacity.source")}</span><b>{t(`admin.monitoring.capacity.source.${context.capacitySource}`)}</b>
        <span>{t("admin.monitoring.incident.calculated")}</span><b>{formatIncidentValue(context.calculatedPct, "percent")}</b>
        <span>{t("admin.monitoring.incident.threshold")}</span><b>{formatIncidentValue(context.threshold, "percent")}</b>
      </div>
    </details>
  );
}

export function MonitoringIncidents({
  active, history, counts, total, tab, onTab, severity, onSeverity, range, onRange, onOpenIncident, refreshing,
}: {
  active: IncidentDto[];
  history: IncidentDto[];
  counts: IncidentCounts;
  total: number;
  tab: IncidentTab;
  onTab: (tab: IncidentTab) => void;
  severity: IncidentSeverityFilter;
  onSeverity: (severity: IncidentSeverityFilter) => void;
  range: IncidentRange;
  onRange: (range: IncidentRange) => void;
  onOpenIncident: (incident: IncidentDto) => void;
  refreshing: boolean;
}) {
  const { t } = useI18n();

  return (
    <section className="mon-incidents" id="mon-incidents">
      <div className="mon-incidents__head">
        <h3 className="h2 mon-incidents__title">{t("admin.monitoring.incidents.section_title")}</h3>
        <div className="mon-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "active"}
            className={`mon-tab${tab === "active" ? " is-active" : ""}`}
            onClick={() => onTab("active")}
          >
            {t("admin.monitoring.incidents.tab.active")}{counts.total > 0 ? ` (${counts.total})` : ""}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "history"}
            className={`mon-tab${tab === "history" ? " is-active" : ""}`}
            onClick={() => onTab("history")}
          >
            {t("admin.monitoring.incidents.tab.history")}
          </button>
        </div>
      </div>

      <div className="mon-incidents__filters">
        <div className="mon-chipRow">
          {(["all", "critical", "warning"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`mon-chipFilter${severity === s ? " is-active" : ""}`}
              onClick={() => onSeverity(s)}
            >
              {s === "all" ? t("admin.monitoring.incidents.filter.all") : s === "critical" ? t("admin.monitoring.incident.severity.critical") : t("admin.monitoring.incident.severity.warning")}
            </button>
          ))}
        </div>
        {tab === "history" && (
          <div className="mon-chipRow">
            {(["24h", "7d", "30d"] as const).map((r) => (
              <button
                key={r}
                type="button"
                className={`mon-chipFilter${range === r ? " is-active" : ""}`}
                onClick={() => onRange(r)}
              >
                {t(`admin.monitoring.incidents.range.${r}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === "active" ? (
        active.length === 0 ? (
          <div className="mon-incidents__empty">✓ {t("admin.monitoring.incidents.empty.active")}</div>
        ) : (
          <div className="mon-incidentList">
            {active.map((inc) => {
              const unit = unitFor(inc.ruleType);
              const showWas = inc.triggerValue != null && inc.value != null && inc.triggerValue !== inc.value;
              return (
                <div key={inc.id} className={`mon-incidentCard mon-incidentCard--${inc.severity}`}>
                  <button type="button" className="mon-incidentCard__main" onClick={() => onOpenIncident(inc)}>
                    <div className="mon-incidentCard__top">
                      <span className="mon-incidentCard__server">{severityIcon(inc.severity)} {inc.serverTitle}</span>
                      <span className="mon-incidentCard__state">{t(`admin.monitoring.incident.state.${inc.state}`)}</span>
                    </div>
                    <div className="mon-incidentCard__rule">{t(incidentRuleKey(inc.ruleType))}</div>
                    <div className="mon-incidentCard__meta">
                      {t(`admin.monitoring.incident.severity.${inc.severity}`)} · {t(`admin.monitoring.incident.state.${inc.state}`)}
                    </div>
                    <div className="mon-incidentCard__values">
                      {showWas ? `${t("admin.monitoring.incident.was")} ${formatIncidentValue(inc.triggerValue, unit)}` : ""}
                      {inc.value != null ? ` ${t("admin.monitoring.incident.now")} ${formatIncidentValue(inc.value, unit)}` : ""}
                      {inc.peakValue != null && inc.peakValue !== inc.value ? ` · ${t("admin.monitoring.incident.peak")} ${formatIncidentValue(inc.peakValue, unit)}` : ""}
                      {inc.threshold != null ? ` · ${t("admin.monitoring.incident.threshold")} ${formatIncidentValue(inc.threshold, unit)}` : ""}
                    </div>
                    <div className="mon-incidentCard__meta">
                      {`${t("admin.monitoring.incident.started")} ${fmtClock(inc.openedAt)} · ${t("admin.monitoring.incident.duration")} ${formatDuration(inc.durationSec)}`}
                    </div>
                  </button>
                  {inc.context && <UplinkDiagnostics context={inc.context} />}
                </div>
              );
            })}
          </div>
        )
      ) : history.length === 0 ? (
        <div className="mon-incidents__empty">{t("admin.monitoring.incidents.empty.history")}</div>
      ) : (
        <div className="mon-incidentList">
          {history.map((inc) => {
            const unit = unitFor(inc.ruleType);
            const peak = inc.peakValue ?? inc.value;
            return (
              <div key={inc.id} className={`mon-incidentCard is-resolved mon-incidentCard--${inc.severity}`}>
                <button type="button" className="mon-incidentCard__main" onClick={() => onOpenIncident(inc)}>
                  <div className="mon-incidentCard__top">
                    <span className="mon-incidentCard__server">✓ {inc.serverTitle}</span>
                    <span className="mon-incidentCard__state">{t("admin.monitoring.incident.state.resolved")}</span>
                  </div>
                  <div className="mon-incidentCard__rule">
                    {t(incidentRuleKey(inc.ruleType))} · {t(`admin.monitoring.incident.severity.${inc.severity}`)}
                  </div>
                  <div className="mon-incidentCard__meta">
                    {fmtClock(inc.openedAt)} → {inc.resolvedAt ? fmtClock(inc.resolvedAt) : "—"}
                    {" · "}{formatDuration(inc.durationSec)}
                  </div>
                  <div className="mon-incidentCard__values">
                    {peak != null ? `${t("admin.monitoring.incident.peak")} ${formatIncidentValue(peak, unit)}` : ""}
                    {inc.threshold != null ? ` · ${t("admin.monitoring.incident.threshold")} ${formatIncidentValue(inc.threshold, unit)}` : ""}
                  </div>
                </button>
                {inc.context && <UplinkDiagnostics context={inc.context} />}
              </div>
            );
          })}
          {total > history.length && (
            <div className="mon-incidents__more">{t("admin.monitoring.incidents.more", { shown: history.length, total })}</div>
          )}
        </div>
      )}
      {refreshing && <div className="mon-incidents__refreshing">{t("common.loading")}</div>}
    </section>
  );
}