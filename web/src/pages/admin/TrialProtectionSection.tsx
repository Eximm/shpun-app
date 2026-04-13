// web/src/pages/admin/TrialProtectionSection.tsx

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { AdminMetric, ModalShell } from "./shared";
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

  async function load(opts?: { silent?: boolean }) {
    const silent = Boolean(opts?.silent);
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const devicesUrl = showAllDevices ? "/admin/trial-protection/devices?all=1" : "/admin/trial-protection/devices";
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
      setEvents(Array.isArray(eventsResp.items) ? eventsResp.items : []);
      setDevices(Array.isArray(devicesResp.items) ? devicesResp.items : []);
      setPrefixes(Array.isArray(prefixesResp.items) ? prefixesResp.items : []);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить данные Trial Protection.");
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
          ipPrefixUsageThreshold: Number(ipPrefixUsageThresholdDraft),
          ipPrefixAttemptThreshold: Number(ipPrefixAttemptThresholdDraft),
          ipPrefixDistinctDevicesThreshold: Number(ipPrefixDistinctDevicesThresholdDraft),
          ipPrefixUserAgentAttemptThreshold: Number(ipPrefixUserAgentAttemptThresholdDraft),
          ipPrefixDistinctUsersThreshold: Number(ipPrefixDistinctUsersThresholdDraft),
        },
      });
      setOkText(`Сохранено: mode=${r.mode}, ttl=${r.ttlHours}h, usage=${r.ipPrefixUsageThreshold}, attempts=${r.ipPrefixAttemptThreshold}, devices=${r.ipPrefixDistinctDevicesThreshold}, ua=${r.ipPrefixUserAgentAttemptThreshold}, users=${r.ipPrefixDistinctUsersThreshold}`);
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || "Не удалось сохранить настройки."); }
    finally { setSavingSettings(false); }
  }

  async function clearEvents() {
    if (!window.confirm("Очистить журнал событий Trial Protection полностью?")) return;
    setClearingEvents(true); setError(null); setOkText(null);
    try {
      const r = await apiFetch<ClearEventsResp>("/admin/trial-protection/clear-events", { method: "POST", body: { keepLatest: 0 } });
      setOkText(`Журнал очищен. Удалено записей: ${r.deleted}`);
      if (openedEvent) setOpenedEvent(null);
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || "Не удалось очистить журнал."); }
    finally { setClearingEvents(false); }
  }

  async function resetTrial(deviceToken: string) {
    if (!window.confirm(`Сбросить trial для устройства?\n\n${deviceToken}`)) return;
    setResettingDevice(deviceToken); setError(null); setOkText(null);
    try {
      const r = await apiFetch<ResetDeviceResp>("/admin/trial-protection/reset-device", { method: "POST", body: { deviceToken } });
      setOkText(`Trial сброшен: ${shortDeviceToken(r.deviceToken)}`);
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || "Не удалось сбросить trial для устройства."); }
    finally { setResettingDevice(null); }
  }

  async function resetPrefix(rawValue: string) {
    const raw = String(rawValue ?? "").trim();
    if (!raw) { setError("Укажи IP или prefix для очистки сети."); return; }
    if (!window.confirm(`Очистить сеть / prefix?\n\n${raw}`)) return;
    setResettingPrefix(raw); setError(null); setOkText(null);
    try {
      const r = await apiFetch<ResetPrefixResp>("/admin/trial-protection/reset-prefix", { method: "POST", body: { ip: raw, clearEvents: 1, unblockDevices: 1 } });
      setOkText(`Сеть очищена: prefix=${r.ipPrefix}, devices=${r.matchedDevices}, usage=${r.deletedUsage}, events=${r.deletedEvents}, unblocked=${r.unblockedDevices}`);
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || "Не удалось очистить сеть / prefix."); }
    finally { setResettingPrefix(null); }
  }

  async function blockDevice(deviceToken: string) {
    if (!window.confirm(`Заблокировать устройство?\n\n${deviceToken}`)) return;
    setBlockingDevice(deviceToken); setError(null); setOkText(null);
    try {
      const r = await apiFetch<BlockDeviceResp>("/admin/trial-protection/block-device", { method: "POST", body: { deviceToken } });
      setOkText(`Устройство заблокировано: ${shortDeviceToken(r.deviceToken)}`);
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || "Не удалось заблокировать устройство."); }
    finally { setBlockingDevice(null); }
  }

  async function unblockDevice(deviceToken: string) {
    if (!window.confirm(`Снять блокировку с устройства?\n\n${deviceToken}`)) return;
    setUnblockingDevice(deviceToken); setError(null); setOkText(null);
    try {
      const r = await apiFetch<BlockDeviceResp>("/admin/trial-protection/unblock-device", { method: "POST", body: { deviceToken } });
      setOkText(`Устройство разблокировано: ${shortDeviceToken(r.deviceToken)}`);
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || "Не удалось разблокировать устройство."); }
    finally { setUnblockingDevice(null); }
  }

  async function deleteDevice(deviceToken: string) {
    if (!window.confirm(`Удалить устройство полностью?\n\n${deviceToken}`)) return;
    setDeletingDevice(deviceToken); setError(null); setOkText(null);
    try {
      const r = await apiFetch<DeleteDeviceResp>("/admin/trial-protection/delete-device", { method: "POST", body: { deviceToken } });
      setOkText(`Устройство удалено: ${shortDeviceToken(r.deviceToken)} · device=${r.deletedDevice}, usage=${r.deletedUsage}, events=${r.deletedEvents}`);
      if (openedDevice?.device_token === deviceToken) setOpenedDevice(null);
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || "Не удалось удалить устройство."); }
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

  const visibleEvents  = useMemo(() => {
    if (!eventsExpanded) return [];
    return eventsShowAll ? sortedEvents : sortedEvents.slice(0, EVENTS_PREVIEW_COUNT);
  }, [eventsExpanded, eventsShowAll, sortedEvents]);

  const visibleDevices = useMemo(() => {
    const start = (devicesPage - 1) * DEVICES_PER_PAGE;
    return filteredDevices.slice(start, start + DEVICES_PER_PAGE);
  }, [devicesPage, filteredDevices]);

  function renderDecisionChip(decision: TrialProtectionEventItem["decision"]) {
    if (decision === "block")   return <span className="chip chip--bad">BLOCK</span>;
    if (decision === "observe") return <span className="chip chip--warn">OBSERVE</span>;
    return <span className="chip chip--ok">ALLOW</span>;
  }

  const hasSettingsChanges =
    modeDraft !== (status?.mode || "observe") ||
    ttlDraft !== String(status?.ttlHours ?? 72) ||
    ipPrefixUsageThresholdDraft            !== String(status?.ipPrefixUsageThreshold ?? 2) ||
    ipPrefixAttemptThresholdDraft          !== String(status?.ipPrefixAttemptThreshold ?? 3) ||
    ipPrefixDistinctDevicesThresholdDraft  !== String(status?.ipPrefixDistinctDevicesThreshold ?? 3) ||
    ipPrefixUserAgentAttemptThresholdDraft !== String(status?.ipPrefixUserAgentAttemptThreshold ?? 2) ||
    ipPrefixDistinctUsersThresholdDraft    !== String(status?.ipPrefixDistinctUsersThreshold ?? 3);

  const dot = <span style={{ opacity: 0.3, margin: "0 4px" }}>·</span>;

  return (
    <>
      {/* ── Настройки ────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card__body">
          <div className="admin-sectionHead">
            <div>
              <div className="kicker">Trial protection</div>
              <h2 className="h2">Защита тестовых доступов</h2>
              <p className="p">Панель контроля режима, порогов и признаков абьюза.</p>
            </div>
            <button className="btn btn--soft" type="button" onClick={() => void load({ silent: true })}
              disabled={refreshing || savingSettings || clearingEvents || Boolean(resettingPrefix)}>
              {refreshing ? "Обновляю…" : "Обновить"}
            </button>
          </div>

          {error  && <div className="pre admin-gap-top-md">{error}</div>}
          {okText && <div className="pre admin-gap-top-md">{okText}</div>}

          {loading ? (
            <div className="list admin-gap-top-md">
              <div className="skeleton h1" /><div className="skeleton p" /><div className="skeleton p" />
            </div>
          ) : (
            <>
              <div className="admin-metricsGrid admin-gap-top-md">
                <AdminMetric label="Mode"          value={status?.mode || "—"} tone={status?.mode === "enforce" ? "bad" : status?.mode === "observe" ? "warn" : "soft"} />
                <AdminMetric label="TTL"           value={`${status?.ttlHours ?? "—"}h`} />
                <AdminMetric label="Devices now"   value={status?.devicesWithTrial ?? 0} />
                <AdminMetric label="Blocks 24h"    value={status?.blocks24h ?? 0}    tone="bad" />
                <AdminMetric label="Attempts 24h"  value={status?.attempts24h ?? 0}  tone="warn" />
                <AdminMetric label="Distinct IPs"  value={status?.distinctIps24h ?? 0} />
              </div>

              <div className="admin-compactGrid admin-gap-top-md">
                {/* Режим */}
                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">Режим работы</div>
                    <div className="list__sub admin-gap-top-sm">
                      {([
                        { value: "off",     label: "защита отключена" },
                        { value: "observe", label: "только логирование" },
                        { value: "enforce", label: "блокировать повторный trial" },
                      ] as { value: TrialDeviceMode; label: string }[]).map(({ value, label }, idx, arr) => (
                        <label key={value} className={`admin-radio${idx === arr.length - 1 ? " admin-radio--last" : ""}`}>
                          <input type="radio" name="trialDeviceMode" value={value} checked={modeDraft === value} onChange={() => setModeDraft(value)} />
                          {" "}<strong>{value}</strong> — {label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {/* TTL */}
                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">TTL в часах</div>
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
              </div>

              {/* Пороги */}
              <div className="admin-compactGrid admin-gap-top-md">
                {[
                  { label: "Порог usage по prefix",    value: ipPrefixUsageThresholdDraft,            set: setIpPrefixUsageThresholdDraft,            max: 100 },
                  { label: "Порог attempts по prefix", value: ipPrefixAttemptThresholdDraft,          set: setIpPrefixAttemptThresholdDraft,          max: 200 },
                  { label: "Порог distinct devices",   value: ipPrefixDistinctDevicesThresholdDraft,  set: setIpPrefixDistinctDevicesThresholdDraft,  max: 200 },
                  { label: "Порог attempts по UA",     value: ipPrefixUserAgentAttemptThresholdDraft, set: setIpPrefixUserAgentAttemptThresholdDraft, max: 200 },
                  { label: "Порог distinct users",     value: ipPrefixDistinctUsersThresholdDraft,    set: setIpPrefixDistinctUsersThresholdDraft,    max: 200 },
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

              <div className="actions actions--1 admin-gap-top-md">
                <button className="btn btn--accent" type="button" onClick={() => void saveSettings()} disabled={savingSettings || !hasSettingsChanges}>
                  {savingSettings ? "Сохраняю настройки…" : "Сохранить настройки"}
                </button>
              </div>

              <div className="admin-metricsGrid admin-gap-top-md">
                <AdminMetric label="Allow 24h"           value={status?.allows24h ?? 0}              tone="ok" />
                <AdminMetric label="Observe 24h"         value={status?.observes24h ?? 0}            tone="warn" />
                <AdminMetric label="Distinct devices 24h" value={status?.distinctDevices24h ?? 0} />
                <AdminMetric label="Missing token 24h"   value={status?.missingDeviceToken24h ?? 0}  tone="warn" />
                <AdminMetric label="Manual blocks 24h"   value={status?.manualBlocks24h ?? 0}        tone="bad" />
                <AdminMetric label="Block device 24h"    value={status?.blockDevice24h ?? 0}         tone="bad" />
                <AdminMetric label="Block ip/prefix 24h" value={(status?.blockIp24h ?? 0) + (status?.blockIpPrefix24h ?? 0)} tone="bad" />
                <AdminMetric label="Blocked now"         value={status?.activeBlockedDevices ?? 0}   tone="bad" />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Устройства ───────────────────────────────────────────────────── */}
      <div className="card admin-gap-top-lg">
        <div className="card__body">
          <div className="admin-sectionHead">
            <div>
              <div className="kicker">Devices</div>
              <h2 className="h2">Устройства</h2>
              <p className="p">Просмотр, блокировка и сброс trial.</p>
            </div>
            <label className="admin-radio">
              <input type="checkbox" checked={showAllDevices} onChange={(e) => setShowAllDevices(e.target.checked)} />
              {" "}Показывать все устройства
            </label>
          </div>

          {loading ? (
            <div className="list admin-gap-top-md">
              <div className="skeleton h1" /><div className="skeleton p" /><div className="skeleton p" />
            </div>
          ) : (
            <>
              <div className="admin-gap-top-md">
                <input className="input" type="text" value={deviceQuery} onChange={(e) => setDeviceQuery(e.target.value)}
                  placeholder="Поиск по token / IP / user id / user-agent" />
              </div>

              {visibleDevices.length === 0 ? (
                <div className="pre admin-gap-top-md">
                  {deviceQuery.trim() ? "Ничего не найдено по текущему фильтру." : "Подходящих устройств сейчас нет."}
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
                            <span>block: {Number(item.is_blocked ?? 0) === 1 ? "yes" : "no"}</span>
                          </div>
                        </div>
                        <div className="admin-rowActions admin-rowActions--compact">
                          <button className="btn btn--soft" type="button" onClick={() => setOpenedDevice(item)}>Открыть</button>
                          {Number(item.is_blocked ?? 0) === 1 ? (
                            <button className="btn btn--soft" type="button" disabled={unblockingDevice === item.device_token} onClick={() => void unblockDevice(item.device_token)}>
                              {unblockingDevice === item.device_token ? "Снятие…" : "Разблокировать"}
                            </button>
                          ) : (
                            <button className="btn btn--soft" type="button" disabled={blockingDevice === item.device_token} onClick={() => void blockDevice(item.device_token)}>
                              {blockingDevice === item.device_token ? "Блок…" : "Заблокировать"}
                            </button>
                          )}
                          <button className="btn btn--soft" type="button" disabled={resettingDevice === item.device_token} onClick={() => void resetTrial(item.device_token)}>
                            {resettingDevice === item.device_token ? "Сброс…" : "Сбросить trial"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {filteredDevices.length > DEVICES_PER_PAGE && (
                    <div className="actions actions--4 admin-gap-top-md">
                      <button className="btn btn--soft" type="button" onClick={() => setDevicesPage(1)} disabled={devicesPage === 1}>« Первая</button>
                      <button className="btn btn--soft" type="button" onClick={() => setDevicesPage((p) => Math.max(1, p - 1))} disabled={devicesPage === 1}>‹ Назад</button>
                      <div className="pre">Стр. {devicesPage} / {totalDevicesPages} · Всего: {filteredDevices.length}</div>
                      <button className="btn btn--soft" type="button" onClick={() => setDevicesPage((p) => Math.min(totalDevicesPages, p + 1))} disabled={devicesPage === totalDevicesPages}>Вперёд ›</button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Очистка сети ─────────────────────────────────────────────────── */}
      <div className="card admin-gap-top-lg">
        <div className="card__body">
          <div className="admin-sectionHead">
            <div>
              <div className="kicker">Network cleanup</div>
              <h2 className="h2">Очистка сети / prefix</h2>
              <p className="p">Чистит usage, снимает блокировки и очищает события по сети, но не удаляет устройства.</p>
            </div>
          </div>

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
                    <button className="btn btn--soft" type="button" disabled={resettingPrefix === item.ipPrefix} onClick={() => void resetPrefix(item.ipPrefix)}>
                      {resettingPrefix === item.ipPrefix ? "Очищаю…" : "Очистить"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="admin-gap-top-md">
            <input className="input" type="text" value={networkInput} onChange={(e) => setNetworkInput(e.target.value)}
              placeholder="Например: 109.247.173.185 или 109.247.173" />
          </div>
          <div className="actions actions--1 admin-gap-top-md">
            <button className="btn btn--soft" type="button" disabled={Boolean(resettingPrefix) || !networkInput.trim()} onClick={() => void resetPrefix(networkInput)}>
              {resettingPrefix === networkInput.trim() ? "Очищаю сеть…" : "Очистить сеть / prefix"}
            </button>
          </div>
        </div>
      </div>

      {/* ── События ──────────────────────────────────────────────────────── */}
      <div className="card admin-gap-top-lg">
        <div className="card__body">
          <div className="admin-sectionHead">
            <div>
              <div className="kicker">Events</div>
              <h2 className="h2">Последние события</h2>
              <p className="p">Диагностика и журнал срабатываний.</p>
            </div>
            <div className="admin-rowActions">
              <button className="btn btn--soft" type="button" onClick={() => { setEventsExpanded((v) => !v); if (eventsExpanded) setEventsShowAll(false); }}>
                {eventsExpanded ? "Скрыть" : "Показать"}
              </button>
              {eventsExpanded && (
                <button className="btn btn--danger" type="button" onClick={() => void clearEvents()} disabled={clearingEvents}>
                  {clearingEvents ? "Очищаю…" : "Очистить журнал"}
                </button>
              )}
            </div>
          </div>

          {!eventsExpanded ? (
            <div className="pre admin-gap-top-md">События скрыты. Последних записей: {sortedEvents.length}.</div>
          ) : loading ? (
            <div className="list admin-gap-top-md"><div className="skeleton h1" /><div className="skeleton p" /></div>
          ) : visibleEvents.length === 0 ? (
            <div className="pre admin-gap-top-md">Событий пока нет.</div>
          ) : (
            <>
              <div className="list admin-gap-top-md">
                {visibleEvents.map((item) => (
                  <div key={item.id} className="list__item is-clickable admin-rowCard admin-rowCard--compact"
                    role="button" tabIndex={0} onClick={() => setOpenedEvent(item)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpenedEvent(item); }}>
                    <div className="list__main">
                      <div className="kicker">{formatDateTime(item.created_at)}</div>
                      <div className="list__title admin-gap-top-xs">{item.event_type}</div>
                      <div className="list__sub admin-listSubCompact">{item.reason || "—"}</div>
                    </div>
                    <div className="admin-rowActions admin-rowActions--single">{renderDecisionChip(item.decision)}</div>
                  </div>
                ))}
              </div>
              {sortedEvents.length > EVENTS_PREVIEW_COUNT && (
                <div className="actions actions--1 admin-gap-top-md">
                  <button className="btn btn--soft" type="button" onClick={() => setEventsShowAll((v) => !v)}>
                    {eventsShowAll ? "Показать только последние 5" : `Показать все (${sortedEvents.length})`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Модалка события ──────────────────────────────────────────────── */}
      {openedEvent && (
        <ModalShell title={openedEvent.event_type} kicker={formatDateTime(openedEvent.created_at)} onClose={() => setOpenedEvent(null)}>
          {(() => {
            const meta        = openedEvent.meta ?? parseMetaJson(openedEvent.meta_json);
            const serviceId   = meta?.serviceId   ?? meta?.service_id   ?? null;
            const trialGroup  = meta?.trialGroup  ?? meta?.trial_group  ?? meta?.category ?? null;
            const periodHuman = meta?.periodHuman ?? meta?.period_human ?? null;
            return (
              <>
                <div className="list">
                  {[
                    { title: "Решение",   value: openedEvent.decision,      side: renderDecisionChip(openedEvent.decision) },
                    { title: "Причина",   value: openedEvent.reason || "—" },
                    { title: "Устройство", value: openedEvent.device_token || "—", cls: "feed__fulltext" },
                    { title: "IP",        value: openedEvent.ip || "—" },
                    { title: "User ID",   value: String(openedEvent.user_id ?? "—") },
                    { title: "Service ID", value: String(serviceId ?? "—") },
                    { title: "Trial group", value: String(trialGroup ?? "—") },
                    { title: "Период",    value: String(periodHuman ?? "—") },
                    { title: "Meta JSON", value: openedEvent.meta_json || "—", cls: "feed__fulltext" },
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
                  <button className="btn btn--soft" type="button" onClick={() => copyText(openedEvent.device_token || "")}>Скопировать device</button>
                  <button className="btn btn--soft" type="button" onClick={() => copyText(openedEvent.meta_json || "")}>Скопировать meta</button>
                </div>
              </>
            );
          })()}
        </ModalShell>
      )}

      {/* ── Модалка устройства ───────────────────────────────────────────── */}
      {openedDevice && (
        <ModalShell title={shortDeviceToken(openedDevice.device_token)} kicker={`Last seen: ${formatDateTime(openedDevice.last_seen_at)}`} onClose={() => setOpenedDevice(null)}>
          <div className="list">
            {[
              { title: "Device token", value: openedDevice.device_token, cls: "feed__fulltext" },
              { title: "User ID",      value: String(openedDevice.last_user_id ?? openedDevice.trial_user_id ?? "—") },
              { title: "Статус",       value: `manual block: ${Number(openedDevice.is_blocked ?? 0) === 1 ? "yes" : "no"}` },
              { title: "Последний trial usage", value: formatDateTime(openedDevice.last_trial_used_at) },
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
              <summary className="admin-details__summary">Дополнительные данные</summary>
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

          <div className="actions actions--4 admin-gap-top-lg">
            <button className="btn btn--soft" type="button" onClick={() => copyText(openedDevice.device_token)}>Скопировать token</button>
            {Number(openedDevice.is_blocked ?? 0) === 1 ? (
              <button className="btn btn--soft" type="button" disabled={unblockingDevice === openedDevice.device_token} onClick={() => void unblockDevice(openedDevice.device_token)}>
                {unblockingDevice === openedDevice.device_token ? "Снятие…" : "Разблокировать"}
              </button>
            ) : (
              <button className="btn btn--soft" type="button" disabled={blockingDevice === openedDevice.device_token} onClick={() => void blockDevice(openedDevice.device_token)}>
                {blockingDevice === openedDevice.device_token ? "Блок…" : "Заблокировать"}
              </button>
            )}
            <button className="btn btn--soft" type="button" disabled={resettingDevice === openedDevice.device_token} onClick={() => void resetTrial(openedDevice.device_token)}>
              {resettingDevice === openedDevice.device_token ? "Сброс…" : "Сбросить trial"}
            </button>
            <button className="btn btn--danger" type="button" disabled={deletingDevice === openedDevice.device_token} onClick={() => void deleteDevice(openedDevice.device_token)}>
              {deletingDevice === openedDevice.device_token ? "Удаление…" : "Удалить устройство"}
            </button>
          </div>
        </ModalShell>
      )}
    </>
  );
}