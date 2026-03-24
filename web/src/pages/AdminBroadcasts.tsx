import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { apiFetch } from "../shared/api/client";

type BroadcastItem = {
  origin_id: string;
  ts: number;
  type?: string;
  level?: "info" | "success" | "error";
  title?: string;
  message?: string;
  copies: number;
};

type ListResp = { ok: true; items: BroadcastItem[] };
type DeleteResp = { ok: true; originId: string; deleted: number };

type OrderBlockMode = "off" | "same_type" | "any";
type TrialDeviceMode = "off" | "observe" | "enforce";

type AdminSettingsResp = {
  ok: 1 | true;
  settings?: {
    orderBlockMode?: OrderBlockMode;
  };
};

type AdminSettingsSaveResp = {
  ok: 1 | true;
  orderBlockMode?: OrderBlockMode;
};

type TrialProtectionStatusResp = {
  ok: true;
  mode: TrialDeviceMode;
  ttlHours: number;
  devicesWithTrial: number;
  activeTrialGroups?: number;
  activeBlockedDevices?: number;
  blocks24h?: number;
  attempts24h?: number;
  allows24h?: number;
  observes24h?: number;
  distinctDevices24h?: number;
  distinctIps24h?: number;
  reuseDevice24h?: number;
  reuseIp24h?: number;
  abuseIpPrefix24h?: number;
  blockDevice24h?: number;
  blockIp24h?: number;
  blockIpPrefix24h?: number;
  missingDeviceToken24h?: number;
  manualBlocks24h?: number;
};

type TrialProtectionEventItem = {
  id: number;
  created_at: number;
  event_type: string;
  decision: "allow" | "observe" | "block";
  reason?: string | null;
  device_token?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  user_id?: number | null;
  meta_json?: string | null;
  meta?: Record<string, any> | null;
};

type TrialProtectionEventsResp = {
  ok: true;
  items: TrialProtectionEventItem[];
};

type ResetDeviceResp = {
  ok: true;
};

type BlockDeviceResp = {
  ok: true;
};

type AdminTab = "overview" | "broadcasts" | "orderRules" | "trialProtection";

type DerivedDeviceItem = {
  deviceToken: string;
  lastSeenAt: number;
  firstSeenAt: number;
  lastIp: string | null;
  lastUserAgent: string | null;
  lastUserId: number | null;
  totalEvents: number;
  blockEvents: number;
  allowEvents: number;
  observeEvents: number;
  lastDecision: "allow" | "observe" | "block";
  lastReason: string | null;
};

const PREVIEW_LIMIT = 140;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateTime(tsSec?: number | null) {
  if (!tsSec || !Number.isFinite(tsSec)) return "—";
  const d = new Date(tsSec * 1000);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(
    d.getMinutes(),
  )}`;
}

function formatDateLabel(tsSec?: number | null) {
  if (!tsSec || !Number.isFinite(tsSec)) return "Без даты";
  const d = new Date(tsSec * 1000);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function truncateText(text: string | null | undefined, limit: number) {
  const source = String(text || "").trim();
  if (!source) return "";
  if (source.length <= limit) return source;
  return source.slice(0, limit).trimEnd() + "…";
}

function shortDeviceToken(token?: string | null) {
  const s = String(token || "").trim();
  if (!s) return "—";
  if (s.length <= 18) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

function parseMetaJson(metaJson?: string | null): Record<string, any> | null {
  const raw = String(metaJson || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function copyText(text: string) {
  if (!text) return;
  void navigator.clipboard?.writeText(text);
}

function groupByDay<T>(items: T[], getTs: (item: T) => number | null | undefined) {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const ts = getTs(item);
    const key = formatDateLabel(ts);
    const arr = groups.get(key) || [];
    arr.push(item);
    groups.set(key, arr);
  }

  return Array.from(groups.entries()).map(([date, values]) => ({
    date,
    items: values,
  }));
}

function deriveDevicesFromEvents(events: TrialProtectionEventItem[]): DerivedDeviceItem[] {
  const map = new Map<string, DerivedDeviceItem>();

  for (const item of events) {
    const deviceToken = String(item.device_token || "").trim();
    if (!deviceToken) continue;

    const existing = map.get(deviceToken);

    if (!existing) {
      map.set(deviceToken, {
        deviceToken,
        lastSeenAt: item.created_at || 0,
        firstSeenAt: item.created_at || 0,
        lastIp: item.ip || null,
        lastUserAgent: item.user_agent || null,
        lastUserId: item.user_id ?? null,
        totalEvents: 1,
        blockEvents: item.decision === "block" ? 1 : 0,
        allowEvents: item.decision === "allow" ? 1 : 0,
        observeEvents: item.decision === "observe" ? 1 : 0,
        lastDecision: item.decision,
        lastReason: item.reason ?? null,
      });
      continue;
    }

    existing.totalEvents += 1;
    if (item.decision === "block") existing.blockEvents += 1;
    if (item.decision === "allow") existing.allowEvents += 1;
    if (item.decision === "observe") existing.observeEvents += 1;

    if ((item.created_at || 0) > existing.lastSeenAt) {
      existing.lastSeenAt = item.created_at || 0;
      existing.lastIp = item.ip || null;
      existing.lastUserAgent = item.user_agent || null;
      existing.lastUserId = item.user_id ?? null;
      existing.lastDecision = item.decision;
      existing.lastReason = item.reason ?? null;
    }

    if ((item.created_at || 0) < existing.firstSeenAt) {
      existing.firstSeenAt = item.created_at || 0;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

function AdminTabButton({
  active,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`btn admin-tabBtn ${active ? "btn--accent admin-tabBtn--active" : "btn--soft"}`}
      type="button"
      onClick={onClick}
    >
      <span className="admin-tabBtn__title">{title}</span>
      <span className="admin-tabBtn__sub">{subtitle}</span>
    </button>
  );
}

function AdminMetric({
  label,
  value,
  tone = "soft",
}: {
  label: string;
  value: ReactNode;
  tone?: "soft" | "ok" | "warn" | "bad";
}) {
  const chipClass =
    tone === "ok" ? "chip--ok" : tone === "warn" ? "chip--warn" : tone === "bad" ? "chip--bad" : "chip--soft";

  return (
    <div className="admin-metric">
      <div className="admin-metric__label">{label}</div>
      <div className="admin-metric__value">{value}</div>
      <div className="admin-metric__meta">
        <span className={`chip ${chipClass}`}>LIVE</span>
      </div>
    </div>
  );
}

function ModalShell({
  title,
  kicker,
  onClose,
  children,
}: {
  title: string;
  kicker?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="modal admin-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__card card admin-modal__card" onClick={(ev) => ev.stopPropagation()}>
        <div className="card__body admin-modal__body">
          <div className="modal__head admin-modal__head">
            <div className="admin-modal__headMain">
              {kicker ? <div className="kicker">{kicker}</div> : null}
              <div className="modal__title admin-modal__title">{title}</div>
            </div>

            <button type="button" className="btn btn--soft modal__close admin-modal__close" onClick={onClose} aria-label="Закрыть">
              ✕
            </button>
          </div>

          <div className="modal__content admin-modal__content">{children}</div>
        </div>
      </div>
    </div>
  );
}

function OverviewSection({ onOpenTab }: { onOpenTab: (tab: AdminTab) => void }) {
  return (
    <div className="card">
      <div className="card__body">
        <div className="kicker">Overview</div>
        <h2 className="h2">Разделы админки</h2>
        <p className="p">Убраны перегруженные блоки, оставлены только рабочие инструменты под текущий backend.</p>

        <div className="admin-overviewGrid admin-gap-top-md">
          <div className="mini admin-miniCard">
            <div className="mini__title">Broadcasts</div>
            <div className="mini__list">
              <div className="list__sub">Просмотр и удаление разосланных новостей.</div>
              <div><span className="chip chip--ok">ГОТОВО</span></div>
              <div className="actions actions--1">
                <button className="btn btn--soft" type="button" onClick={() => onOpenTab("broadcasts")}>
                  Открыть
                </button>
              </div>
            </div>
          </div>

          <div className="mini admin-miniCard">
            <div className="mini__title">Правила заказов</div>
            <div className="mini__list">
              <div className="list__sub">Управление orderBlockMode для неоплаченных услуг.</div>
              <div><span className="chip chip--ok">ACTIVE</span></div>
              <div className="actions actions--1">
                <button className="btn btn--soft" type="button" onClick={() => onOpenTab("orderRules")}>
                  Открыть
                </button>
              </div>
            </div>
          </div>

          <div className="mini admin-miniCard">
            <div className="mini__title">Trial Protection</div>
            <div className="mini__list">
              <div className="list__sub">Статус, журнал, устройства из событий и ручные действия.</div>
              <div><span className="chip chip--warn">CONTROL</span></div>
              <div className="actions actions--1">
                <button className="btn btn--soft" type="button" onClick={() => onOpenTab("trialProtection")}>
                  Открыть
                </button>
              </div>
            </div>
          </div>

          <div className="mini admin-miniCard">
            <div className="mini__title">Telegram fit</div>
            <div className="mini__list">
              <div className="list__sub">Компактные списки, группировка по датам и безопасные модалки.</div>
              <div><span className="chip chip--soft">UPDATED</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BroadcastsSection() {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<BroadcastItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [opened, setOpened] = useState<BroadcastItem | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const r = await apiFetch<ListResp>("/admin/broadcasts?limit=200", { method: "GET" });
      setItems(Array.isArray(r.items) ? r.items : []);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить список broadcast-новостей.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function removeOne(originId: string) {
    const ok = window.confirm(`Удалить broadcast у всех пользователей?\n\n${originId}`);
    if (!ok) return;

    setDeletingId(originId);

    try {
      const encoded = encodeURIComponent(originId);
      const r = await apiFetch<DeleteResp>(`/admin/broadcast/${encoded}`, { method: "DELETE" });

      setItems((prev) => prev.filter((x) => x.origin_id !== originId));
      if (opened?.origin_id === originId) setOpened(null);

      window.alert(`Удалено копий: ${r.deleted}`);
    } catch (e: any) {
      window.alert(e?.message || "Не удалось удалить broadcast.");
    } finally {
      setDeletingId(null);
    }
  }

  const sorted = useMemo(() => items.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)), [items]);
  const groups = useMemo(() => groupByDay(sorted, (item) => item.ts), [sorted]);

  return (
    <>
      <div className="card">
        <div className="card__body">
          <div className="admin-sectionHead">
            <div>
              <div className="kicker">Broadcasts</div>
              <h2 className="h2">Управление broadcast-новостями</h2>
              <p className="p">Список компактный, сгруппирован по датам, длинные тексты уходят в модалку.</p>
            </div>

            <button className="btn btn--accent" type="button" onClick={load} disabled={loading}>
              {loading ? "Обновляю…" : "Обновить"}
            </button>
          </div>

          {error ? <div className="pre admin-gap-top-md">{error}</div> : null}

          {loading && !sorted.length ? (
            <div className="list admin-gap-top-md">
              <div className="skeleton h1" />
              <div className="skeleton p" />
              <div className="skeleton p" />
            </div>
          ) : groups.length === 0 ? (
            <div className="pre admin-gap-top-md">Broadcast-новостей пока нет.</div>
          ) : (
            <div className="admin-groups admin-gap-top-md">
              {groups.map((group) => (
                <div key={group.date} className="admin-dateGroup">
                  <div className="admin-dateTitle">{group.date}</div>

                  <div className="list admin-compactList">
                    {group.items.map((item) => {
                      const preview = truncateText(item.message, PREVIEW_LIMIT);

                      return (
                        <div key={item.origin_id} className="list__item admin-compactItem">
                          <div className="list__main">
                            <div className="kicker">{formatDateTime(item.ts)}</div>
                            <div className="list__title admin-gap-top-xs">{item.title || "Без заголовка"}</div>
                            {preview ? <div className="list__sub admin-listSubCompact">{preview}</div> : null}
                            <div className="admin-inlineMeta admin-gap-top-sm">
                              <span><strong>copies:</strong> {item.copies}</span>
                              <span><strong>origin:</strong> {truncateText(item.origin_id, 32)}</span>
                            </div>
                          </div>

                          <div className="admin-rowActions">
                            <button className="btn btn--soft" type="button" onClick={() => setOpened(item)}>
                              Открыть
                            </button>
                            <button
                              className="btn btn--danger"
                              type="button"
                              disabled={deletingId === item.origin_id}
                              onClick={() => removeOne(item.origin_id)}
                            >
                              {deletingId === item.origin_id ? "Удаляю…" : "Удалить"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {opened ? (
        <ModalShell title={opened.title || "Без заголовка"} kicker={formatDateTime(opened.ts)} onClose={() => setOpened(null)}>
          <div className="list">
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">origin</div>
                <div className="list__sub feed__fulltext">{opened.origin_id}</div>
              </div>
            </div>

            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">copies</div>
                <div className="list__sub">{opened.copies}</div>
              </div>
            </div>

            {opened.message ? (
              <div className="list__item admin-tightItem">
                <div className="list__main">
                  <div className="list__title">message</div>
                  <div className="list__sub feed__fulltext">{opened.message}</div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="actions actions--1 admin-gap-top-lg">
            <button
              className="btn btn--danger"
              type="button"
              disabled={deletingId === opened.origin_id}
              onClick={() => removeOne(opened.origin_id)}
            >
              {deletingId === opened.origin_id ? "Удаляю…" : "Удалить у всех"}
            </button>
          </div>
        </ModalShell>
      ) : null}
    </>
  );
}

function OrderRulesSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<OrderBlockMode>("off");
  const [savedMode, setSavedMode] = useState<OrderBlockMode>("off");
  const [error, setError] = useState<string | null>(null);
  const [okText, setOkText] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setOkText(null);

    try {
      const r = await apiFetch<AdminSettingsResp>("/admin/settings", { method: "GET" });
      const nextMode: OrderBlockMode = r?.settings?.orderBlockMode || "off";
      setMode(nextMode);
      setSavedMode(nextMode);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить настройки.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setOkText(null);

    try {
      const r = await apiFetch<AdminSettingsSaveResp>("/admin/settings/order-rules", {
        method: "PUT",
        body: { orderBlockMode: mode },
      });

      const nextMode: OrderBlockMode = r?.orderBlockMode || mode;
      setMode(nextMode);
      setSavedMode(nextMode);
      setOkText("Настройка сохранена.");
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить настройку.");
    } finally {
      setSaving(false);
    }
  }

  const changed = mode !== savedMode;

  return (
    <div className="card">
      <div className="card__body">
        <div className="kicker">Order rules</div>
        <h2 className="h2">Правила оформления услуг</h2>
        <p className="p">Управление ограничением новых заказов при наличии неоплаченных услуг.</p>

        {loading ? (
          <div className="list admin-gap-top-md">
            <div className="skeleton h1" />
            <div className="skeleton p" />
            <div className="skeleton p" />
          </div>
        ) : (
          <>
            <div className="list admin-gap-top-md">
              <div className="list__item admin-tightItem">
                <div className="list__main">
                  <div className="list__title">Режим блокировки</div>
                  <div className="list__sub admin-gap-top-sm">
                    <label className="admin-radio">
                      <input
                        type="radio"
                        name="orderBlockMode"
                        value="off"
                        checked={mode === "off"}
                        onChange={() => setMode("off")}
                      />{" "}
                      <strong>off</strong> — не ограничивать новые заказы
                    </label>

                    <label className="admin-radio">
                      <input
                        type="radio"
                        name="orderBlockMode"
                        value="same_type"
                        checked={mode === "same_type"}
                        onChange={() => setMode("same_type")}
                      />{" "}
                      <strong>same_type</strong> — блок только того же типа
                    </label>

                    <label className="admin-radio admin-radio--last">
                      <input
                        type="radio"
                        name="orderBlockMode"
                        value="any"
                        checked={mode === "any"}
                        onChange={() => setMode("any")}
                      />{" "}
                      <strong>any</strong> — блок любых новых заказов
                    </label>
                  </div>
                </div>
                <div className="list__side">
                  <span className="chip chip--soft">{savedMode}</span>
                </div>
              </div>
            </div>

            {error ? <div className="pre admin-gap-top-md">{error}</div> : null}
            {okText ? <div className="pre admin-gap-top-md">{okText}</div> : null}

            <div className="actions actions--2 admin-gap-top-md">
              <button className="btn btn--soft" type="button" onClick={load} disabled={loading || saving}>
                Обновить
              </button>
              <button className="btn btn--accent" type="button" onClick={save} disabled={saving || !changed}>
                {saving ? "Сохраняю…" : "Сохранить"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TrialProtectionSection() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resettingDevice, setResettingDevice] = useState<string | null>(null);
  const [blockingDevice, setBlockingDevice] = useState<string | null>(null);
  const [unblockingDevice, setUnblockingDevice] = useState<string | null>(null);

  const [status, setStatus] = useState<TrialProtectionStatusResp | null>(null);
  const [events, setEvents] = useState<TrialProtectionEventItem[]>([]);
  const [openedEvent, setOpenedEvent] = useState<TrialProtectionEventItem | null>(null);
  const [openedDevice, setOpenedDevice] = useState<DerivedDeviceItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okText, setOkText] = useState<string | null>(null);

  async function load(opts?: { silent?: boolean }) {
    const silent = Boolean(opts?.silent);

    if (silent) setRefreshing(true);
    else setLoading(true);

    setError(null);

    try {
      const [statusResp, eventsResp] = await Promise.all([
        apiFetch<TrialProtectionStatusResp>("/admin/trial-protection/status", { method: "GET" }),
        apiFetch<TrialProtectionEventsResp>("/admin/trial-protection/events?limit=80", { method: "GET" }),
      ]);

      setStatus(statusResp);
      setEvents(Array.isArray(eventsResp.items) ? eventsResp.items : []);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить Trial Protection.");
      if (!silent) {
        setStatus(null);
        setEvents([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function resetDevice(deviceToken: string) {
    const ok = window.confirm(`Сбросить trial-state для устройства?\n\n${deviceToken}`);
    if (!ok) return;

    setResettingDevice(deviceToken);
    setError(null);
    setOkText(null);

    try {
      await apiFetch<ResetDeviceResp>("/admin/trial-protection/device/reset", {
        method: "POST",
        body: { deviceToken },
      });

      setOkText(`Сброс выполнен: ${shortDeviceToken(deviceToken)}`);
      if (openedDevice?.deviceToken === deviceToken) setOpenedDevice(null);
      await load({ silent: true });
    } catch (e: any) {
      setError(e?.message || "Не удалось сбросить устройство.");
    } finally {
      setResettingDevice(null);
    }
  }

  async function blockDevice(deviceToken: string) {
    const ok = window.confirm(`Заблокировать устройство вручную?\n\n${deviceToken}`);
    if (!ok) return;

    setBlockingDevice(deviceToken);
    setError(null);
    setOkText(null);

    try {
      await apiFetch<BlockDeviceResp>("/admin/trial-protection/device/block", {
        method: "POST",
        body: { deviceToken },
      });

      setOkText(`Устройство заблокировано: ${shortDeviceToken(deviceToken)}`);
      await load({ silent: true });
    } catch (e: any) {
      setError(e?.message || "Не удалось заблокировать устройство.");
    } finally {
      setBlockingDevice(null);
    }
  }

  async function unblockDevice(deviceToken: string) {
    const ok = window.confirm(
      `Снять блокировку и очистить trial-state для устройства?\n\n${deviceToken}`,
    );
    if (!ok) return;

    setUnblockingDevice(deviceToken);
    setError(null);
    setOkText(null);

    try {
      await apiFetch<BlockDeviceResp>("/admin/trial-protection/device/unblock", {
        method: "POST",
        body: { deviceToken },
      });

      setOkText(`Устройство разблокировано: ${shortDeviceToken(deviceToken)}`);
      await load({ silent: true });
    } catch (e: any) {
      setError(e?.message || "Не удалось разблокировать устройство.");
    } finally {
      setUnblockingDevice(null);
    }
  }

  const sortedEvents = useMemo(
    () => events.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0)),
    [events],
  );

  const eventGroups = useMemo(
    () => groupByDay(sortedEvents, (item) => item.created_at),
    [sortedEvents],
  );

  const devices = useMemo(() => deriveDevicesFromEvents(sortedEvents), [sortedEvents]);

  const deviceGroups = useMemo(
    () => groupByDay(devices, (item) => item.lastSeenAt),
    [devices],
  );

  function renderDecisionChip(decision: TrialProtectionEventItem["decision"] | DerivedDeviceItem["lastDecision"]) {
    if (decision === "block") return <span className="chip chip--bad">BLOCK</span>;
    if (decision === "observe") return <span className="chip chip--warn">OBSERVE</span>;
    return <span className="chip chip--ok">ALLOW</span>;
  }

  return (
    <>
      <div className="card">
        <div className="card__body">
          <div className="admin-sectionHead">
            <div>
              <div className="kicker">Trial protection</div>
              <h2 className="h2">Защита тестовых доступов</h2>
              <p className="p">Режим и TTL только читаются. Управление идёт через работающие device-action эндпоинты.</p>
            </div>

            <button className="btn btn--soft" type="button" onClick={() => void load({ silent: true })} disabled={refreshing}>
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
                <AdminMetric label="Devices" value={status?.devicesWithTrial ?? 0} />
                <AdminMetric label="Blocks 24h" value={status?.blocks24h ?? 0} tone="bad" />
                <AdminMetric label="Attempts 24h" value={status?.attempts24h ?? 0} tone="warn" />
                <AdminMetric label="Distinct IPs 24h" value={status?.distinctIps24h ?? 0} />
              </div>

              <div className="admin-metricsGrid admin-gap-top-md">
                <AdminMetric label="Allow 24h" value={status?.allows24h ?? 0} tone="ok" />
                <AdminMetric label="Observe 24h" value={status?.observes24h ?? 0} tone="warn" />
                <AdminMetric label="Distinct devices 24h" value={status?.distinctDevices24h ?? 0} />
                <AdminMetric label="Missing token 24h" value={status?.missingDeviceToken24h ?? 0} tone="warn" />
                <AdminMetric label="Manual blocks 24h" value={status?.manualBlocks24h ?? 0} tone="bad" />
                <AdminMetric
                  label="IP/prefix blocks"
                  value={(status?.blockIp24h ?? 0) + (status?.blockIpPrefix24h ?? 0)}
                  tone="bad"
                />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card admin-gap-top-lg">
        <div className="card__body">
          <div className="kicker">Devices</div>
          <h2 className="h2">Устройства из журнала событий</h2>
          <p className="p">Список строится из последних событий, поэтому работает без отдельного devices endpoint.</p>

          {loading ? (
            <div className="list admin-gap-top-md">
              <div className="skeleton h1" />
              <div className="skeleton p" />
              <div className="skeleton p" />
            </div>
          ) : deviceGroups.length === 0 ? (
            <div className="pre admin-gap-top-md">Устройств в журнале пока нет.</div>
          ) : (
            <div className="admin-groups admin-gap-top-md">
              {deviceGroups.map((group) => (
                <div key={group.date} className="admin-dateGroup">
                  <div className="admin-dateTitle">{group.date}</div>

                  <div className="list admin-compactList">
                    {group.items.map((item) => (
                      <div key={item.deviceToken} className="list__item admin-compactItem">
                        <div className="list__main admin-clickable" onClick={() => setOpenedDevice(item)}>
                          <div className="kicker">{formatDateTime(item.lastSeenAt)}</div>
                          <div className="list__title admin-gap-top-xs">{shortDeviceToken(item.deviceToken)}</div>
                          <div className="admin-inlineMeta admin-gap-top-sm">
                            <span>events: {item.totalEvents}</span>
                            <span>blocks: {item.blockEvents}</span>
                            <span>ip: {item.lastIp || "—"}</span>
                          </div>
                          <div className="list__sub admin-listSubCompact">{item.lastReason || "Без причины"}</div>
                        </div>

                        <div className="admin-rowActions">
                          <button className="btn btn--soft" type="button" onClick={() => setOpenedDevice(item)}>
                            Детали
                          </button>
                          <button
                            className="btn btn--soft"
                            type="button"
                            disabled={blockingDevice === item.deviceToken}
                            onClick={() => blockDevice(item.deviceToken)}
                          >
                            {blockingDevice === item.deviceToken ? "Блок…" : "Block"}
                          </button>
                          <button
                            className="btn btn--soft"
                            type="button"
                            disabled={unblockingDevice === item.deviceToken}
                            onClick={() => unblockDevice(item.deviceToken)}
                          >
                            {unblockingDevice === item.deviceToken ? "Снятие…" : "Unblock"}
                          </button>
                          <button
                            className="btn btn--danger"
                            type="button"
                            disabled={resettingDevice === item.deviceToken}
                            onClick={() => resetDevice(item.deviceToken)}
                          >
                            {resettingDevice === item.deviceToken ? "Сброс…" : "Reset"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card admin-gap-top-lg">
        <div className="card__body">
          <div className="kicker">Events</div>
          <h2 className="h2">Последние события</h2>
          <p className="p">События сгруппированы по дням, внутри только короткая сводка — детали в модалке.</p>

          {loading ? (
            <div className="list admin-gap-top-md">
              <div className="skeleton h1" />
              <div className="skeleton p" />
              <div className="skeleton p" />
            </div>
          ) : eventGroups.length === 0 ? (
            <div className="pre admin-gap-top-md">Событий пока нет.</div>
          ) : (
            <div className="admin-groups admin-gap-top-md">
              {eventGroups.map((group) => (
                <div key={group.date} className="admin-dateGroup">
                  <div className="admin-dateTitle">{group.date}</div>

                  <div className="list admin-compactList">
                    {group.items.map((item) => (
                      <div
                        key={item.id}
                        className="list__item admin-compactItem is-clickable"
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
                          <div className="admin-inlineMeta admin-gap-top-sm">
                            <span>user: {item.user_id ?? "—"}</span>
                            <span>ip: {item.ip || "—"}</span>
                            <span>device: {shortDeviceToken(item.device_token)}</span>
                          </div>
                          <div className="list__sub admin-listSubCompact">{item.reason || "Без причины"}</div>
                        </div>

                        <div className="admin-rowActions admin-rowActions--single">
                          {renderDecisionChip(item.decision)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
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

                  <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">Причина</div><div className="list__sub">{openedEvent.reason || "—"}</div></div></div>
                  <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">Устройство</div><div className="list__sub feed__fulltext">{openedEvent.device_token || "—"}</div></div></div>
                  <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">IP</div><div className="list__sub">{openedEvent.ip || "—"}</div></div></div>
                  <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">User ID</div><div className="list__sub">{openedEvent.user_id ?? "—"}</div></div></div>
                  <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">Service ID</div><div className="list__sub">{serviceId ?? "—"}</div></div></div>
                  <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">Trial group</div><div className="list__sub">{trialGroup ?? "—"}</div></div></div>
                  <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">Период</div><div className="list__sub">{periodHuman ?? "—"}</div></div></div>
                  <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">User-Agent</div><div className="list__sub feed__fulltext">{openedEvent.user_agent || "—"}</div></div></div>
                  <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">Meta JSON</div><div className="list__sub feed__fulltext">{openedEvent.meta_json || "—"}</div></div></div>
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
          title={shortDeviceToken(openedDevice.deviceToken)}
          kicker={`Last seen: ${formatDateTime(openedDevice.lastSeenAt)}`}
          onClose={() => setOpenedDevice(null)}
        >
          <div className="list">
            <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">Device token</div><div className="list__sub feed__fulltext">{openedDevice.deviceToken}</div></div></div>
            <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">First seen</div><div className="list__sub">{formatDateTime(openedDevice.firstSeenAt)}</div></div></div>
            <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">Last seen</div><div className="list__sub">{formatDateTime(openedDevice.lastSeenAt)}</div></div></div>
            <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">IP</div><div className="list__sub">{openedDevice.lastIp || "—"}</div></div></div>
            <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">User ID</div><div className="list__sub">{openedDevice.lastUserId ?? "—"}</div></div></div>
            <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">Всего событий</div><div className="list__sub">{openedDevice.totalEvents}</div></div></div>
            <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">Allow / Observe / Block</div><div className="list__sub">{openedDevice.allowEvents} / {openedDevice.observeEvents} / {openedDevice.blockEvents}</div></div></div>
            <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">Последнее решение</div><div className="list__sub">{openedDevice.lastDecision}</div></div></div>
            <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">Последняя причина</div><div className="list__sub">{openedDevice.lastReason || "—"}</div></div></div>
            <div className="list__item admin-tightItem"><div className="list__main"><div className="list__title">User-Agent</div><div className="list__sub feed__fulltext">{openedDevice.lastUserAgent || "—"}</div></div></div>
          </div>

          <div className="actions actions--3 admin-gap-top-lg">
            <button className="btn btn--soft" type="button" onClick={() => copyText(openedDevice.deviceToken)}>
              Copy token
            </button>
            <button
              className="btn btn--soft"
              type="button"
              disabled={blockingDevice === openedDevice.deviceToken}
              onClick={() => blockDevice(openedDevice.deviceToken)}
            >
              {blockingDevice === openedDevice.deviceToken ? "Блок…" : "Block"}
            </button>
            <button
              className="btn btn--soft"
              type="button"
              disabled={unblockingDevice === openedDevice.deviceToken}
              onClick={() => unblockDevice(openedDevice.deviceToken)}
            >
              {unblockingDevice === openedDevice.deviceToken ? "Снятие…" : "Unblock"}
            </button>
          </div>

          <div className="actions actions--1 admin-gap-top-sm">
            <button
              className="btn btn--danger"
              type="button"
              disabled={resettingDevice === openedDevice.deviceToken}
              onClick={() => resetDevice(openedDevice.deviceToken)}
            >
              {resettingDevice === openedDevice.deviceToken ? "Сброс…" : "Reset device"}
            </button>
          </div>
        </ModalShell>
      ) : null}
    </>
  );
}

export function AdminBroadcasts() {
  const { me, loading: meLoading } = useMe() as any;
  const isAdmin = Boolean(me?.profile?.isAdmin || me?.admin?.isAdmin);
  const [tab, setTab] = useState<AdminTab>("overview");

  if (meLoading) {
    return (
      <div className="section admin-page">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Admin</h1>
            <p className="p">Загрузка…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/profile" replace />;
  }

  return (
    <div className="section admin-page">
      <div className="card admin-hero">
        <div className="card__body">
          <div className="kicker">Admin panel</div>
          <h1 className="h1">Мини-админка</h1>
          <p className="p">Компактная служебная панель, адаптированная под Telegram WebView.</p>

          <div className="admin-tabsGrid admin-gap-top-md">
            <AdminTabButton active={tab === "overview"} onClick={() => setTab("overview")} title="Обзор" subtitle="Структура" />
            <AdminTabButton active={tab === "broadcasts"} onClick={() => setTab("broadcasts")} title="Broadcasts" subtitle="Новости" />
            <AdminTabButton active={tab === "orderRules"} onClick={() => setTab("orderRules")} title="Заказы" subtitle="Order rules" />
            <AdminTabButton active={tab === "trialProtection"} onClick={() => setTab("trialProtection")} title="Trial Protection" subtitle="Anti-abuse" />
          </div>
        </div>
      </div>

      <div className="admin-content admin-gap-top-md">
        {tab === "overview" ? <OverviewSection onOpenTab={setTab} /> : null}
        {tab === "broadcasts" ? <BroadcastsSection /> : null}
        {tab === "orderRules" ? <OrderRulesSection /> : null}
        {tab === "trialProtection" ? <TrialProtectionSection /> : null}
      </div>
    </div>
  );
}

export default AdminBroadcasts;