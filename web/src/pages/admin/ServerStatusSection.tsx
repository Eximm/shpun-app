import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { useI18n } from "../../shared/i18n";
import { AdminSectionHeader, AdminSectionIcon, ADMIN_SECTION_ICON, ModalShell } from "./shared";
import { ActionMenu } from "./ActionMenu";
import { MonitoringGraph, MONITORING_METRICS, type GraphIncident, type GraphPoint } from "./MonitoringGraph";
import {
  MonitoringIncidents,
  type IncidentCounts,
  type IncidentDto,
  type IncidentRange,
  type IncidentSeverityFilter,
  type IncidentTab,
} from "./MonitoringIncidents";
import {
  formatBitrate,
  formatDuration,
  formatIncidentValue,
  formatLoad,
  formatPct,
  incidentMetricKey,
  incidentRuleKey,
  stateTone,
} from "./monitoringFormat";

type TFn = ReturnType<typeof useI18n>["t"];

type ServerKind = "vpn" | "gateway" | "infra";
type Visibility = "public" | "admin_only";

type MonitoredServer = {
  id: number;
  title: string;
  host: string;
  exporter_url: string;
  kind: ServerKind;
  country_code: string | null;
  active: number;
  sort_order: number;
  uplink_mbps: number | null;
  visibility: Visibility;
  affects_public_health: number;
  node_exporter_enabled: number;
  exporter_auth_type: "none" | "basic";
  exporter_username: string;
  hasExporterPassword: boolean;
  thresholds_json: string | null;
  current?: CurrentCheck | null;
};

type MonitoringSummary = {
  totals: { all: number; online: number; offline: number; stale?: number; noData?: number; vpn: number; gateway: number; infra: number; public: number; adminOnly: number };
  incidents: { critical: number; warning: number; total: number };
};

type CollectorState = {
  lastCycleAt: number | null;
  lastCycleDurationMs: number | null;
  collectorRunning: boolean;
  serversAttempted: number;
  serversSucceeded: number;
  serversFailed: number;
};

type CurrentCheck = {
  id: number;
  online: boolean | null;
  latencyMs: number | null;
  uptime: string | null;
  uptimeSeconds: number | null;
  cpuLoadPct: number | null;
  iowaitPct: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  cpuCores: number | null;
  memoryLoadPct: number | null;
  swapLoadPct: number | null;
  diskLoadPct: number | null;
  diskFreeBytes: number | null;
  inodeLoadPct: number | null;
  rxMbps: number | null;
  txMbps: number | null;
  uplinkLoadPct: number | null;
  uplinkCapacityBps: number | null;
  uplinkCapacitySource: "configured" | "detected" | "unknown";
  rxErrorsDelta: number | null;
  txErrorsDelta: number | null;
  rxDropsDelta: number | null;
  txDropsDelta: number | null;
  fileDescriptors: number | null;
  sockets: number | null;
  exporterStatus: "ok" | "error" | "disabled";
  lastError: string | null;
  checkedAt: string | null;
  state: "fresh" | "stale" | "offline" | "no_data";
  stale: boolean;
  consecutiveFailures: number;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  memoryTotalBytes: number | null;
  memoryAvailableBytes: number | null;
};

type Incident = IncidentDto;
type HistoryPoint = GraphPoint;
type Thresholds = Record<string, number>;

const EMPTY_FORM = {
  title: "",
  host: "",
  exporterUrl: "",
  kind: "vpn" as ServerKind,
  countryCode: "",
  sortOrder: 100,
  uplinkMbps: "",
  active: true,
  visibility: "public" as Visibility,
  affectsPublicHealth: true,
  nodeExporterEnabled: true,
  exporterAuthType: "none" as "none" | "basic",
  exporterUsername: "",
  exporterPassword: "",
  overrideThresholds: false,
  overrideCpu: "",
  overrideMemory: "",
  overrideDisk: "",
};

const COUNTRY_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ
VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(/\s+/);

function countryFlag(code: string) {
  return String.fromCodePoint(...code.split("").map((char) => 127397 + char.charCodeAt(0)));
}

function kindKey(kind: ServerKind) {
  return kind === "infra" ? "admin.servers.kind.infra" : kind === "gateway" ? "admin.servers.kind.gateway" : "admin.servers.kind.vpn";
}

function fmtRelative(iso: string | null, t: TFn) {
  if (!iso) return "—";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const sec = Math.round(diff / 1000);
  if (sec < 60) return t("admin.monitoring.ago.sec", { count: sec });
  const min = Math.round(sec / 60);
  if (min < 60) return t("admin.monitoring.ago.min", { count: min });
  return t("admin.monitoring.ago.hour", { count: Math.round(min / 60) });
}

function fmtBytes(v: number | null) {
  if (v == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = v;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function Gauge({ label, value }: { label: string; value: number | null }) {
  const pct = value == null ? 0 : Math.min(100, Math.max(0, value));
  const cls = value == null ? "is-empty" : value >= 90 ? "is-bad" : value >= 75 ? "is-warn" : "is-ok";
  return (
    <div className="mon-gauge">
      <div className="mon-gauge__head">
        <span className="mon-gauge__label">{label}</span>
        <span className="mon-gauge__value">{formatPct(value)}</span>
      </div>
      <div className="mon-gauge__track"><div className={`mon-gauge__fill ${cls}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export function ServerStatusSection() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<MonitoredServer[]>([]);
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [settings, setSettings] = useState<Thresholds | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forceBusy, setForceBusy] = useState(false);
  const [collector, setCollector] = useState<CollectorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ current: CurrentCheck | null; activeIncidents: Incident[]; recentIncidents: Incident[] } | null>(null);
  const [historyRange, setHistoryRange] = useState<"1h" | "24h" | "7d">("1h");
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionAnchor, setActionAnchor] = useState<HTMLElement | null>(null);
  const [actionServerId, setActionServerId] = useState<number | null>(null);
  const [focusMetric, setFocusMetric] = useState<string | null>(null);
  const [globalActive, setGlobalActive] = useState<IncidentDto[]>([]);
  const [globalHistory, setGlobalHistory] = useState<IncidentDto[]>([]);
  const [globalCounts, setGlobalCounts] = useState<IncidentCounts>({ critical: 0, warning: 0, total: 0 });
  const [globalTotal, setGlobalTotal] = useState(0);
  const [incidentTab, setIncidentTab] = useState<IncidentTab>("active");
  const [incidentSeverity, setIncidentSeverity] = useState<IncidentSeverityFilter>("all");
  const [incidentRange, setIncidentRange] = useState<IncidentRange>("24h");
  const [detailMeta, setDetailMeta] = useState<{ effectiveThresholds: Record<string, number>; uplinkMbps: number | null; uplinkCapacityBps: number | null; uplinkCapacitySource: string } | null>(null);
  const [historyIncidents, setHistoryIncidents] = useState<GraphIncident[]>([]);

  const countryOptionsList = useMemo(
    () => COUNTRY_CODES.map((code) => ({ code })).sort((a, b) => a.code.localeCompare(b.code, locale)),
    [locale],
  );

  async function loadIncidents(opts: { range?: IncidentRange } = {}) {
    const range = opts.range ?? incidentRange;
    try {
      const qs = new URLSearchParams();
      qs.set("range", range);
      qs.set("limit", "50");
      const r = await apiFetch<{ ok: true; active: IncidentDto[]; history: IncidentDto[]; counts: IncidentCounts; total: number }>(
        `/admin/monitoring/incidents?${qs.toString()}`,
        { method: "GET" },
      );
      setGlobalActive(r.active ?? []);
      setGlobalHistory(r.history ?? []);
      setGlobalCounts(r.counts ?? { critical: 0, warning: 0, total: 0 });
      setGlobalTotal(r.total ?? 0);
    } catch {
      /* keep previous incident data */
    }
  }

  /**
   * Stale-while-revalidate loader. The authoritative list/summary are replaced
   * atomically only on success; a partial or failed revalidation keeps the
   * previous metrics on screen and never blanks the list.
   */
  async function loadAll(opts: { silent?: boolean } = {}) {
    if (!opts.silent) setLoading(true);
    setRefreshing(true);
    setError(null);

    const [serversR, sumR, setsR] = await Promise.allSettled([
      apiFetch<{ ok: true; items: MonitoredServer[] }>("/admin/monitored-servers", { method: "GET" }),
      apiFetch<{ ok: true } & MonitoringSummary>("/admin/monitoring/summary", { method: "GET" }),
      apiFetch<{ ok: true; thresholds: Thresholds }>("/admin/monitoring/settings", { method: "GET" }),
    ]);

    if (serversR.status === "fulfilled") setItems(serversR.value.items ?? []);
    if (sumR.status === "fulfilled") {
      setSummary({ totals: sumR.value.totals, incidents: sumR.value.incidents });
      setCollector((sumR.value as any).collector ?? null);
    }
    if (setsR.status === "fulfilled") setSettings(setsR.value.thresholds ?? null);

    if ([serversR, sumR, setsR].some((r) => r.status === "rejected")) {
      setError(t("admin.servers.err.load"));
    }

    void loadIncidents();
    setRefreshing(false);
    if (!opts.silent) setLoading(false);
  }

  async function forceCollect() {
    if (forceBusy) return;
    setForceBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await apiFetch<{ ok: true; collect: { started: boolean; reason: string } }>("/admin/monitoring/collect-now", { method: "POST" });
      await loadAll({ silent: true });
      setNotice(r.collect.started ? t("admin.monitoring.force_check.done") : t("admin.monitoring.force_check.cooldown"));
    } catch (e: any) {
      setError(e?.message || t("admin.servers.err.load"));
    } finally {
      setForceBusy(false);
    }
  }

  useEffect(() => { void loadAll(); }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void loadAll({ silent: true }), 60_000);
    const onVisibility = () => { if (document.visibilityState === "visible") void loadAll({ silent: true }); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  /* ── Server editor ─────────────────────────────────────────────────────── */

  function startCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setEditorOpen(true);
  }

  function edit(item: MonitoredServer) {
    let override: Record<string, unknown> = {};
    try { override = item.thresholds_json ? JSON.parse(item.thresholds_json) : {}; } catch { override = {}; }
    setEditingId(item.id);
    setForm({
      title: item.title || "",
      host: item.host || "",
      exporterUrl: item.exporter_url || "",
      kind: item.kind,
      countryCode: item.country_code || "",
      sortOrder: Number(item.sort_order ?? 100),
      uplinkMbps: item.uplink_mbps != null ? String(item.uplink_mbps) : "",
      active: Number(item.active) === 1,
      visibility: item.visibility,
      affectsPublicHealth: Number(item.affects_public_health) === 1,
      nodeExporterEnabled: Number(item.node_exporter_enabled) === 1,
      exporterAuthType: item.exporter_auth_type,
      exporterUsername: item.exporter_username || "",
      exporterPassword: "",
      overrideThresholds: Boolean(item.thresholds_json),
      overrideCpu: override.cpuPct != null ? String(override.cpuPct) : "",
      overrideMemory: override.memoryWarnPct != null ? String(override.memoryWarnPct) : "",
      overrideDisk: override.diskWarnPct != null ? String(override.diskWarnPct) : "",
    });
    setEditorOpen(true);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    const override: Record<string, number> = {};
    if (form.overrideThresholds) {
      if (form.overrideCpu) override.cpuPct = Number(form.overrideCpu);
      if (form.overrideMemory) override.memoryWarnPct = Number(form.overrideMemory);
      if (form.overrideDisk) override.diskWarnPct = Number(form.overrideDisk);
    }

    const body: Record<string, unknown> = {
      title: form.title,
      host: form.host,
      exporterUrl: form.exporterUrl,
      kind: form.kind,
      countryCode: form.countryCode,
      sortOrder: Number(form.sortOrder || 100),
      uplinkMbps: form.uplinkMbps ? Number(form.uplinkMbps) : null,
      active: form.active,
      visibility: form.visibility,
      affectsPublicHealth: form.affectsPublicHealth,
      nodeExporterEnabled: form.nodeExporterEnabled,
      exporterAuthType: form.exporterAuthType,
      exporterUsername: form.exporterUsername,
      thresholds: form.overrideThresholds ? override : null,
    };
    if (form.exporterPassword) body.exporterPassword = form.exporterPassword;

    try {
      if (editingId) await apiFetch(`/admin/monitored-servers/${editingId}`, { method: "PUT", body });
      else await apiFetch("/admin/monitored-servers", { method: "POST", body });
      setEditorOpen(false);
      await loadAll({ silent: true });
    } catch (e: any) {
      setError(e?.message || t("admin.servers.err.save"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm(t("admin.servers.confirm.delete"))) return;
    await apiFetch(`/admin/monitored-servers/${id}`, { method: "DELETE" });
    await loadAll({ silent: true });
  }

  async function testNodeExporter(id: number) {
    setNotice(null);
    setError(null);
    try {
      const r = await apiFetch<{ ok: true; probe: { ok: boolean; errorCode: string | null; latencyMs: number } }>(
        `/admin/monitored-servers/${id}/test-node-exporter`,
        { method: "POST" },
      );
      if (r.probe.ok) setNotice(t("admin.monitoring.test.ok", { ms: r.probe.latencyMs }));
      else setNotice(t("admin.monitoring.test.fail", { code: r.probe.errorCode || "unknown" }));
    } catch (e: any) {
      setError(e?.message || t("admin.servers.err.load"));
    }
  }

  async function saveSettings() {
    if (!settings || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await apiFetch<{ ok: true; thresholds: Thresholds; ignoredKeys?: string[] }>("/admin/monitoring/settings", { method: "PUT", body: settings });
      setSettings(r.thresholds);
      setNotice(
        r.ignoredKeys && r.ignoredKeys.length > 0
          ? t("admin.monitoring.settings.notice.ignored", { keys: r.ignoredKeys.join(", ") })
          : t("admin.monitoring.settings.notice.saved"),
      );
    } catch (e: any) {
      setError(e?.message || t("admin.servers.err.save"));
    } finally {
      setBusy(false);
    }
  }

  /* ── Expanded detail ───────────────────────────────────────────────────── */

  async function loadDetail(id: number, range: "1h" | "24h" | "7d" = historyRange) {
    setDetailLoading(true);
    try {
      const [d, h] = await Promise.all([
        apiFetch<{ ok: true; current: CurrentCheck | null; effectiveThresholds?: Record<string, number>; activeIncidents: Incident[]; recentIncidents: Incident[] }>(
          `/admin/monitoring/servers/${id}/detail`,
          { method: "GET" },
        ),
        apiFetch<{ ok: true; points: HistoryPoint[]; meta?: { effectiveThresholds: Record<string, number>; uplinkMbps: number | null; uplinkCapacityBps?: number | null; uplinkCapacitySource?: string }; incidents?: Incident[] }>(
          `/admin/monitoring/servers/${id}/history?range=${range}`,
          { method: "GET" },
        ),
      ]);
      setDetail({ current: d.current, activeIncidents: d.activeIncidents ?? [], recentIncidents: d.recentIncidents ?? [] });
      setDetailMeta(
        h.meta
          ? { effectiveThresholds: h.meta.effectiveThresholds, uplinkMbps: h.meta.uplinkMbps, uplinkCapacityBps: h.meta.uplinkCapacityBps ?? null, uplinkCapacitySource: h.meta.uplinkCapacitySource ?? "unknown" }
          : d.effectiveThresholds
            ? { effectiveThresholds: d.effectiveThresholds, uplinkMbps: null, uplinkCapacityBps: null, uplinkCapacitySource: "unknown" }
            : null,
      );
      setHistory(h.points ?? []);
      setHistoryIncidents((h.incidents ?? []).map((i) => ({ id: i.id, ruleType: i.ruleType, severity: i.severity, openedAt: i.openedAt, resolvedAt: i.resolvedAt })));
    } catch {
      setDetail({ current: null, activeIncidents: [], recentIncidents: [] });
      setHistory([]);
      setHistoryIncidents([]);
    } finally {
      setDetailLoading(false);
    }
  }

  async function toggleExpand(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    setHistory([]);
    setHistoryIncidents([]);
    setDetailMeta(null);
    await loadDetail(id, historyRange);
  }

  async function changeRange(range: "1h" | "24h" | "7d") {
    setHistoryRange(range);
    if (!expandedId) return;
    await loadDetail(expandedId, range);
  }

  function openIncident(inc: Incident) {
    if (!items.some((i) => i.id === inc.serverId)) {
      setNotice(t("admin.monitoring.incidents.server_deleted"));
      return;
    }
    setActionAnchor(null);
    setActionServerId(null);
    setExpandedId(inc.serverId);
    setFocusMetric(incidentMetricKey(inc.ruleType));
    const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - inc.openedAt);
    const range: "1h" | "24h" | "7d" = ageSec <= 3600 ? "1h" : ageSec <= 86400 ? "24h" : "7d";
    setHistoryRange(range);
    setDetail(null);
    setHistory([]);
    setHistoryIncidents([]);
    setDetailMeta(null);
    void loadDetail(inc.serverId, range);
    window.requestAnimationFrame(() => {
      document.getElementById(`mon-server-${inc.serverId}`)?.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }

  function currentStateLabel(state: CurrentCheck["state"] | undefined) {
    if (state === "fresh") return t("admin.monitoring.state.fresh");
    if (state === "stale") return t("admin.monitoring.state.stale");
    if (state === "offline") return t("admin.monitoring.state.offline");
    return t("admin.monitoring.state.no_data");
  }

  function currentStateChip(state: CurrentCheck["state"] | undefined) {
    return `chip--${stateTone(state)}`;
  }

  function severityRank(sev: string) {
    return sev === "critical" ? 0 : sev === "warning" ? 1 : 2;
  }

  function incidentUnit(ruleType: string): "percent" | "count" {
    return ruleType === "network_errors" ? "count" : "percent";
  }

  function fmtClockLocal(ts: number) {
    const d = new Date(ts * 1000);
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function capacityBpsLabel(bps: number | null): string {
    return bps != null ? formatBitrate((bps * 8) / 1_000_000) : "—";
  }

  function focusIncidents(sev: IncidentSeverityFilter) {
    setIncidentTab("active");
    setIncidentSeverity(sev);
    window.requestAnimationFrame(() => {
      document.getElementById("mon-incidents")?.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }

  const groups: { kind: ServerKind; items: MonitoredServer[] }[] = [
    { kind: "vpn", items: items.filter((i) => i.kind === "vpn") },
    { kind: "gateway", items: items.filter((i) => i.kind === "gateway") },
    { kind: "infra", items: items.filter((i) => i.kind === "infra") },
  ];

  return (
    <div className="admin-stack">
      <div className="card">
        <div className="card__body">
          <AdminSectionHeader
            icon={ADMIN_SECTION_ICON.serverStatus}
            kicker={t("admin.tab.serverStatus")}
            title={t("admin.monitoring.title")}
            subtitle={loading ? t("common.loading") : t("admin.monitoring.subtitle")}
            actions={
              <>
                <button className="btn" type="button" onClick={() => void loadAll({ silent: true })} disabled={refreshing}>{t("common.refresh")}</button>
                <button className="btn btn--soft" type="button" onClick={() => void forceCollect()} disabled={forceBusy}>{t("admin.monitoring.force_check")}</button>
                <button className="btn btn--primary" type="button" onClick={startCreate}>{t("admin.servers.new")}</button>
              </>
            }
          />

          {error && <div className="pre admin-gap-top-sm">{error}</div>}
          {notice && <div className="pre admin-gap-top-sm">{notice}</div>}

          {summary && (
            <>
              <div className="mon-summary admin-gap-top-md">
                <div className="mon-summary__stat">
                  <span className="mon-summary__value">{summary.totals.online}/{summary.totals.all}</span>
                  <span className="mon-summary__label">{t("admin.monitoring.summary.online")}</span>
                </div>
                <div className="mon-summary__stat">
                  <span className="mon-summary__value">{summary.totals.vpn}</span>
                  <span className="mon-summary__label">{t("admin.servers.kind.vpn")}</span>
                </div>
                <div className="mon-summary__stat">
                  <span className="mon-summary__value">{summary.totals.gateway}</span>
                  <span className="mon-summary__label">{t("admin.servers.kind.gateway")}</span>
                </div>
                <div className="mon-summary__stat">
                  <span className="mon-summary__value">{summary.totals.infra}</span>
                  <span className="mon-summary__label">{t("admin.servers.kind.infra")}</span>
                </div>
                <div className={`mon-summary__stat${(summary.totals.stale ?? 0) > 0 ? " is-warn" : ""}`}>
                  <span className="mon-summary__value">{summary.totals.stale ?? 0}</span>
                  <span className="mon-summary__label">{t("admin.monitoring.state.stale")}</span>
                </div>
                <button
                  type="button"
                  className={`mon-summary__stat is-clickable${summary.incidents.critical > 0 ? " is-bad" : summary.incidents.total > 0 ? " is-warn" : ""}`}
                  onClick={() => focusIncidents("all")}
                >
                  <span className="mon-summary__value">{summary.incidents.total}</span>
                  <span className="mon-summary__label">{t("admin.monitoring.summary.incidents")}</span>
                </button>
                <button type="button" className="mon-summary__stat is-clickable" onClick={() => focusIncidents("warning")}>
                  <span className="mon-summary__value">{summary.incidents.warning}</span>
                  <span className="mon-summary__label">{t("admin.monitoring.summary.warnings")}</span>
                </button>
              </div>
              {collector && (
                <div className="mon-collector admin-gap-top-sm">
                  <span className={`mon-collector__dot ${collector.collectorRunning ? "is-run" : collector.lastCycleAt ? "is-ok" : "is-idle"}`} />
                  <span className="mon-collector__label">{t("admin.monitoring.collector.title")}</span>
                  <span className="mon-collector__meta">
                    {collector.lastCycleAt ? t("admin.monitoring.collector.last", { value: fmtRelative(new Date(collector.lastCycleAt * 1000).toISOString(), t) }) : "—"}
                    {collector.lastCycleDurationMs != null ? ` · ${t("admin.monitoring.collector.duration", { value: collector.lastCycleDurationMs })}` : ""}
                    {` · ${t("admin.monitoring.collector.exporters", { ok: collector.serversSucceeded, total: collector.serversAttempted })}`}
                  </span>
                </div>
              )}
            </>
          )}

          <MonitoringIncidents
            active={incidentSeverity === "all" ? globalActive : globalActive.filter((i) => i.severity === incidentSeverity)}
            history={incidentSeverity === "all" ? globalHistory : globalHistory.filter((i) => i.severity === incidentSeverity)}
            counts={globalCounts}
            total={globalTotal}
            tab={incidentTab}
            onTab={setIncidentTab}
            severity={incidentSeverity}
            onSeverity={setIncidentSeverity}
            range={incidentRange}
            onRange={(r) => { setIncidentRange(r); void loadIncidents({ range: r }); }}
            onOpenIncident={openIncident}
            refreshing={refreshing}
          />

          {groups.map((group) => (
            <section key={group.kind} className="mon-group admin-gap-top-md">
              <h3 className="h2 mon-group__title">
                <AdminSectionIcon name={group.kind === "vpn" ? "server" : group.kind === "gateway" ? "gateway" : "layers"} size={16} />
                {t(kindKey(group.kind))}
              </h3>
              {group.items.length === 0 && <div className="pre">{t("admin.servers.empty")}</div>}
              {group.items.map((item) => {
                const expanded = expandedId === item.id;
                const current = expanded ? detail?.current ?? item.current ?? null : item.current ?? null;
                const rowState = current?.state === "offline"
                  ? "is-offline"
                  : current?.state === "stale"
                    ? "is-stale"
                    : current?.state === "no_data"
                      ? "is-nodata"
                      : "";
                const activeIssues = globalActive.filter((i) => i.serverId === item.id);
                const topIssue = activeIssues.slice().sort((a, b) => severityRank(a.severity) - severityRank(b.severity))[0] ?? null;
                return (
                  <div key={item.id} id={`mon-server-${item.id}`} className={`mon-row${expanded ? " is-expanded" : ""}${rowState ? ` ${rowState}` : ""}`}>
                    <div className="mon-row__main" role="button" tabIndex={0} onClick={() => void toggleExpand(item.id)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void toggleExpand(item.id); } }} aria-expanded={expanded} aria-controls={`mon-detail-${item.id}`}>
                      <div className="mon-row__identity">
                        <div className="mon-row__title">
                          <span className={`serverStatus-dot serverStatus-dot--${Number(item.active) ? "online" : "offline"}`} />
                          {item.country_code ? `${countryFlag(item.country_code)} ` : ""}{item.title || item.host}
                        </div>
                        <div className="mon-row__badges">
                          <span className={`chip ${currentStateChip(current?.state)}`}>{currentStateLabel(current?.state)}</span>
                          <span className="chip chip--soft">{t(kindKey(item.kind))}</span>
                          <span className={`chip ${item.visibility === "admin_only" ? "chip--warn" : "chip--ok"}`}>
                            {item.visibility === "admin_only" ? `🔒 ${t("admin.monitoring.badge.internal")}` : t("admin.monitoring.badge.public")}
                          </span>
                          {Number(item.affects_public_health) === 1 && item.visibility === "admin_only" && (
                            <span className="chip chip--soft">{t("admin.monitoring.badge.affects_health")}</span>
                          )}
                        </div>
                      </div>
                      <div className="mon-row__metrics">
                        <Gauge label={t("admin.monitoring.metric.cpu_short")} value={current?.cpuLoadPct ?? null} />
                        <Gauge label={t("admin.monitoring.metric.ram_short")} value={current?.memoryLoadPct ?? null} />
                        <Gauge label={t("admin.monitoring.metric.disk_short")} value={current?.diskLoadPct ?? null} />
                        <span className="mon-row__plain">{t("admin.monitoring.metric.load_short", { value: formatLoad(current?.load1) })}</span>
                        <span className="mon-row__plain">{`↓ ${formatBitrate(current?.rxMbps)}   ↑ ${formatBitrate(current?.txMbps)}`}</span>
                        <span className="mon-row__plain">{current?.uptime ? t("admin.monitoring.metric.uptime_short", { value: current.uptime }) : "—"}</span>
                        <span className={`mon-row__plain mon-row__fresh${current?.state === "stale" || current?.state === "offline" ? " is-stale" : ""}`}>{t("admin.monitoring.metric.freshness", { value: fmtRelative(current?.checkedAt ?? null, t) })}</span>
                      </div>
                      {topIssue && (
                        <div className={`mon-row__issue mon-row__issue--${topIssue.severity}`}>
                          {`${topIssue.severity === "critical" ? "🔴" : "⚠"} ${t(incidentRuleKey(topIssue.ruleType))}`}
                          {topIssue.value != null && topIssue.threshold != null
                            ? `: ${formatIncidentValue(topIssue.value, incidentUnit(topIssue.ruleType))} · ${t("admin.monitoring.incident.threshold_short")} ${formatIncidentValue(topIssue.threshold, incidentUnit(topIssue.ruleType))}`
                            : ""}
                          {` · ${formatDuration(topIssue.durationSec)}`}
                          {activeIssues.length > 1 ? ` · +${activeIssues.length - 1}` : ""}
                        </div>
                      )}
                      <div className="actions mon-row__actions mon-row__actions--desktop">
                        <button className="btn btn--soft" type="button" onClick={(e) => { e.stopPropagation(); edit(item); }}>{t("common.edit")}</button>
                        <button className="btn btn--danger" type="button" onClick={(e) => { e.stopPropagation(); void remove(item.id); }}>{t("common.delete")}</button>
                      </div>
                      <button
                        className="mon-row__chevron"
                        type="button"
                        aria-label={expanded ? t("admin.monitoring.row.collapse") : t("admin.monitoring.row.expand")}
                        aria-expanded={expanded}
                        aria-controls={`mon-detail-${item.id}`}
                        onClick={(e) => { e.stopPropagation(); void toggleExpand(item.id); }}
                      >{expanded ? "⌃" : "⌄"}</button>
                      <div className="mon-row__overflow" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="mon-row__overflowBtn"
                          type="button"
                          aria-label={t("admin.monitoring.action.menu")}
                          aria-haspopup="menu"
                          aria-expanded={actionServerId === item.id}
                          onClick={(e) => { setActionAnchor(e.currentTarget); setActionServerId(item.id); }}
                        >⋮</button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="mon-detail" id={`mon-detail-${item.id}`}>
                        {detailLoading && <div className="pre">{t("common.loading")}</div>}
                        {current && (
                          <>
                            <div className="mon-detail__section">
                              <div className="mon-detail__heading">{t("admin.monitoring.section.system")}</div>
                              <div className="mon-kv">
                                <span>{t("admin.monitoring.metric.cpu")}</span><b>{formatPct(current.cpuLoadPct)}</b>
                                <span>{t("admin.monitoring.metric.iowait")}</span><b>{formatPct(current.iowaitPct)}</b>
                                <span>{t("admin.monitoring.metric.load")}</span><b>{`${current.load1 ?? "—"} / ${current.load5 ?? "—"} / ${current.load15 ?? "—"}`}</b>
                                <span>{t("admin.monitoring.metric.ram")}</span><b>{formatPct(current.memoryLoadPct)}</b>
                                <span>{t("admin.monitoring.metric.swap")}</span><b>{formatPct(current.swapLoadPct)}</b>
                                <span>{t("admin.monitoring.metric.disk")}</span><b>{formatPct(current.diskLoadPct)}</b>
                                <span>{t("admin.monitoring.metric.disk_free")}</span><b>{fmtBytes(current.diskFreeBytes)}</b>
                                <span>{t("admin.monitoring.metric.inode")}</span><b>{formatPct(current.inodeLoadPct)}</b>
                                <span>{t("admin.monitoring.metric.uptime")}</span><b>{current.uptime ?? "—"}</b>
                                <span>{t("admin.monitoring.metric.cpu_cores")}</span><b>{current.cpuCores ?? "—"}</b>
                              </div>
                            </div>

                            <div className="mon-detail__section">
                              <div className="mon-detail__heading">{t("admin.monitoring.section.network")}</div>
                              <div className="mon-kv">
                                <span>{t("admin.monitoring.metric.rx")}</span><b>{formatBitrate(current.rxMbps)}</b>
                                <span>{t("admin.monitoring.metric.tx")}</span><b>{formatBitrate(current.txMbps)}</b>
                                <span>{t("admin.monitoring.metric.uplink")}</span><b>{formatPct(current.uplinkLoadPct)}</b>
                                <span>{t("admin.monitoring.metric.capacity")}</span><b>{detailMeta?.uplinkCapacityBps != null ? formatBitrate((detailMeta.uplinkCapacityBps * 8) / 1_000_000) : detailMeta?.uplinkMbps != null ? formatBitrate(detailMeta.uplinkMbps) : "—"}</b>
                                <span>{t("admin.monitoring.capacity.source")}</span><b>{t(`admin.monitoring.capacity.source.${detailMeta?.uplinkCapacitySource === "configured" || detailMeta?.uplinkCapacitySource === "detected" ? detailMeta.uplinkCapacitySource : "unknown"}`)}</b>
                                <span>{t("admin.monitoring.metric.drops")}</span><b>{`${current.rxDropsDelta ?? "—"} / ${current.txDropsDelta ?? "—"}`}</b>
                                <span>{t("admin.monitoring.metric.errors")}</span><b>{`${current.rxErrorsDelta ?? "—"} / ${current.txErrorsDelta ?? "—"}`}</b>
                                <span>{t("admin.monitoring.metric.fd")}</span><b>{current.fileDescriptors ?? "—"}</b>
                                <span>{t("admin.monitoring.metric.sockets")}</span><b>{current.sockets ?? "—"}</b>
                              </div>
                            </div>

                            <div className="mon-detail__section">
                              <div className="mon-detail__heading">{t("admin.monitoring.section.monitoring")}</div>
                              <div className="mon-kv">
                                <span>{t("admin.monitoring.monitoring.exporter")}</span><b>{current.exporterStatus}</b>
                                <span>{t("admin.monitoring.monitoring.latency")}</span><b>{current.latencyMs != null ? `${current.latencyMs} ms` : "—"}</b>
                                <span>{t("admin.monitoring.monitoring.last_check")}</span><b>{fmtRelative(current.checkedAt, t)}</b>
                                <span>{t("admin.monitoring.monitoring.last_error")}</span><b>{current.lastError || "—"}</b>
                              </div>
                              <button className="btn btn--soft admin-gap-top-sm" type="button" onClick={() => void testNodeExporter(item.id)} disabled={Number(item.node_exporter_enabled) !== 1}>
                                {t("admin.monitoring.test.node_exporter")}
                              </button>
                            </div>

                            <div className="mon-detail__section">
                              <div className="mon-detail__heading">{t("admin.monitoring.section.incidents")}</div>
                              {detail?.activeIncidents.length ? (
                                <div className="mon-incidentList">
                                  {detail.activeIncidents.map((inc) => {
                                    const unit = incidentUnit(inc.ruleType);
                                    const showWas = inc.triggerValue != null && inc.value != null && inc.triggerValue !== inc.value;
                                    return (
                                      <div key={inc.id} className={`mon-incident mon-incident--${inc.severity}`}>
                                        <div className="mon-incident__row">
                                          <span className="mon-incident__rule">{t(incidentRuleKey(inc.ruleType))}</span>
                                          <span className="mon-incident__badge">{`${t(`admin.monitoring.incident.severity.${inc.severity}`)} · ${t(`admin.monitoring.incident.state.${inc.state}`)}`}</span>
                                        </div>
                                        <div className="mon-incident__values">
                                          {showWas ? `${t("admin.monitoring.incident.was")} ${formatIncidentValue(inc.triggerValue, unit)} · ` : ""}
                                          {inc.value != null ? `${t("admin.monitoring.incident.now")} ${formatIncidentValue(inc.value, unit)}` : ""}
                                          {inc.peakValue != null && inc.peakValue !== inc.value ? ` · ${t("admin.monitoring.incident.peak")} ${formatIncidentValue(inc.peakValue, unit)}` : ""}
                                          {inc.threshold != null ? ` · ${t("admin.monitoring.incident.threshold")} ${formatIncidentValue(inc.threshold, unit)}` : ""}
                                        </div>
                                        <div className="mon-incident__meta">{`${t("admin.monitoring.incident.started")} ${fmtClockLocal(inc.openedAt)} · ${t("admin.monitoring.incident.duration")} ${formatDuration(inc.durationSec)}`}</div>
                                        {inc.context && (
                                          <div className="mon-kv mon-incident__context">
                                            <span>{t("admin.monitoring.metric.rx")}</span><b>{capacityBpsLabel(inc.context.rxBps)}</b>
                                            <span>{t("admin.monitoring.metric.tx")}</span><b>{capacityBpsLabel(inc.context.txBps)}</b>
                                            <span>{t("admin.monitoring.metric.capacity")}</span><b>{capacityBpsLabel(inc.context.capacityBps)}</b>
                                            <span>{t("admin.monitoring.capacity.source")}</span><b>{t(`admin.monitoring.capacity.source.${inc.context.capacitySource}`)}</b>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="mon-kv"><span>{t("admin.monitoring.incidents.none")}</span><b>—</b></div>
                              )}
                            </div>

                            <div className="mon-detail__section mon-detail__section--history">
                              <div className="mon-detail__heading">{t("admin.monitoring.section.history")}</div>
                              <div className="actions actions--3 admin-gap-top-sm mon-rangeButtons">
                                {(["1h", "24h", "7d"] as const).map((range) => (
                                  <button key={range} className={`mon-rangeBtn${historyRange === range ? " is-active" : ""}`} type="button" onClick={() => void changeRange(range)}>
                                    {t(`admin.monitoring.history.range.${range}`)}
                                  </button>
                                ))}
                              </div>
                              {history.length < 2 ? (
                                <div className="pre admin-gap-top-sm">{t("admin.monitoring.history.empty")}</div>
                              ) : (
                                <div className="mon-graphs admin-gap-top-sm">
                                  {[...MONITORING_METRICS]
                                    .sort((a, b) => (a.key === focusMetric ? -1 : b.key === focusMetric ? 1 : 0))
                                    .map((metric) => {
                                      const th = detailMeta?.effectiveThresholds ?? {};
                                      const threshold = metric.key === "cpu" ? th.cpuPct
                                        : metric.key === "ram" ? th.memoryWarnPct
                                          : metric.key === "disk" ? th.diskWarnPct
                                            : metric.key === "uplink" ? th.uplinkWarnPct
                                              : null;
                                      const thresholdCrit = metric.key === "ram" ? th.memoryCritPct
                                        : metric.key === "disk" ? th.diskCritPct
                                          : null;
                                      const currentValue = metric.key === "cpu" ? current.cpuLoadPct
                                        : metric.key === "ram" ? current.memoryLoadPct
                                          : metric.key === "disk" ? current.diskLoadPct
                                            : metric.key === "uplink" ? current.uplinkLoadPct
                                              : metric.key === "rx" ? current.rxMbps
                                                : metric.key === "tx" ? current.txMbps
                                                  : null;
                                      return (
                                        <MonitoringGraph
                                          key={metric.key}
                                          metric={metric}
                                          points={history}
                                          current={currentValue}
                                          threshold={threshold}
                                          thresholdCrit={thresholdCrit}
                                          incidents={historyIncidents.filter((i) => incidentMetricKey(i.ruleType) === metric.key)}
                                          range={historyRange}
                                          isFocus={focusMetric === metric.key}
                                          note={metric.key === "uplink"
                                            ? `${t("admin.monitoring.graph.capacity", { value: detailMeta?.uplinkCapacityBps != null ? formatBitrate((detailMeta.uplinkCapacityBps * 8) / 1_000_000) : detailMeta?.uplinkMbps != null ? formatBitrate(detailMeta.uplinkMbps) : "—" })} · ${t("admin.monitoring.capacity.source")}: ${t(`admin.monitoring.capacity.source.${detailMeta?.uplinkCapacitySource === "configured" || detailMeta?.uplinkCapacitySource === "detected" ? detailMeta.uplinkCapacitySource : "unknown"}`)}${currentValue != null && currentValue > 100 ? ` · ${t("admin.monitoring.graph.above100")}` : ""}`
                                            : undefined}
                                        />
                                      );
                                    })}
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>

      {/* Global thresholds */}
      <div className="card">
        <div className="card__body">
          <AdminSectionHeader
            icon="monitoring"
            kicker={t("admin.tab.serverStatus")}
            title={t("admin.monitoring.settings.title")}
            subtitle={t("admin.monitoring.settings.subtitle")}
            actions={
              <>
                <button className="btn btn--soft" type="button" onClick={() => setSettingsOpen((v) => !v)}>
                  {settingsOpen ? t("admin.monitoring.collapse") : t("admin.monitoring.expand")}
                </button>
                <button className="btn btn--primary" type="button" onClick={() => void saveSettings()} disabled={busy}>{t("common.save")}</button>
              </>
            }
          />
          {settingsOpen && settings && (
            <div className="admin-serverStatus-form admin-gap-top-md">
              {Object.keys(settings).map((key) => (
                <label className="field" key={key}>
                  <span className="field__label">{t(`admin.monitoring.settings.${key}`)}</span>
                  <input
                    className="input"
                    type="number"
                    value={settings[key]}
                    onChange={(e) => setSettings((prev) => (prev ? { ...prev, [key]: Number(e.target.value) } : prev))}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Server editor */}
      {editorOpen && (
        <ModalShell
          kicker="Node exporter"
          title={editingId ? t("admin.servers.editor.edit_title") : t("admin.servers.editor.add_title")}
          onClose={() => setEditorOpen(false)}
        >
          <div className="admin-serverStatus-form">
            <label className="field">
              <span className="field__label">{t("admin.servers.field.title")}</span>
              <input className="input" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
            </label>
            <label className="field">
              <span className="field__label">{t("admin.servers.field.host")}</span>
              <input className="input" value={form.host} onChange={(e) => setForm((p) => ({ ...p, host: e.target.value }))} />
            </label>
            <label className="field">
              <span className="field__label">{t("admin.servers.field.kind")}</span>
              <select className="input" value={form.kind} onChange={(e) => setForm((p) => ({ ...p, kind: e.target.value as ServerKind }))}>
                <option value="vpn">{t("admin.servers.kind.vpn")}</option>
                <option value="gateway">{t("admin.servers.kind.gateway")}</option>
                <option value="infra">{t("admin.servers.kind.infra")}</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">{t("admin.servers.field.country")}</span>
              <select className="input" value={form.countryCode} onChange={(e) => setForm((p) => ({ ...p, countryCode: e.target.value }))}>
                <option value="">{t("admin.servers.field.country_none")}</option>
                {countryOptionsList.map(({ code }) => <option key={code} value={code}>{countryFlag(code)} {code}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field__label">{t("admin.servers.field.visibility")}</span>
              <select className="input" value={form.visibility} onChange={(e) => setForm((p) => ({ ...p, visibility: e.target.value as Visibility }))}>
                <option value="public">{t("admin.servers.visibility.public")}</option>
                <option value="admin_only">{t("admin.servers.visibility.admin_only")}</option>
              </select>
            </label>
            <label className="admin-serverStatus-check">
              <input type="checkbox" checked={form.affectsPublicHealth} onChange={(e) => setForm((p) => ({ ...p, affectsPublicHealth: e.target.checked }))} />
              {t("admin.servers.field.affects_health")}
            </label>
            <label className="admin-serverStatus-check">
              <input type="checkbox" checked={form.nodeExporterEnabled} onChange={(e) => setForm((p) => ({ ...p, nodeExporterEnabled: e.target.checked }))} />
              {t("admin.servers.field.node_exporter_enabled")}
            </label>
            <label className="field admin-serverStatus-fieldWide">
              <span className="field__label">{t("admin.servers.field.exporter")}</span>
              <input className="input" value={form.exporterUrl} onChange={(e) => setForm((p) => ({ ...p, exporterUrl: e.target.value }))} disabled={!form.nodeExporterEnabled} />
            </label>
            <label className="field">
              <span className="field__label">{t("admin.servers.field.exporter_auth")}</span>
              <select className="input" value={form.exporterAuthType} onChange={(e) => setForm((p) => ({ ...p, exporterAuthType: e.target.value === "basic" ? "basic" : "none" }))}>
                <option value="none">{t("admin.servers.auth.none")}</option>
                <option value="basic">{t("admin.servers.auth.basic")}</option>
              </select>
            </label>
            {form.exporterAuthType === "basic" && (
              <>
                <label className="field">
                  <span className="field__label">{t("admin.servers.field.exporter_username")}</span>
                  <input className="input" value={form.exporterUsername} onChange={(e) => setForm((p) => ({ ...p, exporterUsername: e.target.value }))} />
                </label>
                <label className="field">
                  <span className="field__label">{t("admin.servers.field.exporter_password")}</span>
                  <input className="input" type="password" value={form.exporterPassword} onChange={(e) => setForm((p) => ({ ...p, exporterPassword: e.target.value }))} placeholder={t("admin.servers.field.exporter_password_keep")} />
                </label>
              </>
            )}
            <label className="field">
              <span className="field__label">{t("admin.servers.field.sort")}</span>
              <input className="input" type="number" value={form.sortOrder} onChange={(e) => setForm((p) => ({ ...p, sortOrder: Number(e.target.value) }))} />
            </label>
            <label className="field">
              <span className="field__label">{t("admin.servers.field.uplink")}</span>
              <input className="input" type="number" value={form.uplinkMbps} onChange={(e) => setForm((p) => ({ ...p, uplinkMbps: e.target.value }))} />
            </label>
            <label className="admin-serverStatus-check">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))} />
              {t("admin.servers.field.active")}
            </label>
            <label className="admin-serverStatus-check">
              <input type="checkbox" checked={form.overrideThresholds} onChange={(e) => setForm((p) => ({ ...p, overrideThresholds: e.target.checked }))} />
              {t("admin.servers.field.thresholds_override")}
            </label>
            {form.overrideThresholds && (
              <>
                <label className="field"><span className="field__label">{t("admin.servers.field.override_cpu")}</span><input className="input" type="number" value={form.overrideCpu} onChange={(e) => setForm((p) => ({ ...p, overrideCpu: e.target.value }))} /></label>
                <label className="field"><span className="field__label">{t("admin.servers.field.override_memory")}</span><input className="input" type="number" value={form.overrideMemory} onChange={(e) => setForm((p) => ({ ...p, overrideMemory: e.target.value }))} /></label>
                <label className="field"><span className="field__label">{t("admin.servers.field.override_disk")}</span><input className="input" type="number" value={form.overrideDisk} onChange={(e) => setForm((p) => ({ ...p, overrideDisk: e.target.value }))} /></label>
              </>
            )}
          </div>
          <div className="actions actions--2 admin-gap-top-sm">
            <button className="btn btn--primary" type="button" onClick={() => void save()} disabled={busy || !form.host.trim()}>{editingId ? t("common.save") : t("admin.servers.action.add")}</button>
            <button className="btn" type="button" onClick={() => setEditorOpen(false)} disabled={busy}>{t("common.cancel")}</button>
          </div>
        </ModalShell>
      )}

      <ActionMenu
        anchorEl={actionAnchor}
        open={actionServerId != null}
        onClose={() => {
          const el = actionAnchor;
          setActionServerId(null);
          setActionAnchor(null);
          window.requestAnimationFrame(() => {
            try { el?.focus?.({ preventScroll: true }); } catch { /* best-effort */ }
          });
        }}
        items={(() => {
          const it = items.find((x) => x.id === actionServerId);
          return it
            ? [
                { label: t("common.edit"), onClick: () => edit(it) },
                { label: t("common.delete"), danger: true, onClick: () => void remove(it.id) },
              ]
            : [];
        })()}
      />
    </div>
  );
}