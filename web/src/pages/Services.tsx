// FILE: web/src/pages/Services.tsx

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../shared/api/client";
import { toast } from "../shared/ui/toast";
import { toastApiError } from "../shared/ui/toast/toastApiError";
import { useMe } from "../app/auth/useMe";
import { normalizeError } from "../shared/api/errorText";
import { getMood } from "../shared/payments-mood";
import { useI18n } from "../shared/i18n";

/* ─── Types ─────────────────────────────────────────────────────────────── */

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
  parent?: number | null; // user_service_id родительской услуги (может отсутствовать)
};

type ApiSummary = {
  total: number; active: number; blocked: number; pending: number;
  notPaid: number; expiringSoon: number; monthlyCost: number; currency: string;
};

type ApiServicesResponse = { ok: true; items: ApiServiceItem[]; summary: ApiSummary };
type ServiceKind = "amneziawg" | "marzban" | "marzban_router" | "unknown";

/* ─── Utils ─────────────────────────────────────────────────────────────── */

type T = (k: string, fb?: string) => string;

function go(url: string) { window.location.assign(url); }

function detectKind(category?: string): ServiceKind {
  if (!category) return "unknown";
  if (category.startsWith("vpn-")) return "amneziawg";
  if (category === "marzban" || category.startsWith("marzban-")) {
    return category === "marzban-r" ? "marzban_router" : "marzban";
  }
  return "unknown";
}

function isWhiteListCategory(category?: string) { return category === "marzban-wl"; }

function kindTitle(k: ServiceKind, t: T) {
  switch (k) {
    case "amneziawg":      return t("services.kind.amneziawg",     "AmneziaWG");
    case "marzban":        return t("services.kind.marzban",        "Marzban");
    case "marzban_router": return t("services.kind.marzban_router", "Router VPN");
    default:               return t("services.kind.unknown",        "Другое");
  }
}

function kindDescr(k: ServiceKind, t: T) {
  switch (k) {
    case "marzban":        return t("services.kind_descr.marzban",        "Подписка для телефонов, ПК и планшетов.");
    case "marzban_router": return t("services.kind_descr.marzban_router", "Отдельные подписки для роутеров (Shpun Router / OpenWrt).");
    case "amneziawg":      return t("services.kind_descr.amneziawg",      "Простой ключ для одного сервера.");
    default:               return t("services.kind_descr.unknown",        "Другие услуги.");
  }
}

function kindIcon(k: ServiceKind): string {
  switch (k) {
    case "marzban":        return "🛰️";
    case "marzban_router": return "📡";
    case "amneziawg":      return "🔑";
    default:               return "📦";
  }
}

function statusLabel(s: UiStatus, t: T) {
  switch (s) {
    case "active":   return t("services.status.active",   "Активна");
    case "pending":  return t("services.status.pending",  "Подключается");
    case "not_paid": return t("services.status.not_paid", "Не оплачена");
    case "blocked":  return t("services.status.blocked",  "Заблокирована");
    case "removed":  return t("services.status.removed",  "Завершена");
    case "error":    return t("services.status.error",    "Ошибка");
    case "init":     return t("services.status.init",     "Инициализация");
    default:         return t("services.status.default",  "Статус");
  }
}

function statusTint(s: UiStatus) {
  switch (s) {
    case "active":
      return { bg: "rgba(43,227,143,.06)", border: "rgba(43,227,143,.22)", stripe: "#2be38f", chipBg: "rgba(43,227,143,.12)", chipBorder: "rgba(43,227,143,.28)", chipColor: "#2be38f" };
    case "pending":
    case "init":
      return { bg: "rgba(59,130,246,.06)", border: "rgba(59,130,246,.22)", stripe: "#3b82f6", chipBg: "rgba(59,130,246,.12)", chipBorder: "rgba(59,130,246,.28)", chipColor: "#93c5fd" };
    case "not_paid":
      return { bg: "rgba(245,158,11,.06)", border: "rgba(245,158,11,.22)", stripe: "#f59e0b", chipBg: "rgba(245,158,11,.12)", chipBorder: "rgba(245,158,11,.28)", chipColor: "#f59e0b" };
    case "blocked":
      return { bg: "rgba(245,158,11,.08)", border: "rgba(245,158,11,.28)", stripe: "#f59e0b", chipBg: "rgba(245,158,11,.12)", chipBorder: "rgba(245,158,11,.30)", chipColor: "#f59e0b" };
    case "error":
      return { bg: "rgba(255,77,109,.06)", border: "rgba(255,77,109,.22)", stripe: "#ff4d6d", chipBg: "rgba(255,77,109,.12)", chipBorder: "rgba(255,77,109,.28)", chipColor: "#ff4d6d" };
    default:
      return { bg: "rgba(255,255,255,.03)", border: "rgba(255,255,255,.09)", stripe: "rgba(255,255,255,.20)", chipBg: "rgba(255,255,255,.06)", chipBorder: "rgba(255,255,255,.12)", chipColor: "rgba(255,255,255,.55)" };
  }
}

function fmtDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function fmtMoney(n: number, cur: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "RUB", maximumFractionDigits: 0 }).format(Number(n || 0)); }
  catch { return `${n} ${cur || "RUB"}`; }
}

function daysLeftText(s: ApiServiceItem, t: T) {
  const left = s.daysLeft;
  if (s.status === "active" && left != null)
    return left >= 0
      ? t("services.hint.days_left", "Осталось ~{days} дн.").replace("{days}", String(left))
      : t("services.hint.expired", "Истекла");
  if (s.status === "not_paid") return t("services.hint.not_paid", "Требуется оплата");
  if (s.status === "blocked")  return t("services.hint.blocked",  "Требуется действие");
  if (s.status === "pending")  return t("services.hint.pending",  "Подождите немного");
  if (s.status === "init")     return t("services.hint.init",     "Инициализируется");
  if (s.status === "error")    return t("services.hint.error",    "Проверьте статус");
  return "";
}

function statusSortWeight(s: UiStatus) {
  const w: Record<UiStatus, number> = { active: 0, pending: 1, not_paid: 2, blocked: 3, init: 4, error: 5, removed: 6 };
  return w[s] ?? 99;
}

function canDeleteStatus(s: UiStatus) { return !["pending", "init", "removed", "active"].includes(s); }
function canStopStatus(s: UiStatus)   { return s === "active"; }

function deleteConfirmText(s: ApiServiceItem, t: T) {
  if (s.status === "not_paid") return t("services.delete_confirm.not_paid", "Удалить неоплаченный заказ? Он исчезнет из списка.");
  if (s.status === "blocked")  return t("services.delete_confirm.blocked",  "Удалить услугу? Она исчезнет из списка.");
  if (s.status === "error")    return t("services.delete_confirm.error",    "Удалить услугу? Она исчезнет из списка.");
  return t("services.delete_confirm.default", "Удалить услугу?");
}

function normStatus(s: any): UiStatus {
  const v = String(s || "").toLowerCase();
  const valid: UiStatus[] = ["active", "blocked", "pending", "not_paid", "removed", "error", "init"];
  return valid.includes(v as UiStatus) ? (v as UiStatus) : "error";
}

function nnum(v: any, def = 0) {
  const x = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(x) ? x : def;
}

/* ─── Lazy connect components ────────────────────────────────────────────── */

const ConnectAmneziaWG = React.lazy(() => import("./connect/ConnectAmneziaWG"));
const ConnectMarzban   = React.lazy(() => import("./connect/ConnectMarzban.tsx"));
const ConnectRouter    = React.lazy(() => import("./connect/ConnectRouter"));

/* ─── Progress bar ───────────────────────────────────────────────────────── */

function DaysProgress({ daysLeft, periodMonths }: { daysLeft: number | null; periodMonths: number }) {
  if (daysLeft == null || daysLeft < 0) return null;
  const total = (periodMonths || 1) * 30;
  const pct   = Math.min(100, Math.max(0, Math.round((daysLeft / total) * 100)));
  const color = daysLeft <= 5 ? "#f59e0b" : daysLeft <= 10 ? "#f59e0b" : "#2be38f";
  return (
    <div style={{ height: 3, borderRadius: 99, background: "rgba(255,255,255,.08)", overflow: "hidden", margin: "6px 0 0" }}>
      <div style={{ height: "100%", width: `${pct}%`, borderRadius: 99, background: color, transition: "width 500ms ease" }} />
    </div>
  );
}

/* ─── PaymentSuccessModal ────────────────────────────────────────────────── */

function PaymentSuccessModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(onClose, 5000);
    return () => window.clearTimeout(t);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" className="modal" onMouseDown={onClose}>
      <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()} style={{ textAlign: "center" }}>
        <div className="card__body">
          <div style={{ fontSize: 52, marginBottom: 8 }}>✅</div>
          <div className="h1" style={{ fontSize: 20, marginBottom: 8 }}>Оплата прошла успешно</div>
          <p className="p" style={{ opacity: 0.75 }}>Баланс пополнен. Услуги обновятся автоматически — это может занять несколько секунд.</p>
          <button className="btn btn--primary" type="button" onClick={onClose} style={{ marginTop: 20, width: "100%" }}>Отлично</button>
          <p className="p" style={{ marginTop: 10, opacity: 0.4, fontSize: 12 }}>Закроется автоматически через несколько секунд</p>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ─── Modal ─────────────────────────────────────────────────────────────── */

function Modal({ title, open, children, confirmText = "ОК", cancelText = "Отмена", loading, error,
  confirmClassName = "btn btn--primary", onClose, onConfirm, footerHint, closeLabel }: {
  title: string; open: boolean; children: React.ReactNode; confirmText?: string; cancelText?: string;
  loading?: boolean; error?: string | null; confirmClassName?: string;
  onClose: () => void; onConfirm: () => void; footerHint: string; closeLabel: string;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card modal__card">
        <div className="card__body">
          <div className="modal__head">
            <div className="modal__title">{title}</div>
            <button className="btn modal__close" onClick={onClose} aria-label={closeLabel} disabled={!!loading}>✕</button>
          </div>
          <div className="modal__content">{children}</div>
          {error ? <div className="pre" style={{ marginTop: 12, borderColor: "rgba(255,77,109,0.30)" }}>{error}</div> : null}
          <div className="actions actions--2" style={{ marginTop: 14 }}>
            <button className="btn" onClick={onClose} disabled={!!loading}>{cancelText}</button>
            <button className={confirmClassName} onClick={onConfirm} disabled={!!loading}>{loading ? "…" : confirmText}</button>
          </div>
          <p className="p" style={{ opacity: 0.55, fontSize: 12, marginTop: 8 }}>{footerHint}</p>
        </div>
      </div>
    </div>
  );
}

/* ─── ConnectInline ──────────────────────────────────────────────────────── */

function ConnectInline({ kind, service, onDone, t }: { kind: ServiceKind; service: ApiServiceItem; onDone?: () => void; t: T }) {
  return (
    <div className="svc__connect">
      <div className="row svc__connectHead">
        <div className="services-cat__title svc__connectTitle">{t("services.connect.title", "Подключение")}</div>
      </div>
      <div className="svc__connectBody">
        <Suspense fallback={<p className="p">{t("services.loading_short", "Загружаем…")}</p>}>
          {kind === "amneziawg"      ? <ConnectAmneziaWG usi={service.userServiceId} service={service} onDone={onDone} /> : null}
          {kind === "marzban"        ? <ConnectMarzban   usi={service.userServiceId} service={service} onDone={onDone} /> : null}
          {kind === "marzban_router" ? <ConnectRouter    usi={service.userServiceId} service={service} onDone={onDone} /> : null}
          {kind === "unknown" ? <div className="pre">{t("services.connect.unavailable", "Для этого типа услуги подключение пока недоступно.")}</div> : null}
        </Suspense>
      </div>
    </div>
  );
}

/* ─── ServiceRow — одна услуга ───────────────────────────────────────────── */

function ServiceRow({ s, expanded, connectOpen, onToggle, onToggleConnect, onRefresh, onAskDelete, onAskStop, t, isChild = false }: {
  s: ApiServiceItem; expanded: boolean; connectOpen: boolean; isChild?: boolean;
  onToggle: () => void; onToggleConnect: () => void; onRefresh: () => void;
  onAskDelete: (s: ApiServiceItem) => void; onAskStop: (s: ApiServiceItem) => void; t: T;
}) {
  const tint       = statusTint(s.status);
  const kind       = detectKind(s.category);
  const canConnect = kind !== "unknown" && s.status === "active";
  const hint       = daysLeftText(s, t);
  const until      = s.expireAt ? fmtDate(s.expireAt) : "";
  const payUrl     = `/payments?reason=service&usi=${encodeURIComponent(String(s.userServiceId))}`;
  const supportUrl = `/support?topic=service&usi=${encodeURIComponent(String(s.userServiceId))}`;

  return (
    <div style={{
      borderRadius: isChild ? "0 0 11px 11px" : 11,
      background: tint.bg,
      border: isChild ? "none" : `.5px solid ${tint.border}`,
    }}>

      {/* Заголовок — кликабельный */}
      <button type="button" onClick={onToggle} aria-expanded={expanded} style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: isChild ? "10px 12px" : "10px 12px",
        background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
      }}>
        {/* Цветная полоска */}
        <div style={{ width: 3, height: 36, borderRadius: 99, flexShrink: 0, background: tint.stripe }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{ display: "inline-flex", padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 800, background: tint.chipBg, border: `.5px solid ${tint.chipBorder}`, color: tint.chipColor, whiteSpace: "nowrap" }}>
              {statusLabel(s.status, t)}
            </span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(255,255,255,.90)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            #{s.userServiceId} — {s.title}
          </div>
          {(until || hint) && (
            <div style={{ fontSize: 10, color: "rgba(255,255,255,.40)", marginTop: 2 }}>
              {until ? `До: ${until}` : ""}{until && hint ? " · " : ""}{hint}
            </div>
          )}
          {s.status === "active" && <DaysProgress daysLeft={s.daysLeft} periodMonths={s.periodMonths} />}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,.45)", whiteSpace: "nowrap" }}>
            {fmtMoney(s.price, s.currency)} / {s.periodMonths || 1}{t("services.month_short", "м")}
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,.30)" }}>{expanded ? "▲" : "▼"}</div>
        </div>
      </button>

      {/* Действия */}
      {expanded && (
        <div style={{ padding: "0 12px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
          {s.descr ? <p className="p" style={{ marginTop: 0, marginBottom: 2, fontSize: 12 }}>{s.descr}</p> : null}

          {isChild && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              padding: "8px 10px", borderRadius: 9,
              background: "rgba(96,165,250,0.07)",
              border: "0.5px solid rgba(96,165,250,0.22)",
            }}>
              <span style={{ fontSize: 14, flexShrink: 0, lineHeight: 1.4 }}>🔁</span>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", lineHeight: 1.45 }}>
                <b style={{ color: "rgba(147,197,253,0.90)" }}>Доп. ключ</b> — работает только совместно с основным.
                Используйте как резерв, если основной ключ не работает в вашей сети или регионе.
              </div>
            </div>
          )}

          {s.status === "active" && (
            <button className="btn btn--primary" onClick={onToggleConnect} disabled={!canConnect} type="button" style={{ width: "100%", fontWeight: 800 }}>
              {connectOpen ? t("services.connect.hide", "Скрыть подключение") : t("services.connect.button", "Как подключиться")}
            </button>
          )}
          {s.status === "not_paid" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <button className="btn btn--primary" onClick={() => go(payUrl)} type="button">💳 {t("services.pay", "Оплатить")}</button>
              <button className="btn" onClick={onRefresh} type="button">↻ {t("services.refresh", "Обновить")}</button>
            </div>
          )}
          {(s.status === "pending" || s.status === "init") && (
            <button className="btn btn--primary" onClick={onRefresh} type="button" style={{ width: "100%" }}>↻ {t("services.refresh_status", "Обновить статус")}</button>
          )}
          {s.status === "blocked" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <button className="btn btn--primary" onClick={() => go(payUrl)} type="button">💳 {t("services.topup", "Оплатить")}</button>
              <button className="btn" onClick={() => go(supportUrl)} type="button">🛟 {t("services.support", "Поддержка")}</button>
            </div>
          )}
          {s.status === "error" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <button className="btn btn--primary" onClick={onRefresh} type="button">↻ {t("services.refresh", "Обновить")}</button>
              <button className="btn" onClick={() => go(supportUrl)} type="button">🛟 {t("services.support", "Поддержка")}</button>
            </div>
          )}

          {connectOpen && canConnect && <ConnectInline kind={kind} service={s} onDone={onRefresh} t={t} />}

          {!isChild && canStopStatus(s.status) && (
            <button className="btn" onClick={() => onAskStop(s)} type="button" style={{ width: "100%", fontSize: 11, color: "rgba(255,255,255,.40)", borderColor: "rgba(255,255,255,.08)" }}>
              🛑 {t("services.stop.button", "Заблокировать")}
            </button>
          )}
          {!isChild && canDeleteStatus(s.status) && (
            <button className="btn btn--danger" onClick={() => onAskDelete(s)} type="button" style={{ width: "100%" }}>
              🗑️ {t("services.delete.button", "Удалить услугу")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── ServiceCard — основная карточка, может содержать WL ───────────────── */

function ServiceCard({ main, children, expandedId, connectOpenId, onToggle, onToggleConnect, onRefresh, onAskDelete, onAskStop, t }: {
  main: ApiServiceItem; children: ApiServiceItem[];
  expandedId: number | null; connectOpenId: number | null;
  onToggle: (id: number) => void; onToggleConnect: (id: number) => void; onRefresh: () => void;
  onAskDelete: (s: ApiServiceItem) => void; onAskStop: (s: ApiServiceItem) => void; t: T;
}) {
  const tint = statusTint(main.status);
  const hasWL = children.length > 0;

  return (
    <div style={{
      borderRadius: 12,
      background: tint.bg,
      border: `.5px solid ${tint.border}`,
      overflow: "hidden",
    }}>
      {/* Основная услуга */}
      <ServiceRow
        s={main}
        expanded={expandedId === main.userServiceId}
        connectOpen={connectOpenId === main.userServiceId}
        onToggle={() => onToggle(main.userServiceId)}
        onToggleConnect={() => onToggleConnect(main.userServiceId)}
        onRefresh={onRefresh}
        onAskDelete={onAskDelete}
        onAskStop={onAskStop}
        t={t}
      />

      {/* WL дочерние ключи */}
      {hasWL && children.map((child) => (
        <React.Fragment key={child.userServiceId}>
          {/* Разделитель с меткой */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", margin: "2px 0" }}>
            <div style={{ flex: 1, height: ".5px", background: "rgba(96,165,250,.20)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 800, color: "rgba(96,165,250,.65)", textTransform: "uppercase", letterSpacing: ".08em" }}>
              <span>🔁</span>
              <span>Доп. ключ · резерв для сложных сетей</span>
            </div>
            <div style={{ flex: 1, height: ".5px", background: "rgba(96,165,250,.20)" }} />
          </div>

          {/* Дочерняя карточка */}
          <div style={{ background: "rgba(96,165,250,.04)" }}>
            <ServiceRow
              s={child}
              isChild
              expanded={expandedId === child.userServiceId}
              connectOpen={connectOpenId === child.userServiceId}
              onToggle={() => onToggle(child.userServiceId)}
              onToggleConnect={() => onToggleConnect(child.userServiceId)}
              onRefresh={onRefresh}
              onAskDelete={onAskDelete}
              onAskStop={onAskStop}
              t={t}
            />
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ─── Groups state ───────────────────────────────────────────────────────── */

const STORAGE_KEY = "services.groups.v1";

function readGroupsState(): Record<ServiceKind, boolean> | null {
  try {
    const obj = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!obj || typeof obj !== "object") return null;
    const pick = (k: ServiceKind, def: boolean) => typeof obj[k] === "boolean" ? obj[k] : def;
    return { amneziawg: pick("amneziawg", false), marzban: pick("marzban", true), marzban_router: pick("marzban_router", false), unknown: pick("unknown", false) };
  } catch { return null; }
}

function saveGroupsState(v: Record<ServiceKind, boolean>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}

/* ─── Services page ──────────────────────────────────────────────────────── */

export function Services() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();

  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<unknown>(null);
  const [items,    setItems]    = useState<ApiServiceItem[]>([]);
  const [summary,  setSummary]  = useState<ApiSummary | null>(null);

  const [expandedId,    setExpandedId]    = useState<number | null>(null);
  const [connectOpenId, setConnectOpenId] = useState<number | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<ApiServiceItem | null>(null);
  const [deleteBusy,   setDeleteBusy]   = useState(false);
  const [deleteError,  setDeleteError]  = useState<unknown>(null);

  const [stopTarget, setStopTarget] = useState<ApiServiceItem | null>(null);
  const [stopBusy,   setStopBusy]   = useState(false);
  const [stopError,  setStopError]  = useState<unknown>(null);

  const [openGroups, setOpenGroups] = useState<Record<ServiceKind, boolean>>(
    () => readGroupsState() ?? { amneziawg: false, marzban: true, marzban_router: false, unknown: false }
  );

  const [paySuccessOpen, setPaySuccessOpen] = useState<boolean>(() => {
    try { return new URLSearchParams(window.location.search).get("payment") === "success"; }
    catch { return false; }
  });

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    if (sp.get("payment") === "success") {
      sp.delete("payment");
      const next = sp.toString();
      navigate(location.pathname + (next ? `?${next}` : ""), { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { me } = useMe();
  const discountPercent = Math.max(0, nnum((me as any)?.discount, 0));

  useEffect(() => { saveGroupsState(openGroups); }, [openGroups]);

  const prevStatusesRef = useRef<Map<number, UiStatus> | null>(null);
  const statusInitRef   = useRef(false);

  async function load(opts?: { silent?: boolean; toastOnSuccess?: boolean }) {
    const silent         = !!opts?.silent;
    const toastOnSuccess = !!opts?.toastOnSuccess;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const r = await apiFetch("/services", { method: "GET" }) as ApiServicesResponse;
      setItems(r.items || []);
      setSummary(r.summary || null);
      if (toastOnSuccess) toast.info("🔄 Обновили", { description: getMood("service_status_updated") ?? "Статусы услуг актуальны." });
    } catch (e) {
      setError(e);
      if (!silent) toastApiError(e, { title: t("services.toast.refresh_failed", "Не удалось обновить") });
    } finally { if (!silent) setLoading(false); }
  }

  async function onConfirmStop() {
    if (!stopTarget || stopBusy) return;
    setStopBusy(true); setStopError(null);
    try {
      await apiFetch(`/services/${encodeURIComponent(String(stopTarget.userServiceId))}/stop`, { method: "POST" });
      setStopTarget(null);
      toast.success("🔒 Заблокировано", { description: getMood("service_blocked") ?? "Услуга на паузе." });
      await load({ silent: true });
    } catch (e) { setStopError(e); toastApiError(e, { title: t("services.toast.block_failed", "Не удалось заблокировать") }); }
    finally { setStopBusy(false); }
  }

  async function onConfirmDelete() {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true); setDeleteError(null);
    const usi = deleteTarget.userServiceId;
    try {
      await apiFetch(`/services/${encodeURIComponent(String(usi))}`, { method: "DELETE" });
      setDeleteTarget(null);
      setExpandedId((cur) => cur === usi ? null : cur);
      setConnectOpenId((cur) => cur === usi ? null : cur);
      toast.success(getMood("service_removed") ?? "🗑️ Удалено", { description: "Услуга убрана из списка." });
      await load({ silent: true });
    } catch (e) { setDeleteError(e); toastApiError(e, { title: t("services.toast.delete_failed", "Не удалось удалить") }); }
    finally { setDeleteBusy(false); }
  }

  useEffect(() => { void load({ silent: false }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cur = new Map<number, UiStatus>();
    for (const it of items) cur.set(it.userServiceId, normStatus(it.status));
    if (!statusInitRef.current) { prevStatusesRef.current = cur; statusInitRef.current = true; return; }
    const prev = prevStatusesRef.current || new Map<number, UiStatus>();
    for (const it of items) {
      const before = prev.get(it.userServiceId); const after = cur.get(it.userServiceId);
      if (!before || !after || before === after) continue;
      const title = it.title || `${t("services.item", "Услуга")} #${it.userServiceId}`;
      if (after === "blocked") toast.error(title, { description: getMood("service_blocked") ?? "Нужны действия." });
      else if (after === "not_paid") toast.info(title, { description: "💳 Требуется оплата. Загляните в раздел услуг." });
      else if (after === "active" && ["pending","not_paid","blocked","init"].includes(before)) toast.success(title, { description: getMood("service_activated") ?? "Услуга в строю." });
      else if (after === "removed") toast.success(title, { description: getMood("service_removed") ?? "Услуга завершена." });
    }
    prevStatusesRef.current = cur;
  }, [items, t]);

  /* ── Группировка: по kind, внутри — основные + WL привязаны по parent ── */
  const groups = useMemo(() => {
    const byKind: Record<ServiceKind, { main: ApiServiceItem; children: ApiServiceItem[] }[]> = {
      amneziawg: [], marzban: [], marzban_router: [], unknown: [],
    };

    // Разделяем на основные (parent=null/undefined) и дочерние WL (parent — число)
    const mainItems = items.filter(x => !x.parent);
    const wlItems   = items.filter(x => !!x.parent);

    // Индекс WL по parent userServiceId
    const wlByParent = new Map<number, ApiServiceItem[]>();
    for (const wl of wlItems) {
      if (wl.parent == null) continue;
      const arr = wlByParent.get(wl.parent) ?? [];
      arr.push(wl);
      wlByParent.set(wl.parent, arr);
    }

    // Сортировка основных
    const sortFn = (a: ApiServiceItem, b: ApiServiceItem) => {
      const d = statusSortWeight(a.status) - statusSortWeight(b.status);
      return d !== 0 ? d : a.userServiceId - b.userServiceId;
    };

    mainItems.sort(sortFn);

    for (const main of mainItems) {
      const kind     = detectKind(main.category);
      const children = (wlByParent.get(main.userServiceId) ?? []).sort(sortFn);
      byKind[kind].push({ main, children });
    }

    return byKind;
  }, [items]);

  const toggleGroup = (kind: ServiceKind) => setOpenGroups((cur) => ({ ...cur, [kind]: !cur[kind] }));

  const handleToggle = (id: number) => {
    setExpandedId((cur) => cur === id ? null : id);
    setConnectOpenId((cur) => cur === id ? null : cur);
  };
  const handleToggleConnect = (id: number) => {
    setExpandedId(id);
    setConnectOpenId((cur) => cur === id ? null : id);
  };

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="app-loader" style={{ opacity: 1, transition: "opacity 180ms ease", pointerEvents: "auto" }}>
        <div className="app-loader__card">
          <div className="app-loader__shine" />
          <div className="app-loader__brandRow"><div className="app-loader__mark" /><div className="app-loader__title">Shpun App</div></div>
          <div className="app-loader__text">{t("services.loading", "Загружаем услуги…")}</div>
        </div>
      </div>
    );
  }

  /* ── Error ── */
  if (error) {
    return (
      <div className="section">
        <div className="card"><div className="card__body">
          <h1 className="h1">{t("services.title", "Услуги")}</h1>
          <p className="p">{normalizeError(error).description ?? t("services.error.text", "Не удалось загрузить список услуг.")}</p>
          <div className="actions actions--1" style={{ marginTop: 12 }}>
            <button className="btn btn--primary" onClick={() => void load({ silent: false })} type="button">{t("services.retry", "Повторить")}</button>
          </div>
        </div></div>
      </div>
    );
  }

  const s              = summary;
  const hasServices    = items.length > 0;
  const fallbackActive = items.filter((x) => x.status === "active").length;
  const fallbackAttn   = items.filter((x) => x.status === "blocked" || x.status === "not_paid").length;
  const attnCount      = (s?.blocked ?? 0) + (s?.notPaid ?? 0) || fallbackAttn;
  const stopErrText    = stopError   ? normalizeError(stopError).description   : null;
  const deleteErrText  = deleteError ? normalizeError(deleteError).description : null;

  /* ── Render ── */
  return (
    <div className="section">

      <PaymentSuccessModal open={paySuccessOpen} onClose={() => setPaySuccessOpen(false)} />

      {/* ── Шапка ── */}
      <div className="card">
        <div className="card__body">
          <div className="services-top">
            <div className="services-top__left">
              <div className="services-top__title">{t("services.title", "Услуги")}</div>
              <div className="services-top__sub">{t("services.sub", "Ваши услуги и их текущий статус.")}</div>
            </div>
          </div>

          {hasServices && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
              <span className="badge">✅ {t("services.meta.active", "Активных")}: <b>{s?.active ?? fallbackActive}</b></span>
              {attnCount > 0 && (
                <span className="badge" style={{ borderColor: "rgba(245,158,11,.38)", background: "rgba(245,158,11,.08)" }}>
                  ⚠️ {t("services.meta.attention", "Внимание")}: <b>{attnCount}</b>
                </span>
              )}
              {discountPercent > 0 && (
                <span className="badge" style={{ borderColor: "rgba(124,92,255,.38)", background: "rgba(124,92,255,.08)" }}>
                  🎁 {t("services.meta.discount", "Скидка")}: <b>-{Math.round(discountPercent)}%</b>
                </span>
              )}
            </div>
          )}

          <div className="services-head__actions">
            <button className="btn btn--primary services-head__cta" onClick={() => go("/services/order")} type="button">
              {hasServices ? t("services.cta.add_more", "Подключить ещё") : t("services.cta.choose_plan", "Выбрать тариф")}
            </button>
            {hasServices && (
              <button className="btn services-head__cta" onClick={() => void load({ silent: false, toastOnSuccess: true })} type="button">
                {t("services.refresh", "Обновить")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Empty state ── */}
      {!hasServices && (
        <div className="section">
          <div className="card" style={{ background: "linear-gradient(135deg,rgba(124,92,255,.14),rgba(77,215,255,.08))", borderColor: "rgba(124,92,255,.30)" }}>
            <div className="card__body">
              <div className="h1">{t("services.empty.title")}</div>
              <p className="p" style={{ marginTop: 4, opacity: 0.7 }}>{t("services.empty.text")}</p>
              <div className="actions actions--1" style={{ marginTop: 16 }}>
                <button className="btn btn--primary" style={{ fontSize: 16, minHeight: 52, boxShadow: "0 0 24px rgba(124,92,255,.40)" }} onClick={() => go("/services/order")} type="button">
                  {t("services.cta.choose_plan")} →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Группы услуг ── */}
      {hasServices && (["marzban", "marzban_router", "amneziawg", "unknown"] as ServiceKind[]).map((kind) => {
        const arr = groups[kind];
        if (!arr?.length) return null;
        const open = !!openGroups[kind];
        const icon = kindIcon(kind);
        const total = arr.reduce((acc, g) => acc + 1 + g.children.length, 0);

        return (
          <div className="section" key={kind}>
            <div className="card">
              <div className="card__body">
                <button type="button" className="services-cat__head services-cat__head--toggle" onClick={() => toggleGroup(kind)} aria-expanded={open}>
                  <div className="services-cat__headLeft">
                    <div className="services-cat__titleRow">
                      <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
                      <div className="services-cat__title">{kindTitle(kind, t)}</div>
                      <span className="services-cat__chev" aria-hidden>{open ? "▲" : "▼"}</span>
                    </div>
                    <p className="p" style={{ marginTop: 4 }}>{kindDescr(kind, t)}</p>
                  </div>
                  <span className="badge" style={{ flexShrink: 0 }}>{total}</span>
                </button>

                {open && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                    {arr.map(({ main, children }) => (
                      <ServiceCard
                        key={main.userServiceId}
                        main={main}
                        children={children}
                        expandedId={expandedId}
                        connectOpenId={connectOpenId}
                        onToggle={handleToggle}
                        onToggleConnect={handleToggleConnect}
                        onRefresh={() => void load({ silent: false })}
                        onAskDelete={(svc) => { setDeleteError(null); setDeleteTarget(svc); }}
                        onAskStop={(svc) => { setStopError(null); setStopTarget(svc); }}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* ── Stop modal ── */}
      <Modal
        title={stopTarget ? t("services.modal.stop.title_named", "Заблокировать «{title}»?").replace("{title}", stopTarget.title) : t("services.modal.stop.title", "Заблокировать услугу?")}
        open={!!stopTarget} loading={stopBusy} error={stopErrText} confirmClassName="btn btn--danger"
        onClose={() => { if (!stopBusy) { setStopTarget(null); setStopError(null); } }}
        onConfirm={onConfirmStop} confirmText={t("services.stop.button", "Заблокировать")}
        cancelText={t("services.cancel", "Отмена")} footerHint={t("services.modal.footer_hint", "Если не уверены — сначала проверьте статус.")} closeLabel={t("services.close", "Закрыть")}>
        {stopTarget && (
          <>
            <p className="p"><b>{t("services.modal.stop.what_happens", "Что произойдёт:")}</b></p>
            <p className="p">{t("services.modal.stop.text", "Услуга «{title}» будет заблокирована.").replace("{title}", stopTarget.title)}</p>
            <div className="pre" style={{ borderColor: "rgba(245,158,11,.28)", marginTop: 10 }}>
              <div>⚠️ {t("services.modal.stop.warn1", "Самостоятельно разблокировать нельзя.")}</div>
              <div>{t("services.modal.stop.warn2", "Для восстановления обратитесь в поддержку.")}</div>
            </div>
            <div className="pre" style={{ marginTop: 8 }}>
              <div>{t("services.modal.status", "Статус")}: <b>{statusLabel(stopTarget.status, t)}</b></div>
              <div>{t("services.modal.type", "Тип")}: <b>{kindTitle(detectKind(stopTarget.category), t)}</b></div>
              <div>{t("services.modal.plan", "Тариф")}: <b>{fmtMoney(stopTarget.price, stopTarget.currency)}</b> / {stopTarget.periodMonths || 1}{t("services.month_short", "м")}</div>
              {stopTarget.expireAt && <div>{t("services.modal.until", "До")}: <b>{fmtDate(stopTarget.expireAt)}</b></div>}
            </div>
          </>
        )}
      </Modal>

      {/* ── Delete modal ── */}
      <Modal
        title={deleteTarget ? t("services.modal.delete.title_named", "Удалить «{title}»?").replace("{title}", deleteTarget.title) : t("services.modal.delete.title", "Удалить услугу?")}
        open={!!deleteTarget} loading={deleteBusy} error={deleteErrText} confirmClassName="btn btn--danger"
        onClose={() => { if (!deleteBusy) { setDeleteTarget(null); setDeleteError(null); } }}
        onConfirm={onConfirmDelete} confirmText={t("services.delete.confirm", "Удалить")}
        cancelText={t("services.cancel", "Отмена")} footerHint={t("services.modal.footer_hint", "Если не уверены — сначала проверьте статус.")} closeLabel={t("services.close", "Закрыть")}>
        {deleteTarget && (
          <>
            <p className="p"><b>{t("services.modal.delete.confirm_title", "Подтверждение удаления")}</b></p>
            <p className="p">{deleteConfirmText(deleteTarget, t)}</p>
            <div className="pre" style={{ marginTop: 8 }}>
              <div>{t("services.modal.status", "Статус")}: <b>{statusLabel(deleteTarget.status, t)}</b></div>
              <div>{t("services.modal.type", "Тип")}: <b>{kindTitle(detectKind(deleteTarget.category), t)}</b></div>
              <div>{t("services.modal.plan", "Тариф")}: <b>{fmtMoney(deleteTarget.price, deleteTarget.currency)}</b> / {deleteTarget.periodMonths || 1}{t("services.month_short", "м")}</div>
              {deleteTarget.expireAt && <div>{t("services.modal.until", "До")}: <b>{fmtDate(deleteTarget.expireAt)}</b></div>}
            </div>
          </>
        )}
      </Modal>

    </div>
  );
}