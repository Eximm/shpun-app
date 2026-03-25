import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { AdminMetric, ModalShell } from "./shared";
import { copyText, formatDateTime, parseMetaJson, shortDeviceToken } from "./utils";
import type {
  BlockDeviceResp,
  ClearEventsResp,
  DeleteDeviceResp,
  ResetDeviceResp,
  ResetPrefixResp,
  TrialDeviceItem,
  TrialDeviceMode,
  TrialDevicesResp,
  TrialPrefixItem,
  TrialPrefixesResp,
  TrialProtectionEventItem,
  TrialProtectionEventsResp,
  TrialProtectionSettingsSaveResp,
  TrialProtectionStatusResp,
} from "./types";

const DEVICES_PER_PAGE = 10;
const EVENTS_PREVIEW_COUNT = 5;

export function TrialProtectionSection() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [resettingPrefix, setResettingPrefix] = useState<string | null>(null);
  const [resettingDevice, setResettingDevice] = useState<string | null>(null);
  const [blockingDevice, setBlockingDevice] = useState<string | null>(null);
  const [unblockingDevice, setUnblockingDevice] = useState<string | null>(null);
  const [deletingDevice, setDeletingDevice] = useState<string | null>(null);
  const [clearingEvents, setClearingEvents] = useState(false);

  const [status, setStatus] = useState<TrialProtectionStatusResp | null>(null);
  const [events, setEvents] = useState<TrialProtectionEventItem[]>([]);
  const [devices, setDevices] = useState<TrialDeviceItem[]>([]);
  const [prefixes, setPrefixes] = useState<TrialPrefixItem[]>([]);

  const [openedEvent, setOpenedEvent] = useState<TrialProtectionEventItem | null>(null);
  const [openedDevice, setOpenedDevice] = useState<TrialDeviceItem | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [okText, setOkText] = useState<string | null>(null);

  const [eventsExpanded, setEventsExpanded] = useState(false);
  const [eventsShowAll, setEventsShowAll] = useState(false);

  const [devicesPage, setDevicesPage] = useState(1);
  const [deviceQuery, setDeviceQuery] = useState("");
  const [showAllDevices, setShowAllDevices] = useState(false);

  const [networkInput, setNetworkInput] = useState("");

  const [modeDraft, setModeDraft] = useState<TrialDeviceMode>("observe");
  const [ttlDraft, setTtlDraft] = useState<string>("72");
  const [ipPrefixUsageThresholdDraft, setIpPrefixUsageThresholdDraft] = useState<string>("2");
  const [ipPrefixAttemptThresholdDraft, setIpPrefixAttemptThresholdDraft] = useState<string>("3");
  const [ipPrefixDistinctDevicesThresholdDraft, setIpPrefixDistinctDevicesThresholdDraft] = useState<string>("3");
  const [ipPrefixUserAgentAttemptThresholdDraft, setIpPrefixUserAgentAttemptThresholdDraft] = useState<string>("2");
  const [ipPrefixDistinctUsersThresholdDraft, setIpPrefixDistinctUsersThresholdDraft] = useState<string>("3");

  async function load(opts?: { silent?: boolean }) {
    const silent = Boolean(opts?.silent);

    if (silent) setRefreshing(true);
    else setLoading(true);

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
      setEvents(Array.isArray(eventsResp.items) ? eventsResp.items : []);
      setDevices(Array.isArray(devicesResp.items) ? devicesResp.items : []);
      setPrefixes(Array.isArray(prefixesResp.items) ? prefixesResp.items : []);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить данные Trial Protection.");
      if (!silent) {
        setStatus(null);
        setEvents([]);
        setDevices([]);
        setPrefixes([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, [showAllDevices]);

  async function saveSettings() {
    setSavingSettings(true);
    setError(null);
    setOkText(null);

    try {
      const payload = {
        mode: modeDraft,
        ttlHours: Number(ttlDraft),
        ipPrefixUsageThreshold: Number(ipPrefixUsageThresholdDraft),
        ipPrefixAttemptThreshold: Number(ipPrefixAttemptThresholdDraft),
        ipPrefixDistinctDevicesThreshold: Number(ipPrefixDistinctDevicesThresholdDraft),
        ipPrefixUserAgentAttemptThreshold: Number(ipPrefixUserAgentAttemptThresholdDraft),
        ipPrefixDistinctUsersThreshold: Number(ipPrefixDistinctUsersThresholdDraft),
      };

      const r = await apiFetch<TrialProtectionSettingsSaveResp>("/admin/trial-protection/settings", {
        method: "PUT",
        body: payload,
      });

      setOkText(
        `Настройки сохранены: mode=${r.mode}, ttl=${r.ttlHours}h, usage=${r.ipPrefixUsageThreshold}, attempts=${r.ipPrefixAttemptThreshold}, devices=${r.ipPrefixDistinctDevicesThreshold}, ua=${r.ipPrefixUserAgentAttemptThreshold}, users=${r.ipPrefixDistinctUsersThreshold}`,
      );

      await load({ silent: true });
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить настройки.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function clearEvents() {
    const ok = window.confirm("Очистить журнал событий Trial Protection полностью?");
    if (!ok) return;

    setClearingEvents(true);
    setError(null);
    setOkText(null);

    try {
      const r = await apiFetch<ClearEventsResp>("/admin/trial-protection/clear-events", {
        method: "POST",
        body: { keepLatest: 0 },
      });

      setOkText(`Журнал очищен. Удалено записей: ${r.deleted}`);
      if (openedEvent) setOpenedEvent(null);
      await load({ silent: true });
    } catch (e: any) {
      setError(e?.message || "Не удалось очистить журнал.");
    } finally {
      setClearingEvents(false);
    }
  }

  async function resetTrial(deviceToken: string) {
    const ok = window.confirm(
      `Сбросить trial для устройства?\n\n${deviceToken}\n\nЭто разрешит устройству получить trial заново, но само устройство из базы не удалится.`,
    );
    if (!ok) return;

    setResettingDevice(deviceToken);
    setError(null);
    setOkText(null);

    try {
      const r = await apiFetch<ResetDeviceResp>("/admin/trial-protection/reset-device", {
        method: "POST",
        body: { deviceToken },
      });

      setOkText(`Trial сброшен: ${shortDeviceToken(r.deviceToken)}`);
      await load({ silent: true });
    } catch (e: any) {
      setError(e?.message || "Не удалось сбросить trial для устройства.");
    } finally {
      setResettingDevice(null);
    }
  }

  async function resetPrefix(rawValue: string) {
    const raw = String(rawValue ?? "").trim();
    if (!raw) {
      setError("Укажи IP или prefix для очистки сети.");
      return;
    }

    const ok = window.confirm(
      `Очистить сеть / prefix?\n\n${raw}\n\nЭто снимет сетевой reuse, очистит usage и снимет блокировки по найденным устройствам.\nСами устройства удалены не будут.`,
    );
    if (!ok) return;

    setResettingPrefix(raw);
    setError(null);
    setOkText(null);

    try {
      const r = await apiFetch<ResetPrefixResp>("/admin/trial-protection/reset-prefix", {
        method: "POST",
        body: { ip: raw, clearEvents: 1, unblockDevices: 1 },
      });

      setOkText(
        `Сеть очищена: prefix=${r.ipPrefix}, devices=${r.matchedDevices}, usage=${r.deletedUsage}, events=${r.deletedEvents}, unblocked=${r.unblockedDevices}`,
      );

      await load({ silent: true });
    } catch (e: any) {
      setError(e?.message || "Не удалось очистить сеть / prefix.");
    } finally {
      setResettingPrefix(null);
    }
  }

  async function blockDevice(deviceToken: string) {
    const ok = window.confirm(`Заблокировать устройство?\n\n${deviceToken}`);
    if (!ok) return;

    setBlockingDevice(deviceToken);
    setError(null);
    setOkText(null);

    try {
      const r = await apiFetch<BlockDeviceResp>("/admin/trial-protection/block-device", {
        method: "POST",
        body: { deviceToken },
      });

      setOkText(`Устройство заблокировано: ${shortDeviceToken(r.deviceToken)}`);
      await load({ silent: true });
    } catch (e: any) {
      setError(e?.message || "Не удалось заблокировать устройство.");
    } finally {
      setBlockingDevice(null);
    }
  }

  async function unblockDevice(deviceToken: string) {
    const ok = window.confirm(`Снять блокировку с устройства?\n\n${deviceToken}`);
    if (!ok) return;

    setUnblockingDevice(deviceToken);
    setError(null);
    setOkText(null);

    try {
      const r = await apiFetch<BlockDeviceResp>("/admin/trial-protection/unblock-device", {
        method: "POST",
        body: { deviceToken },
      });

      setOkText(`Устройство разблокировано: ${shortDeviceToken(r.deviceToken)}`);
      await load({ silent: true });
    } catch (e: any) {
      setError(e?.message || "Не удалось разблокировать устройство.");
    } finally {
      setUnblockingDevice(null);
    }
  }

  async function deleteDevice(deviceToken: string) {
    const ok = window.confirm(
      `Удалить устройство полностью?\n\n${deviceToken}\n\nБудут удалены:\n- устройство\n- trial usage\n- события этого устройства`,
    );
    if (!ok) return;

    setDeletingDevice(deviceToken);
    setError(null);
    setOkText(null);

    try {
      const r = await apiFetch<DeleteDeviceResp>("/admin/trial-protection/delete-device", {
        method: "POST",
        body: { deviceToken },
      });

      setOkText(
        `Устройство удалено: ${shortDeviceToken(r.deviceToken)} · device=${r.deletedDevice}, usage=${r.deletedUsage}, events=${r.deletedEvents}`,
      );

      if (openedDevice?.device_token === deviceToken) {
        setOpenedDevice(null);
      }

      await load({ silent: true });
    } catch (e: any) {
      setError(e?.message || "Не удалось удалить устройство.");
    } finally {
      setDeletingDevice(null);
    }
  }

  const sortedEvents = useMemo(
    () => events.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0)),
    [events],
  );

  const sortedDevices = useMemo(
    () => devices.slice().sort((a, b) => (b.last_seen_at || 0) - (a.last_seen_at || 0)),
    [devices],
  );

  const filteredDevices = useMemo(() => {
    const q = deviceQuery.trim().toLowerCase();
    if (!q) return sortedDevices;

    return sortedDevices.filter((item) => {
      const token = String(item.device_token ?? "").toLowerCase();
      const ip = String(item.last_ip ?? item.first_ip ?? "").toLowerCase();
      const userAgent = String(item.user_agent ?? "").toLowerCase();
      const trialUserId = String(item.trial_user_id ?? "").toLowerCase();

      return (
        token.includes(q) ||
        ip.includes(q) ||
        userAgent.includes(q) ||
        trialUserId.includes(q)
      );
    });
  }, [sortedDevices, deviceQuery]);

  const totalDevicesPages = Math.max(1, Math.ceil(filteredDevices.length / DEVICES_PER_PAGE));

  useEffect(() => {
    setDevicesPage(1);
  }, [deviceQuery, showAllDevices]);

  useEffect(() => {
    if (devicesPage > totalDevicesPages) {
      setDevicesPage(totalDevicesPages);
    }
  }, [devicesPage, totalDevicesPages]);

  const visibleEvents = useMemo(() => {
    if (!eventsExpanded) return [];
    if (eventsShowAll) return sortedEvents;
    return sortedEvents.slice(0, EVENTS_PREVIEW_COUNT);
  }, [eventsExpanded, eventsShowAll, sortedEvents]);

  const visibleDevices = useMemo(() => {
    const start = (devicesPage - 1) * DEVICES_PER_PAGE;
    return filteredDevices.slice(start, start + DEVICES_PER_PAGE);
  }, [devicesPage, filteredDevices]);

  function renderDecisionChip(decision: TrialProtectionEventItem["decision"]) {
    if (decision === "block") return <span className="chip chip--bad">BLOCK</span>;
    if (decision === "observe") return <span className="chip chip--warn">OBSERVE</span>;
    return <span className="chip chip--ok">ALLOW</span>;
  }

  const hasSettingsChanges =
    modeDraft !== (status?.mode || "observe") ||
    ttlDraft !== String(status?.ttlHours ?? 72) ||
    ipPrefixUsageThresholdDraft !== String(status?.ipPrefixUsageThreshold ?? 2) ||
    ipPrefixAttemptThresholdDraft !== String(status?.ipPrefixAttemptThreshold ?? 3) ||
    ipPrefixDistinctDevicesThresholdDraft !== String(status?.ipPrefixDistinctDevicesThreshold ?? 3) ||
    ipPrefixUserAgentAttemptThresholdDraft !== String(status?.ipPrefixUserAgentAttemptThreshold ?? 2) ||
    ipPrefixDistinctUsersThresholdDraft !== String(status?.ipPrefixDistinctUsersThreshold ?? 3);

  return (
    <>
      <div className="card">
        <div className="card__body">
          <div className="admin-sectionHead">
            <div>
              <div className="kicker">Trial protection</div>
              <h2 className="h2">Защита тестовых доступов</h2>
              <p className="p">Панель контроля режима, порогов и признаков абьюза.</p>
            </div>

            <button
              className="btn btn--soft"
              type="button"
              onClick={() => void load({ silent: true })}
              disabled={refreshing || savingSettings || clearingEvents || Boolean(resettingPrefix)}
            >
              {refreshing ? "Обновляю…" : "Обновить"}
            </button>
          </div>

          {error ? <div className="pre admin-gap-top-md">{error}</div> : null}
          {okText ? <div className="pre admin-gap-top-md">{okText}</div> : null}

          {loading ? (
            <div className="list admin-gap-top-md">
              <div className="skeleton h1" />
              <div className="skeleton p" />
              <div className="skeleton p" />
            </div>
          ) : (
            <>
              <div className="admin-metricsGrid admin-gap-top-md">
                <AdminMetric
                  label="Mode"
                  value={status?.mode || "—"}
                  tone={status?.mode === "enforce" ? "bad" : status?.mode === "observe" ? "warn" : "soft"}
                />
                <AdminMetric label="TTL" value={`${status?.ttlHours ?? "—"}h`} />
                <AdminMetric label="Devices now" value={status?.devicesWithTrial ?? 0} />
                <AdminMetric label="Blocks 24h" value={status?.blocks24h ?? 0} tone="bad" />
                <AdminMetric label="Attempts 24h" value={status?.attempts24h ?? 0} tone="warn" />
                <AdminMetric label="Distinct IPs 24h" value={status?.distinctIps24h ?? 0} />
              </div>

              <div className="admin-compactGrid admin-gap-top-md">
                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">Режим работы</div>
                    <div className="list__sub admin-gap-top-sm">
                      <label className="admin-radio">
                        <input
                          type="radio"
                          name="trialDeviceMode"
                          value="off"
                          checked={modeDraft === "off"}
                          onChange={() => setModeDraft("off")}
                        />{" "}
                        <strong>off</strong> — защита отключена
                      </label>

                      <label className="admin-radio">
                        <input
                          type="radio"
                          name="trialDeviceMode"
                          value="observe"
                          checked={modeDraft === "observe"}
                          onChange={() => setModeDraft("observe")}
                        />{" "}
                        <strong>observe</strong> — только логирование
                      </label>

                      <label className="admin-radio admin-radio--last">
                        <input
                          type="radio"
                          name="trialDeviceMode"
                          value="enforce"
                          checked={modeDraft === "enforce"}
                          onChange={() => setModeDraft("enforce")}
                        />{" "}
                        <strong>enforce</strong> — блокировать повторный trial
                      </label>
                    </div>
                  </div>
                </div>

                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">TTL в часах</div>
                    <div className="list__sub admin-gap-top-sm">
                      <input
                        className="input admin-numberInput"
                        type="number"
                        min="1"
                        max="720"
                        step="1"
                        value={ttlDraft}
                        onChange={(e) => setTtlDraft(e.target.value)}
                      />
                    </div>

                    <div className="admin-inlineMeta admin-gap-top-sm">
                      <span>reuse device 24h: {status?.reuseDevice24h ?? 0}</span>
                      <span>reuse ip 24h: {status?.reuseIp24h ?? 0}</span>
                      <span>ip-prefix abuse 24h: {status?.abuseIpPrefix24h ?? 0}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="admin-compactGrid admin-gap-top-md">
                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">Порог usage по prefix</div>
                    <div className="list__sub admin-gap-top-sm">
                      <input
                        className="input admin-numberInput"
                        type="number"
                        min="1"
                        max="100"
                        step="1"
                        value={ipPrefixUsageThresholdDraft}
                        onChange={(e) => setIpPrefixUsageThresholdDraft(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">Порог attempts по prefix</div>
                    <div className="list__sub admin-gap-top-sm">
                      <input
                        className="input admin-numberInput"
                        type="number"
                        min="1"
                        max="200"
                        step="1"
                        value={ipPrefixAttemptThresholdDraft}
                        onChange={(e) => setIpPrefixAttemptThresholdDraft(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">Порог distinct devices</div>
                    <div className="list__sub admin-gap-top-sm">
                      <input
                        className="input admin-numberInput"
                        type="number"
                        min="1"
                        max="200"
                        step="1"
                        value={ipPrefixDistinctDevicesThresholdDraft}
                        onChange={(e) => setIpPrefixDistinctDevicesThresholdDraft(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">Порог attempts по UA</div>
                    <div className="list__sub admin-gap-top-sm">
                      <input
                        className="input admin-numberInput"
                        type="number"
                        min="1"
                        max="200"
                        step="1"
                        value={ipPrefixUserAgentAttemptThresholdDraft}
                        onChange={(e) => setIpPrefixUserAgentAttemptThresholdDraft(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">Порог distinct users</div>
                    <div className="list__sub admin-gap-top-sm">
                      <input
                        className="input admin-numberInput"
                        type="number"
                        min="1"
                        max="200"
                        step="1"
                        value={ipPrefixDistinctUsersThresholdDraft}
                        onChange={(e) => setIpPrefixDistinctUsersThresholdDraft(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="actions actions--1 admin-gap-top-md">
                <button
                  className="btn btn--accent"
                  type="button"
                  onClick={saveSettings}
                  disabled={savingSettings || !hasSettingsChanges}
                >
                  {savingSettings ? "Сохраняю настройки…" : "Сохранить настройки"}
                </button>
              </div>

              <div className="admin-metricsGrid admin-gap-top-md">
                <AdminMetric label="Allow 24h" value={status?.allows24h ?? 0} tone="ok" />
                <AdminMetric label="Observe 24h" value={status?.observes24h ?? 0} tone="warn" />
                <AdminMetric label="Distinct devices 24h" value={status?.distinctDevices24h ?? 0} />
                <AdminMetric label="Missing token 24h" value={status?.missingDeviceToken24h ?? 0} tone="warn" />
                <AdminMetric label="Manual blocks 24h" value={status?.manualBlocks24h ?? 0} tone="bad" />
                <AdminMetric label="Block device 24h" value={status?.blockDevice24h ?? 0} tone="bad" />
                <AdminMetric
                  label="Block ip/prefix 24h"
                  value={(status?.blockIp24h ?? 0) + (status?.blockIpPrefix24h ?? 0)}
                  tone="bad"
                />
                <AdminMetric label="Blocked now" value={status?.activeBlockedDevices ?? 0} tone="bad" />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card admin-gap-top-lg">
        <div className="card__body">
          <div className="admin-sectionHead">
            <div>
              <div className="kicker">Devices</div>
              <h2 className="h2">Устройства</h2>
              <p className="p">Основной список для управления: просмотр, блокировка и сброс trial.</p>
            </div>

            <label className="admin-radio">
              <input
                type="checkbox"
                checked={showAllDevices}
                onChange={(e) => setShowAllDevices(e.target.checked)}
              />{" "}
              Показывать все устройства
            </label>
          </div>

          {loading ? (
            <div className="list admin-gap-top-md">
              <div className="skeleton h1" />
              <div className="skeleton p" />
              <div className="skeleton p" />
            </div>
          ) : error ? (
            <div className="pre admin-gap-top-md">{error}</div>
          ) : (
            <>
              <div className="admin-gap-top-md">
                <input
                  className="input"
                  type="text"
                  value={deviceQuery}
                  onChange={(e) => setDeviceQuery(e.target.value)}
                  placeholder="Поиск по token / IP / user id / user-agent"
                />
              </div>

              {visibleDevices.length === 0 ? (
                <div className="pre admin-gap-top-md">
                  {deviceQuery.trim()
                    ? "Ничего не найдено по текущему фильтру."
                    : "Подходящих устройств сейчас нет."}
                </div>
              ) : (
                <>
                  <div className="list admin-gap-top-md">
                    {visibleDevices.map((item) => (
                      <div key={item.id} className="list__item admin-rowCard admin-rowCard--compact">
                        <div
                          className="list__main admin-clickable"
                          onClick={() => setOpenedDevice(item)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") setOpenedDevice(item);
                          }}
                        >
                          <div className="kicker">{formatDateTime(item.last_seen_at)}</div>
                          <div className="list__title admin-gap-top-xs">{shortDeviceToken(item.device_token)}</div>
                          <div className="list__sub admin-listSubCompact">
                            <span>uid: {item.trial_user_id ?? "—"}</span>
                            <span className="paymentsHist__dot" />
                            <span>groups: {Number(item.active_trial_count ?? 0)}</span>
                            <span className="paymentsHist__dot" />
                            <span>ip: {item.last_ip || "—"}</span>
                            <span className="paymentsHist__dot" />
                            <span>block: {Number(item.is_blocked ?? 0) === 1 ? "yes" : "no"}</span>
                          </div>
                        </div>

                        <div className="admin-rowActions admin-rowActions--compact">
                          <button
                            className="btn btn--soft"
                            type="button"
                            onClick={() => setOpenedDevice(item)}
                          >
                            Open
                          </button>

                          {Number(item.is_blocked ?? 0) === 1 ? (
                            <button
                              className="btn btn--soft"
                              type="button"
                              disabled={unblockingDevice === item.device_token}
                              onClick={() => unblockDevice(item.device_token)}
                            >
                              {unblockingDevice === item.device_token ? "Снятие…" : "Unblock"}
                            </button>
                          ) : (
                            <button
                              className="btn btn--soft"
                              type="button"
                              disabled={blockingDevice === item.device_token}
                              onClick={() => blockDevice(item.device_token)}
                            >
                              {blockingDevice === item.device_token ? "Блок…" : "Block"}
                            </button>
                          )}

                          <button
                            className="btn btn--soft"
                            type="button"
                            disabled={resettingDevice === item.device_token}
                            onClick={() => resetTrial(item.device_token)}
                          >
                            {resettingDevice === item.device_token ? "Сброс…" : "Reset trial"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {filteredDevices.length > DEVICES_PER_PAGE ? (
                    <div className="actions actions--4 admin-gap-top-md">
                      <button
                        className="btn btn--soft"
                        type="button"
                        onClick={() => setDevicesPage(1)}
                        disabled={devicesPage === 1}
                      >
                        « Первая
                      </button>

                      <button
                        className="btn btn--soft"
                        type="button"
                        onClick={() => setDevicesPage((p) => Math.max(1, p - 1))}
                        disabled={devicesPage === 1}
                      >
                        ‹ Назад
                      </button>

                      <div className="pre">
                        Страница {devicesPage} / {totalDevicesPages} · Всего: {filteredDevices.length}
                      </div>

                      <button
                        className="btn btn--soft"
                        type="button"
                        onClick={() => setDevicesPage((p) => Math.min(totalDevicesPages, p + 1))}
                        disabled={devicesPage === totalDevicesPages}
                      >
                        Вперёд ›
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="card admin-gap-top-lg">
        <div className="card__body">
          <div className="admin-sectionHead">
            <div>
              <div className="kicker">Network cleanup</div>
              <h2 className="h2">Очистка сети / prefix</h2>
              <p className="p">
                Наблюдаемые подсети и ручной инструмент сетевой очистки. Чистит usage, снимает блокировки и очищает
                события по сети, но не удаляет сами устройства.
              </p>
            </div>
          </div>

          {prefixes.length > 0 ? (
            <div className="list admin-gap-top-md">
              {prefixes.map((item) => (
                <div key={item.ipPrefix} className="list__item admin-rowCard admin-rowCard--compact">
                  <div className="list__main">
                    <div className="list__title">{item.ipPrefix}</div>
                    <div className="list__sub admin-listSubCompact">
                      <span>devices: {item.devicesCount}</span>
                      <span className="paymentsHist__dot" />
                      <span>attempts24h: {item.attempts24h}</span>
                      <span className="paymentsHist__dot" />
                      <span>users: {item.distinctUsers}</span>
                      <span className="paymentsHist__dot" />
                      <span>blocked: {item.blockedDevices}</span>
                    </div>
                  </div>

                  <div className="admin-rowActions admin-rowActions--compact">
                    <button
                      className="btn btn--soft"
                      type="button"
                      disabled={resettingPrefix === item.ipPrefix}
                      onClick={() => resetPrefix(item.ipPrefix)}
                    >
                      {resettingPrefix === item.ipPrefix ? "Очищаю…" : "Очистить"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="admin-gap-top-md">
            <input
              className="input"
              type="text"
              value={networkInput}
              onChange={(e) => setNetworkInput(e.target.value)}
              placeholder="Например: 109.247.173.185 или 109.247.173"
            />
          </div>

          <div className="actions actions--1 admin-gap-top-md">
            <button
              className="btn btn--soft"
              type="button"
              disabled={Boolean(resettingPrefix) || !networkInput.trim()}
              onClick={() => resetPrefix(networkInput)}
            >
              {resettingPrefix === networkInput.trim() ? "Очищаю сеть…" : "Очистить сеть / prefix"}
            </button>
          </div>
        </div>
      </div>

      <div className="card admin-gap-top-lg">
        <div className="card__body">
          <div className="admin-sectionHead">
            <div>
              <div className="kicker">Events</div>
              <h2 className="h2">Последние события</h2>
              <p className="p">Диагностика и журнал срабатываний.</p>
            </div>

            <div className="admin-rowActions">
              <button
                className="btn btn--soft"
                type="button"
                onClick={() => {
                  setEventsExpanded((v) => !v);
                  if (eventsExpanded) setEventsShowAll(false);
                }}
              >
                {eventsExpanded ? "Скрыть" : "Показать"}
              </button>

              {eventsExpanded ? (
                <button className="btn btn--danger" type="button" onClick={clearEvents} disabled={clearingEvents}>
                  {clearingEvents ? "Очищаю…" : "Очистить журнал"}
                </button>
              ) : null}
            </div>
          </div>

          {!eventsExpanded ? (
            <div className="pre admin-gap-top-md">
              События скрыты. Последних записей: {sortedEvents.length}.
            </div>
          ) : loading ? (
            <div className="list admin-gap-top-md">
              <div className="skeleton h1" />
              <div className="skeleton p" />
              <div className="skeleton p" />
            </div>
          ) : error ? (
            <div className="pre admin-gap-top-md">{error}</div>
          ) : visibleEvents.length === 0 ? (
            <div className="pre admin-gap-top-md">Событий пока нет.</div>
          ) : (
            <>
              <div className="list admin-gap-top-md">
                {visibleEvents.map((item) => (
                  <div
                    key={item.id}
                    className="list__item is-clickable admin-rowCard admin-rowCard--compact"
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenedEvent(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setOpenedEvent(item);
                    }}
                  >
                    <div className="list__main">
                      <div className="kicker">{formatDateTime(item.created_at)}</div>
                      <div className="list__title admin-gap-top-xs">{item.event_type}</div>
                      <div className="list__sub admin-listSubCompact">{item.reason || "Без причины"}</div>
                    </div>
                    <div className="admin-rowActions admin-rowActions--single">{renderDecisionChip(item.decision)}</div>
                  </div>
                ))}
              </div>

              {sortedEvents.length > EVENTS_PREVIEW_COUNT ? (
                <div className="actions actions--1 admin-gap-top-md">
                  <button className="btn btn--soft" type="button" onClick={() => setEventsShowAll((v) => !v)}>
                    {eventsShowAll ? "Показать только последние 5" : `Показать все (${sortedEvents.length})`}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {openedEvent ? (
        <ModalShell
          title={openedEvent.event_type}
          kicker={formatDateTime(openedEvent.created_at)}
          onClose={() => setOpenedEvent(null)}
        >
          {(() => {
            const meta = openedEvent.meta ?? parseMetaJson(openedEvent.meta_json);
            const serviceId = meta?.serviceId ?? meta?.service_id ?? null;
            const trialGroup = meta?.trialGroup ?? meta?.trial_group ?? meta?.category ?? null;
            const periodHuman = meta?.periodHuman ?? meta?.period_human ?? null;

            return (
              <>
                <div className="list">
                  <div className="list__item admin-tightItem">
                    <div className="list__main">
                      <div className="list__title">Решение</div>
                      <div className="list__sub">{openedEvent.decision}</div>
                    </div>
                    <div className="list__side">{renderDecisionChip(openedEvent.decision)}</div>
                  </div>

                  <div className="list__item admin-tightItem">
                    <div className="list__main">
                      <div className="list__title">Причина</div>
                      <div className="list__sub">{openedEvent.reason || "—"}</div>
                    </div>
                  </div>

                  <div className="list__item admin-tightItem">
                    <div className="list__main">
                      <div className="list__title">Устройство</div>
                      <div className="list__sub feed__fulltext">{openedEvent.device_token || "—"}</div>
                    </div>
                  </div>

                  <div className="list__item admin-tightItem">
                    <div className="list__main">
                      <div className="list__title">IP</div>
                      <div className="list__sub">{openedEvent.ip || "—"}</div>
                    </div>
                  </div>

                  <div className="list__item admin-tightItem">
                    <div className="list__main">
                      <div className="list__title">User ID</div>
                      <div className="list__sub">{openedEvent.user_id ?? "—"}</div>
                    </div>
                  </div>

                  <div className="list__item admin-tightItem">
                    <div className="list__main">
                      <div className="list__title">Service ID</div>
                      <div className="list__sub">{serviceId ?? "—"}</div>
                    </div>
                  </div>

                  <div className="list__item admin-tightItem">
                    <div className="list__main">
                      <div className="list__title">Trial group</div>
                      <div className="list__sub">{trialGroup ?? "—"}</div>
                    </div>
                  </div>

                  <div className="list__item admin-tightItem">
                    <div className="list__main">
                      <div className="list__title">Период</div>
                      <div className="list__sub">{periodHuman ?? "—"}</div>
                    </div>
                  </div>

                  <div className="list__item admin-tightItem">
                    <div className="list__main">
                      <div className="list__title">Meta JSON</div>
                      <div className="list__sub feed__fulltext">{openedEvent.meta_json || "—"}</div>
                    </div>
                  </div>
                </div>

                <div className="actions actions--2 admin-gap-top-lg">
                  <button className="btn btn--soft" type="button" onClick={() => copyText(openedEvent.device_token || "")}>
                    Copy device
                  </button>
                  <button className="btn btn--soft" type="button" onClick={() => copyText(openedEvent.meta_json || "")}>
                    Copy meta
                  </button>
                </div>
              </>
            );
          })()}
        </ModalShell>
      ) : null}

      {openedDevice ? (
        <ModalShell
          title={shortDeviceToken(openedDevice.device_token)}
          kicker={`Last seen: ${formatDateTime(openedDevice.last_seen_at)}`}
          onClose={() => setOpenedDevice(null)}
        >
          <div className="list">
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Device token</div>
                <div className="list__sub feed__fulltext">{openedDevice.device_token}</div>
              </div>
            </div>

            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">User ID</div>
                <div className="list__sub">{openedDevice.trial_user_id ?? "—"}</div>
              </div>
            </div>

            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">IP / groups</div>
                <div className="list__sub">
                  {openedDevice.last_ip || "—"}
                  <span className="paymentsHist__dot" />
                  groups: {Number(openedDevice.active_trial_count ?? 0)}
                </div>
              </div>
            </div>

            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Статус</div>
                <div className="list__sub">
                  manual block: {Number(openedDevice.is_blocked ?? 0) === 1 ? "yes" : "no"}
                </div>
              </div>
            </div>

            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Последний trial usage</div>
                <div className="list__sub">{formatDateTime(openedDevice.last_trial_used_at)}</div>
              </div>
            </div>

            <details className="admin-details admin-gap-top-sm">
              <summary className="admin-details__summary">Дополнительные данные</summary>
              <div className="list admin-gap-top-sm">
                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">First seen</div>
                    <div className="list__sub">{formatDateTime(openedDevice.first_seen_at)}</div>
                  </div>
                </div>

                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">Last seen</div>
                    <div className="list__sub">{formatDateTime(openedDevice.last_seen_at)}</div>
                  </div>
                </div>

                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">First IP</div>
                    <div className="list__sub">{openedDevice.first_ip || "—"}</div>
                  </div>
                </div>

                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">User-Agent</div>
                    <div className="list__sub feed__fulltext">{openedDevice.user_agent || "—"}</div>
                  </div>
                </div>
              </div>
            </details>
          </div>

          <div className="actions actions--4 admin-gap-top-lg">
            <button className="btn btn--soft" type="button" onClick={() => copyText(openedDevice.device_token)}>
              Copy token
            </button>

            {Number(openedDevice.is_blocked ?? 0) === 1 ? (
              <button
                className="btn btn--soft"
                type="button"
                disabled={unblockingDevice === openedDevice.device_token}
                onClick={() => unblockDevice(openedDevice.device_token)}
              >
                {unblockingDevice === openedDevice.device_token ? "Снятие…" : "Unblock"}
              </button>
            ) : (
              <button
                className="btn btn--soft"
                type="button"
                disabled={blockingDevice === openedDevice.device_token}
                onClick={() => blockDevice(openedDevice.device_token)}
              >
                {blockingDevice === openedDevice.device_token ? "Блок…" : "Block"}
              </button>
            )}

            <button
              className="btn btn--soft"
              type="button"
              disabled={resettingDevice === openedDevice.device_token}
              onClick={() => resetTrial(openedDevice.device_token)}
            >
              {resettingDevice === openedDevice.device_token ? "Сброс…" : "Reset trial"}
            </button>

            <button
              className="btn btn--danger"
              type="button"
              disabled={deletingDevice === openedDevice.device_token}
              onClick={() => deleteDevice(openedDevice.device_token)}
            >
              {deletingDevice === openedDevice.device_token ? "Удаление…" : "Delete device"}
            </button>
          </div>
        </ModalShell>
      ) : null}
    </>
  );
}