// web/src/pages/admin/SupportSection.tsx
//
// Admin support UI: ticket list, filters, detail card, conversation,
// staff replies, internal notes and status/priority/assignee management.
// Uses the existing backend support admin API.

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { ModalShell } from "./shared";

/* ─── Types ──────────────────────────────────────────────────────────────── */

type TicketStatus =
  | "open"
  | "in_progress"
  | "waiting_user"
  | "waiting_staff"
  | "resolved"
  | "closed";
type TicketPriority = "low" | "normal" | "high" | "urgent";
type TicketSource = "app" | "telegram";
type AuthorType = "user" | "staff" | "system";

type ServiceSnapshot = {
  user_service_id: number;
  service_id?: number | null;
  name?: string | null;
  category?: string | null;
  status?: string | null;
  expire?: string | null;
  period?: string | number | null;
  cost?: number | null;
};

type ContextUser = {
  user_id?: number | null;
  login?: string | null;
  display_name?: string | null;
  balance?: number | null;
  bonus?: number | null;
};

type TicketMessage = {
  id: number;
  ticketId: number;
  authorType: AuthorType;
  authorUserId: number | null;
  authorName: string | null;
  text: string;
  isInternalNote: boolean;
  createdAt: string;
};

type AdminTicket = {
  id: number;
  publicNo: string;
  storageProvider: string;
  externalId: string | null;
  userId: number;
  source: TicketSource;
  categoryKey: string;
  subject: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  assignedTo: number | null;
  serviceId: number | null;
  userServiceId: number | null;
  serviceCategory: string | null;
  userLoginSnapshot: string | null;
  displayNameSnapshot: string | null;
  balanceSnapshot: number | null;
  serviceSnapshot: ServiceSnapshot | null;
  contextSnapshot: Record<string, unknown> | null;
  telegramChatId: number | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  closedAt: string | null;
  messages?: TicketMessage[];
};

type SupportCategory = {
  key: string;
  title: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
};

type Filters = {
  status: string;
  priority: string;
  categoryKey: string;
  assignedTo: string;
  unassigned: boolean;
  q: string;
};

const EMPTY_FILTERS: Filters = {
  status: "",
  priority: "",
  categoryKey: "",
  assignedTo: "",
  unassigned: false,
  q: "",
};

const STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Открыт",
  in_progress: "В работе",
  waiting_user: "Ждём пользователя",
  waiting_staff: "Ждём оператора",
  resolved: "Решён",
  closed: "Закрыт",
};

const STATUS_TONES: Record<TicketStatus, string> = {
  open: "warn",
  in_progress: "accent",
  waiting_user: "ok",
  waiting_staff: "bad",
  resolved: "ok",
  closed: "soft",
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  urgent: "Срочный",
};

const PRIORITY_TONES: Record<TicketPriority, string> = {
  low: "soft",
  normal: "soft",
  high: "warn",
  urgent: "bad",
};

const SOURCE_LABELS: Record<TicketSource, string> = {
  app: "ShpunApp",
  telegram: "Telegram",
};

const AUTHOR_LABELS: Record<AuthorType, string> = {
  user: "Пользователь",
  staff: "Оператор",
  system: "Система",
};

const STATUS_OPTIONS = Object.keys(STATUS_LABELS) as TicketStatus[];
const PRIORITY_OPTIONS = Object.keys(PRIORITY_LABELS) as TicketPriority[];

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ru-RU");
}

function formatCost(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

function formatPeriod(period?: string | number | null) {
  if (period === null || period === undefined || period === "") return "—";
  const raw = String(period);
  return /^\d+$/.test(raw) ? `${raw} мес` : raw;
}

function buildQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.categoryKey) params.set("category_key", filters.categoryKey);
  if (filters.unassigned) params.set("assigned_to", "null");
  else if (filters.assignedTo.trim()) params.set("assigned_to", filters.assignedTo.trim());
  if (filters.q.trim()) params.set("q", filters.q.trim());
  const query = params.toString();
  return query ? `?${query}` : "";
}

function userLabel(ticket: AdminTicket) {
  const name = ticket.displayNameSnapshot || ticket.userLoginSnapshot;
  return name ? `${name} · #${ticket.userId}` : `Пользователь #${ticket.userId}`;
}

/* ─── Message bubble ─────────────────────────────────────────────────────── */

function MessageBubble({ message }: { message: TicketMessage }) {
  const isUser = message.authorType === "user";
  const isSystem = message.authorType === "system";

  const background = message.isInternalNote
    ? "rgba(245,158,11,0.08)"
    : isUser
      ? "rgba(255,255,255,0.05)"
      : isSystem
        ? "rgba(255,255,255,0.03)"
        : "rgba(124,92,255,0.14)";

  const border = message.isInternalNote
    ? "1px dashed rgba(245,158,11,0.55)"
    : isUser
      ? "1px solid rgba(255,255,255,0.08)"
      : isSystem
        ? "1px solid rgba(255,255,255,0.06)"
        : "1px solid rgba(124,92,255,0.30)";

  const alignSelf = isSystem ? "center" : isUser ? "flex-start" : "flex-end";
  const maxWidth = isSystem ? "100%" : "92%";

  return (
    <div
      style={{
        alignSelf,
        maxWidth,
        minWidth: 0,
        background,
        border,
        borderRadius: 14,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "baseline",
          flexWrap: "wrap",
          fontSize: 12,
          color: "rgba(255,255,255,0.62)",
        }}
      >
        <strong style={{ color: "rgba(255,255,255,0.88)", fontWeight: 800 }}>
          {AUTHOR_LABELS[message.authorType]}
          {!isUser && !isSystem && message.authorName ? ` · ${message.authorName}` : ""}
        </strong>
        <span>{formatDateTime(message.createdAt)}</span>
        {message.isInternalNote && (
          <span className="chip chip--warn" style={{ marginLeft: "auto" }}>
            Внутренняя заметка
          </span>
        )}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 14,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {message.text}
      </div>
    </div>
  );
}

/* ─── Snapshot view ──────────────────────────────────────────────────────── */

function SnapshotView({ ticket }: { ticket: AdminTicket }) {
  const contextUser = (ticket.contextSnapshot?.user ?? null) as ContextUser | null;
  const service = ticket.serviceSnapshot;
  const balance = contextUser?.balance ?? ticket.balanceSnapshot;
  const login = contextUser?.login ?? ticket.userLoginSnapshot;
  const displayName = contextUser?.display_name ?? ticket.displayNameSnapshot;

  const rows: Array<{ label: string; value: string }> = [
    { label: "Пользователь", value: `#${ticket.userId}` },
    { label: "Login", value: login || "—" },
    { label: "Имя", value: displayName || "—" },
    { label: "Баланс", value: formatCost(balance) },
    { label: "Бонусы", value: contextUser?.bonus != null ? formatCost(contextUser.bonus) : "—" },
    { label: "Telegram chat", value: ticket.telegramChatId ? String(ticket.telegramChatId) : "—" },
  ];

  return (
    <div className="list admin-gap-top-sm">
      <div className="list__item admin-tightItem">
        <div className="list__main">
          <div className="list__title">Снимок пользователя</div>
          <div
            style={{
              marginTop: 8,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 8,
            }}
          >
            {rows.map((row) => (
              <div key={row.label} style={{ minWidth: 0 }}>
                <div className="list__sub" style={{ marginTop: 0, fontSize: 12 }}>
                  {row.label}
                </div>
                <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{row.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="list__item admin-tightItem">
        <div className="list__main">
          <div className="list__title">Снимок услуги</div>
          {!service ? (
            <div className="list__sub" style={{ marginTop: 6 }}>
              Обращение без привязки к услуге.
            </div>
          ) : (
            <div
              style={{
                marginTop: 8,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 8,
              }}
            >
              {[
                { label: "Услуга", value: service.name || "—" },
                { label: "user_service_id", value: service.user_service_id ? `#${service.user_service_id}` : "—" },
                { label: "service_id", value: service.service_id != null ? String(service.service_id) : "—" },
                { label: "Категория", value: service.category || ticket.serviceCategory || "—" },
                { label: "Статус", value: service.status || "—" },
                { label: "Активна до", value: service.expire || "—" },
                { label: "Период", value: formatPeriod(service.period) },
                { label: "Стоимость", value: formatCost(service.cost) },
              ].map((row) => (
                <div key={row.label} style={{ minWidth: 0 }}>
                  <div className="list__sub" style={{ marginTop: 0, fontSize: 12 }}>
                    {row.label}
                  </div>
                  <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{row.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Section ────────────────────────────────────────────────────────────── */

export function SupportSection() {
  const [items, setItems] = useState<AdminTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<SupportCategory[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");

  const [opened, setOpened] = useState<AdminTicket | null>(null);
  const [openedLoading, setOpenedLoading] = useState(false);
  const [openedError, setOpenedError] = useState("");

  const [replyText, setReplyText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [sendingNote, setSendingNote] = useState(false);
  const [patching, setPatching] = useState(false);
  const [assigneeDraft, setAssigneeDraft] = useState("");
  const [rawOpen, setRawOpen] = useState(false);

  // Synchronous locks: prevent double-submit before React re-renders.
  const replyLock = useRef(false);
  const noteLock = useRef(false);
  const patchLock = useRef(false);
  // Guards against a late response overwriting a different, newly opened ticket.
  const openedIdRef = useRef<number | null>(null);

  const categoryTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories) map.set(category.key, category.title);
    return map;
  }, [categories]);

  useEffect(() => {
    void loadCategories();
  }, []);

  // Reload list on filter changes (debounced for the search field).
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadTickets();
    }, filters.q.trim() ? 350 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.status,
    filters.priority,
    filters.categoryKey,
    filters.assignedTo,
    filters.unassigned,
    filters.q,
  ]);

  useEffect(() => {
    openedIdRef.current = opened?.id ?? null;
    setAssigneeDraft(opened?.assignedTo != null ? String(opened.assignedTo) : "");
  }, [opened?.id, opened?.assignedTo]);

  async function loadCategories() {
    try {
      const response = await apiFetch<{ ok: true; items: SupportCategory[] }>(
        "/admin/support/categories",
        { method: "GET" },
      );
      setCategories(response.items ?? []);
    } catch {
      // Category filter is optional; ignore load failures.
    }
  }

  async function loadTickets() {
    setLoading(true);
    setListError("");
    try {
      const response = await apiFetch<{ ok: true; items: AdminTicket[]; total: number }>(
        `/admin/support/tickets${buildQuery(filters)}`,
        { method: "GET" },
      );
      setItems(response.items ?? []);
      setTotal(Number(response.total ?? 0));
    } catch (error) {
      setListError(errorMessage(error, "Не удалось загрузить тикеты."));
    } finally {
      setLoading(false);
    }
  }

  async function openTicket(id: number) {
    setOpenedLoading(true);
    setOpenedError("");
    setNotice("");
    setRawOpen(false);
    try {
      const response = await apiFetch<{ ok: true; ticket: AdminTicket }>(
        `/admin/support/tickets/${id}`,
        { method: "GET" },
      );
      setOpened(response.ticket);
      setReplyText("");
      setNoteText("");
    } catch (error) {
      setOpenedError(errorMessage(error, "Не удалось открыть тикет."));
    } finally {
      setOpenedLoading(false);
    }
  }

  function closeTicket() {
    setOpened(null);
    setOpenedError("");
    setNotice("");
  }

  async function sendMessage(text: string, internal: boolean) {
    if (!opened) return;
    const payload = text.trim();
    if (payload.length < 2) {
      setOpenedError("Сообщение слишком короткое.");
      return;
    }

    const lock = internal ? noteLock : replyLock;
    if (lock.current) return;
    lock.current = true;
    if (internal) setSendingNote(true);
    else setSendingReply(true);
    setOpenedError("");
    setNotice("");

    const ticketId = opened.id;
    try {
      const response = await apiFetch<{ ok: true; ticket: AdminTicket }>(
        `/admin/support/tickets/${ticketId}/messages`,
        { method: "POST", body: { text: payload, internal } },
      );
      if (openedIdRef.current !== ticketId) return;
      setOpened(response.ticket);
      if (internal) {
        setNoteText("");
        setNotice("Внутренняя заметка добавлена.");
      } else {
        setReplyText("");
        setNotice("Ответ отправлен пользователю.");
      }
      await loadTickets();
    } catch (error) {
      if (openedIdRef.current === ticketId) {
        setOpenedError(errorMessage(error, internal ? "Не удалось добавить заметку." : "Не удалось отправить ответ."));
      }
    } finally {
      lock.current = false;
      setSendingNote(false);
      setSendingReply(false);
    }
  }

  async function patchTicket(patch: Record<string, unknown>) {
    if (!opened) return;
    if (patchLock.current) return;
    patchLock.current = true;
    setPatching(true);
    setOpenedError("");
    setNotice("");

    const ticketId = opened.id;
    try {
      const response = await apiFetch<{ ok: true; ticket: AdminTicket }>(
        `/admin/support/tickets/${ticketId}`,
        { method: "PATCH", body: patch },
      );
      if (openedIdRef.current !== ticketId) return;
      setOpened(response.ticket);
      setNotice("Тикет обновлён.");
      await loadTickets();
    } catch (error) {
      if (openedIdRef.current === ticketId) {
        setOpenedError(errorMessage(error, "Не удалось обновить тикет."));
      }
    } finally {
      patchLock.current = false;
      setPatching(false);
    }
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
  }

  const hasMessages = Boolean(opened?.messages && opened.messages.length > 0);

  return (
    <div className="card">
      <div className="card__body">
        <div className="kicker">Support</div>
        <h2 className="h1">Обращения в поддержку</h2>
        <p className="p">
          Тикеты из ShpunApp и Telegram. Здесь можно читать переписку, отвечать пользователю,
          вести внутренние заметки и управлять статусом.
        </p>

        {/* ── Filters ── */}
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 10,
          }}
        >
          <label className="field">
            <span className="field__label">Статус</span>
            <select
              className="input"
              value={filters.status}
              onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
            >
              <option value="">Все</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{STATUS_LABELS[status]}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Приоритет</span>
            <select
              className="input"
              value={filters.priority}
              onChange={(e) => setFilters((p) => ({ ...p, priority: e.target.value }))}
            >
              <option value="">Все</option>
              {PRIORITY_OPTIONS.map((priority) => (
                <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Категория</span>
            <select
              className="input"
              value={filters.categoryKey}
              onChange={(e) => setFilters((p) => ({ ...p, categoryKey: e.target.value }))}
            >
              <option value="">Все</option>
              {categories.map((category) => (
                <option key={category.key} value={category.key}>{category.title}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Оператор (ID)</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder="напр. 123"
              value={filters.assignedTo}
              disabled={filters.unassigned}
              onChange={(e) => setFilters((p) => ({ ...p, assignedTo: e.target.value.replace(/[^\d]/g, "") }))}
            />
          </label>

          <label className="field">
            <span className="field__label">Поиск</span>
            <input
              className="input"
              placeholder="номер, логин, тема"
              value={filters.q}
              onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
            />
          </label>

          <label className="field" style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 10 }}>
              <input
                type="checkbox"
                checked={filters.unassigned}
                onChange={(e) =>
                  setFilters((p) => ({ ...p, unassigned: e.target.checked, assignedTo: e.target.checked ? "" : p.assignedTo }))
                }
              />
              <span className="field__label" style={{ margin: 0 }}>Без оператора</span>
            </span>
          </label>
        </div>

        <div className="actions actions--2 admin-gap-top-sm">
          <button className="btn btn--soft" type="button" onClick={() => void loadTickets()} disabled={loading}>
            {loading ? "Обновляю…" : "Обновить"}
          </button>
          <button className="btn" type="button" onClick={resetFilters} disabled={loading}>
            Сбросить фильтры
          </button>
        </div>

        {notice && <div className="pre admin-gap-top-md">{notice}</div>}
        {listError && <div className="pre admin-gap-top-md">{listError}</div>}

        <h3 className="h2 admin-gap-top-md">Тикеты · {total}</h3>

        {loading ? (
          <div className="list admin-gap-top-md">
            <div className="skeleton h1" />
            <div className="skeleton p" />
          </div>
        ) : items.length === 0 ? (
          <p className="p admin-gap-top-md">Тикетов по заданным фильтрам нет.</p>
        ) : (
          <div className="list admin-gap-top-md">
            {items.map((ticket) => (
              <div
                key={ticket.id}
                className="list__item is-clickable admin-tightItem"
                role="button"
                tabIndex={0}
                onClick={() => void openTicket(ticket.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") void openTicket(ticket.id);
                }}
              >
                <div className="list__main">
                  <div className="list__title">
                    #{ticket.publicNo} · {userLabel(ticket)}
                  </div>
                  <div className="list__sub" style={{ marginTop: 6 }}>
                    {categoryTitles.get(ticket.categoryKey) ?? ticket.categoryKey}
                    {" · "}
                    {SOURCE_LABELS[ticket.source] ?? ticket.source}
                    {ticket.userServiceId ? ` · услуга #${ticket.userServiceId}` : ""}
                    {" · "}
                    обновлён {formatDateTime(ticket.lastMessageAt)}
                    {" · "}
                    {ticket.assignedTo != null ? `оператор #${ticket.assignedTo}` : "не назначен"}
                  </div>
                </div>
                <div className="list__side" style={{ flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                  <span className={`chip chip--${STATUS_TONES[ticket.status]}`}>
                    {STATUS_LABELS[ticket.status]}
                  </span>
                  <span className={`chip chip--${PRIORITY_TONES[ticket.priority]}`}>
                    {PRIORITY_LABELS[ticket.priority]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Detail modal ── */}
      {openedLoading && !opened && (
        <ModalShell title="Загрузка тикета…" kicker="Support" onClose={closeTicket}>
          <div className="list">
            <div className="skeleton h1" />
            <div className="skeleton p" />
          </div>
        </ModalShell>
      )}

      {opened && (
        <ModalShell
          title={`#${opened.publicNo} · ${opened.subject || "Без темы"}`}
          kicker={`${STATUS_LABELS[opened.status]} · ${PRIORITY_LABELS[opened.priority]}`}
          onClose={closeTicket}
        >
          {openedError && <div className="pre">{openedError}</div>}
          {notice && <div className="pre admin-gap-top-sm">{notice}</div>}

          {/* Summary */}
          <div className="list admin-gap-top-sm">
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">{userLabel(opened)}</div>
                <div className="list__sub" style={{ marginTop: 6 }}>
                  {categoryTitles.get(opened.categoryKey) ?? opened.categoryKey}
                  {" · "}
                  {SOURCE_LABELS[opened.source] ?? opened.source}
                  {" · "}
                  создан {formatDateTime(opened.createdAt)}
                  {" · "}
                  обновлён {formatDateTime(opened.updatedAt)}
                  {opened.closedAt ? ` · закрыт ${formatDateTime(opened.closedAt)}` : ""}
                </div>
              </div>
              <div className="list__side" style={{ flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                <span className={`chip chip--${STATUS_TONES[opened.status]}`}>{STATUS_LABELS[opened.status]}</span>
                <span className={`chip chip--${PRIORITY_TONES[opened.priority]}`}>{PRIORITY_LABELS[opened.priority]}</span>
              </div>
            </div>
          </div>

          {/* Controls */}
          <h3 className="h2 admin-gap-top-md">Управление</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 10,
              marginTop: 8,
            }}
          >
            <label className="field">
              <span className="field__label">Статус</span>
              <select
                className="input"
                value={opened.status}
                disabled={patching}
                onChange={(e) => void patchTicket({ status: e.target.value })}
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Приоритет</span>
              <select
                className="input"
                value={opened.priority}
                disabled={patching}
                onChange={(e) => void patchTicket({ priority: e.target.value })}
              >
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Оператор (ID)</span>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  inputMode="numeric"
                  placeholder="не назначен"
                  value={assigneeDraft}
                  disabled={patching}
                  onChange={(e) => setAssigneeDraft(e.target.value.replace(/[^\d]/g, ""))}
                />
                <button
                  className="btn btn--soft"
                  type="button"
                  disabled={patching}
                  onClick={() =>
                    void patchTicket({ assigned_to: assigneeDraft.trim() ? Number(assigneeDraft) : null })
                  }
                >
                  Назначить
                </button>
              </div>
            </label>
          </div>

          {/* Snapshot */}
          <h3 className="h2 admin-gap-top-md">Диагностика</h3>
          <SnapshotView ticket={opened} />

          {/* Conversation */}
          <h3 className="h2 admin-gap-top-md">Переписка</h3>
          {!hasMessages ? (
            <div className="list admin-gap-top-sm">
              <div className="list__item admin-tightItem">
                <div className="list__sub" style={{ marginTop: 0 }}>Сообщений пока нет.</div>
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                marginTop: 8,
                maxHeight: 460,
                overflowY: "auto",
                paddingRight: 2,
              }}
            >
              {opened.messages!.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </div>
          )}

          {/* Staff reply */}
          <h3 className="h2 admin-gap-top-md">Ответ пользователю</h3>
          <textarea
            className="input"
            style={{ minHeight: 96, resize: "vertical", marginTop: 8, whiteSpace: "pre-wrap" }}
            value={replyText}
            maxLength={4000}
            disabled={sendingReply || sendingNote}
            placeholder="Сообщение уйдёт пользователю в ShpunApp и Telegram"
            onChange={(e) => setReplyText(e.target.value)}
          />
          <div className="actions actions--1 admin-gap-top-sm">
            <button
              className="btn btn--primary"
              type="button"
              disabled={sendingReply || sendingNote || replyText.trim().length < 2}
              onClick={() => void sendMessage(replyText, false)}
            >
              {sendingReply ? "Отправляю…" : "Отправить ответ"}
            </button>
          </div>

          {/* Internal note */}
          <h3 className="h2 admin-gap-top-md">Внутренняя заметка</h3>
          <p className="p" style={{ marginTop: 4 }}>
            Видна только операторам и не попадает пользователю.
          </p>
          <textarea
            className="input"
            style={{ minHeight: 80, resize: "vertical", marginTop: 8, whiteSpace: "pre-wrap" }}
            value={noteText}
            maxLength={4000}
            disabled={sendingReply || sendingNote}
            placeholder="Заметка для команды"
            onChange={(e) => setNoteText(e.target.value)}
          />
          <div className="actions actions--1 admin-gap-top-sm">
            <button
              className="btn btn--soft"
              type="button"
              disabled={sendingReply || sendingNote || noteText.trim().length < 2}
              onClick={() => void sendMessage(noteText, true)}
            >
              {sendingNote ? "Сохраняю…" : "Добавить заметку"}
            </button>
          </div>

          {/* Raw context */}
          <details
            className="admin-gap-top-md"
            open={rawOpen}
            onToggle={(e) => setRawOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>Raw context</summary>
            <pre className="pre" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(
                {
                  ticketId: opened.id,
                  publicNo: opened.publicNo,
                  storageProvider: opened.storageProvider,
                  externalId: opened.externalId,
                  userId: opened.userId,
                  source: opened.source,
                  serviceId: opened.serviceId,
                  userServiceId: opened.userServiceId,
                  serviceCategory: opened.serviceCategory,
                  balanceSnapshot: opened.balanceSnapshot,
                  serviceSnapshot: opened.serviceSnapshot,
                  contextSnapshot: opened.contextSnapshot,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </ModalShell>
      )}
    </div>
  );
}
