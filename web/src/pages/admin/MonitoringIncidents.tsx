// web/src/pages/admin/MonitoringIncidents.tsx
//
// Global incident surface for Admin Monitoring: Active / History tabs, light
// severity + range filters, human rule labels, click-through to the server card
// and its relevant graph.

import { useI18n } from "../../shared/i18n";
import { formatDuration, formatIncidentValue, incidentRuleKey } from "./monitoringFormat";

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
  threshold: number | null;
  message: string;
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
            {active.map((inc) => (
              <button
                key={inc.id}
                type="button"
                className={`mon-incidentCard mon-incidentCard--${inc.severity}`}
                onClick={() => onOpenIncident(inc)}
              >
                <div className="mon-incidentCard__top">
                  <span className="mon-incidentCard__server">{severityIcon(inc.severity)} {inc.serverTitle}</span>
                  <span className="mon-incidentCard__state chip chip--warn">{t(`admin.monitoring.incident.state.${inc.state}`)}</span>
                </div>
                <div className="mon-incidentCard__rule">{t(incidentRuleKey(inc.ruleType))}</div>
                <div className="mon-incidentCard__meta">
                  {inc.value != null && inc.threshold != null
                    ? `${formatIncidentValue(inc.value, unitFor(inc.ruleType))} > ${formatIncidentValue(inc.threshold, unitFor(inc.ruleType))}`
                    : t(`admin.monitoring.incident.severity.${inc.severity}`)}
                  {" · "}{formatDuration(inc.durationSec)}
                </div>
              </button>
            ))}
          </div>
        )
      ) : history.length === 0 ? (
        <div className="mon-incidents__empty">{t("admin.monitoring.incidents.empty.history")}</div>
      ) : (
        <div className="mon-incidentList">
          {history.map((inc) => (
            <button
              key={inc.id}
              type="button"
              className={`mon-incidentCard is-resolved mon-incidentCard--${inc.severity}`}
              onClick={() => onOpenIncident(inc)}
            >
              <div className="mon-incidentCard__top">
                <span className="mon-incidentCard__server">✓ {inc.serverTitle}</span>
                <span className="mon-incidentCard__state">{t(`admin.monitoring.incident.severity.${inc.severity}`)}</span>
              </div>
              <div className="mon-incidentCard__rule">{t(incidentRuleKey(inc.ruleType))}</div>
              <div className="mon-incidentCard__meta">
                {fmtClock(inc.openedAt)} → {inc.resolvedAt ? fmtClock(inc.resolvedAt) : "—"}
                {" · "}{formatDuration(inc.durationSec)}
              </div>
            </button>
          ))}
          {total > history.length && (
            <div className="mon-incidents__more">{t("admin.monitoring.incidents.more", { shown: history.length, total })}</div>
          )}
        </div>
      )}
      {refreshing && <div className="mon-incidents__refreshing">{t("common.loading")}</div>}
    </section>
  );
}