// FILE: web/src/pages/admin/TrialProtectionSection.tsx

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { AdminMetric, AdminSectionHeader, ModalShell } from "./shared";
import { useI18n } from "../../shared/i18n";
import { copyText, formatDateTime, parseMetaJson, shortDeviceToken } from "./utils";
import type {
  BlockDeviceResp, ClearEventsResp, DeleteDeviceResp, ResetDeviceResp, ResetPrefixResp,
  TrialDeviceItem, TrialDeviceMode, TrialDevicesResp, TrialPrefixItem, TrialPrefixesResp,
  TrialProtectionEventItem, TrialProtectionEventsResp,
  TrialProtectionSettingsSaveResp, TrialProtectionStatusResp,
} from "./types";

const DEVICES_PER_PAGE     = 10;
const EVENTS_PREVIEW_COUNT = 5;

export function TrialProtectionSection() {
  const { t } = useI18n();
  const [loading,          setLoading]          = useState(true);
  const [refreshing,       setRefreshing]       = useState(false);
  const [savingSettings,   setSavingSettings]   = useState(false);
  const [resettingPrefix,  setResettingPrefix]  = useState<string | null>(null);
  const [resettingDevice,  setResettingDevice]  = useState<string | null>(null);
  const [blockingDevice,   setBlockingDevice]   = useState<string | null>(null);
  const [unblockingDevice, setUnblockingDevice] = useState<string | null>(null);
  const [deletingDevice,   setDeletingDevice]   = useState<string | null>(null);
  const [clearingEvents,   setClearingEvents]   = useState(false);

  const [status,   setStatus]   = useState<TrialProtectionStatusResp | null>(null);
  const [events,   setEvents]   = useState<TrialProtectionEventItem[]>([]);
  const [devices,  setDevices]  = useState<TrialDeviceItem[]>([]);
  const [prefixes, setPrefixes] = useState<TrialPrefixItem[]>([]);

  const [openedEvent,  setOpenedEvent]  = useState<TrialProtectionEventItem | null>(null);
  const [openedDevice, setOpenedDevice] = useState<TrialDeviceItem | null>(null);

  const [error,  setError]  = useState<string | null>(null);
  const [okText, setOkText] = useState<string | null>(null);

  const [eventsExpanded, setEventsExpanded] = useState(false);
  const [eventsShowAll,  setEventsShowAll]  = useState(false);
  const [devicesPage,    setDevicesPage]    = useState(1);
  const [deviceQuery,    setDeviceQuery]    = useState("");
  const [showAllDevices, setShowAllDevices] = useState(false);
  const [networkInput,   setNetworkInput]   = useState("");

  const [modeDraft,                              setModeDraft]                              = useState<TrialDeviceMode>("observe");
  const [ttlDraft,                               setTtlDraft]                               = useState("72");
  const [ipPrefixUsageThresholdDraft,            setIpPrefixUsageThresholdDraft]            = useState("2");
  const [ipPrefixAttemptThresholdDraft,          setIpPrefixAttemptThresholdDraft]          = useState("3");
  const [ipPrefixDistinctDevicesThresholdDraft,  setIpPrefixDistinctDevicesThresholdDraft]  = useState("3");
  const [ipPrefixUserAgentAttemptThresholdDraft, setIpPrefixUserAgentAttemptThresholdDraft] = useState("2");
  const [ipPrefixDistinctUsersThresholdDraft,    setIpPrefixDistinctUsersThresholdDraft]    = useState("3");
  const [requireVerifiedEmailDraft,              setRequireVerifiedEmailDraft]              = useState(false);

  async function load(opts?: { silent?: boolean }) {
    const silent = Boolean(opts?.silent);
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const devicesUrl = showAllDevices
        ? "/admin/trial-protection/devices?all=1"
        : "/admin/trial-protection/devices";
      const [statusResp, eventsResp, devicesResp, prefixesResp] = await Promise.all([
        apiFetch<TrialProtectionStatusResp>("/admin/trial-protection/status", { method: "GET" }),
        apiFetch<TrialProtectionEventsResp>("/admin/trial-protection/events?limit=20", { method: "GET" }),
        apiFetch<TrialDevicesResp>(devicesUrl, { method: "GET" }),
        apiFetch<TrialPrefixesResp>("/admin/trial-protection/prefixes?limit=20", { method: "GET" }),
      ]);
      setStatus(statusResp);
      setModeDraft(statusResp.mode);
      setTtlDraft(String(statusResp.ttlHours));
      setIpPrefixUsageThresholdDraft(String(statusResp.ipPrefixUsageThreshold ?? 2));
      setIpPrefixAttemptThresholdDraft(String(statusResp.ipPrefixAttemptThreshold ?? 3));
      setIpPrefixDistinctDevicesThresholdDraft(String(statusResp.ipPrefixDistinctDevicesThreshold ?? 3));
      setIpPrefixUserAgentAttemptThresholdDraft(String(statusResp.ipPrefixUserAgentAttemptThreshold ?? 2));
      setIpPrefixDistinctUsersThresholdDraft(String(statusResp.ipPrefixDistinctUsersThreshold ?? 3));
      setRequireVerifiedEmailDraft(Boolean(statusResp.requireVerifiedEmail));
      setEvents(Array.isArray(eventsResp.items) ? eventsResp.items : []);
      setDevices(Array.isArray(devicesResp.items) ? devicesResp.items : []);
      setPrefixes(Array.isArray(prefixesResp.items) ? prefixesResp.items : []);
    } catch (e: any) {
      setError(e?.message || t("admin.trial.load_failed"));
      if (!silent) { setStatus(null); setEvents([]); setDevices([]); setPrefixes([]); }
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { void load(); }, [showAllDevices]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveSettings() {
    setSavingSettings(true); setError(null); setOkText(null);
    try {
      const r = await apiFetch<TrialProtectionSettingsSaveResp>("/admin/trial-protection/settings", {
        method: "PUT",
        body: {
          mode: modeDraft, ttlHours: Number(ttlDraft),
          ipPrefixUsageThreshold:            Number(ipPrefixUsageThresholdDraft),
          ipPrefixAttemptThreshold:          Number(ipPrefixAttemptThresholdDraft),
          ipPrefixDistinctDevicesThreshold:  Number(ipPrefixDistinctDevicesThresholdDraft),
          ipPrefixUserAgentAttemptThreshold: Number(ipPrefixUserAgentAttemptThresholdDraft),
          ipPrefixDistinctUsersThreshold:    Number(ipPrefixDistinctUsersThresholdDraft),
          requireVerifiedEmail:              requireVerifiedEmailDraft,
        },
      });
      setOkText(t("admin.trial.settings.saved", { mode: r.mode, ttl: r.ttlHours }));
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || t("admin.trial.settings.save_failed")); }
    finally { setSavingSettings(false); }
  }

  async function clearEvents() {
    if (!window.confirm(t("admin.trial.confirm.clear_events"))) return;
    setClearingEvents(true); setError(null); setOkText(null);
    try {
      const r = await apiFetch<ClearEventsResp>("/admin/trial-protection/clear-events", { method: "POST", body: { keepLatest: 0 } });
      setOkText(t("admin.trial.events.cleared", { n: r.deleted }));
      if (openedEvent) setOpenedEvent(null);
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || t("admin.trial.events.clear_failed")); }
    finally { setClearingEvents(false); }
  }

  async function resetTrial(deviceToken: string) {
    if (!window.confirm(`${t("admin.trial.confirm.reset_device")}\n\n${deviceToken}`)) return;
    setResettingDevice(deviceToken); setError(null); setOkText(null);
    try {
      const r = await apiFetch<ResetDeviceResp>("/admin/trial-protection/reset-device", { method: "POST", body: { deviceToken } });
      setOkText(t("admin.trial.device.reset_done", { token: shortDeviceToken(r.deviceToken) }));
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || t("admin.trial.device.reset_failed")); }
    finally { setResettingDevice(null); }
  }

  async function resetPrefix(rawValue: string) {
    const raw = String(rawValue ?? "").trim();
    if (!raw) { setError(t("admin.trial.network.need_input")); return; }
    if (!window.confirm(`${t("admin.trial.confirm.reset_prefix")}\n\n${raw}`)) return;
    setResettingPrefix(raw); setError(null); setOkText(null);
    try {
      const r = await apiFetch<ResetPrefixResp>("/admin/trial-protection/reset-prefix", { method: "POST", body: { ip: raw, clearEvents: 1, unblockDevices: 1 } });
      setOkText(t("admin.trial.network.cleared", { prefix: r.ipPrefix, devices: r.matchedDevices }));
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || t("admin.trial.network.clear_failed")); }
    finally { setResettingPrefix(null); }
  }

  async function blockDevice(deviceToken: string) {
    if (!window.confirm(`${t("admin.trial.confirm.block_device")}\n\n${deviceToken}`)) return;
    setBlockingDevice(deviceToken); setError(null); setOkText(null);
    try {
      const r = await apiFetch<BlockDeviceResp>("/admin/trial-protection/block-device", { method: "POST", body: { deviceToken } });
      setOkText(t("admin.trial.device.blocked", { token: shortDeviceToken(r.deviceToken) }));
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || t("admin.trial.device.block_failed")); }
    finally { setBlockingDevice(null); }
  }

  async function unblockDevice(deviceToken: string) {
    if (!window.confirm(`${t("admin.trial.confirm.unblock_device")}\n\n${deviceToken}`)) return;
    setUnblockingDevice(deviceToken); setError(null); setOkText(null);
    try {
      const r = await apiFetch<BlockDeviceResp>("/admin/trial-protection/unblock-device", { method: "POST", body: { deviceToken } });
      setOkText(t("admin.trial.device.unblocked", { token: shortDeviceToken(r.deviceToken) }));
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || t("admin.trial.device.unblock_failed")); }
    finally { setUnblockingDevice(null); }
  }

  async function deleteDevice(deviceToken: string) {
    if (!window.confirm(`${t("admin.trial.confirm.delete_device")}\n\n${deviceToken}`)) return;
    setDeletingDevice(deviceToken); setError(null); setOkText(null);
    try {
      const r = await apiFetch<DeleteDeviceResp>("/admin/trial-protection/delete-device", { method: "POST", body: { deviceToken } });
      setOkText(t("admin.trial.device.deleted", { token: shortDeviceToken(r.deviceToken) }));
      if (openedDevice?.device_token === deviceToken) setOpenedDevice(null);
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || t("admin.trial.device.delete_failed")); }
    finally { setDeletingDevice(null); }
  }

  const sortedEvents  = useMemo(() => events.slice().sort((a, b)  => (b.created_at || 0) - (a.created_at || 0)), [events]);
  const sortedDevices = useMemo(() => devices.slice().sort((a, b) => (b.last_seen_at || 0) - (a.last_seen_at || 0)), [devices]);

  const filteredDevices = useMemo(() => {
    const q = deviceQuery.trim().toLowerCase();
    if (!q) return sortedDevices;
    return sortedDevices.filter((item) => {
      const token = String(item.device_token ?? "").toLowerCase();
      const ip    = String(item.last_ip ?? item.first_ip ?? "").toLowerCase();
      const ua    = String(item.user_agent ?? "").toLowerCase();
      const uid   = String(item.trial_user_id ?? "").toLowerCase();
      return token.includes(q) || ip.includes(q) || ua.includes(q) || uid.includes(q);
    });
  }, [sortedDevices, deviceQuery]);

  const totalDevicesPages = Math.max(1, Math.ceil(filteredDevices.length / DEVICES_PER_PAGE));

  useEffect(() => { setDevicesPage(1); }, [deviceQuery, showAllDevices]);
  useEffect(() => { if (devicesPage > totalDevicesPages) setDevicesPage(totalDevicesPages); }, [devicesPage, totalDevicesPages]);

  const visibleEvents = useMemo(() => {
    if (!eventsExpanded) return [];
    return eventsShowAll ? sortedEvents : sortedEvents.slice(0, EVENTS_PREVIEW_COUNT);
  }, [eventsExpanded, eventsShowAll, sortedEvents]);

  const visibleDevices = useMemo(() => {
    const start = (devicesPage - 1) * DEVICES_PER_PAGE;
    return filteredDevices.slice(start, start + DEVICES_PER_PAGE);
  }, [devicesPage, filteredDevices]);

  const hasSettingsChanges =
    modeDraft !== (status?.mode || "observe") ||
    ttlDraft !== String(status?.ttlHours ?? 72) ||
    ipPrefixUsageThresholdDraft            !== String(status?.ipPrefixUsageThreshold ?? 2) ||
    ipPrefixAttemptThresholdDraft          !== String(status?.ipPrefixAttemptThreshold ?? 3) ||
    ipPrefixDistinctDevicesThresholdDraft  !== String(status?.ipPrefixDistinctDevicesThreshold ?? 3) ||
    ipPrefixUserAgentAttemptThresholdDraft !== String(status?.ipPrefixUserAgentAttemptThreshold ?? 2) ||
    ipPrefixDistinctUsersThresholdDraft    !== String(status?.ipPrefixDistinctUsersThreshold ?? 3) ||
    requireVerifiedEmailDraft              !== Boolean(status?.requireVerifiedEmail);

  function renderDecisionChip(decision: TrialProtectionEventItem["decision"]) {
    if (decision === "block")   return <span className="chip chip--bad">BLOCK</span>;
    if (decision === "observe") return <span className="chip chip--warn">OBSERVE</span>;
    return <span className="chip chip--ok">ALLOW</span>;
  }

  const dot = <span style={{ opacity: 0.28, margin: "0 4px" }}>·</span>;

  return (
    <>
      {/* ── Настройки ── */}
      <div className="card">
        <div className="card__body">
          <AdminSectionHeader
            kicker={t("admin.tab.trial")}
            title={t("admin.section.trial.title")}
            subtitle={t("admin.section.trial.subtitle")}
            actions={
              <>
                <button className="btn" type="button"
                  onClick={() => void load({ silent: true })}
                  disabled={refreshing || savingSettings || clearingEvents || Boolean(resettingPrefix)}>
                  {refreshing ? t("admin.trial.refreshing") : t("common.refresh")}
                </button>
                <button className="btn btn--primary" type="button"
                  onClick={() => void saveSettings()}
                  disabled={savingSettings || !hasSettingsChanges}>
                  {savingSettings ? t("admin.trial.saving") : t("admin.trial.save_settings")}
                </button>
              </>
            }
          />

          {error  && <div className="pre admin-gap-top-md" style={{ borderColor: "rgba(255,77,109,0.30)" }}>{error}</div>}
          {okText && <div className="pre admin-gap-top-md" style={{ borderColor: "rgba(43,227,143,0.30)" }}>{okText}</div>}

          {loading ? (
            <div className="list admin-gap-top-md">
              <div className="skeleton h1" /><div className="skeleton p" /><div className="skeleton p" />
            </div>
          ) : (
            <>
              <div className="admin-metricsGrid admin-gap-top-md">
                <AdminMetric label={t("admin.trial.metrics.mode")}         value={status?.mode || "—"} tone={status?.mode === "enforce" ? "bad" : status?.mode === "observe" ? "warn" : "soft"} />
                <AdminMetric label={t("admin.trial.metrics.email_gate")}   value={status?.requireVerifiedEmail ? t("admin.trial.metrics.email_gate_on") : t("admin.trial.metrics.email_gate_off")} tone={status?.requireVerifiedEmail ? "warn" : "soft"} />
                <AdminMetric label={t("admin.trial.metrics.ttl")}          value={`${status?.ttlHours ?? "—"}h`} />
                <AdminMetric label={t("admin.trial.metrics.devices_now")}  value={status?.devicesWithTrial ?? 0} />
                <AdminMetric label={t("admin.trial.metrics.blocks_24h")}   value={status?.blocks24h ?? 0}   tone="bad" />
                <AdminMetric label={t("admin.trial.metrics.attempts_24h")} value={status?.attempts24h ?? 0} tone="warn" />
                <AdminMetric label={t("admin.trial.metrics.distinct_ips")} value={status?.distinctIps24h ?? 0} />
              </div>

              <div className="admin-compactGrid admin-gap-top-md">
                {/* Режим */}
                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">{t("admin.trial.mode.title")}</div>
                    <div className="list__sub admin-gap-top-sm">
                      {([
                        { value: "off",     label: t("admin.trial.mode.off") },
                        { value: "observe", label: t("admin.trial.mode.observe") },
                        { value: "enforce", label: t("admin.trial.mode.enforce") },
                      ] as { value: TrialDeviceMode; label: string }[]).map(({ value, label }, idx, arr) => (
                        <label key={value} className={`admin-radio${idx === arr.length - 1 ? " admin-radio--last" : ""}`}>
                          <input type="radio" name="trialDeviceMode" value={value}
                            checked={modeDraft === value} onChange={() => setModeDraft(value)} />
                          {" "}<strong>{value}</strong> — {label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {/* TTL */}
                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">{t("admin.trial.ttl.title")}</div>
                    <div className="list__sub admin-gap-top-sm">
                      <input className="input admin-numberInput" type="number" min="1" max="720" step="1"
                        value={ttlDraft} onChange={(e) => setTtlDraft(e.target.value)} />
                    </div>
                    <div className="admin-inlineMeta admin-gap-top-sm">
                      <span>reuse device 24h: {status?.reuseDevice24h ?? 0}</span>
                      <span>reuse ip 24h: {status?.reuseIp24h ?? 0}</span>
                      <span>ip-prefix abuse 24h: {status?.abuseIpPrefix24h ?? 0}</span>
                    </div>
                  </div>
                </div>

                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">{t("admin.trial.email.title")}</div>
                    <div className="list__sub admin-gap-top-sm">
                      <label className="admin-radio admin-radio--last">
                        <input type="checkbox"
                          checked={requireVerifiedEmailDraft}
                          onChange={(e) => setRequireVerifiedEmailDraft(e.target.checked)} />
                        {" "}{t("admin.trial.email.note")}
                      </label>
                    </div>
                    <div className="admin-inlineMeta admin-gap-top-sm">
                      <span>blocked by email 24h: {status?.emailBlocks24h ?? 0}</span>
                      <span>{status?.requireVerifiedEmail ? "email gate: on" : "email gate: off"}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Пороги (расширенные) */}
              <details className="admin-details admin-gap-top-md">
                <summary className="admin-details__summary">{t("admin.trial.thresholds.title")}</summary>
                <div className="admin-compactGrid admin-gap-top-sm">
                  {[
                    { label: t("admin.trial.thresholds.usage"),            value: ipPrefixUsageThresholdDraft,            set: setIpPrefixUsageThresholdDraft,            max: 100 },
                    { label: t("admin.trial.thresholds.attempts"),         value: ipPrefixAttemptThresholdDraft,          set: setIpPrefixAttemptThresholdDraft,          max: 200 },
                    { label: t("admin.trial.thresholds.distinct_devices"), value: ipPrefixDistinctDevicesThresholdDraft,  set: setIpPrefixDistinctDevicesThresholdDraft,  max: 200 },
                    { label: t("admin.trial.thresholds.attempts_ua"),      value: ipPrefixUserAgentAttemptThresholdDraft, set: setIpPrefixUserAgentAttemptThresholdDraft, max: 200 },
                    { label: t("admin.trial.thresholds.distinct_users"),   value: ipPrefixDistinctUsersThresholdDraft,    set: setIpPrefixDistinctUsersThresholdDraft,    max: 200 },
                  ].map(({ label, value, set, max }) => (
                    <div key={label} className="list__item admin-tightItem">
                      <div className="list__main">
                        <div className="list__title">{label}</div>
                        <div className="list__sub admin-gap-top-sm">
                          <input className="input admin-numberInput" type="number" min="1" max={max} step="1"
                            value={value} onChange={(e) => set(e.target.value)} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="actions actions--1 admin-gap-top-sm">
                  <button className="btn btn--primary" type="button"
                    onClick={() => void saveSettings()}
                    disabled={savingSettings || !hasSettingsChanges}>
                    {savingSettings ? t("admin.trial.saving") : t("admin.trial.save_settings")}
                  </button>
                </div>
              </details>

              <details className="admin-details admin-gap-top-md">
                <summary className="admin-details__summary">{t("admin.trial.stats.title")}</summary>
                <div className="admin-metricsGrid admin-gap-top-sm">
                  <AdminMetric label={t("admin.trial.metrics.allow_24h")}            value={status?.allows24h ?? 0}              tone="ok" />
                  <AdminMetric label={t("admin.trial.metrics.observe_24h")}          value={status?.observes24h ?? 0}            tone="warn" />
                  <AdminMetric label={t("admin.trial.metrics.distinct_devices_24h")} value={status?.distinctDevices24h ?? 0} />
                  <AdminMetric label={t("admin.trial.metrics.missing_token_24h")}    value={status?.missingDeviceToken24h ?? 0}  tone="warn" />
                  <AdminMetric label={t("admin.trial.metrics.email_blocks_24h")}     value={status?.emailBlocks24h ?? 0}         tone="warn" />
                  <AdminMetric label={t("admin.trial.metrics.manual_blocks_24h")}    value={status?.manualBlocks24h ?? 0}        tone="bad" />
                  <AdminMetric label={t("admin.trial.metrics.block_device_24h")}     value={status?.blockDevice24h ?? 0}         tone="bad" />
                  <AdminMetric label={t("admin.trial.metrics.block_ip_24h")}         value={(status?.blockIp24h ?? 0) + (status?.blockIpPrefix24h ?? 0)} tone="bad" />
                  <AdminMetric label={t("admin.trial.metrics.blocked_now")}          value={status?.activeBlockedDevices ?? 0}   tone="bad" />
                </div>
              </details>
            </>
          )}
        </div>
      </div>

      {/* ── Устройства ── */}
      <div className="card admin-gap-top-lg">
        <div className="card__body">
          <AdminSectionHeader
            kicker={t("admin.trial.devices.kicker")}
            title={t("admin.trial.devices.title")}
            subtitle={t("admin.trial.devices.subtitle")}
            actions={
              <label className="admin-radio admin-radio--last">
                <input type="checkbox" checked={showAllDevices}
                  onChange={(e) => setShowAllDevices(e.target.checked)} />
                {" "}{t("admin.trial.devices.show_all")}
              </label>
            }
          />

          {loading ? (
            <div className="list admin-gap-top-md">
              <div className="skeleton h1" /><div className="skeleton p" />
            </div>
          ) : (
            <>
              <div className="admin-gap-top-md">
                <input className="input" type="text" value={deviceQuery}
                  onChange={(e) => setDeviceQuery(e.target.value)}
                  placeholder={t("admin.trial.devices.search_ph")} />
              </div>

              {visibleDevices.length === 0 ? (
                <div className="pre admin-gap-top-md">
                  {deviceQuery.trim() ? t("admin.trial.devices.not_found") : t("admin.trial.devices.empty")}
                </div>
              ) : (
                <>
                  <div className="list admin-gap-top-md">
                    {visibleDevices.map((item) => (
                      <div key={item.id} className="list__item admin-rowCard admin-rowCard--compact">
                        <div className="list__main admin-clickable" role="button" tabIndex={0}
                          onClick={() => setOpenedDevice(item)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpenedDevice(item); }}>
                          <div className="kicker">{formatDateTime(item.last_seen_at)}</div>
                          <div className="list__title admin-gap-top-xs">{shortDeviceToken(item.device_token)}</div>
                          <div className="list__sub admin-listSubCompact">
                            <span>uid: {item.last_user_id ?? item.trial_user_id ?? "—"}</span>{dot}
                            <span>groups: {Number(item.active_trial_count ?? 0)}</span>{dot}
                            <span>ip: {item.last_ip || "—"}</span>{dot}
                            <span className={Number(item.is_blocked ?? 0) === 1 ? "" : ""}>
                              block: {Number(item.is_blocked ?? 0) === 1 ? "yes" : "no"}
                            </span>
                          </div>
                        </div>
                        <div className="admin-rowActions admin-rowActions--compact">
                          <button className="btn" type="button" onClick={() => setOpenedDevice(item)}>{t("common.open")}</button>
                          {Number(item.is_blocked ?? 0) === 1 ? (
                            <button className="btn" type="button"
                              disabled={unblockingDevice === item.device_token}
                              onClick={() => void unblockDevice(item.device_token)}>
                              {unblockingDevice === item.device_token ? t("admin.trial.action.unblocking") : t("admin.trial.action.unblock")}
                            </button>
                          ) : (
                            <button className="btn" type="button"
                              disabled={blockingDevice === item.device_token}
                              onClick={() => void blockDevice(item.device_token)}>
                              {blockingDevice === item.device_token ? t("admin.trial.action.blocking") : t("admin.trial.action.block")}
                            </button>
                          )}
                          <button className="btn" type="button"
                            disabled={resettingDevice === item.device_token}
                            onClick={() => void resetTrial(item.device_token)}>
                            {resettingDevice === item.device_token ? t("admin.trial.action.resetting") : t("admin.trial.action.reset_trial")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {filteredDevices.length > DEVICES_PER_PAGE && (
                    <div className="actions actions--4 admin-gap-top-md">
                      <button className="btn" type="button"
                        onClick={() => setDevicesPage(1)} disabled={devicesPage === 1}>{t("admin.trial.action.first")}</button>
                      <button className="btn" type="button"
                        onClick={() => setDevicesPage((p) => Math.max(1, p - 1))} disabled={devicesPage === 1}>{t("admin.trial.action.prev")}</button>
                      <div className="pre" style={{ margin: 0 }}>{t("admin.trial.page")} {devicesPage} / {totalDevicesPages} · {filteredDevices.length}</div>
                      <button className="btn" type="button"
                        onClick={() => setDevicesPage((p) => Math.min(totalDevicesPages, p + 1))}
                        disabled={devicesPage === totalDevicesPages}>{t("admin.trial.action.next")}</button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Очистка сети ── */}
      <details className="admin-details admin-gap-top-lg">
        <summary className="admin-details__summary">{t("admin.trial.network.title")}</summary>
        <div className="admin-cleanupPanel">
          <p className="admin-sectionHeader__sub">{t("admin.trial.network.note")}</p>

          {prefixes.length > 0 && (
            <div className="list admin-gap-top-md">
              {prefixes.map((item) => (
                <div key={item.ipPrefix} className="list__item admin-rowCard admin-rowCard--compact">
                  <div className="list__main">
                    <div className="list__title">{item.ipPrefix}</div>
                    <div className="list__sub admin-listSubCompact">
                      <span>devices: {item.devicesCount}</span>{dot}
                      <span>attempts24h: {item.attempts24h}</span>{dot}
                      <span>users: {item.distinctUsers}</span>{dot}
                      <span>blocked: {item.blockedDevices}</span>
                    </div>
                  </div>
                  <div className="admin-rowActions admin-rowActions--compact">
                    <button className="btn" type="button"
                      disabled={resettingPrefix === item.ipPrefix}
                      onClick={() => void resetPrefix(item.ipPrefix)}>
                      {resettingPrefix === item.ipPrefix ? t("admin.trial.network.clearing") : t("admin.trial.network.clear")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="admin-gap-top-md">
            <input className="input" type="text" value={networkInput}
              onChange={(e) => setNetworkInput(e.target.value)}
              placeholder={t("admin.trial.network.ph")} />
          </div>
          <div className="actions actions--1 admin-gap-top-md">
            <button className="btn btn--primary" type="button"
              disabled={Boolean(resettingPrefix) || !networkInput.trim()}
              onClick={() => void resetPrefix(networkInput)}>
              {resettingPrefix === networkInput.trim() ? t("admin.trial.network.clearing_network") : t("admin.trial.network.clear_network")}
            </button>
          </div>
        </div>
      </details>

      {/* ── События ── */}
      <div className="card admin-gap-top-lg">
        <div className="card__body">
          <AdminSectionHeader
            kicker={t("admin.trial.events.kicker")}
            title={t("admin.trial.events.title")}
            subtitle={t("admin.trial.events.subtitle")}
            actions={
              <>
                <button className="btn" type="button"
                  onClick={() => { setEventsExpanded((v) => !v); if (eventsExpanded) setEventsShowAll(false); }}>
                  {eventsExpanded ? t("admin.trial.events.hide") : t("admin.trial.events.show")}
                </button>
                {eventsExpanded && (
                  <button className="btn btn--danger" type="button"
                    onClick={() => void clearEvents()} disabled={clearingEvents}>
                    {clearingEvents ? t("admin.trial.network.clearing") : t("admin.trial.events.clear")}
                  </button>
                )}
              </>
            }
          />

          {!eventsExpanded ? (
            <div className="pre admin-gap-top-md">{t("admin.trial.events.hidden", { n: sortedEvents.length })}</div>
          ) : loading ? (
            <div className="list admin-gap-top-md"><div className="skeleton h1" /><div className="skeleton p" /></div>
          ) : visibleEvents.length === 0 ? (
            <div className="pre admin-gap-top-md">{t("admin.trial.events.empty")}</div>
          ) : (
            <>
              <div className="list admin-gap-top-md">
                {visibleEvents.map((item) => (
                  <div key={item.id}
                    className="list__item is-clickable admin-rowCard admin-rowCard--compact"
                    role="button" tabIndex={0}
                    onClick={() => setOpenedEvent(item)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpenedEvent(item); }}>
                    <div className="list__main">
                      <div className="kicker">{formatDateTime(item.created_at)}</div>
                      <div className="list__title admin-gap-top-xs">{item.event_type}</div>
                      <div className="list__sub admin-listSubCompact">{item.reason || "—"}</div>
                    </div>
                    <div className="admin-rowActions admin-rowActions--single">
                      {renderDecisionChip(item.decision)}
                    </div>
                  </div>
                ))}
              </div>
              {sortedEvents.length > EVENTS_PREVIEW_COUNT && (
                <div className="actions actions--1 admin-gap-top-md">
                  <button className="btn" type="button" onClick={() => setEventsShowAll((v) => !v)}>
                    {eventsShowAll ? t("admin.trial.events.show_preview") : t("admin.trial.events.show_all", { n: sortedEvents.length })}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Модалка события ── */}
      {openedEvent && (
        <ModalShell
          title={openedEvent.event_type}
          kicker={formatDateTime(openedEvent.created_at)}
          onClose={() => setOpenedEvent(null)}
        >
          {(() => {
            const meta       = openedEvent.meta ?? parseMetaJson(openedEvent.meta_json);
            const serviceId  = meta?.serviceId  ?? meta?.service_id  ?? null;
            const trialGroup = meta?.trialGroup  ?? meta?.trial_group ?? meta?.category ?? null;
            const periodHuman = meta?.periodHuman ?? meta?.period_human ?? null;
            return (
              <>
                <div className="list">
                  {[
                    { title: t("admin.trial.event.decision"), value: openedEvent.decision,      side: renderDecisionChip(openedEvent.decision) },
                    { title: t("admin.trial.event.reason"),   value: openedEvent.reason || "—" },
                    { title: t("admin.trial.event.device"),   value: openedEvent.device_token || "—", cls: "feed__fulltext" },
                    { title: "IP",         value: openedEvent.ip || "—" },
                    { title: "User ID",    value: String(openedEvent.user_id ?? "—") },
                    { title: "Service ID", value: String(serviceId ?? "—") },
                    { title: "Trial group", value: String(trialGroup ?? "—") },
                    { title: t("admin.trial.event.period"), value: String(periodHuman ?? "—") },
                    { title: "Meta JSON",  value: openedEvent.meta_json || "—", cls: "feed__fulltext" },
                  ].map(({ title, value, side, cls }) => (
                    <div key={title} className="list__item admin-tightItem">
                      <div className="list__main">
                        <div className="list__title">{title}</div>
                        <div className={`list__sub${cls ? ` ${cls}` : ""}`}>{value}</div>
                      </div>
                      {side && <div className="list__side">{side}</div>}
                    </div>
                  ))}
                </div>
                <div className="actions actions--2 admin-gap-top-lg">
                  <button className="btn" type="button" onClick={() => copyText(openedEvent.device_token || "")}>{t("admin.trial.event.copy_device")}</button>
                  <button className="btn" type="button" onClick={() => copyText(openedEvent.meta_json || "")}>{t("admin.trial.event.copy_meta")}</button>
                </div>
              </>
            );
          })()}
        </ModalShell>
      )}

      {/* ── Модалка устройства ── */}
      {openedDevice && (
        <ModalShell
          title={shortDeviceToken(openedDevice.device_token)}
          kicker={`Last seen: ${formatDateTime(openedDevice.last_seen_at)}`}
          onClose={() => setOpenedDevice(null)}
        >
          <div className="list">
            {[
              { title: "Device token",          value: openedDevice.device_token, cls: "feed__fulltext" },
              { title: "User ID",               value: String(openedDevice.last_user_id ?? openedDevice.trial_user_id ?? "—") },
              { title: t("admin.trial.device.status"),                value: `manual block: ${Number(openedDevice.is_blocked ?? 0) === 1 ? "yes" : "no"}` },
              { title: t("admin.trial.device.last_usage"), value: formatDateTime(openedDevice.last_trial_used_at) },
            ].map(({ title, value, cls }) => (
              <div key={title} className="list__item admin-tightItem">
                <div className="list__main">
                  <div className="list__title">{title}</div>
                  <div className={`list__sub${cls ? ` ${cls}` : ""}`}>{value}</div>
                </div>
              </div>
            ))}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">IP / groups</div>
                <div className="list__sub">
                  {openedDevice.last_ip || "—"}{dot}groups: {Number(openedDevice.active_trial_count ?? 0)}
                </div>
              </div>
            </div>
            <details className="admin-details admin-gap-top-sm">
              <summary className="admin-details__summary">{t("admin.trial.device.extra")}</summary>
              <div className="list admin-gap-top-sm">
                {[
                  { title: "First seen",  value: formatDateTime(openedDevice.first_seen_at) },
                  { title: "Last seen",   value: formatDateTime(openedDevice.last_seen_at) },
                  { title: "First IP",    value: openedDevice.first_ip || "—" },
                  { title: "User-Agent",  value: openedDevice.user_agent || "—", cls: "feed__fulltext" },
                ].map(({ title, value, cls }) => (
                  <div key={title} className="list__item admin-tightItem">
                    <div className="list__main">
                      <div className="list__title">{title}</div>
                      <div className={`list__sub${cls ? ` ${cls}` : ""}`}>{value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>

          <div className="actions actions--2 admin-gap-top-lg">
            <button className="btn" type="button" onClick={() => copyText(openedDevice.device_token)}>
              {t("admin.trial.device.copy_token")}
            </button>
            {Number(openedDevice.is_blocked ?? 0) === 1 ? (
              <button className="btn" type="button"
                disabled={unblockingDevice === openedDevice.device_token}
                onClick={() => void unblockDevice(openedDevice.device_token)}>
                {unblockingDevice === openedDevice.device_token ? t("admin.trial.action.unblocking") : t("admin.trial.action.unblock")}
              </button>
            ) : (
              <button className="btn" type="button"
                disabled={blockingDevice === openedDevice.device_token}
                onClick={() => void blockDevice(openedDevice.device_token)}>
                {blockingDevice === openedDevice.device_token ? t("admin.trial.action.blocking") : t("admin.trial.action.block")}
              </button>
            )}
          </div>
          <div className="actions actions--2" style={{ marginTop: 8 }}>
            <button className="btn" type="button"
              disabled={resettingDevice === openedDevice.device_token}
              onClick={() => void resetTrial(openedDevice.device_token)}>
              {resettingDevice === openedDevice.device_token ? t("admin.trial.action.resetting") : t("admin.trial.action.reset_trial")}
            </button>
            <button className="btn btn--danger" type="button"
              disabled={deletingDevice === openedDevice.device_token}
              onClick={() => void deleteDevice(openedDevice.device_token)}>
              {deletingDevice === openedDevice.device_token ? t("admin.trial.action.deleting") : t("admin.trial.action.delete_device")}
            </button>
          </div>
        </ModalShell>
      )}
    </>
  );
}
