// web/src/pages/admin/GatewayRoutingSection.tsx
//
// Phase 2: live HAProxy backend/server topology for a selected gateway plus
// operational controls (enable / disable / drain / weight) applied instantly
// through the bridge's runtime API. A guardrail (HTTP 409) protects the last
// active server of a backend; the user can confirm to force it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../../shared/api/client";
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
type ChangeRow = {
  id: number;
  created_at: string;
  admin_user_id: number | null;
  backend: string;
  server: string;
  action: string;
};
type ChangesResp = { ok: true; changes: ChangeRow[] };

const STATUS_TONE: Record<ServerStatus, string> = {
  up: "var(--ok, #1d9e75)",
  down: "var(--danger, #e24b4a)",
  maint: "var(--muted, #888780)",
  drain: "var(--warn, #ba7517)",
  nolb: "var(--warn, #ba7517)",
  no_check: "var(--muted, #888780)",
  unknown: "var(--muted, #888780)",
};

const skey = (backend: string, server: string) => `${backend}/${server}`;

export function GatewayRoutingSection() {
  const { t } = useI18n();
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [routes, setRoutes] = useState<RoutesResp | null>(null);
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});

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

  const load = useCallback((id: number) => {
    setLoading(true);
    setError("");
    Promise.all([
      apiFetch<RoutesResp>(`/admin/gateways/${id}/routes`),
      apiFetch<ChangesResp>(`/admin/gateways/${id}/changes?limit=20`).catch(() => ({ ok: true, changes: [] }) as ChangesResp),
    ])
      .then(([r, c]) => { setRoutes(r); setChanges(c.changes); })
      .catch(() => { setError(t("admin.gateways.error")); setRoutes(null); })
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => { if (activeId != null) load(activeId); }, [activeId, load]);

  const totalServers = useMemo(
    () => routes?.topology.backends.reduce((n, b) => n + b.servers.length, 0) ?? 0,
    [routes],
  );

  async function mutate(path: string, body: Record<string, unknown>, key: string) {
    if (activeId == null) return;
    setBusy((m) => ({ ...m, [key]: true }));
    setError("");
    try {
      await apiFetch(`/admin/gateways/${activeId}/${path}`, { method: "POST", body });
      load(activeId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (window.confirm(t("admin.gateways.confirm.orphan"))) {
          try {
            await apiFetch(`/admin/gateways/${activeId}/${path}`, { method: "POST", body: { ...body, force: true } });
            load(activeId);
          } catch { setError(t("admin.gateways.actionError")); }
        }
      } else {
        setError(t("admin.gateways.actionError"));
      }
    } finally {
      setBusy((m) => ({ ...m, [key]: false }));
    }
  }

  const setState = (s: GatewayServer, state: "ready" | "drain" | "maint") =>
    mutate("servers/state", { backend: s.backend, server: s.name, state }, skey(s.backend, s.name));

  const setWeight = (s: GatewayServer, weight: number) =>
    mutate("servers/weight", { backend: s.backend, server: s.name, weight }, skey(s.backend, s.name));

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
            <button key={g.id} type="button" className={`btn${g.id === activeId ? " btn--primary" : " btn--ghost"}`} onClick={() => setActiveId(g.id)}>
              {g.title}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="admin-section__hint">{t("admin.gateways.loading")}</p>}
      {error && <p className="admin-section__hint" style={{ color: "var(--danger, #e24b4a)" }}>{error}</p>}

      {routes && !loading && (
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
                        <th style={{ padding: "4px 8px" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {b.servers.map((s) => (
                        <ServerRow key={`${s.name}:${s.weight ?? 0}:${s.status}`} s={s} busy={!!busy[skey(s.backend, s.name)]} onState={setState} onWeight={setWeight} t={t} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          {changes.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 15, marginBottom: 8 }}>{t("admin.gateways.changes")}</h3>
              <div style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted, #888780)" }}>
                {changes.map((c) => (
                  <div key={c.id} style={{ fontFamily: "var(--font-mono, monospace)" }}>
                    {c.created_at} · {c.backend}/{c.server} · {c.action}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ServerRow({
  s, busy, onState, onWeight, t,
}: {
  s: GatewayServer;
  busy: boolean;
  onState: (s: GatewayServer, state: "ready" | "drain" | "maint") => void;
  onWeight: (s: GatewayServer, weight: number) => void;
  t: (k: string) => string;
}) {
  const [weight, setWeightInput] = useState(String(s.weight ?? 0));
  const outOfRotation = s.status === "maint" || s.status === "drain";

  return (
    <tr style={{ borderTop: "0.5px solid var(--border, #e5e5e5)" }}>
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
      <td style={{ padding: "4px 8px" }}>
        <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          <input
            type="number" min={0} max={256} value={weight}
            onChange={(e) => setWeightInput(e.target.value)}
            style={{ width: 56 }} disabled={busy}
            aria-label={t("admin.gateways.col.weight")}
          />
          <button
            type="button" className="btn btn--ghost" disabled={busy || weight === String(s.weight ?? 0)}
            onClick={() => { const n = Number(weight); if (Number.isInteger(n) && n >= 0 && n <= 256) onWeight(s, n); }}
            style={{ padding: "2px 8px", fontSize: 12 }}
          >
            {t("admin.gateways.action.apply")}
          </button>
        </span>
      </td>
      <td style={{ padding: "4px 8px" }}>
        <span style={{ display: "inline-flex", gap: 6 }}>
          {outOfRotation ? (
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => onState(s, "ready")} style={{ padding: "2px 10px", fontSize: 12 }}>
              {t("admin.gateways.action.enable")}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onState(s, "drain")} style={{ padding: "2px 10px", fontSize: 12 }}>
                {t("admin.gateways.action.drain")}
              </button>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onState(s, "maint")} style={{ padding: "2px 10px", fontSize: 12 }}>
                {t("admin.gateways.action.disable")}
              </button>
            </>
          )}
        </span>
      </td>
    </tr>
  );
}

function StatusDot({ status }: { status: ServerStatus }) {
  return (
    <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: STATUS_TONE[status], display: "inline-block", flexShrink: 0 }} />
  );
}

export default GatewayRoutingSection;
