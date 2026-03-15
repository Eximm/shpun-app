import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../shared/api/client";
import { PageStatusCard } from "../shared/ui/PageStatusCard";

import { toast } from "../shared/ui/toast";
import { toastApiError } from "../shared/ui/toast/toastApiError";
import { getMood } from "../shared/payments-mood";

import { useMe } from "../app/auth/useMe";
import { normalizeError } from "../shared/api/errorText";
import { useI18n } from "../shared/i18n";

type UiStatus = "active" | "blocked" | "pending" | "not_paid" | "removed" | "error" | "init";

type ApiServiceItem = {
  userServiceId: number;
  serviceId: number;
  title: string;
  descr: string;
  category: string;
  status: UiStatus;
  statusRaw: string;
  createdAt: string | null;
  expireAt: string | null;
  daysLeft: number | null;
  price: number;
  periodMonths: number;
  currency: string;
};

type ApiSummary = {
  total: number;
  active: number;
  blocked: number;
  pending: number;
  notPaid: number;
  expiringSoon: number;
  monthlyCost: number;
  currency: string;
};

type ApiServicesResponse = {
  ok: true;
  items: ApiServiceItem[];
  summary: ApiSummary;
};

type ServiceKind = "amneziawg" | "marzban" | "marzban_router" | "unknown";

function go(url: string) {
  window.location.assign(url);
}

function detectKind(category?: string): ServiceKind {
  if (!category) return "unknown";
  if (category.startsWith("vpn-")) return "amneziawg";
  if (category === "marzban") return "marzban";
  if (category === "marzban-r") return "marzban_router";
  return "unknown";
}

function kindTitle(k: ServiceKind, t: (k: string, fb?: string) => string) {
  switch (k) {
    case "amneziawg":
      return t("services.kind.amneziawg", "AmneziaWG");
    case "marzban":
      return t("services.kind.marzban", "Marzban");
    case "marzban_router":
      return t("services.kind.marzban_router", "Router VPN");
    default:
      return t("services.kind.unknown", "Other");
  }
}

function kindDescr(k: ServiceKind, t: (k: string, fb?: string) => string) {
  switch (k) {
    case "marzban":
      return t("services.kind_descr.marzban", "Subscription for phones, PCs, and tablets.");
    case "marzban_router":
      return t("services.kind_descr.marzban_router", "Separate subscriptions for routers (Shpun Router / OpenWrt).");
    case "amneziawg":
      return t("services.kind_descr.amneziawg", "Simple key for one server.");
    default:
      return t("services.kind_descr.unknown", "Other services.");
  }
}

function statusLabel(s: UiStatus, t: (k: string, fb?: string) => string) {
  switch (s) {
    case "active":
      return t("services.status.active", "Active");
    case "pending":
      return t("services.status.pending", "Connecting");
    case "not_paid":
      return t("services.status.not_paid", "Unpaid");
    case "blocked":
      return t("services.status.blocked", "Blocked");
    case "removed":
      return t("services.status.removed", "Completed");
    case "error":
      return t("services.status.error", "Error");
    case "init":
      return t("services.status.init", "Initializing");
    default:
      return t("services.status.default", "Status");
  }
}

function statusTint(s: UiStatus) {
  switch (s) {
    case "active":
      return { bg: "rgba(34,197,94,.08)", border: "rgba(34,197,94,.28)", stripe: "rgba(34,197,94,.45)" };
    case "pending":
    case "init":
      return { bg: "rgba(59,130,246,.08)", border: "rgba(59,130,246,.28)", stripe: "rgba(59,130,246,.45)" };
    case "not_paid":
      return { bg: "rgba(245,158,11,.08)", border: "rgba(245,158,11,.28)", stripe: "rgba(245,158,11,.45)" };
    case "blocked":
      return { bg: "rgba(245,158,11,.10)", border: "rgba(245,158,11,.32)", stripe: "rgba(245,158,11,.55)" };
    case "error":
      return { bg: "rgba(239,68,68,.08)", border: "rgba(239,68,68,.28)", stripe: "rgba(239,68,68,.50)" };
    case "removed":
      return { bg: "rgba(148,163,184,.06)", border: "rgba(148,163,184,.22)", stripe: "rgba(148,163,184,.28)" };
    default:
      return { bg: "rgba(255,255,255,.02)", border: "rgba(148,163,184,.22)", stripe: "rgba(148,163,184,.22)" };
  }
}

function fmtDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function fmtMoney(n: number, cur: string) {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur || "RUB",
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${v} ${cur || "RUB"}`;
  }
}

function hintText(s: ApiServiceItem, t: (k: string, fb?: string) => string) {
  const left = s.daysLeft;
  if (s.status === "active" && left != null) {
    return left >= 0
      ? t("services.hint.days_left", "About {days} days left.").replace("{days}", String(left))
      : t("services.hint.expired", "Expired");
  }
  if (s.status === "not_paid") return t("services.hint.not_paid", "Payment required");
  if (s.status === "blocked") return t("services.hint.blocked", "Action required");
  if (s.status === "pending") return t("services.hint.pending", "Please wait a little");
  if (s.status === "init") return t("services.hint.init", "Service is being initialized");
  if (s.status === "error") return t("services.hint.error", "Check the status or contact support");
  return "";
}

function statusSortWeight(s: UiStatus) {
  switch (s) {
    case "active":
      return 0;
    case "pending":
      return 1;
    case "not_paid":
      return 2;
    case "blocked":
      return 3;
    case "init":
      return 4;
    case "error":
      return 5;
    case "removed":
      return 6;
    default:
      return 99;
  }
}

function canDeleteStatus(s: UiStatus) {
  if (s === "pending" || s === "init") return false;
  if (s === "removed") return false;
  if (s === "active") return false;
  return true;
}

function canStopStatus(s: UiStatus) {
  return s === "active";
}

function deleteConfirmText(s: ApiServiceItem, t: (k: string, fb?: string) => string) {
  switch (s.status) {
    case "not_paid":
      return t("services.delete_confirm.not_paid", "Delete unpaid order? It will disappear from the list.");
    case "blocked":
      return t("services.delete_confirm.blocked", "Delete service? It will disappear from the list.");
    case "error":
      return t("services.delete_confirm.error", "Delete service? It will disappear from the list.");
    default:
      return t("services.delete_confirm.default", "Delete service?");
  }
}

function Modal({
  title,
  open,
  children,
  confirmText = "Confirm",
  cancelText = "Cancel",
  loading,
  error,
  confirmClassName = "btn btn--primary",
  onClose,
  onConfirm,
  footerHint,
  closeLabel,
}: {
  title: string;
  open: boolean;
  children: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  error?: string | null;
  confirmClassName?: string;
  onClose: () => void;
  onConfirm: () => void;
  footerHint: string;
  closeLabel: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card modal__card">
        <div className="card__body">
          <div className="modal__head">
            <div className="modal__title">{title}</div>
            <button className="btn modal__close" onClick={onClose} aria-label={closeLabel} disabled={!!loading}>
              ✕
            </button>
          </div>

          <div className="modal__content">{children}</div>

          {error ? <div className="pre">{error}</div> : null}

          <div className="actions actions--2">
            <button className="btn" onClick={onClose} disabled={!!loading}>
              {cancelText}
            </button>

            <button className={confirmClassName} onClick={onConfirm} disabled={!!loading}>
              {loading ? "…" : confirmText}
            </button>
          </div>

          <div className="p">{footerHint}</div>
        </div>
      </div>
    </div>
  );
}

const ConnectAmneziaWG = React.lazy(() => import("./connect/ConnectAmneziaWG"));
const ConnectMarzban = React.lazy(() => import("./connect/ConnectMarzban.tsx"));
const ConnectRouter = React.lazy(() => import("./connect/ConnectRouter"));

function ConnectInline({
  kind,
  service,
  onDone,
  t,
}: {
  kind: ServiceKind;
  service: ApiServiceItem;
  onDone?: () => void;
  t: (k: string, fb?: string) => string;
}) {
  return (
    <div className="svc__connect">
      <div className="row svc__connectHead">
        <div className="services-cat__title svc__connectTitle">{t("services.connect.title", "Connection")}</div>
      </div>

      <div className="svc__connectBody">
        <Suspense fallback={<div className="p">{t("services.loading_short", "Loading…")}</div>}>
          {kind === "amneziawg" ? <ConnectAmneziaWG usi={service.userServiceId} service={service} onDone={onDone} /> : null}
          {kind === "marzban" ? <ConnectMarzban usi={service.userServiceId} service={service} onDone={onDone} /> : null}
          {kind === "marzban_router" ? <ConnectRouter usi={service.userServiceId} service={service} onDone={onDone} /> : null}
          {kind === "unknown" ? <div className="pre">{t("services.connect.unavailable", "No connection helper for this service type yet.")}</div> : null}
        </Suspense>
      </div>
    </div>
  );
}

function ServiceCard({
  s,
  expanded,
  connectOpen,
  onToggle,
  onToggleConnect,
  onRefresh,
  onAskDelete,
  onAskStop,
  t,
}: {
  s: ApiServiceItem;
  expanded: boolean;
  connectOpen: boolean;
  onToggle: () => void;
  onToggleConnect: () => void;
  onRefresh: () => void;
  onAskDelete: (s: ApiServiceItem) => void;
  onAskStop: (s: ApiServiceItem) => void;
  t: (k: string, fb?: string) => string;
}) {
  const until = s.expireAt ? fmtDate(s.expireAt) : "";
  const kind = detectKind(s.category);
  const hint = hintText(s, t);

  const payUrl = `/payments?reason=service&usi=${encodeURIComponent(String(s.userServiceId))}`;
  const supportUrl = `/support?topic=service&usi=${encodeURIComponent(String(s.userServiceId))}`;

  const allowDelete = canDeleteStatus(s.status);
  const allowStop = canStopStatus(s.status);

  const canShowConnect = kind !== "unknown" && s.status === "active";

  const compactMeta = (() => {
    const parts: React.ReactNode[] = [];
    if (until) parts.push(<>{t("services.meta.until", "Until")}: <b>{until}</b></>);
    if (hint) parts.push(<>{hint}</>);
    if (parts.length === 0) return "—";
    return (
      <>
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <span className="svc__dot">·</span> : null}
            <span className="svc__metaItem">{p}</span>
          </React.Fragment>
        ))}
      </>
    );
  })();

  const tint = statusTint(s.status);

  return (
    <div
      className="kv__item svc svc--compact"
      style={{
        background: `linear-gradient(180deg, ${tint.bg}, rgba(0,0,0,0))`,
        borderColor: tint.border,
        boxShadow: `inset 3px 0 0 ${tint.stripe}`,
      }}
    >
      <button type="button" className="svc__btn" onClick={onToggle} aria-expanded={expanded}>
        <div className="svc__row">
          <div className="svc__left">
            <div className="svc__status">{statusLabel(s.status, t)}</div>
            <div className="svc__title">
              #{s.userServiceId} — {s.title}
            </div>
            <div className="svc__sub svc__sub--compact">{compactMeta}</div>
          </div>

          <div className="svc__right">
            <span className="badge">
              {fmtMoney(s.price, s.currency)} / {s.periodMonths || 1}{t("services.month_short", "mo")}
            </span>
          </div>
        </div>

        <div className="svc__toggle">
          <b>{expanded ? "▲" : "▼"}</b> {t("services.actions.title", "Actions")}
        </div>
      </button>

      {expanded ? (
        <div className="svc__details">
          {s.status === "active" ? (
            <div className="actions actions--1">
              <button
                className="btn btn--primary"
                onClick={onToggleConnect}
                disabled={!canShowConnect}
                title={!canShowConnect ? t("services.connect.only_active", "Connection is available only for active services.") : t("services.connect.open", "Open connection")}
              >
                {connectOpen ? t("services.connect.hide", "Hide connection") : t("services.connect.button", "Connection")}
              </button>
            </div>
          ) : null}

          {s.status === "not_paid" ? (
            <div className="actions actions--2">
              <button className="btn btn--primary" onClick={() => go(payUrl)}>
                {t("services.pay", "Pay / top up")}
              </button>
              <button className="btn" onClick={onRefresh}>
                {t("services.refresh", "Refresh")}
              </button>
            </div>
          ) : null}

          {s.status === "pending" || s.status === "init" ? (
            <div className="actions actions--1">
              <button className="btn btn--primary" onClick={onRefresh}>
                {t("services.refresh_status", "Refresh status")}
              </button>
            </div>
          ) : null}

          {s.status === "blocked" ? (
            <div className="actions actions--2">
              <button className="btn btn--primary" onClick={() => go(payUrl)}>
                {t("services.topup", "Top up / pay")}
              </button>
              <button className="btn" onClick={() => go(supportUrl)}>
                {t("services.support", "Support")}
              </button>
            </div>
          ) : null}

          {s.status === "error" ? (
            <div className="actions actions--2">
              <button className="btn btn--primary" onClick={onRefresh}>
                {t("services.refresh", "Refresh")}
              </button>
              <button className="btn" onClick={() => go(supportUrl)}>
                {t("services.support", "Support")}
              </button>
            </div>
          ) : null}

          {connectOpen && canShowConnect ? <ConnectInline kind={kind} service={s} onDone={onRefresh} t={t} /> : null}

          {allowStop ? (
            <div className="actions actions--1">
              <button className="btn" onClick={() => onAskStop(s)} title={t("services.stop.title", "Block service")}>
                🛑 {t("services.stop.button", "Block")}
              </button>
            </div>
          ) : null}

          {allowDelete ? (
            <div className="actions actions--1">
              <button className="btn" onClick={() => onAskDelete(s)} title={t("services.delete.title", "Delete service")}>
                🗑️ {t("services.delete.button", "Delete service")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const STORAGE_KEY = "services.groups.v1";

function readGroupsState(): Record<ServiceKind, boolean> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;

    const pick = (k: ServiceKind, def: boolean) => (typeof obj[k] === "boolean" ? obj[k] : def);

    return {
      amneziawg: pick("amneziawg", false),
      marzban: pick("marzban", false),
      marzban_router: pick("marzban_router", false),
      unknown: pick("unknown", false),
    };
  } catch {
    return null;
  }
}

function saveGroupsState(v: Record<ServiceKind, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // ignore
  }
}

function normStatus(s: any): UiStatus {
  const v = String(s || "").toLowerCase();
  if (v === "active" || v === "blocked" || v === "pending" || v === "not_paid" || v === "removed" || v === "error" || v === "init") {
    return v as UiStatus;
  }
  return "error";
}

function nnum(v: any, def = 0) {
  const x = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(x) ? x : def;
}

export function Services() {
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [items, setItems] = useState<ApiServiceItem[]>([]);
  const [summary, setSummary] = useState<ApiSummary | null>(null);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [connectOpenId, setConnectOpenId] = useState<number | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<ApiServiceItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);

  const [stopTarget, setStopTarget] = useState<ApiServiceItem | null>(null);
  const [stopBusy, setStopBusy] = useState(false);
  const [stopError, setStopError] = useState<unknown>(null);

  const [openGroups, setOpenGroups] = useState<Record<ServiceKind, boolean>>(() => {
    return (
      readGroupsState() ?? {
        amneziawg: false,
        marzban: false,
        marzban_router: false,
        unknown: false,
      }
    );
  });

  const { me } = useMe();
  const discountPercent = Math.max(0, nnum((me as any)?.discount, 0));

  useEffect(() => {
    saveGroupsState(openGroups);
  }, [openGroups]);

  const prevStatusesRef = useRef<Map<number, UiStatus> | null>(null);
  const statusInitRef = useRef(false);

  async function load(opts?: { silent?: boolean; toastOnSuccess?: boolean }) {
    const silent = !!opts?.silent;
    const toastOnSuccess = !!opts?.toastOnSuccess;

    if (!silent) setLoading(true);
    setError(null);

    try {
      const r = (await apiFetch("/services", { method: "GET" })) as ApiServicesResponse;
      const newItems = r.items || [];

      setItems(newItems);
      setSummary(r.summary || null);

      if (toastOnSuccess) {
        toast.info(t("services.toast.updated", "Updated"), {
          description: getMood("payment_checking", { seed: String(newItems.length) }) ?? t("services.toast.updated_desc", "Service statuses updated."),
        });
      }
    } catch (e: unknown) {
      setError(e);
      if (!silent) toastApiError(e, { title: t("services.toast.refresh_failed", "Could not refresh") });
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function stopService(userServiceId: number) {
    await apiFetch(`/services/${encodeURIComponent(String(userServiceId))}/stop`, { method: "POST" });
  }

  async function deleteService(userServiceId: number) {
    await apiFetch(`/services/${encodeURIComponent(String(userServiceId))}`, { method: "DELETE" });
  }

  async function onConfirmStop() {
    if (!stopTarget || stopBusy) return;
    setStopBusy(true);
    setStopError(null);

    const usi = stopTarget.userServiceId;

    try {
      await stopService(usi);
      setStopTarget(null);
      setExpandedId(usi);

      toast.success(t("services.toast.blocked", "Blocked"), {
        description: getMood("payment_success", { seed: String(usi) }) ?? t("services.toast.blocked_desc", "Service has been blocked."),
      });

      await load({ silent: true });
    } catch (e: unknown) {
      setStopError(e);
      toastApiError(e, { title: t("services.toast.block_failed", "Could not block") });
    } finally {
      setStopBusy(false);
    }
  }

  async function onConfirmDelete() {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);

    const usi = deleteTarget.userServiceId;

    try {
      await deleteService(usi);
      setDeleteTarget(null);
      setExpandedId((cur) => (cur === usi ? null : cur));
      setConnectOpenId((cur) => (cur === usi ? null : cur));

      toast.success(t("services.toast.deleted", "Service deleted"), {
        description: getMood("payment_success", { seed: String(usi) }) ?? t("services.toast.deleted_desc", "Done. Service was removed from the list."),
      });

      await load({ silent: true });
    } catch (e: unknown) {
      setDeleteError(e);
      toastApiError(e, { title: t("services.toast.delete_failed", "Could not delete") });
    } finally {
      setDeleteBusy(false);
    }
  }

  useEffect(() => {
    load({ silent: false, toastOnSuccess: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const cur = new Map<number, UiStatus>();
    for (const it of items || []) cur.set(it.userServiceId, normStatus(it.status));

    if (!statusInitRef.current) {
      prevStatusesRef.current = cur;
      statusInitRef.current = true;
      return;
    }

    const prev = prevStatusesRef.current || new Map<number, UiStatus>();

    for (const it of items || []) {
      const id = it.userServiceId;
      const before = prev.get(id);
      const after = cur.get(id);

      if (!before || !after || before === after) continue;

      const title = it.title ? it.title : `${t("services.item", "Service")} #${id}`;
      const seed = String(id);

      if (after === "blocked") {
        toast.error(title, { description: t("services.toast.service_blocked", "Service is blocked. Action required.") });
      } else if (after === "not_paid") {
        toast.info(title, { description: t("services.toast.service_not_paid", "Payment required.") });
      } else if (after === "active" && (before === "pending" || before === "not_paid" || before === "blocked" || before === "init")) {
        toast.success(title, { description: getMood("payment_success", { seed }) ?? t("services.toast.service_active", "Service activated.") });
      } else if (after === "removed") {
        toast.success(title, { description: getMood("payment_success", { seed }) ?? t("services.toast.service_removed", "Service completed.") });
      }
    }

    prevStatusesRef.current = cur;
  }, [items, t]);

  const groups = useMemo(() => {
    const byKind: Record<ServiceKind, ApiServiceItem[]> = {
      amneziawg: [],
      marzban: [],
      marzban_router: [],
      unknown: [],
    };

    for (const it of items) byKind[detectKind(it.category)].push(it);

    const sortFn = (a: ApiServiceItem, b: ApiServiceItem) => {
      const wa = statusSortWeight(a.status);
      const wb = statusSortWeight(b.status);
      if (wa !== wb) return wa - wb;
      return (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999);
    };

    (Object.keys(byKind) as ServiceKind[]).forEach((k) => byKind[k].sort(sortFn));
    return byKind;
  }, [items]);

  if (loading) {
    return (
      <div className="section">
        <div className="page-status">
          <PageStatusCard title={t("services.title", "Services")} text={t("services.loading", "Loading...")} />
        </div>
      </div>
    );
  }

  if (error) {
    const n = normalizeError(error, { title: t("services.title", "Services") });

    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("services.title", "Services")}</h1>
            <p className="p">{n.description ?? t("services.error.text", "Could not load services list. Please try again.")}</p>
            <div className="actions actions--1">
              <button className="btn btn--primary" onClick={() => load({ silent: false, toastOnSuccess: false })}>
                {t("services.retry", "Retry")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const s = summary;
  const fallbackActive = items.filter((x) => x.status === "active").length;
  const fallbackAttention = items.filter((x) => x.status === "blocked" || x.status === "not_paid").length;

  const toggleGroup = (kind: ServiceKind) => {
    setOpenGroups((cur) => ({ ...cur, [kind]: !cur[kind] }));
  };

  const Section = ({ kind }: { kind: ServiceKind }) => {
    const arr = groups[kind];
    if (!arr || arr.length === 0) return null;

    const open = !!openGroups[kind];

    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <button
              type="button"
              className="services-cat__head services-cat__head--toggle"
              onClick={() => toggleGroup(kind)}
              aria-expanded={open}
            >
              <div className="services-cat__headLeft">
                <div className="services-cat__titleRow">
                  <div className="services-cat__title">{kindTitle(kind, t)}</div>
                  <span className="services-cat__chev" aria-hidden>
                    {open ? "▲" : "▼"}
                  </span>
                </div>
                <p className="p">{kindDescr(kind, t)}</p>
              </div>

              <span className="badge">{arr.length}</span>
            </button>

            {open ? (
              <div className="kv">
                {arr.map((x) => (
                  <ServiceCard
                    key={x.userServiceId}
                    s={x}
                    expanded={expandedId === x.userServiceId}
                    connectOpen={connectOpenId === x.userServiceId}
                    onToggle={() => {
                      setExpandedId((cur) => (cur === x.userServiceId ? null : x.userServiceId));
                      setConnectOpenId((cur) => (cur === x.userServiceId ? null : cur));
                    }}
                    onToggleConnect={() => {
                      setExpandedId(x.userServiceId);
                      setConnectOpenId((cur) => (cur === x.userServiceId ? null : x.userServiceId));
                    }}
                    onRefresh={() => load({ silent: false, toastOnSuccess: false })}
                    onAskDelete={(svc) => {
                      setDeleteError(null);
                      setDeleteTarget(svc);
                    }}
                    onAskStop={(svc) => {
                      setStopError(null);
                      setStopTarget(svc);
                    }}
                    t={t}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const stopErrText = stopError ? normalizeError(stopError, { title: t("services.toast.block_failed", "Could not block") }).description : null;
  const deleteErrText = deleteError ? normalizeError(deleteError, { title: t("services.toast.delete_failed", "Could not delete") }).description : null;

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div className="services-top">
            <div className="services-top__left">
              <div className="services-top__title">{t("services.title", "Services")}</div>
              <div className="services-top__sub">{t("services.sub", "Your services and their current status.")}</div>
            </div>
          </div>

          <div className="services-head__meta services-head__meta--wide">
            <span className="badge">
              {t("services.meta.active", "Active")}: <b>{s?.active ?? fallbackActive}</b>
            </span>
            <span className="badge">
              {t("services.meta.attention", "Attention")}: <b>{(s?.blocked ?? 0) + (s?.notPaid ?? 0) || fallbackAttention}</b>
            </span>
            <span className="badge">
              {t("services.meta.monthly", "Per month")}: <b>{fmtMoney(s?.monthlyCost ?? 0, s?.currency ?? "RUB")}</b>
            </span>

            {discountPercent > 0 ? (
              <span className="badge">
                {t("services.meta.discount", "Discount")}: <b>-{Math.round(discountPercent)}%</b>
              </span>
            ) : null}
          </div>

          <div className="services-head__actions">
            <button className="btn btn--primary services-head__cta" onClick={() => go("/services/order")}>
              {t("services.order", "Order")}
            </button>

            <button
              className="btn services-head__cta"
              onClick={() => load({ silent: false, toastOnSuccess: true })}
              title={t("services.refresh_status", "Refresh status")}
            >
              {t("services.refresh", "Refresh")}
            </button>
          </div>
        </div>
      </div>

      <Section kind="amneziawg" />
      <Section kind="marzban" />
      <Section kind="marzban_router" />
      <Section kind="unknown" />

      <Modal
        title={
          stopTarget
            ? t("services.modal.stop.title_named", "Block service “{title}”?").replace("{title}", stopTarget.title)
            : t("services.modal.stop.title", "Block service?")
        }
        open={!!stopTarget}
        loading={stopBusy}
        error={stopErrText}
        onClose={() => {
          if (stopBusy) return;
          setStopTarget(null);
          setStopError(null);
        }}
        onConfirm={onConfirmStop}
        confirmText={t("services.stop.button", "Block")}
        cancelText={t("services.cancel", "Cancel")}
        confirmClassName="btn btn--primary"
        footerHint={t("services.modal.footer_hint", "If you are unsure, first check the service status or contact support.")}
        closeLabel={t("services.close", "Close")}
      >
        {stopTarget ? (
          <>
            <div className="p">
              <b>{t("services.modal.stop.what_happens", "What will happen:")}</b>
            </div>

            <div className="p">
              {t("services.modal.stop.text", "We will block service “{title}”. After that it will stop working.").replace("{title}", stopTarget.title)}
            </div>

            <div className="pre">
              <div>⚠️ {t("services.modal.stop.warn1", "You cannot unblock it yourself.")}</div>
              <div>{t("services.modal.stop.warn2", "If you need access again, contact support.")}</div>
            </div>

            <div className="pre">
              <div>
                {t("services.modal.status", "Status")}: <b>{statusLabel(stopTarget.status, t)}</b>
              </div>
              <div>
                {t("services.modal.type", "Type")}: <b>{kindTitle(detectKind(stopTarget.category), t)}</b>
              </div>
              <div>
                {t("services.modal.plan", "Plan")}: <b>{fmtMoney(stopTarget.price, stopTarget.currency)}</b> / {stopTarget.periodMonths || 1}{t("services.month_short", "mo")}
              </div>
              {stopTarget.expireAt ? (
                <div>
                  {t("services.modal.until", "Active until")}: <b>{fmtDate(stopTarget.expireAt)}</b>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </Modal>

      <Modal
        title={
          deleteTarget
            ? t("services.modal.delete.title_named", "Delete service “{title}”?").replace("{title}", deleteTarget.title)
            : t("services.modal.delete.title", "Delete service?")
        }
        open={!!deleteTarget}
        loading={deleteBusy}
        error={deleteErrText}
        onClose={() => {
          if (deleteBusy) return;
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={onConfirmDelete}
        confirmText={t("services.delete.confirm", "Delete")}
        cancelText={t("services.cancel", "Cancel")}
        confirmClassName="btn btn--primary"
        footerHint={t("services.modal.footer_hint", "If you are unsure, first check the service status or contact support.")}
        closeLabel={t("services.close", "Close")}
      >
        {deleteTarget ? (
          <>
            <div className="p">
              <b>{t("services.modal.delete.confirm_title", "Delete confirmation")}</b>
            </div>

            <div className="p">{deleteConfirmText(deleteTarget, t)}</div>

            <div className="pre">
              <div>
                {t("services.modal.status", "Status")}: <b>{statusLabel(deleteTarget.status, t)}</b>
              </div>
              <div>
                {t("services.modal.type", "Type")}: <b>{kindTitle(detectKind(deleteTarget.category), t)}</b>
              </div>
              <div>
                {t("services.modal.plan", "Plan")}: <b>{fmtMoney(deleteTarget.price, deleteTarget.currency)}</b> / {deleteTarget.periodMonths || 1}{t("services.month_short", "mo")}
              </div>
              {deleteTarget.expireAt ? (
                <div>
                  {t("services.modal.until", "Active until")}: <b>{fmtDate(deleteTarget.expireAt)}</b>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  );
}