// api/src/modules/serverStatus/incidents.ts
//
// Stateful anomaly/incident engine with hysteresis, confirmation and cooldown.
//
// A single sample never opens an incident. Each rule first creates a PENDING
// incident, which is confirmed only after the configured duration
// (time-based rules) or a number of consecutive failed checks (availability).
// Recovery requires the condition to be fully cleared (with hysteresis for
// percentage metrics) for `recoveryChecks` consecutive cycles.
//
// The engine is pure with respect to notification dispatch: it returns a list
// of events and the caller decides how to notify. Persistence (streaks,
// active incident, notify state) lives in incidentsRepo.

import {
  confirmIncident,
  createPendingIncident,
  dropPendingIncident,
  escalateIncident,
  findActiveIncident,
  markIncidentNotified,
  markIncidentSeen,
  markRecovering,
  resolveIncident,
  setAlerting,
  type IncidentSeverity,
  type MonitoringIncidentRow,
} from "./incidentsRepo.js";
import type { MonitoringThresholds } from "./settingsRepo.js";

export type IncidentEventKind = "opened" | "resolved" | "reminder" | "escalated";

export type IncidentEvent = {
  kind: IncidentEventKind;
  incident: MonitoringIncidentRow;
  serverId: number;
  serverTitle: string;
  ruleType: string;
  severity: IncidentSeverity;
  ts: number;
  message: string;
  /** Seconds the incident was active (resolved events only). */
  durationSec?: number;
};

export type RuleEvaluation = {
  ruleType: string;
  severity: IncidentSeverity;
  /** Condition currently present (opens/keeps an incident). */
  active: boolean;
  /**
   * Condition still present for hysteresis purposes. Recovery is only counted
   * when this is false. Defaults to `active`.
   */
  hold?: boolean;
  value: number | null;
  threshold: number | null;
  message: string;
  context?: Record<string, unknown>;
  /** Time-based rules: seconds the pending state must last before confirming. */
  confirmAfterSec?: number;
  /** Count-based rules (availability): consecutive triggers before confirming. */
  confirmAfterChecks?: number;
};

type EvaluationInput = {
  serverId: number;
  serverTitle: string;
  ts: number;
  thresholds: MonitoringThresholds;
  rules: RuleEvaluation[];
};

const HOUR = 3600;

/**
 * Evaluate all rules for one server and return notification events.
 * Persistence is updated as a side effect.
 */
export function evaluateServerIncidents(input: EvaluationInput): IncidentEvent[] {
  const events: IncidentEvent[] = [];
  const { serverId, serverTitle, ts, thresholds } = input;

  for (const rule of finalizeRules(input.rules)) {
    const active = findActiveIncident(serverId, rule.ruleType);
    const hold = rule.hold ?? rule.active;

    if (!active) {
      if (!rule.active) continue;
      const created = createPendingIncident({
        serverId,
        ruleType: rule.ruleType,
        severity: rule.severity,
        ts,
        value: rule.value,
        threshold: rule.threshold,
        message: rule.message,
        context: rule.context,
      });
      // Availability rules confirm after N failed checks (handled on later
      // cycles); immediate rules opt in explicitly with `confirmAfterChecks: 1`
      // or `confirmAfterSec: 0`. Everything else needs at least a second cycle.
      const immediate = rule.confirmAfterChecks === 1 || rule.confirmAfterSec === 0;
      if (immediate) {
        confirmIncident(created.id, ts);
        const confirmed = findActiveIncident(serverId, rule.ruleType)!;
        events.push(toEvent("opened", confirmed, serverId, serverTitle, ts));
        markIncidentNotified(confirmed.id, ts, "notified", 1);
      }
      continue;
    }

    if (active.state === "pending") {
      if (!active.resolved_at && hold) {
        markIncidentSeen(active.id, { ts, value: rule.value, message: rule.message, context: rule.context });
        const refreshed = findActiveIncident(serverId, rule.ruleType)!;
        const durationOk =
          (rule.confirmAfterSec ?? 0) > 0 ? ts - refreshed.opened_at >= (rule.confirmAfterSec ?? 0) : true;
        const checksOk =
          (rule.confirmAfterChecks ?? 0) > 0 ? refreshed.streak >= (rule.confirmAfterChecks ?? 0) : true;
        if (durationOk && checksOk) {
          confirmIncident(refreshed.id, ts);
          const confirmed = findActiveIncident(serverId, rule.ruleType)!;
          events.push(toEvent("opened", confirmed, serverId, serverTitle, ts));
          markIncidentNotified(confirmed.id, ts, "notified", 1);
        }
      } else {
        // Condition disappeared before confirmation -> silent cancel.
        dropPendingIncident(active.id);
      }
      continue;
    }

    // Active alerting / recovering.
    if (hold) {
      markIncidentSeen(active.id, { ts, value: rule.value, message: rule.message, context: rule.context });
      const refreshed = findActiveIncident(serverId, rule.ruleType)!;
      if (refreshed.state === "recovering") {
        // Condition returned before recovery completed -> back to alerting.
        setAlerting(refreshed.id, ts);
      }
      if (rule.severity === "critical" && refreshed.severity !== "critical") {
        escalateIncident(active.id, "critical", rule.message);
        const escalated = findActiveIncident(serverId, rule.ruleType)!;
        events.push(toEvent("escalated", escalated, serverId, serverTitle, ts));
        markIncidentNotified(escalated.id, ts, "notified", escalated.notify_count + 1);
      } else if (
        refreshed.last_notified_at != null &&
        thresholds.reminderSec > 0 &&
        ts - refreshed.last_notified_at >= thresholds.reminderSec
      ) {
        events.push(toEvent("reminder", refreshed, serverId, serverTitle, ts));
        markIncidentNotified(refreshed.id, ts, "notified", refreshed.notify_count + 1);
      }
    } else {
      markRecovering(active.id, ts);
      const refreshed = findActiveIncident(serverId, rule.ruleType)!;
      if (refreshed.recover_streak >= thresholds.recoveryChecks) {
        resolveIncident(refreshed.id, ts);
        const resolved = findActiveIncident(serverId, rule.ruleType);
        const finalRow = resolved ?? refreshed;
        events.push({
          ...toEvent("resolved", { ...finalRow, state: "resolved", resolved_at: ts }, serverId, serverTitle, ts),
          durationSec: Math.max(0, ts - finalRow.opened_at),
        });
      }
    }
  }

  return events;
}

function finalizeRules(rules: RuleEvaluation[]) {
  return rules.filter((r) => r && r.ruleType && r.message);
}

function toEvent(
  kind: IncidentEventKind,
  incident: MonitoringIncidentRow,
  serverId: number,
  serverTitle: string,
  ts: number,
): IncidentEvent {
  return {
    kind,
    incident,
    serverId,
    serverTitle,
    ruleType: incident.rule_type,
    severity: incident.severity,
    ts,
    message: incident.message,
  };
}

export function incidentDuration(incident: MonitoringIncidentRow, now = Math.floor(Date.now() / 1000)) {
  const end = incident.resolved_at ?? now;
  return Math.max(0, end - incident.opened_at);
}

export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}м ${s % 60}с`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}ч ${m % 60}м`;
  const d = Math.floor(h / 24);
  return `${d}д ${h % 24}ч`;
}

export { HOUR };