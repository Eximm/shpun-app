// web/src/pages/admin/gateway/HistoryTab.tsx
//
// Compact audit log: when, what kind of change, and its one-line summary.

import { useI18n } from "../../../shared/i18n";
import type { ChangeRow } from "./gatewayApi";

const KNOWN_ACTIONS = new Set([
  "weight", "route", "state:ready", "state:drain", "state:maint",
  "config:route.repoint", "config:route.domains", "config:route.add", "config:route.remove", "config:frontend.default",
  "config:server.add", "config:server.update", "config:server.remove",
  "config:node.readdress", "config:node.add", "config:node.remove",
  "config:backend.add", "config:backend.remove",
]);

function describe(c: ChangeRow): string {
  const d = c.detail ?? {};
  if (typeof d.summary === "string") return d.summary;
  if (c.action === "weight") return `${c.backend}/${c.server}: ${String(d.from ?? "—")} → ${String(d.to ?? "—")}`;
  if (c.action === "route") return `${String(d.acl ?? c.server)}: ${String(d.from ?? "—")} → ${String(d.to ?? c.backend)}`;
  return `${c.backend}/${c.server}`;
}

export function HistoryTab({ changes }: { changes: ChangeRow[] }) {
  const { t } = useI18n();
  if (changes.length === 0) return <p className="admin-section__hint">{t("admin.gateways.history.empty")}</p>;
  return (
    <div className="gw-card">
      <div className="gw-rows">
        {changes.map((c) => (
          <div key={c.id} className="gw-row gw-row--history">
            <span className="gw-muted gw-mono">{c.created_at.replace("T", " ").slice(0, 16)}</span>
            <span className={`gw-tag${c.action.startsWith("config:") ? " is-config" : ""}`}>
              {KNOWN_ACTIONS.has(c.action) ? t(`admin.gateways.act.${c.action}`) : c.action}
            </span>
            <span className="gw-mono gw-history__text" title={describe(c)}>
              {describe(c)}
              {d(c).force ? <span className="gw-tag is-drain">{t("admin.gateways.history.forced")}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const d = (c: ChangeRow) => (c.detail ?? {}) as { force?: boolean };
