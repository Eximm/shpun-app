import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { useI18n } from "../../shared/i18n";
import { AdminSectionHeader, AdminSectionIcon, ADMIN_SECTION_ICON, ModalShell } from "./shared";
import { formatBitrate, formatLoad, formatPct, shouldShowRemnawaveUsers } from "./monitoringFormat";

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
  remnawave_integration_id: number | null;
  remnawave_node_uuid: string | null;
  thresholds_json: string | null;
  current?: CurrentCheck | null;
};

type MonitoringSummary = {
  totals: { all: number; online: number; offline: number; vpn: number; gateway: number; infra: number; public: number; adminOnly: number };
  incidents: { critical: number; warning: number; total: number };
  globalOnlineUsers: number | null;
};

type Integration = {
  id: number;
  name: string;
  type: "remnawave" | "node_exporter";
  enabled: boolean;
  baseUrl: string;
  metricsUrl: string;
  apiUrl: string;
  username: string;
  hasPassword: boolean;
  hasApiToken: boolean;
  lastCheckAt: string | null;
  lastCheckStatus: string | null;
  lastErrorCode: string | null;
};

type RemnawaveNode = { nodeUuid: string; nodeName: string | null; onlineUsers: number | null; up: boolean | null };

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
  rxErrorsDelta: number | null;
  txErrorsDelta: number | null;
  rxDropsDelta: number | null;
  txDropsDelta: number | null;
  fileDescriptors: number | null;
  sockets: number | null;
  remnawaveOnline: boolean | null;
  onlineUsers: number | null;
  exporterStatus: "ok" | "error" | "disabled";
  lastError: string | null;
  checkedAt: string | null;
};

type Incident = {
  id: number;
  rule_type: string;
  severity: "info" | "warning" | "critical";
  state: string;
  opened_at: number;
  resolved_at: number | null;
  value: number | null;
  message: string;
};

type HistoryPoint = {
  ts: number;
  cpuAvg: number | null;
  memAvg: number | null;
  diskAvg: number | null;
  rxAvg: number | null;
  txAvg: number | null;
  load1Avg: number | null;
};

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
  remnawaveIntegrationId: "",
  remnawaveNodeUuid: "",
  overrideThresholds: false,
  overrideCpu: "",
  overrideMemory: "",
  overrideDisk: "",
};

const EMPTY_INTEGRATION = {
  name: "",
  type: "remnawave" as "remnawave" | "node_exporter",
  metricsUrl: "",
  baseUrl: "",
  apiUrl: "",
  username: "",
  password: "",
  apiToken: "",
  enabled: true,
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

function Gauge({ label, value, tone = "ok" }: { label: string; value: number | null; tone?: "ok" | "warn" | "bad" }) {
  const pct = value == null ? 0 : Math.min(100, Math.max(0, value));
  const cls = value == null ? "is-empty" : value >= 90 ? "is-bad" : value >= 75 ? "is-warn" : tone === "warn" ? "is-warn" : "is-ok";
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

function Sparkline({ points, pick, label }: { points: HistoryPoint[]; pick: (p: HistoryPoint) => number | null; label: string }) {
  const values = points.map(pick);
  if (values.length < 2) return null;
  const width = 240;
  const height = 48;
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const coords = values
    .map((v, i) => (v == null ? null : `${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`))
    .filter((x): x is string => x != null);
  return (
    <div className="mon-chart">
      <div className="mon-chart__label">{label}</div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <polyline className="mon-chart__line" points={coords.join(" ")} />
      </svg>
      <div className="mon-chart__range">{`${Math.round(min)}–${Math.round(max)}`}</div>
    </div>
  );
}

export function ServerStatusSection() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<MonitoredServer[]>([]);
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [settings, setSettings] = useState<Thresholds | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [integrationForm, setIntegrationForm] = useState({ ...EMPTY_INTEGRATION });
  const [editingIntegrationId, setEditingIntegrationId] = useState<number | null>(null);
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [remnawaveNodes, setRemnawaveNodes] = useState<RemnawaveNode[]>([]);
  const [probeDiag, setProbeDiag] = useState<Record<number, { metricFamilies: string[]; labelKeys: string[]; nodeUuidCount: number } | null>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ current: CurrentCheck | null; activeIncidents: Incident[]; recentIncidents: Incident[] } | null>(null);
  const [historyRange, setHistoryRange] = useState<"1h" | "24h" | "7d">("1h");
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const countryOptionsList = useMemo(
    () => COUNTRY_CODES.map((code) => ({ code })).sort((a, b) => a.code.localeCompare(b.code, locale)),
    [locale],
  );

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [servers, sum, ints, sets] = await Promise.all([
        apiFetch<{ ok: true; items: MonitoredServer[] }>("/admin/monitored-servers", { method: "GET" }),
        apiFetch<{ ok: true } & MonitoringSummary>("/admin/monitoring/summary", { method: "GET" }),
        apiFetch<{ ok: true; items: Integration[] }>("/admin/monitoring/integrations", { method: "GET" }),
        apiFetch<{ ok: true; thresholds: Thresholds }>("/admin/monitoring/settings", { method: "GET" }),
      ]);
      setItems(servers.items ?? []);
      setSummary({ totals: sum.totals, incidents: sum.incidents, globalOnlineUsers: sum.globalOnlineUsers });
      setIntegrations(ints.items ?? []);
      setSettings(sets.thresholds ?? null);
    } catch (e: any) {
      setError(e?.message || t("admin.servers.err.load"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(); }, []);

  /* ── Server editor ─────────────────────────────────────────────────────── */

  function startCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setRemnawaveNodes([]);
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
      remnawaveIntegrationId: item.remnawave_integration_id ? String(item.remnawave_integration_id) : "",
      remnawaveNodeUuid: item.remnawave_node_uuid || "",
      overrideThresholds: Boolean(item.thresholds_json),
      overrideCpu: override.cpuPct != null ? String(override.cpuPct) : "",
      overrideMemory: override.memoryWarnPct != null ? String(override.memoryWarnPct) : "",
      overrideDisk: override.diskWarnPct != null ? String(override.diskWarnPct) : "",
    });
    setRemnawaveNodes([]);
    setEditorOpen(true);
  }

  async function loadRemnawaveNodes(integrationId: string) {
    setRemnawaveNodes([]);
    const id = Number(integrationId);
    if (!id) return;
    try {
      const r = await apiFetch<{ ok: true; nodes: RemnawaveNode[] }>(`/admin/monitoring/integrations/${id}/nodes`, { method: "GET" });
      setRemnawaveNodes(r.nodes ?? []);
    } catch {
      setRemnawaveNodes([]);
    }
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
      remnawaveIntegrationId: form.remnawaveIntegrationId ? Number(form.remnawaveIntegrationId) : null,
      remnawaveNodeUuid: form.remnawaveNodeUuid || null,
      thresholds: form.overrideThresholds ? override : null,
    };
    if (form.exporterPassword) body.exporterPassword = form.exporterPassword;

    try {
      if (editingId) await apiFetch(`/admin/monitored-servers/${editingId}`, { method: "PUT", body });
      else await apiFetch("/admin/monitored-servers", { method: "POST", body });
      setEditorOpen(false);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || t("admin.servers.err.save"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm(t("admin.servers.confirm.delete"))) return;
    await apiFetch(`/admin/monitored-servers/${id}`, { method: "DELETE" });
    await loadAll();
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

  /* ── Integrations ──────────────────────────────────────────────────────── */

  function startIntegrationCreate() {
    setEditingIntegrationId(null);
    setIntegrationForm({ ...EMPTY_INTEGRATION });
    setIntegrationOpen(true);
  }

  function editIntegration(item: Integration) {
    setEditingIntegrationId(item.id);
    setIntegrationForm({
      name: item.name,
      type: item.type,
      metricsUrl: item.metricsUrl,
      baseUrl: item.baseUrl,
      apiUrl: item.apiUrl,
      username: item.username,
      password: "",
      apiToken: "",
      enabled: item.enabled,
    });
    setIntegrationOpen(true);
  }

  async function saveIntegration() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const body: Record<string, unknown> = { ...integrationForm };
    if (!integrationForm.password) delete body.password;
    if (!integrationForm.apiToken) delete body.apiToken;
    try {
      if (editingIntegrationId) await apiFetch(`/admin/monitoring/integrations/${editingIntegrationId}`, { method: "PUT", body });
      else await apiFetch("/admin/monitoring/integrations", { method: "POST", body });
      setIntegrationOpen(false);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || t("admin.monitoring.integrations.err.save"));
    } finally {
      setBusy(false);
    }
  }

  async function removeIntegration(id: number) {
    if (!window.confirm(t("admin.monitoring.integrations.confirm.delete"))) return;
    await apiFetch(`/admin/monitoring/integrations/${id}`, { method: "DELETE" });
    await loadAll();
  }

  async function testIntegration(id: number) {
    setNotice(null);
    setError(null);
    try {
      const r = await apiFetch<{ ok: true; probe: { reachable: boolean; nodeMetricsFound: boolean; onlineUsersMetricPresent: boolean; errorCode: string | null; nodeCount: number; diagnostics?: { metricFamilies: string[]; labelKeys: string[]; nodeUuidCount: number } } }>(
        `/admin/monitoring/integrations/${id}/test`,
        { method: "POST" },
      );
      const p = r.probe;
      setProbeDiag((prev) => ({ ...prev, [id]: p.diagnostics ?? null }));
      if (p.reachable && p.onlineUsersMetricPresent) {
        setNotice(t("admin.monitoring.integrations.test.ok", { count: p.nodeCount }));
      } else {
        setNotice(t("admin.monitoring.integrations.test.fail", { code: p.errorCode || (p.nodeMetricsFound ? "metric_missing" : "no_nodes") }));
      }
    } catch (e: any) {
      setError(e?.message || t("admin.monitoring.integrations.err.test"));
    }
  }

  /* ── Settings ─────────────────────────────────────────────────────────── */

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

  async function toggleExpand(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    setHistory([]);
    setDetailLoading(true);
    try {
      const [d, h] = await Promise.all([
        apiFetch<{ ok: true; current: CurrentCheck | null; activeIncidents: Incident[]; recentIncidents: Incident[] }>(
          `/admin/monitoring/servers/${id}/detail`,
          { method: "GET" },
        ),
        apiFetch<{ ok: true; points: HistoryPoint[] }>(`/admin/monitoring/servers/${id}/history?range=${historyRange}`, { method: "GET" }),
      ]);
      setDetail({ current: d.current, activeIncidents: d.activeIncidents ?? [], recentIncidents: d.recentIncidents ?? [] });
      setHistory(h.points ?? []);
    } catch {
      setDetail({ current: null, activeIncidents: [], recentIncidents: [] });
    } finally {
      setDetailLoading(false);
    }
  }

  async function changeRange(range: "1h" | "24h" | "7d") {
    setHistoryRange(range);
    if (!expandedId) return;
    try {
      const h = await apiFetch<{ ok: true; points: HistoryPoint[] }>(`/admin/monitoring/servers/${expandedId}/history?range=${range}`, { method: "GET" });
      setHistory(h.points ?? []);
    } catch {
      setHistory([]);
    }
  }

  /* ── Grouping / rendering ──────────────────────────────────────────────── */

  const groups: { kind: ServerKind; items: MonitoredServer[] }[] = [
    { kind: "vpn", items: items.filter((i) => i.kind === "vpn") },
    { kind: "gateway", items: items.filter((i) => i.kind === "gateway") },
    { kind: "infra", items: items.filter((i) => i.kind === "infra") },
  ];

  function stateLabel(online: boolean | null | undefined) {
    if (online === true) return t("admin.monitoring.state.online");
    if (online === false) return t("admin.monitoring.state.offline");
    return t("admin.monitoring.state.unknown");
  }

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
                <button className="btn" type="button" onClick={() => void loadAll()} disabled={loading}>{t("common.refresh")}</button>
                <button className="btn btn--primary" type="button" onClick={startCreate}>{t("admin.servers.new")}</button>
              </>
            }
          />

          {error && <div className="pre admin-gap-top-sm">{error}</div>}
          {notice && <div className="pre admin-gap-top-sm">{notice}</div>}

          {summary && (
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
              <div className={`mon-summary__stat${summary.incidents.critical > 0 ? " is-bad" : summary.incidents.total > 0 ? " is-warn" : ""}`}>
                <span className="mon-summary__value">{summary.incidents.total}</span>
                <span className="mon-summary__label">{t("admin.monitoring.summary.incidents")}</span>
              </div>
              <div className="mon-summary__stat">
                <span className="mon-summary__value">{summary.incidents.warning}</span>
                <span className="mon-summary__label">{t("admin.monitoring.summary.warnings")}</span>
              </div>
              {summary.globalOnlineUsers != null && (
                <div className="mon-summary__stat">
                  <span className="mon-summary__value">{summary.globalOnlineUsers}</span>
                  <span className="mon-summary__label">{t("admin.monitoring.summary.global_users")}</span>
                </div>
              )}
            </div>
          )}

          {groups.map((group) => (
            <section key={group.kind} className="mon-group admin-gap-top-md">
              <h3 className="h2 mon-group__title">
                <AdminSectionIcon name={group.kind === "vpn" ? "server" : group.kind === "gateway" ? "gateway" : "layers"} size={16} />
                {t(kindKey(group.kind))}
              </h3>
              {group.items.length === 0 && <div className="pre">{t("admin.servers.empty")}</div>}
              {group.items.map((item) => {
                const expanded = expandedId === item.id;
                // Compact rows use the current snapshot delivered with the admin
                // list; expanding only enriches with incidents/history and must
                // never be required to see CPU/RAM/Disk/load/network.
                const current = expanded ? detail?.current ?? item.current ?? null : item.current ?? null;
                const users = current?.onlineUsers;
                const rowState = !Number(item.active) || current?.online === false
                  ? "is-offline"
                  : current?.remnawaveOnline === false
                    ? "is-warn"
                    : "";
                return (
                  <div key={item.id} className={`mon-row${expanded ? " is-expanded" : ""}${rowState ? ` ${rowState}` : ""}`}>
                    <div className="mon-row__main" role="button" tabIndex={0} onClick={() => void toggleExpand(item.id)} onKeyDown={(e) => { if (e.key === "Enter") void toggleExpand(item.id); }}>
                      <div className="mon-row__identity">
                        <div className="mon-row__title">
                          <span className={`serverStatus-dot serverStatus-dot--${Number(item.active) ? "online" : "offline"}`} />
                          {item.country_code ? `${countryFlag(item.country_code)} ` : ""}{item.title || item.host}
                        </div>
                        <div className="mon-row__badges">
                          <span className={`chip ${current?.online === false ? "chip--bad" : "chip--soft"}`}>{stateLabel(current?.online)}</span>
                          <span className="chip chip--soft">{t(kindKey(item.kind))}</span>
                          <span className={`chip ${item.visibility === "admin_only" ? "chip--warn" : "chip--ok"}`}>
                            {item.visibility === "admin_only" ? `🔒 ${t("admin.monitoring.badge.internal")}` : t("admin.monitoring.badge.public")}
                          </span>
                          {Number(item.affects_public_health) === 1 && item.visibility === "admin_only" && (
                            <span className="chip chip--soft">{t("admin.monitoring.badge.affects_health")}</span>
                          )}
                          {shouldShowRemnawaveUsers(Boolean(item.remnawave_node_uuid), users) && (
                            <span className="chip chip--ok">{t("admin.monitoring.badge.connections", { count: users ?? 0 })}</span>
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
                        <span className={`mon-row__plain mon-row__fresh${current?.online === false ? " is-stale" : ""}`}>{t("admin.monitoring.metric.freshness", { value: fmtRelative(current?.checkedAt ?? null, t) })}</span>
                      </div>
                      <div className="actions mon-row__actions mon-row__actions--desktop">
                        <button className="btn btn--soft" type="button" onClick={(e) => { e.stopPropagation(); edit(item); }}>{t("common.edit")}</button>
                        <button className="btn btn--danger" type="button" onClick={(e) => { e.stopPropagation(); void remove(item.id); }}>{t("common.delete")}</button>
                      </div>
                      <div className="mon-row__overflow" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn btn--soft mon-row__overflowBtn"
                          type="button"
                          aria-label={t("admin.monitoring.action.menu")}
                          aria-haspopup="menu"
                          aria-expanded={menuOpenId === item.id}
                          onClick={() => setMenuOpenId(menuOpenId === item.id ? null : item.id)}
                        >⋮</button>
                        {menuOpenId === item.id && (
                          <div className="mon-row__overflowMenu" role="menu">
                            <button className="btn btn--soft" role="menuitem" type="button" onClick={() => { setMenuOpenId(null); edit(item); }}>{t("common.edit")}</button>
                            <button className="btn btn--danger" role="menuitem" type="button" onClick={() => { setMenuOpenId(null); void remove(item.id); }}>{t("common.delete")}</button>
                          </div>
                        )}
                      </div>
                    </div>

                    {expanded && (
                      <div className="mon-detail">
                        {detailLoading && <div className="pre">{t("common.loading")}</div>}
                        {current && (
                          <>
                            <div className="mon-detail__section">
                              <div className="mon-detail__heading">{t("admin.monitoring.section.system")}</div>
                              <div className="mon-kv">
                                <span>{t("admin.monitoring.metric.cpu")}</span><b>{current.cpuLoadPct ?? "—"}%</b>
                                <span>{t("admin.monitoring.metric.iowait")}</span><b>{current.iowaitPct ?? "—"}%</b>
                                <span>{t("admin.monitoring.metric.load")}</span><b>{`${current.load1 ?? "—"} / ${current.load5 ?? "—"} / ${current.load15 ?? "—"}`}</b>
                                <span>{t("admin.monitoring.metric.ram")}</span><b>{current.memoryLoadPct ?? "—"}%</b>
                                <span>{t("admin.monitoring.metric.swap")}</span><b>{current.swapLoadPct ?? "—"}%</b>
                                <span>{t("admin.monitoring.metric.disk")}</span><b>{current.diskLoadPct ?? "—"}%</b>
                                <span>{t("admin.monitoring.metric.disk_free")}</span><b>{fmtBytes(current.diskFreeBytes)}</b>
                                <span>{t("admin.monitoring.metric.inode")}</span><b>{current.inodeLoadPct ?? "—"}%</b>
                                <span>{t("admin.monitoring.metric.uptime")}</span><b>{current.uptime ?? "—"}</b>
                                <span>{t("admin.monitoring.metric.cpu_cores")}</span><b>{current.cpuCores ?? "—"}</b>
                              </div>
                            </div>

                            <div className="mon-detail__section">
                              <div className="mon-detail__heading">{t("admin.monitoring.section.network")}</div>
                              <div className="mon-kv">
                                <span>{t("admin.monitoring.metric.rx")}</span><b>{formatBitrate(current.rxMbps)}</b>
                                <span>{t("admin.monitoring.metric.tx")}</span><b>{formatBitrate(current.txMbps)}</b>
                                <span>{t("admin.monitoring.metric.uplink")}</span><b>{current.uplinkLoadPct ?? "—"}%</b>
                                <span>{t("admin.monitoring.metric.drops")}</span><b>{`${current.rxDropsDelta ?? "—"} / ${current.txDropsDelta ?? "—"}`}</b>
                                <span>{t("admin.monitoring.metric.errors")}</span><b>{`${current.rxErrorsDelta ?? "—"} / ${current.txErrorsDelta ?? "—"}`}</b>
                                <span>{t("admin.monitoring.metric.fd")}</span><b>{current.fileDescriptors ?? "—"}</b>
                                <span>{t("admin.monitoring.metric.sockets")}</span><b>{current.sockets ?? "—"}</b>
                              </div>
                            </div>

                            <div className="mon-detail__section">
                              <div className="mon-detail__heading">{t("admin.monitoring.section.remnawave")}</div>
                              <div className="mon-kv">
                                <span>{t("admin.monitoring.remnawave.state")}</span><b>{current.remnawaveOnline == null ? t("admin.monitoring.remnawave.not_bound") : stateLabel(current.remnawaveOnline)}</b>
                                <span>{t("admin.monitoring.remnawave.users")}</span><b>{current.onlineUsers ?? "—"}</b>
                                <span>{t("admin.monitoring.remnawave.node_uuid")}</span><b>{item.remnawave_node_uuid || "—"}</b>
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
                                  {detail.activeIncidents.map((inc) => (
                                    <div key={inc.id} className={`mon-incident mon-incident--${inc.severity}`}>
                                      <span>{inc.message}</span>
                                      <span className="mon-incident__meta">{`${inc.severity} · ${inc.state}`}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="mon-kv"><span>{t("admin.monitoring.incidents.none")}</span><b>—</b></div>
                              )}
                            </div>

                            <div className="mon-detail__section">
                              <div className="mon-detail__heading">{t("admin.monitoring.section.history")}</div>
                              <div className="actions actions--3 admin-gap-top-sm">
                                {(["1h", "24h", "7d"] as const).map((range) => (
                                  <button key={range} className={`btn ${historyRange === range ? "btn--primary" : "btn--soft"}`} type="button" onClick={() => void changeRange(range)}>
                                    {t(`admin.monitoring.history.range.${range}`)}
                                  </button>
                                ))}
                              </div>
                              {history.length < 2 ? (
                                <div className="pre admin-gap-top-sm">{t("admin.monitoring.history.empty")}</div>
                              ) : (
                                <div className="mon-charts admin-gap-top-sm">
                                  <Sparkline points={history} pick={(p) => p.cpuAvg} label={t("admin.monitoring.metric.cpu")} />
                                  <Sparkline points={history} pick={(p) => p.memAvg} label={t("admin.monitoring.metric.ram")} />
                                  <Sparkline points={history} pick={(p) => p.rxAvg} label={t("admin.monitoring.metric.rx")} />
                                  <Sparkline points={history} pick={(p) => p.txAvg} label={t("admin.monitoring.metric.tx")} />
                                  <Sparkline points={history} pick={(p) => p.diskAvg} label={t("admin.monitoring.metric.disk")} />
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

      {/* Integrations */}
      <div className="card">
        <div className="card__body">
          <AdminSectionHeader
            icon="integration"
            kicker={t("admin.tab.serverStatus")}
            title={t("admin.monitoring.integrations.title")}
            subtitle={t("admin.monitoring.integrations.subtitle")}
            actions={<button className="btn btn--primary" type="button" onClick={startIntegrationCreate}>{t("admin.monitoring.integrations.new")}</button>}
          />
          <div className="admin-serverStatus-list admin-gap-top-md">
            {integrations.map((item) => (
              <div className="admin-serverStatus-item" key={item.id}>
                <div>
                  <div className="admin-serverStatus-title">
                    <span className={`serverStatus-dot serverStatus-dot--${item.lastCheckStatus === "error" ? "offline" : "online"}`} />
                    {item.name}
                  </div>
                  <div className="list__sub">{item.type} · {item.metricsUrl || item.baseUrl}</div>
                  <div className="list__sub">
                    {item.hasPassword ? t("admin.monitoring.integrations.secret.set") : t("admin.monitoring.integrations.secret.none")}
                    {" · "}
                    {t("admin.monitoring.integrations.last_check", { value: item.lastCheckAt || "—" })}
                    {item.lastErrorCode ? ` · ${item.lastErrorCode}` : ""}
                  </div>
                  {probeDiag[item.id] && (
                    <div className="list__sub">
                      {t("admin.monitoring.integrations.diag.metrics")}: {probeDiag[item.id]!.metricFamilies.join(", ") || "—"}
                      <br />
                      {t("admin.monitoring.integrations.diag.labels")}: {probeDiag[item.id]!.labelKeys.join(", ") || "—"}
                      <br />
                      {t("admin.monitoring.integrations.diag.uuid")}: {probeDiag[item.id]!.nodeUuidCount}
                    </div>
                  )}
                </div>
                <div className="actions">
                  <button className="btn btn--soft" type="button" onClick={() => void testIntegration(item.id)}>{t("admin.monitoring.integrations.test")}</button>
                  <button className="btn btn--soft" type="button" onClick={() => editIntegration(item)}>{t("common.edit")}</button>
                  <button className="btn btn--danger" type="button" onClick={() => void removeIntegration(item.id)}>{t("common.delete")}</button>
                </div>
              </div>
            ))}
            {integrations.length === 0 && <div className="pre">{t("admin.monitoring.integrations.empty")}</div>}
          </div>
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
            <label className="field">
              <span className="field__label">{t("admin.servers.field.remnawave_integration")}</span>
              <select
                className="input"
                value={form.remnawaveIntegrationId}
                onChange={(e) => { setForm((p) => ({ ...p, remnawaveIntegrationId: e.target.value, remnawaveNodeUuid: "" })); void loadRemnawaveNodes(e.target.value); }}
              >
                <option value="">{t("admin.servers.field.remnawave_none")}</option>
                {integrations.filter((i) => i.type === "remnawave").map((i) => <option key={i.id} value={String(i.id)}>{i.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field__label">{t("admin.servers.field.remnawave_uuid")}</span>
              {remnawaveNodes.length > 0 ? (
                <select className="input" value={form.remnawaveNodeUuid} onChange={(e) => setForm((p) => ({ ...p, remnawaveNodeUuid: e.target.value }))}>
                  <option value="">{t("admin.servers.field.remnawave_none")}</option>
                  {remnawaveNodes.map((n) => <option key={n.nodeUuid} value={n.nodeUuid}>{`${n.nodeName || n.nodeUuid} · ${n.nodeUuid}`}</option>)}
                </select>
              ) : (
                <input className="input" value={form.remnawaveNodeUuid} onChange={(e) => setForm((p) => ({ ...p, remnawaveNodeUuid: e.target.value }))} />
              )}
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

      {/* Integration editor */}
      {integrationOpen && (
        <ModalShell
          kicker={t("admin.monitoring.integrations.title")}
          title={editingIntegrationId ? t("admin.monitoring.integrations.edit") : t("admin.monitoring.integrations.new")}
          onClose={() => setIntegrationOpen(false)}
        >
          <div className="admin-serverStatus-form">
            <label className="field"><span className="field__label">{t("admin.monitoring.integrations.field.name")}</span><input className="input" value={integrationForm.name} onChange={(e) => setIntegrationForm((p) => ({ ...p, name: e.target.value }))} /></label>
            <label className="field">
              <span className="field__label">{t("admin.monitoring.integrations.field.type")}</span>
              <select className="input" value={integrationForm.type} onChange={(e) => setIntegrationForm((p) => ({ ...p, type: e.target.value === "node_exporter" ? "node_exporter" : "remnawave" }))}>
                <option value="remnawave">{t("admin.monitoring.integrations.type.remnawave")}</option>
                <option value="node_exporter">{t("admin.monitoring.integrations.type.node_exporter")}</option>
              </select>
            </label>
            <label className="field admin-serverStatus-fieldWide"><span className="field__label">{t("admin.monitoring.integrations.field.metrics_url")}</span><input className="input" value={integrationForm.metricsUrl} onChange={(e) => setIntegrationForm((p) => ({ ...p, metricsUrl: e.target.value }))} /></label>
            <label className="field admin-serverStatus-fieldWide"><span className="field__label">{t("admin.monitoring.integrations.field.base_url")}</span><input className="input" value={integrationForm.baseUrl} onChange={(e) => setIntegrationForm((p) => ({ ...p, baseUrl: e.target.value }))} /></label>
            <label className="field admin-serverStatus-fieldWide"><span className="field__label">{t("admin.monitoring.integrations.field.api_url")}</span><input className="input" value={integrationForm.apiUrl} onChange={(e) => setIntegrationForm((p) => ({ ...p, apiUrl: e.target.value }))} /></label>
            <label className="field"><span className="field__label">{t("admin.monitoring.integrations.field.username")}</span><input className="input" value={integrationForm.username} onChange={(e) => setIntegrationForm((p) => ({ ...p, username: e.target.value }))} /></label>
            <label className="field"><span className="field__label">{t("admin.monitoring.integrations.field.password")}</span><input className="input" type="password" value={integrationForm.password} onChange={(e) => setIntegrationForm((p) => ({ ...p, password: e.target.value }))} placeholder={t("admin.monitoring.integrations.field.password_keep")} /></label>
            <label className="field"><span className="field__label">{t("admin.monitoring.integrations.field.api_token")}</span><input className="input" type="password" value={integrationForm.apiToken} onChange={(e) => setIntegrationForm((p) => ({ ...p, apiToken: e.target.value }))} placeholder={t("admin.monitoring.integrations.field.token_keep")} /></label>
            <label className="admin-serverStatus-check"><input type="checkbox" checked={integrationForm.enabled} onChange={(e) => setIntegrationForm((p) => ({ ...p, enabled: e.target.checked }))} />{t("admin.monitoring.integrations.field.enabled")}</label>
          </div>
          <div className="actions actions--2 admin-gap-top-sm">
            <button className="btn btn--primary" type="button" onClick={() => void saveIntegration()} disabled={busy}>{t("common.save")}</button>
            <button className="btn" type="button" onClick={() => setIntegrationOpen(false)} disabled={busy}>{t("common.cancel")}</button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}