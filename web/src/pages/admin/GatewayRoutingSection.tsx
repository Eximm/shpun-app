// web/src/pages/admin/GatewayRoutingSection.tsx
//
// Phase 1 (READ-ONLY): shows the live HAProxy backend/server topology for a
// selected gateway, read through the locked-down bridge. No mutations yet.

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { useI18n } from "../../shared/i18n";

type Gateway = { id: number; title: string; host: string; visibility: string };
type GatewaysResp = { ok: true; gateways: Gateway[] };

type ServerStatus = "up" | "down" | "maint" | "drain" | "nolb" | "no_check" | "unknown";
type GatewayServer = {
  backend: string;
  name: string;
  addr: string | null;
  status: ServerStatus;
  weight: number | null;
  checkStatus: string | null;
  sessionsCur: number | null;
  isBackup: boolean;
};
type GatewayBackend = { name: string; status: ServerStatus; servers: GatewayServer[] };
type RoutesResp = {
  ok: true;
  gateway: { id: number; title: string; host: string };
  topology: { backends: GatewayBackend[] };
};

const STATUS_TONE: Record<ServerStatus, string> = {
  up: "var(--ok, #1d9e75)",
  down: "var(--danger, #e24b4a)",
  maint: "var(--muted, #888780)",
  drain: "var(--warn, #ba7517)",
  nolb: "var(--warn, #ba7517)",
  no_check: "var(--muted, #888780)",
  unknown: "var(--muted, #888780)",
};

export function GatewayRoutingSection() {
  const { t } = useI18n();
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [routes, setRoutes] = useState<RoutesResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    apiFetch<GatewaysResp>("/admin/gateways")
      .then((r) => {
        if (!alive) return;
        setGateways(r.gateways);
        if (r.gateways.length > 0) setActiveId((prev) => prev ?? r.gateways[0].id);
      })
      .catch(() => { if (alive) setError(t("admin.gateways.error")); });
    return () => { alive = false; };
  }, [t]);

  function load(id: number) {
    setLoading(true);
    setError("");
    apiFetch<RoutesResp>(`/admin/gateways/${id}/routes`)
      .then((r) => { setRoutes(r); })
      .catch(() => { setError(t("admin.gateways.error")); setRoutes(null); })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (activeId != null) load(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const totalServers = useMemo(
    () => routes?.topology.backends.reduce((n, b) => n + b.servers.length, 0) ?? 0,
    [routes],
  );

  return (
    <div className="admin-section">
      <header className="admin-section__head">
        <div>
          <h2>{t("admin.gateways.title")}</h2>
          <p className="admin-section__hint">{t("admin.gateways.readonly")}</p>
        </div>
        {activeId != null && (
          <button type="button" className="btn btn--ghost" onClick={() => load(activeId)} disabled={loading}>
            {t("admin.gateways.refresh")}
          </button>
        )}
      </header>

      {gateways.length === 0 && !error && <p className="admin-section__hint">{t("admin.gateways.empty")}</p>}

      {gateways.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
          {gateways.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`btn${g.id === activeId ? " btn--primary" : " btn--ghost"}`}
              onClick={() => setActiveId(g.id)}
            >
              {g.title}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="admin-section__hint">{t("admin.gateways.loading")}</p>}
      {error && <p className="admin-section__hint" style={{ color: "var(--danger, #e24b4a)" }}>{error}</p>}

      {routes && !loading && !error && (
        <>
          <p className="admin-section__hint">
            {routes.gateway.host} · {routes.topology.backends.length} {t("admin.gateways.backends")} · {totalServers} {t("admin.gateways.servers")}
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {routes.topology.backends.map((b) => (
              <div key={b.name} className="card" style={{ padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <StatusDot status={b.status} />
                  <strong style={{ fontFamily: "var(--font-mono, monospace)" }}>{b.name}</strong>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--muted, #888780)" }}>
                        <th style={{ padding: "4px 8px" }}>{t("admin.gateways.col.server")}</th>
                        <th style={{ padding: "4px 8px" }}>{t("admin.gateways.col.addr")}</th>
                        <th style={{ padding: "4px 8px" }}>{t("admin.gateways.col.status")}</th>
                        <th style={{ padding: "4px 8px" }}>{t("admin.gateways.col.weight")}</th>
                        <th style={{ padding: "4px 8px" }}>{t("admin.gateways.col.check")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.servers.map((s) => (
                        <tr key={s.name} style={{ borderTop: "0.5px solid var(--border, #e5e5e5)" }}>
                          <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono, monospace)" }}>
                            {s.name}{s.isBackup ? <span style={{ color: "var(--muted, #888780)" }}> · {t("admin.gateways.backup")}</span> : null}
                          </td>
                          <td style={{ padding: "4px 8px", color: "var(--muted, #888780)", fontFamily: "var(--font-mono, monospace)" }}>{s.addr ?? "—"}</td>
                          <td style={{ padding: "4px 8px" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <StatusDot status={s.status} />
                              {t(`admin.gateways.status.${s.status}`)}
                            </span>
                          </td>
                          <td style={{ padding: "4px 8px" }}>{s.weight ?? "—"}</td>
                          <td style={{ padding: "4px 8px", color: "var(--muted, #888780)" }}>{s.checkStatus ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: ServerStatus }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: 9, height: 9, borderRadius: "50%", background: STATUS_TONE[status], display: "inline-block", flexShrink: 0 }}
    />
  );
}

export default GatewayRoutingSection;
