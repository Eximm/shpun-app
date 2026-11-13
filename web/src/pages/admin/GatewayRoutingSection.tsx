// web/src/pages/admin/GatewayRoutingSection.tsx
//
// Gateway routing editor. Four compact tabs over one selected gateway:
//   Routes  — SNI → backend rules per frontend (repoint, domains, add/remove,
//             default backend);
//   Servers — backends grouped by family with their servers (runtime
//             enable/drain/maint/weight + add/edit/remove server, add/clone/
//             remove backend);
//   Nodes   — upstream hosts across all backends (change address everywhere,
//             add a node to several backends, remove a node);
//   History — audit log.
// Runtime actions apply instantly; structural edits are previewed as a diff
// and then validated + gracefully reloaded on the gateway.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../shared/api/client";
import { useI18n } from "../../shared/i18n";
import { ADMIN_SECTION_ICON, AdminSectionHeader } from "./shared";
import { DiffPreviewDialog, ErrorLine } from "./gateway/EditDialogs";
import {
  applyEdit,
  describeError,
  fetchChanges,
  fetchConfig,
  fetchGateways,
  fetchRuntime,
  previewEdit,
  setServerState,
  setServerWeight,
  skey,
  type ChangeRow,
  type ConfigResp,
  type EditOp,
  type EditPreview,
  type Gateway,
  type RoutesResp,
  type RuntimeBackend,
  type RuntimeServer,
} from "./gateway/gatewayApi";
import type { EditorCtx } from "./gateway/editorContext";
import { RoutesTab } from "./gateway/RoutesTab";
import { ServersTab } from "./gateway/ServersTab";
import { NodesTab } from "./gateway/NodesTab";
import { HistoryTab } from "./gateway/HistoryTab";

type Tab = "routes" | "servers" | "nodes" | "history";
const TABS: Tab[] = ["routes", "servers", "nodes", "history"];

type ErrorState = { key: string; detail?: string } | null;

export function GatewayRoutingSection() {
  const { t } = useI18n();
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [gatewaysLoaded, setGatewaysLoaded] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("routes");
  const [runtime, setRuntime] = useState<RoutesResp | null>(null);
  const [config, setConfig] = useState<ConfigResp | null>(null);
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ErrorState>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<EditPreview | null>(null);
  // Ignore responses for a gateway that is no longer selected.
  const loadSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    fetchGateways()
      .then((r) => {
        if (!alive) return;
        setGateways(r.gateways);
        if (r.gateways.length > 0) setActiveId((prev) => prev ?? r.gateways[0].id);
      })
      .catch(() => { if (alive) setError({ key: "admin.gateways.error" }); })
      .finally(() => { if (alive) setGatewaysLoaded(true); });
    return () => { alive = false; };
  }, []);

  const load = useCallback(async (id: number, opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    const seq = ++loadSeq.current;
    if (silent) setRefreshing(true); else { setLoading(true); setRuntime(null); setConfig(null); }
    const [rt, cfg, ch] = await Promise.allSettled([fetchRuntime(id), fetchConfig(id), fetchChanges(id)]);
    if (seq !== loadSeq.current) return;
    if (rt.status === "fulfilled") setRuntime(rt.value); else if (!silent) setRuntime(null);
    if (cfg.status === "fulfilled") setConfig(cfg.value); else if (!silent) setConfig(null);
    if (ch.status === "fulfilled") setChanges(ch.value.changes);
    if (rt.status === "rejected" && cfg.status === "rejected") setError({ key: "admin.gateways.error" });
    if (silent) setRefreshing(false); else setLoading(false);
  }, []);

  useEffect(() => {
    if (activeId == null) return;
    setError(null);
    setNotice("");
    void load(activeId);
  }, [activeId, load]);

  const activeGateway = useMemo(() => gateways.find((g) => g.id === activeId) ?? null, [gateways, activeId]);

  const runtimeServers = useMemo(() => {
    const m = new Map<string, RuntimeServer>();
    for (const b of runtime?.topology.backends ?? []) for (const s of b.servers) m.set(skey(b.name, s.name), s);
    return m;
  }, [runtime]);
  const runtimeBackends = useMemo(() => {
    const m = new Map<string, RuntimeBackend>();
    for (const b of runtime?.topology.backends ?? []) m.set(b.name, b);
    return m;
  }, [runtime]);

  const requestEdit = useCallback(async (op: EditOp) => {
    if (activeId == null) return;
    setError(null);
    setNotice("");
    setPreview(await previewEdit(activeId, op));
  }, [activeId]);

  const editInline = useCallback(async (op: EditOp) => {
    try {
      await requestEdit(op);
    } catch (e) {
      setError(describeError(e));
    }
  }, [requestEdit]);

  const applyPreview = useCallback(async () => {
    if (activeId == null || !preview) return;
    try {
      const r = await applyEdit(activeId, preview);
      setPreview(null);
      setNotice(t("admin.gateways.applied", { summary: r.summary }));
      await load(activeId, { silent: true });
    } catch (e) {
      // Someone else changed the config: refresh so the next attempt is based
      // on the current state, and let the dialog explain what happened.
      // On a timeout the outcome is unknown — refresh to show the real state.
      if (e instanceof ApiError && (e.code === "config_changed" || e.code === "apply_timeout")) {
        void load(activeId, { silent: true });
      }
      throw e;
    }
  }, [activeId, preview, load, t]);

  const runtimeAction = useCallback(async (key: string, run: (force: boolean) => Promise<unknown>) => {
    if (activeId == null) return;
    setBusy((m) => ({ ...m, [key]: true }));
    setError(null);
    setNotice("");
    try {
      try {
        await run(false);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.code === "last_active_server") {
          if (!window.confirm(t("admin.gateways.confirm.orphan"))) return;
          await run(true);
        } else {
          throw e;
        }
      }
      await load(activeId, { silent: true });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy((m) => ({ ...m, [key]: false }));
    }
  }, [activeId, load, t]);

  const onState = useCallback((row: { backend: string; name: string }, state: "ready" | "drain" | "maint") => {
    if (activeId == null) return;
    void runtimeAction(skey(row.backend, row.name), (force) => setServerState(activeId, row.backend, row.name, state, force));
  }, [activeId, runtimeAction]);

  const onWeight = useCallback(async (row: { backend: string; name: string }, weight: number) => {
    if (activeId == null) return;
    await runtimeAction(skey(row.backend, row.name), (force) => setServerWeight(activeId, row.backend, row.name, weight, force));
  }, [activeId, runtimeAction]);

  const ctx: EditorCtx = useMemo(() => ({
    model: config?.model ?? null,
    runtimeServers,
    runtimeBackends,
    requestEdit,
    editInline,
    runtimeAction,
    busy,
  }), [config, runtimeServers, runtimeBackends, requestEdit, editInline, runtimeAction, busy]);

  const stats = useMemo(() => {
    const model = config?.model;
    const servers = [...runtimeServers.values()];
    return {
      routes: model ? model.frontends.reduce((n, f) => n + f.rules.length, 0) : null,
      backends: model?.backends.length ?? runtime?.topology.backends.length ?? 0,
      servers: model ? model.backends.reduce((n, b) => n + b.servers.length, 0) : servers.length,
      nodes: model?.nodes.length ?? null,
      down: servers.filter((s) => s.status === "down").length,
      out: servers.filter((s) => s.status === "maint" || s.status === "drain").length,
    };
  }, [config, runtime, runtimeServers]);

  const hasData = !!runtime || !!config;

  return (
    <div className="admin-section gw">
      <AdminSectionHeader
        icon={ADMIN_SECTION_ICON.gateways}
        kicker={t("admin.tab.gateways")}
        title={t("admin.gateways.title")}
        subtitle={t("admin.gateways.subtitle")}
        actions={activeId != null ? (
          <>
            {refreshing && <span className="gw-muted gw-updating">{t("admin.gateways.updating")}</span>}
            <button type="button" className="btn btn--soft" onClick={() => void load(activeId)} disabled={loading || refreshing}>
              {t("admin.gateways.refresh")}
            </button>
          </>
        ) : null}
      />

      {gatewaysLoaded && gateways.length === 0 && !error && <p className="admin-section__hint">{t("admin.gateways.empty")}</p>}

      {gateways.length > 1 && (
        <div className="gw-chips" role="tablist" aria-label={t("admin.gateways.select")}>
          {gateways.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={g.id === activeId}
              className={`chip gw-chip${g.id === activeId ? " is-active" : ""}`} onClick={() => setActiveId(g.id)}>
              {g.title}
            </button>
          ))}
        </div>
      )}

      {activeGateway && (
        <div className="gw-summary">
          <span className="gw-summary__gw">
            <strong>{activeGateway.title}</strong>
            <span className="gw-mono gw-muted">{activeGateway.host}</span>
          </span>
          {hasData && (
            <span className="gw-summary__stats">
              {stats.routes != null && <span>{t("admin.gateways.stat.routes", { count: stats.routes })}</span>}
              <span>{t("admin.gateways.stat.backends", { count: stats.backends })}</span>
              <span>{t("admin.gateways.stat.servers", { count: stats.servers })}</span>
              {stats.nodes != null && <span>{t("admin.gateways.stat.nodes", { count: stats.nodes })}</span>}
              {stats.down > 0 && <span className="gw-tag is-down">{t("admin.gateways.stat.down", { count: stats.down })}</span>}
              {stats.out > 0 && <span className="gw-tag is-drain">{t("admin.gateways.stat.out", { count: stats.out })}</span>}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="gw-banner">
          <ErrorLine error={error} />
          <button type="button" className="gw-more" aria-label={t("admin.modal.close")} onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {notice && (
        <div className="gw-notice" role="status">
          <span>{notice}</span>
          <button type="button" className="gw-more" aria-label={t("admin.modal.close")} onClick={() => setNotice("")}>✕</button>
        </div>
      )}
      {hasData && !config && <p className="admin-section__hint">{t("admin.gateways.configUnavailable")}</p>}

      {loading && <p className="admin-section__hint">{t("admin.gateways.loading")}</p>}

      {hasData && !loading && (
        <>
          <div className="gw-tabs" role="tablist">
            {TABS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k}
                className={`gw-tab${tab === k ? " is-active" : ""}`} onClick={() => setTab(k)}>
                {t(`admin.gateways.tab.${k}`)}
              </button>
            ))}
          </div>
          <p className="admin-section__hint gw-tabhint">{t(`admin.gateways.tabhint.${tab}`)}</p>

          {tab === "routes" && <RoutesTab ctx={ctx} />}
          {tab === "servers" && <ServersTab ctx={ctx} onState={onState} onWeight={onWeight} />}
          {tab === "nodes" && <NodesTab ctx={ctx} />}
          {tab === "history" && <HistoryTab changes={changes} />}
        </>
      )}

      {preview && <DiffPreviewDialog preview={preview} onApply={applyPreview} onClose={() => setPreview(null)} />}
    </div>
  );
}

export default GatewayRoutingSection;
