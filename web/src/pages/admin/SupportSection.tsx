// web/src/pages/admin/SupportSection.tsx
//
// Admin support helpdesk UI.
// Layout: compact header/context, conversation as the main area, pinned
// composer, diagnostics tucked into a collapsible. Uses the existing backend
// support admin API (no contract changes).

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { refreshSupportUnread } from "../../app/notifications/supportUnread";
import {
  ATTACHMENT_ACCEPT,
  AttachmentList,
  PendingFiles,
  buildMessageFormData,
  releasePendingFiles,
  toPendingFiles,
  type PendingFile,
  type TicketAttachment,
} from "../../shared/support/attachments";
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
  attachments?: TicketAttachment[];
};

type AdminTicket = {
  id: number;
  publicNo: string;
  kind?: "support" | "partnership";
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
  unread?: boolean;
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

type PartnershipContext = {
  proposal_type?: string;
  platform_url?: string;
  audience_size?: string | null;
  offer?: string;
  contact?: string | null;
  comment?: string | null;
};

const PARTNERSHIP_TYPE_LABELS: Record<string, string> = {
  blogger: "Блогер / автор",
  channel: "Telegram-канал / сообщество",
  youtube: "YouTube / Twitch",
  site: "Сайт / проект",
  other: "Другое",
};

function partnershipTypeLabel(key?: string | null): string {
  return (key && PARTNERSHIP_TYPE_LABELS[key]) || key || "Другое";
}

function partnershipOf(ticket: AdminTicket): PartnershipContext | null {
  const raw = ticket.contextSnapshot?.["partnership"];
  return raw && typeof raw === "object" ? (raw as PartnershipContext) : null;
}

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

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTime(value?: string | null) {
  const parsed = parseDate(value);
  return parsed ? parsed.toLocaleString("ru-RU") : (value || "—");
}

function formatClock(value?: string | null) {
  const parsed = parseDate(value);
  if (!parsed) return value || "";
  const today = new Date();
  const sameDay = parsed.toDateString() === today.toDateString();
  return sameDay
    ? parsed.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : parsed.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
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

function buildQuery(filters: Filters, kind?: "support" | "partnership"): string {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
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
  return ticket.displayNameSnapshot || ticket.userLoginSnapshot || `Пользователь #${ticket.userId}`;
}

/* ─── Message bubble ─────────────────────────────────────────────────────── */

function MessageBubble({ message }: { message: TicketMessage }) {
  const isUser = message.authorType === "user";
  const isSystem = message.authorType === "system";

  if (message.isInternalNote) {
    return (
      <div className="supportMsg supportMsg--note">
        <div className="supportMsg__meta">
          <strong>Внутренняя заметка</strong>
          {message.authorName ? <span>· {message.authorName}</span> : null}
          <span className="supportMsg__time">{formatClock(message.createdAt)}</span>
        </div>
        {message.text ? <div className="supportMsg__text">{message.text}</div> : null}
        <AttachmentList attachments={message.attachments} />
      </div>
    );
  }

  const modifier = isUser ? "supportMsg--user" : isSystem ? "supportMsg--system" : "supportMsg--staff";

  return (
    <div className={`supportMsg ${modifier}`}>
      <div className="supportMsg__meta">
        <strong>{AUTHOR_LABELS[message.authorType]}</strong>
        {!isUser && !isSystem && message.authorName ? <span>· {message.authorName}</span> : null}
        <span className="supportMsg__time">{formatClock(message.createdAt)}</span>
      </div>
      {message.text ? <div className="supportMsg__text">{message.text}</div> : null}
      <AttachmentList attachments={message.attachments} />
    </div>
  );
}

/* ─── Diagnostics ────────────────────────────────────────────────────────── */

function Diagnostics({ ticket }: { ticket: AdminTicket }) {
  const contextUser = (ticket.contextSnapshot?.user ?? null) as ContextUser | null;
  const service = ticket.serviceSnapshot;
  const partnership = partnershipOf(ticket);
  const balance = contextUser?.balance ?? ticket.balanceSnapshot;
  const login = contextUser?.login ?? ticket.userLoginSnapshot;
  const displayName = contextUser?.display_name ?? ticket.displayNameSnapshot;

  const userRows: Array<{ label: string; value: string }> = [
    { label: "user id", value: `#${ticket.userId}` },
    { label: "login", value: login || "—" },
    { label: "имя", value: displayName || "—" },
    { label: "баланс", value: formatCost(balance) },
    { label: "бонусы", value: contextUser?.bonus != null ? formatCost(contextUser.bonus) : "—" },
    { label: "telegram chat", value: ticket.telegramChatId ? String(ticket.telegramChatId) : "—" },
  ];

  const serviceRows: Array<{ label: string; value: string }> = service
    ? [
        { label: "услуга", value: service.name || "—" },
        { label: "user_service_id", value: service.user_service_id ? `#${service.user_service_id}` : "—" },
        { label: "service_id", value: service.service_id != null ? String(service.service_id) : "—" },
        { label: "категория", value: service.category || ticket.serviceCategory || "—" },
        { label: "статус", value: service.status || "—" },
        { label: "активна до", value: service.expire || "—" },
        { label: "период", value: formatPeriod(service.period) },
        { label: "стоимость", value: formatCost(service.cost) },
      ]
    : [];

  return (
    <details className="supportDiag">
      <summary>Диагностика</summary>

      <div className="supportDiag__block">
        <div className="supportDiag__title">Снимок пользователя</div>
        <div className="supportDiag__grid">
          {userRows.map((row) => (
            <div key={row.label} className="supportDiag__cell">
              <div className="supportDiag__label">{row.label}</div>
              <div className="supportDiag__value">{row.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="supportDiag__block">
        <div className="supportDiag__title">
          {ticket.kind === "partnership" ? "Параметры предложения" : "Снимок услуги"}
        </div>
        {ticket.kind === "partnership" ? (
          partnership ? (
            <>
              <div className="supportDiag__grid">
                {[
                  { label: "тип", value: partnershipTypeLabel(partnership.proposal_type) },
                  { label: "площадка", value: partnership.platform_url || "—" },
                  { label: "аудитория", value: partnership.audience_size || "—" },
                  { label: "контакт", value: partnership.contact || "—" },
                ].map((row) => (
                  <div key={row.label} className="supportDiag__cell">
                    <div className="supportDiag__label">{row.label}</div>
                    <div className="supportDiag__value">{row.value}</div>
                  </div>
                ))}
              </div>
              {partnership.offer ? (
                <div className="admin-gap-top-sm">
                  <div className="supportDiag__label">предложение</div>
                  <div className="supportDiag__value" style={{ whiteSpace: "pre-wrap" }}>{partnership.offer}</div>
                </div>
              ) : null}
              {partnership.comment ? (
                <div className="admin-gap-top-sm">
                  <div className="supportDiag__label">комментарий</div>
                  <div className="supportDiag__value" style={{ whiteSpace: "pre-wrap" }}>{partnership.comment}</div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="supportDiag__label">Нет данных предложения.</div>
          )
        ) : serviceRows.length === 0 ? (
          <div className="supportDiag__label">Обращение без привязки к услуге.</div>
        ) : (
          <div className="supportDiag__grid">
            {serviceRows.map((row) => (
              <div key={row.label} className="supportDiag__cell">
                <div className="supportDiag__label">{row.label}</div>
                <div className="supportDiag__value">{row.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="supportDiag__raw">
        <summary>Raw context</summary>
        <pre className="pre" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {JSON.stringify(
            {
              ticketId: ticket.id,
              publicNo: ticket.publicNo,
              storageProvider: ticket.storageProvider,
              externalId: ticket.externalId,
              userId: ticket.userId,
              source: ticket.source,
              serviceId: ticket.serviceId,
              userServiceId: ticket.userServiceId,
              serviceCategory: ticket.serviceCategory,
              balanceSnapshot: ticket.balanceSnapshot,
              serviceSnapshot: ticket.serviceSnapshot,
              contextSnapshot: ticket.contextSnapshot,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </details>
  );
}

/* ─── Section ────────────────────────────────────────────────────────────── */

export function SupportSection({
  initialKind = "support",
  initialTicketId,
}: { initialKind?: "support" | "partnership"; initialTicketId?: number } = {}) {
  const [items, setItems] = useState<AdminTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<SupportCategory[]>([]);
  const [kind, setKind] = useState<"support" | "partnership">(initialKind);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");

  const [opened, setOpened] = useState<AdminTicket | null>(null);
  const [openedLoading, setOpenedLoading] = useState(false);
  const [openedError, setOpenedError] = useState("");

  const [composerMode, setComposerMode] = useState<"reply" | "note">("reply");
  const [composerText, setComposerText] = useState("");
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [sending, setSending] = useState(false);
  const [patching, setPatching] = useState(false);
  const [assigneeDraft, setAssigneeDraft] = useState("");

  // Synchronous locks prevent double-submit before React re-renders.
  const sendLock = useRef(false);
  const patchLock = useRef(false);
  const openedIdRef = useRef<number | null>(null);
  const autoOpenedRef = useRef(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    kind,
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

  // Deep link: ?ticket=<id> opens the ticket once.
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!initialTicketId || !Number.isFinite(initialTicketId) || initialTicketId <= 0) return;
    autoOpenedRef.current = true;
    void openTicket(initialTicketId);
  }, [initialTicketId]);

  // Keep the conversation scrolled to the latest message.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [opened?.id, opened?.messages?.length]);

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

  async function loadTickets(options: { silent?: boolean } = {}) {
    if (!options.silent) setLoading(true);
    setListError("");
    try {
      const response = await apiFetch<{ ok: true; items: AdminTicket[]; total: number }>(
        `/admin/support/tickets${buildQuery(filters, kind)}`,
        { method: "GET" },
      );
      setItems(response.items ?? []);
      setTotal(Number(response.total ?? 0));
    } catch (error) {
      setListError(errorMessage(error, "Не удалось загрузить тикеты."));
    } finally {
      if (!options.silent) setLoading(false);
    }
  }

  async function openTicket(id: number) {
    setOpenedLoading(true);
    setOpenedError("");
    setNotice("");
    setComposerMode("reply");
    try {
      const response = await apiFetch<{ ok: true; ticket: AdminTicket }>(
        `/admin/support/tickets/${id}`,
        { method: "GET" },
      );
      setOpened(response.ticket);
      setComposerText("");
      // Clear the local unread marker and refresh the badge. The backend
      // already marked the ticket read when it served the detail request.
      setItems((prev) => prev.map((t) => (t.id === id ? { ...t, unread: false } : t)));
      void refreshSupportUnread();
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
    setComposerText("");
  }

  async function sendComposer() {
    if (!opened) return;
    const payload = composerText.trim();
    if (payload.length < 2 && pending.length === 0) {
      setOpenedError("Сообщение слишком короткое.");
      return;
    }
    if (sendLock.current) return;
    sendLock.current = true;
    setSending(true);
    setOpenedError("");
    setNotice("");

    const internal = composerMode === "note";
    const ticketId = opened.id;
    try {
      const body = pending.length
        ? buildMessageFormData(payload, pending.map((f) => f.file), { internal: internal ? "1" : "0" })
        : { text: payload, internal };
      const response = await apiFetch<{ ok: true; ticket: AdminTicket }>(
        `/admin/support/tickets/${ticketId}/messages`,
        { method: "POST", body },
      );
      if (openedIdRef.current !== ticketId) return;
      setOpened(response.ticket);
      releasePendingFiles(pending);
      setPending([]);
      setComposerText("");
      setNotice(internal ? "Внутренняя заметка добавлена." : "Ответ отправлен пользователю.");
      void loadTickets({ silent: true });
    } catch (error) {
      if (openedIdRef.current === ticketId) {
        setOpenedError(errorMessage(error, internal ? "Не удалось добавить заметку." : "Не удалось отправить ответ."));
      }
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  function onPickFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = toPendingFiles(event.target.files);
    setPending((prev) => [...prev, ...picked].slice(0, 5));
    event.target.value = "";
  }

  function removePending(id: string) {
    setPending((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) {
        try { URL.revokeObjectURL(target.previewUrl); } catch { /* ignore */ }
      }
      return prev.filter((f) => f.id !== id);
    });
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
      void loadTickets({ silent: true });
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

  const messages = opened?.messages ?? [];

  return (
    <div className="card">
      <div className="card__body">
        <div className="kicker">Inbox</div>
        <h2 className="h1">{kind === "partnership" ? "Сотрудничество" : "Обращения в поддержку"}</h2>
        <p className="p">
          {kind === "partnership"
            ? "Входящие предложения о рекламе и сотрудничестве."
            : "Тикеты из ShpunApp и Telegram: переписка, ответы и внутренние заметки."}
        </p>

        <div className="supportKindTabs">
          <button
            type="button"
            className={`supportKindTab${kind === "support" ? " supportKindTab--active" : ""}`}
            onClick={() => setKind("support")}
          >
            Поддержка
          </button>
          <button
            type="button"
            className={`supportKindTab${kind === "partnership" ? " supportKindTab--active" : ""}`}
            onClick={() => setKind("partnership")}
          >
            🤝 Сотрудничество
          </button>
        </div>

        {/* ── Filters ── */}
        <div className="supportFilters admin-gap-top-sm">
          <label className="field">
            <span className="field__label">Статус</span>
            <select className="input" value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
              <option value="">Все</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{STATUS_LABELS[status]}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Приоритет</span>
            <select className="input" value={filters.priority} onChange={(e) => setFilters((p) => ({ ...p, priority: e.target.value }))}>
              <option value="">Все</option>
              {PRIORITY_OPTIONS.map((priority) => (
                <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Категория</span>
            <select className="input" value={filters.categoryKey} onChange={(e) => setFilters((p) => ({ ...p, categoryKey: e.target.value }))}>
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
            <input className="input" placeholder="номер, логин, тема" value={filters.q} onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))} />
          </label>

          <label className="field supportFilters__check">
            <span className="supportFilters__checkLine">
              <input
                type="checkbox"
                checked={filters.unassigned}
                onChange={(e) => setFilters((p) => ({ ...p, unassigned: e.target.checked, assignedTo: e.target.checked ? "" : p.assignedTo }))}
              />
              <span className="field__label" style={{ margin: 0 }}>Без оператора</span>
            </span>
          </label>
        </div>

        <div className="actions actions--2 admin-gap-top-sm">
          <button className="btn btn--soft" type="button" onClick={() => void loadTickets()} disabled={loading}>
            {loading ? "Обновляю…" : "Обновить"}
          </button>
          <button className="btn" type="button" onClick={resetFilters} disabled={loading}>Сбросить фильтры</button>
        </div>

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
                    {ticket.unread ? <span className="supportUnreadDot" aria-label="Непрочитано" /> : null}
                    #{ticket.publicNo} · {userLabel(ticket)}
                  </div>
                  <div className="list__sub" style={{ marginTop: 6 }}>
                    {categoryTitles.get(ticket.categoryKey) ?? ticket.categoryKey}
                    {" · "}
                    {SOURCE_LABELS[ticket.source] ?? ticket.source}
                    {ticket.userServiceId ? ` · услуга #${ticket.userServiceId}` : ""}
                    {" · "}
                    {formatClock(ticket.lastMessageAt) || "—"}
                    {" · "}
                    {ticket.assignedTo != null ? `оператор #${ticket.assignedTo}` : "не назначен"}
                  </div>
                </div>
                <div className="list__side" style={{ flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                  <span className={`chip chip--${STATUS_TONES[ticket.status]}`}>{STATUS_LABELS[ticket.status]}</span>
                  {(ticket.priority === "high" || ticket.priority === "urgent") && (
                    <span className={`chip chip--${PRIORITY_TONES[ticket.priority]}`}>{PRIORITY_LABELS[ticket.priority]}</span>
                  )}
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
          title={opened.subject ? `#${opened.publicNo} · ${opened.subject}` : `#${opened.publicNo}`}
          kicker={`${categoryTitles.get(opened.categoryKey) ?? opened.categoryKey} · ${SOURCE_LABELS[opened.source] ?? opened.source}`}
          onClose={closeTicket}
        >
          {openedError && <div className="pre">{openedError}</div>}
          {notice && <div className="pre admin-gap-top-sm">{notice}</div>}

          {/* Meta / controls (single place for status & priority) */}
          <div className="supportDetail__meta admin-gap-top-sm">
            <label className="field">
              <span className="field__label">Статус</span>
              <select className="input" value={opened.status} disabled={patching} onChange={(e) => void patchTicket({ status: e.target.value })}>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Приоритет</span>
              <select className="input" value={opened.priority} disabled={patching} onChange={(e) => void patchTicket({ priority: e.target.value })}>
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Оператор (ID)</span>
              <div className="supportDetail__operator">
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
                  onClick={() => void patchTicket({ assigned_to: assigneeDraft.trim() ? Number(assigneeDraft) : null })}
                >
                  ОК
                </button>
              </div>
            </label>
          </div>

          {/* Compact context */}
          <div className="supportDetail__context">
            <span><strong>{userLabel(opened)}</strong> · #{opened.userId}</span>
            {opened.kind === "partnership" ? (
              partnershipOf(opened)?.platform_url ? (
                <span>Площадка: {partnershipOf(opened)?.platform_url}</span>
              ) : null
            ) : opened.serviceSnapshot || opened.userServiceId ? (
              <span>
                Услуга{opened.userServiceId ? ` #${opened.userServiceId}` : ""}
                {opened.serviceSnapshot?.name ? ` · ${opened.serviceSnapshot.name}` : ""}
                {opened.serviceSnapshot?.status ? ` · ${opened.serviceSnapshot.status}` : ""}
              </span>
            ) : null}
            <span>создан {formatDateTime(opened.createdAt)}</span>
          </div>

          <Diagnostics ticket={opened} />

          {/* Conversation */}
          <div className="supportDetail__thread" ref={threadRef}>
            {messages.length === 0 ? (
              <div className="supportDetail__empty">Сообщений пока нет.</div>
            ) : (
              messages.map((message) => <MessageBubble key={message.id} message={message} />)
            )}
          </div>

          {/* Pinned composer */}
          <div className="supportDetail__composer">
            <div className="supportMode" role="tablist" aria-label="Тип сообщения">
              <button
                type="button"
                role="tab"
                aria-selected={composerMode === "reply"}
                className={`supportMode__btn${composerMode === "reply" ? " supportMode__btn--active" : ""}`}
                onClick={() => setComposerMode("reply")}
              >
                Ответ пользователю
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={composerMode === "note"}
                className={`supportMode__btn${composerMode === "note" ? " supportMode__btn--active" : ""}`}
                onClick={() => setComposerMode("note")}
              >
                Внутренняя заметка
              </button>
            </div>

            <textarea
              className="input supportDetail__input"
              value={composerText}
              maxLength={4000}
              disabled={sending}
              placeholder={composerMode === "note" ? "Заметка для команды (пользователь не увидит)" : "Сообщение уйдёт пользователю"}
              onChange={(e) => setComposerText(e.target.value)}
            />

            <PendingFiles files={pending} onRemove={removePending} disabled={sending} />

            <div className="actions actions--2">
              <button
                className="composerAttach"
                type="button"
                aria-label="Прикрепить файл"
                disabled={sending || pending.length >= 5}
                onClick={() => fileInputRef.current?.click()}
              >
                📎
              </button>
              <input ref={fileInputRef} type="file" multiple accept={ATTACHMENT_ACCEPT} style={{ display: "none" }} onChange={onPickFiles} />
              <button
                className={`btn ${composerMode === "note" ? "btn--soft" : "btn--primary"}`}
                type="button"
                disabled={sending || (composerText.trim().length < 2 && pending.length === 0)}
                onClick={() => void sendComposer()}
              >
                {sending ? "Отправляю…" : composerMode === "note" ? "Сохранить заметку" : "Отправить ответ"}
              </button>
            </div>
            <div className="composerHint">Вложения хранятся до 180 дней и затем автоматически удаляются.</div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
