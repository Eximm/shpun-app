// web/src/pages/admin/SupportSection.tsx
//
// Admin support helpdesk UI.
// Layout: compact header/context, conversation as the main area, pinned
// composer, diagnostics tucked into a collapsible. Uses the existing backend
// support admin API (no contract changes).

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { refreshSupportUnread, useSupportUnread } from "../../app/notifications/supportUnread";
import { refreshAdminOverview } from "../../app/notifications/adminOverview";
import { useI18n } from "../../shared/i18n";
import {
  ATTACHMENT_ACCEPT,
  buildMessageFormData,
  type TicketAttachment,
} from "../../shared/support/attachments";
import { AttachmentList, PendingFiles } from "../../shared/support/AttachmentViews";
import { useAttachmentComposer, type AttachmentAddError } from "../../shared/support/useAttachmentComposer";
import { AdminFilterBar, AdminSectionHeader, ModalShell, PartnershipTabIcon, SupportTabIcon, UnreadMarker, ADMIN_SECTION_ICON } from "./shared";
import { ActionMenu } from "./ActionMenu";
import { ticketStatusLabel, TICKET_STATUSES } from "../../shared/support/ticketLabels";

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
  deletedAt?: string | null;
  deletedBy?: number | null;
  deletedByName?: string | null;
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

type HistoryTicket = {
  id: number;
  userId: number;
  publicNo: string;
  kind: string;
  status: TicketStatus;
  priority: TicketPriority;
  categoryKey: string;
  subject: string | null;
  serviceId: number | null;
  userServiceId: number | null;
  serviceCategory: string | null;
  serviceTitle: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  closedAt: string | null;
  messageCount: number;
};

type HistoryCompensation = {
  id: number;
  ticketId: number | null;
  serviceId: number | null;
  serviceTitleSnapshot: string | null;
  kind: string;
  amountDays: number | null;
  amountMinor: number | null;
  currency: string | null;
  description: string;
  reason: string | null;
  createdBy: number | null;
  createdAt: string;
};

type HistoryNote = {
  id: number;
  text: string;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string | null;
  isPinned: boolean;
};

type HistoryTimelineEvent =
  | { kind: "ticket"; at: string; ticketId: number; publicNo: string; title: string | null; status: string; serviceTitle: string | null }
  | { kind: "compensation"; at: string; compensationId: number; ticketId: number | null; serviceTitle: string | null; amountDays: number | null; amountMinor: number | null; currency: string | null; description: string }
  | { kind: "note"; at: string; noteId: number; text: string; isPinned: boolean };

type UserHistory = {
  user: { id: number; login: string | null; displayName: string | null; balance: number | null };
  summary: { ticketsTotal: number; ticketsOpen: number; compensationsTotal: number; notesTotal: number; lastTicketAt: string | null };
  tickets: HistoryTicket[];
  compensations: HistoryCompensation[];
  notes: HistoryNote[];
  timeline: HistoryTimelineEvent[];
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

const PARTNERSHIP_TYPE_KEYS: Record<string, string> = {
  blogger: "partnership.type.blogger",
  channel: "partnership.type.channel",
  youtube: "partnership.type.youtube",
  site: "partnership.type.site",
  other: "partnership.type.other",
};

type TFn = ReturnType<typeof useI18n>["t"];

function partnershipTypeLabel(key: string | null | undefined, t: TFn): string {
  if (key && PARTNERSHIP_TYPE_KEYS[key]) return t(PARTNERSHIP_TYPE_KEYS[key]);
  return key || t("partnership.type.other");
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

const STATUS_TONES: Record<TicketStatus, string> = {
  open: "warn",
  in_progress: "accent",
  waiting_user: "ok",
  waiting_staff: "bad",
  resolved: "ok",
  closed: "soft",
};

const PRIORITY_KEYS: Record<TicketPriority, string> = {
  low: "ticket.priority.low",
  normal: "ticket.priority.normal",
  high: "ticket.priority.high",
  urgent: "ticket.priority.urgent",
};

const PRIORITY_TONES: Record<TicketPriority, string> = {
  low: "soft",
  normal: "soft",
  high: "warn",
  urgent: "bad",
};

const SOURCE_KEYS: Record<TicketSource, string> = {
  app: "ticket.source.app",
  telegram: "ticket.source.telegram",
};

const AUTHOR_KEYS: Record<AuthorType, string> = {
  user: "ticket.author.user",
  staff: "ticket.author.staff",
  system: "ticket.author.system",
};

const STATUS_OPTIONS = TICKET_STATUSES;
const PRIORITY_OPTIONS = Object.keys(PRIORITY_KEYS) as TicketPriority[];

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

type DateFormatter = ReturnType<typeof useI18n>["formatDate"];
type CurrencyFormatter = ReturnType<typeof useI18n>["formatCurrency"];

function formatDateTime(value: string | null | undefined, formatDate: DateFormatter) {
  const parsed = parseDate(value);
  return parsed
    ? formatDate(parsed, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : (value || "—");
}

function formatClock(value: string | null | undefined, formatDate: DateFormatter) {
  const parsed = parseDate(value);
  if (!parsed) return value || "";
  const today = new Date();
  const sameDay = parsed.toDateString() === today.toDateString();
  return sameDay
    ? formatDate(parsed, { hour: "2-digit", minute: "2-digit" })
    : formatDate(parsed, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatCost(value: number | null | undefined, formatCurrency: CurrencyFormatter) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return formatCurrency(Number(value));
}

function formatPeriod(period: string | number | null | undefined, t: TFn) {
  if (period === null || period === undefined || period === "") return "—";
  const raw = String(period);
  return /^\d+$/.test(raw) ? t("support.admin.period_months", { n: raw }) : raw;
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

function userLabel(ticket: AdminTicket, t: TFn) {
  return ticket.displayNameSnapshot || ticket.userLoginSnapshot || t("support.admin.user_ref", { id: ticket.userId });
}

/* ─── Copy button (local feedback, no global toast) ──────────────────────── */

function CopyTextButton({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const resolvedLabel = label ?? t("support.admin.copy");

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  // Nothing to copy (e.g. attachment-only message) → no button at all.
  if (!text.trim()) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      className={`supportMsg__copy${copied ? " supportMsg__copy--done" : ""}`}
      onClick={() => void handleCopy()}
      aria-label={copied ? t("common.copied") : resolvedLabel}
      title={copied ? t("common.copied") : resolvedLabel}
    >
      {copied ? `✓ ${t("common.copied")}` : resolvedLabel}
    </button>
  );
}

/* ─── Message bubble ─────────────────────────────────────────────────────── */

function MessageBubble({ message, onDelete }: { message: TicketMessage; onDelete?: (message: TicketMessage) => void }) {
  const { t, formatDate } = useI18n();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  // Soft-deleted message: compact audit placeholder, never the original body.
  if (message.deletedAt) {
    return (
      <div className="supportMsg supportMsg--deleted">
        <div className="supportMsg__meta">
          <strong>{t("support.admin.message_deleted")}</strong>
          {message.deletedByName ? <span>· {t("support.admin.deleted_by", { name: message.deletedByName })}</span> : null}
          <span className="supportMsg__time">{formatClock(message.deletedAt, formatDate)}</span>
        </div>
      </div>
    );
  }

  const isUser = message.authorType === "user";
  const isSystem = message.authorType === "system";

  const menu = onDelete ? (
    <ActionMenu
      anchorEl={menuAnchor}
      open={Boolean(menuAnchor)}
      onClose={() => setMenuAnchor(null)}
      items={[{ label: t("support.admin.action.delete_message"), danger: true, onClick: () => onDelete(message) }]}
    />
  ) : null;

  const actions = (isUser && message.text.trim()) || onDelete ? (
    <div className="supportMsg__actions">
      {isUser && message.text.trim() ? <CopyTextButton text={message.text} /> : null}
      {onDelete ? (
        <button
          type="button"
          className="supportMsg__menuBtn"
          aria-haspopup="menu"
          aria-label={t("support.admin.message_actions")}
          onClick={(e) => setMenuAnchor(e.currentTarget)}
        >
          {"\u22EE"}
        </button>
      ) : null}
    </div>
  ) : null;

  if (message.isInternalNote) {
    return (
      <div className="supportMsg supportMsg--note">
        <div className="supportMsg__meta">
          <strong>{t("support.admin.internal_note")}</strong>
          {message.authorName ? <span>· {message.authorName}</span> : null}
          <span className="supportMsg__time">{formatClock(message.createdAt, formatDate)}</span>
        </div>
        {message.text ? <div className="supportMsg__text">{message.text}</div> : null}
        <AttachmentList attachments={message.attachments} />
        {actions}
        {menu}
      </div>
    );
  }

  const modifier = isUser ? "supportMsg--user" : isSystem ? "supportMsg--system" : "supportMsg--staff";

  return (
    <div className={`supportMsg ${modifier}`}>
      <div className="supportMsg__meta">
        <strong>{t(AUTHOR_KEYS[message.authorType])}</strong>
        {!isUser && !isSystem && message.authorName ? <span>· {message.authorName}</span> : null}
        <span className="supportMsg__time">{formatClock(message.createdAt, formatDate)}</span>
      </div>
      {message.text ? <div className="supportMsg__text">{message.text}</div> : null}
      <AttachmentList attachments={message.attachments} />
      {actions}
      {menu}
    </div>
  );
}

/* ─── Diagnostics ────────────────────────────────────────────────────────── */

function Diagnostics({ ticket }: { ticket: AdminTicket }) {
  const { t, formatCurrency } = useI18n();
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
    { label: "баланс", value: formatCost(balance, formatCurrency) },
    { label: "бонусы", value: contextUser?.bonus != null ? formatCost(contextUser.bonus, formatCurrency) : "—" },
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
        { label: "период", value: formatPeriod(service.period, t) },
        { label: "стоимость", value: formatCost(service.cost, formatCurrency) },
      ]
    : [];

  return (
    <details className="supportDiag">
      <summary>{t("support.admin.diagnostics")}</summary>

      <div className="supportDiag__block">
        <div className="supportDiag__title">{t("support.admin.snapshot_user")}</div>
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
          {ticket.kind === "partnership" ? t("support.admin.snapshot_proposal") : t("support.admin.snapshot_service")}
        </div>
        {ticket.kind === "partnership" ? (
          partnership ? (
            <>
              <div className="supportDiag__grid">
                {[
                  { label: t("support.admin.diag.type"), value: partnershipTypeLabel(partnership.proposal_type, t) },
                  { label: t("support.admin.diag.platform"), value: partnership.platform_url || "—" },
                  { label: t("support.admin.diag.audience"), value: partnership.audience_size || "—" },
                  { label: t("support.admin.diag.contact"), value: partnership.contact || "—" },
                ].map((row) => (
                  <div key={row.label} className="supportDiag__cell">
                    <div className="supportDiag__label">{row.label}</div>
                    <div className="supportDiag__value">{row.value}</div>
                  </div>
                ))}
              </div>
              {partnership.offer ? (
                <div className="admin-gap-top-sm">
                  <div className="supportDiag__label">{t("support.admin.diag.offer")}</div>
                  <div className="supportDiag__value" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{partnership.offer}</div>
                  <div className="supportMsg__actions">
                    <CopyTextButton text={partnership.offer} label={t("support.admin.copy_proposal")} />
                  </div>
                </div>
              ) : null}
              {partnership.comment ? (
                <div className="admin-gap-top-sm">
                  <div className="supportDiag__label">{t("support.admin.diag.comment")}</div>
                  <div className="supportDiag__value" style={{ whiteSpace: "pre-wrap" }}>{partnership.comment}</div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="supportDiag__label">{t("support.admin.no_proposal")}</div>
          )
        ) : serviceRows.length === 0 ? (
          <div className="supportDiag__label">{t("support.admin.no_service")}</div>
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
  const { t, formatDate, tp } = useI18n();
  const statusLabel = (status: TicketStatus) => ticketStatusLabel(status, "admin", t);
  const priorityLabel = (priority: TicketPriority) => t(PRIORITY_KEYS[priority] ?? priority);
  const sourceLabel = (source: TicketSource) => t(SOURCE_KEYS[source] ?? source);
  const [items, setItems] = useState<AdminTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<SupportCategory[]>([]);
  const [kind, setKind] = useState<"support" | "partnership">(initialKind);
  const unreadCounts = useSupportUnread(true);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");

  const [opened, setOpened] = useState<AdminTicket | null>(null);
  const [openedLoading, setOpenedLoading] = useState(false);
  const [openedError, setOpenedError] = useState("");

  const [composerMode, setComposerMode] = useState<"reply" | "note">("reply");
  const [composerText, setComposerText] = useState("");
  const [attachError, setAttachError] = useState<AttachmentAddError | null>(null);
  const attach = useAttachmentComposer({ onError: setAttachError });
  const [sending, setSending] = useState(false);
  const [patching, setPatching] = useState(false);
  const [assigneeDraft, setAssigneeDraft] = useState("");
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const [userHistory, setUserHistory] = useState<UserHistory | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [compDraft, setCompDraft] = useState({ days: "7", description: "" });
  const [compSaving, setCompSaving] = useState(false);
  const [compFormOpen, setCompFormOpen] = useState(false);
  const [noteFormOpen, setNoteFormOpen] = useState(false);
  const compSectionRef = useRef<HTMLElement | null>(null);

  // Synchronous locks prevent double-submit before React re-renders.
  const sendLock = useRef(false);
  const patchLock = useRef(false);
  const openedIdRef = useRef<number | null>(null);
  const autoOpenedRef = useRef(false);
  // The whole modal content is the single scroll container (no nested thread
  // scroller), so long messages are never confined to a tiny viewport.
  const modalContentRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Polling / scroll bookkeeping (merge by id, never resurrect deleted messages).
  const prevCountRef = useRef(0);
  const prevTicketIdRef = useRef<number | null>(null);
  const nearBottomRef = useRef(true);

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
    const el = modalContentRef.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      nearBottomRef.current = near;
      if (near) setHasNewBelow(false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [opened?.id]);

  // Auto-scroll only when the reader is already at the bottom. Otherwise show
  // the "new message" affordance instead of yanking them away from history.
  useEffect(() => {
    const el = modalContentRef.current;
    if (!el || !opened) return;
    const count = opened.messages?.length ?? 0;
    const sameTicket = prevTicketIdRef.current === opened.id;
    const grew = sameTicket && count > prevCountRef.current;
    prevTicketIdRef.current = opened.id;
    prevCountRef.current = count;
    if (!grew || nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      nearBottomRef.current = true;
      setHasNewBelow(false);
    } else {
      setHasNewBelow(true);
    }
  }, [opened?.id, opened?.messages?.length]);

  function scrollToNewest() {
    const el = modalContentRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    nearBottomRef.current = true;
    setHasNewBelow(false);
  }

  // Auto-grow the composer up to the CSS max-height, then scroll internally.
  // The scroll anchor is preserved so typing in a long message never jumps
  // the caret view back to the top when the height is re-measured.
  useEffect(() => {
    const el = composerInputRef.current;
    if (!el) return;
    const maxHeight = parseFloat(window.getComputedStyle(el).maxHeight);
    const cap = Number.isFinite(maxHeight) ? maxHeight : Number.POSITIVE_INFINITY;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
    el.scrollTop = el.scrollHeight - el.clientHeight - fromBottom;
  }, [composerText, composerMode, opened?.id]);

  // Background polling: the ticket list refreshes periodically, and the open
  // ticket polls more often. Both pause while the tab is hidden.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadTickets({ silent: true });
    }, 12000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, filters]);

  useEffect(() => {
    const openedId = opened?.id ?? null;
    const timer = openedId
      ? window.setInterval(() => {
          if (!document.hidden) void loadOpenedSilently(openedId);
        }, 4000)
      : null;
    const onFocus = () => {
      if (openedId) void loadOpenedSilently(openedId);
      void loadTickets({ silent: true });
    };
    const onVisibility = () => { if (!document.hidden) onFocus(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer) window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened?.id, kind, filters]);

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
      setListError(errorMessage(error, t("support.admin.list_failed")));
    } finally {
      if (!options.silent) setLoading(false);
    }
  }

  // Merge by canonical message id: union of local+incoming, and a deleted
  // message is never resurrected by a stale polling response.
  function mergeMessages(local: TicketMessage[], incoming: TicketMessage[]): TicketMessage[] {
    const map = new Map<number, TicketMessage>();
    for (const m of local) map.set(m.id, m);
    for (const m of incoming) {
      const prev = map.get(m.id);
      if (prev?.deletedAt && !m.deletedAt) continue;
      map.set(m.id, m);
    }
    return Array.from(map.values()).sort((a, b) => a.id - b.id);
  }

  function mergeTicket(prev: AdminTicket, next: AdminTicket): AdminTicket {
    if (prev.id !== next.id) return next;
    return { ...next, messages: mergeMessages(prev.messages ?? [], next.messages ?? []) };
  }

  function applyTicketUpdate(next: AdminTicket) {
    setOpened((prev) => (prev && prev.id === next.id ? mergeTicket(prev, next) : next));
  }

  async function loadOpenedSilently(id: number) {
    try {
      const response = await apiFetch<{ ok: true; ticket: AdminTicket }>(`/admin/support/tickets/${id}`, { method: "GET" });
      if (openedIdRef.current !== id) return;
      applyTicketUpdate(response.ticket);
    } catch {
      // Background refresh failed: keep the current view, retry on next tick.
    }
  }

  function refreshAll() {
    void loadTickets({ silent: true });
    const id = openedIdRef.current;
    if (id) void loadOpenedSilently(id);
  }

  async function loadUserHistory(userId: number, options: { silent?: boolean } = {}) {
    if (!options.silent) setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await apiFetch<{ ok: true; history: UserHistory }>(
        `/admin/support/users/${userId}/history`,
        { method: "GET" },
      );
      setUserHistory(response.history);
    } catch (error) {
      setHistoryError(errorMessage(error, t("support.history.err")));
    } finally {
      if (!options.silent) setHistoryLoading(false);
    }
  }

  function openHistory() {
    setHistoryOpen(true);
    setCompFormOpen(false);
    setNoteFormOpen(false);
    if (opened) void loadUserHistory(opened.userId, { silent: true });
  }

  async function addHistoryNote() {
    if (!opened) return;
    const text = noteDraft.trim();
    if (!text) return;
    setNoteSaving(true);
    try {
      await apiFetch(`/admin/support/users/${opened.userId}/notes`, { method: "POST", body: { text } });
      setNoteDraft("");
      setNoteFormOpen(false);
      setNotice(t("support.history.note.saved"));
      await loadUserHistory(opened.userId, { silent: true });
    } catch (error) {
      setHistoryError(errorMessage(error, t("support.history.err")));
    } finally {
      setNoteSaving(false);
    }
  }

  async function addHistoryCompensation() {
    if (!opened) return;
    const description = compDraft.description.trim();
    if (!description) return;
    setCompSaving(true);
    try {
      await apiFetch(`/admin/support/users/${opened.userId}/compensations`, {
        method: "POST",
        body: {
          ticketId: opened.id,
          serviceId: opened.serviceId,
          serviceTitle: opened.serviceSnapshot?.name ?? null,
          kind: "days",
          amountDays: compDraft.days === "" ? null : Number(compDraft.days),
          description,
        },
      });
      setCompDraft({ days: "7", description: "" });
      setCompFormOpen(false);
      setNotice(t("support.history.comp.saved"));
      await loadUserHistory(opened.userId, { silent: true });
    } catch (error) {
      setHistoryError(errorMessage(error, t("support.history.err")));
    } finally {
      setCompSaving(false);
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
      applyTicketUpdate(response.ticket);
      setComposerText("");
      void loadUserHistory(response.ticket.userId);
      // Clear the local unread marker and refresh the badge. The backend
      // already marked the ticket read when it served the detail request.
      setItems((prev) => prev.map((t) => (t.id === id ? { ...t, unread: false } : t)));
      void refreshSupportUnread();
      void refreshAdminOverview();
    } catch (error) {
      setOpenedError(errorMessage(error, t("support.admin.open_failed")));
    } finally {
      setOpenedLoading(false);
    }
  }

  function closeTicket() {
    setOpened(null);
    setOpenedError("");
    setNotice("");
    setComposerText("");
    setUserHistory(null);
    setHistoryOpen(false);
    setCompFormOpen(false);
    setNoteFormOpen(false);
  }

  async function sendComposer() {
    if (!opened) return;
    const payload = composerText.trim();
    if (payload.length < 2 && attach.pending.length === 0) {
      setOpenedError(t("support.admin.too_short"));
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
      const body = attach.pending.length
        ? buildMessageFormData(payload, attach.pending.map((f) => f.file), { internal: internal ? "1" : "0" })
        : { text: payload, internal };
      const response = await apiFetch<{ ok: true; ticket: AdminTicket }>(
        `/admin/support/tickets/${ticketId}/messages`,
        { method: "POST", body },
      );
      if (openedIdRef.current !== ticketId) return;
      applyTicketUpdate(response.ticket);
      attach.clearPending();
      setAttachError(null);
      setComposerText("");
      setNotice(internal ? t("support.admin.note_added") : t("support.admin.reply_sent"));
      void loadTickets({ silent: true });
      void refreshSupportUnread();
      void refreshAdminOverview();
    } catch (error) {
      if (openedIdRef.current === ticketId) {
        setOpenedError(errorMessage(error, internal ? t("support.admin.note_failed") : t("support.admin.reply_failed")));
      }
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  function handlePickFiles(event: React.ChangeEvent<HTMLInputElement>) {
    setAttachError(null);
    attach.onPickFiles(event);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    setAttachError(null);
    attach.onPaste(event);
  }

  function handleRemovePending(id: string) {
    setAttachError(null);
    attach.removePending(id);
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
      applyTicketUpdate(response.ticket);
      setNotice(t("support.admin.updated"));
      void loadTickets({ silent: true });
    } catch (error) {
      if (openedIdRef.current === ticketId) {
        setOpenedError(errorMessage(error, t("support.admin.update_failed")));
      }
    } finally {
      patchLock.current = false;
      setPatching(false);
    }
  }

  async function deleteMessage(message: TicketMessage) {
    if (!opened) return;
    if (!window.confirm(t("support.admin.confirm_delete_message"))) return;
    const ticketId = opened.id;
    setOpenedError("");
    setNotice("");
    try {
      const response = await apiFetch<{ ok: true; ticket: AdminTicket }>(
        `/admin/support/messages/${message.id}`,
        { method: "DELETE" },
      );
      if (openedIdRef.current !== ticketId) return;
      applyTicketUpdate(response.ticket);
      setNotice(t("support.admin.message_deleted"));
      void loadTickets({ silent: true });
    } catch (error) {
      if (openedIdRef.current === ticketId) {
        setOpenedError(errorMessage(error, t("support.admin.delete_failed")));
      }
    }
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
  }

  const activeFilterCount = [
    filters.status,
    filters.priority,
    filters.categoryKey,
    filters.assignedTo.trim(),
    filters.q.trim(),
    filters.unassigned ? "unassigned" : "",
  ].filter(Boolean).length;

  const messages = opened?.messages ?? [];
  const sameServiceCompensations = useMemo(() => {
    if (!userHistory || !opened?.serviceId) return [];
    return userHistory.compensations.filter((c) => c.serviceId === opened.serviceId);
  }, [userHistory, opened?.serviceId]);

  const historyServiceTitle = (ticket: { serviceTitle?: string | null; subject?: string | null; serviceSnapshot?: { name?: string | null } | null }) =>
    ticket.serviceTitle || ticket.subject || ticket.serviceSnapshot?.name || t("support.service_word");
  const formatCompAmount = (c: HistoryCompensation) =>
    c.amountDays != null
      ? `+${tp("support.history.days", c.amountDays)}`
      : c.amountMinor != null
        ? `+${c.amountMinor} ${c.currency ?? ""}`.trim()
        : "—";
  const compPublicNo = (c: HistoryCompensation) => {
    if (!c.ticketId) return "";
    return userHistory?.tickets.find((x) => x.id === c.ticketId)?.publicNo ?? String(c.ticketId);
  };
  const compForTicket = (ht: HistoryTicket) =>
    userHistory?.compensations.find((c) => c.ticketId === ht.id) ??
    (ht.serviceId ? userHistory?.compensations.find((c) => c.serviceId === ht.serviceId) : undefined);
  const pinnedNote = userHistory?.notes.find((n) => n.isPinned) ?? null;
  const latestSameCompensation = sameServiceCompensations[0] ?? null;

  return (
    <div className="card">
      <div className="card__body">
        <AdminSectionHeader
          icon={ADMIN_SECTION_ICON.support}
          kicker={t("support.admin.kicker")}
          title={t("support.admin.title")}
          subtitle={kind === "partnership"
            ? t("support.admin.partnership_subtitle")
            : t("support.admin.subtitle")}
          actions={
            <button className="btn btn--soft" type="button" onClick={refreshAll} disabled={loading}>
              {loading ? t("common.refreshing") : t("common.refresh")}
            </button>
          }
        />

        <div className="supportKindTabs">
          <button
            type="button"
            className={`supportKindTab${kind === "support" ? " supportKindTab--active" : ""}`}
            onClick={() => setKind("support")}
          >
            <SupportTabIcon />
            <span>{t("support.admin.tab.support")}</span>
            <UnreadMarker count={unreadCounts.support} variant="badge" />
          </button>
          <button
            type="button"
            className={`supportKindTab${kind === "partnership" ? " supportKindTab--active" : ""}`}
            onClick={() => setKind("partnership")}
          >
            <PartnershipTabIcon />
            <span>{t("support.admin.tab.partnership")}</span>
            <UnreadMarker count={unreadCounts.partnership} variant="badge" />
          </button>
        </div>

        {/* ── Filters ── */}
        <AdminFilterBar activeCount={activeFilterCount}>
          <label className="field">
            <span className="field__label">{t("support.admin.filter.status")}</span>
            <select className="input" value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
              <option value="">{t("support.admin.filter.all")}</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{statusLabel(status)}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">{t("support.admin.filter.priority")}</span>
            <select className="input" value={filters.priority} onChange={(e) => setFilters((p) => ({ ...p, priority: e.target.value }))}>
              <option value="">{t("support.admin.filter.all")}</option>
              {PRIORITY_OPTIONS.map((priority) => (
                <option key={priority} value={priority}>{priorityLabel(priority)}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">{t("support.admin.filter.category")}</span>
            <select className="input" value={filters.categoryKey} onChange={(e) => setFilters((p) => ({ ...p, categoryKey: e.target.value }))}>
              <option value="">{t("support.admin.filter.all")}</option>
              {categories.map((category) => (
                <option key={category.key} value={category.key}>{category.title}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">{t("support.admin.filter.operator")}</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder={t("support.admin.filter.operator_ph")}
              value={filters.assignedTo}
              disabled={filters.unassigned}
              onChange={(e) => setFilters((p) => ({ ...p, assignedTo: e.target.value.replace(/[^\d]/g, "") }))}
            />
          </label>

          <label className="field">
            <span className="field__label">{t("support.admin.filter.search")}</span>
            <input className="input" placeholder={t("support.admin.filter.search_ph")} value={filters.q} onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))} />
          </label>

          <label className="field supportFilters__check">
            <span className="supportFilters__checkLine">
              <input
                type="checkbox"
                checked={filters.unassigned}
                onChange={(e) => setFilters((p) => ({ ...p, unassigned: e.target.checked, assignedTo: e.target.checked ? "" : p.assignedTo }))}
              />
              <span className="field__label" style={{ margin: 0 }}>{t("support.admin.filter.unassigned")}</span>
            </span>
          </label>
        </AdminFilterBar>

        {activeFilterCount > 0 && (
          <div className="admin-gap-top-sm">
            <button className="btn btn--soft" type="button" onClick={resetFilters} disabled={loading}>{t("support.admin.filter.reset")}</button>
          </div>
        )}

        {listError && <div className="pre admin-gap-top-md">{listError}</div>}

        <h3 className="h2 admin-gap-top-md">{t("support.admin.list_title", { count: total })}</h3>

        {loading ? (
          <div className="list admin-gap-top-md">
            <div className="skeleton h1" />
            <div className="skeleton p" />
          </div>
        ) : items.length === 0 ? (
          <p className="p admin-gap-top-md">{t("support.admin.empty")}</p>
        ) : (
          <div className="list admin-gap-top-md">
            {items.map((ticket) => (
              <div
                key={ticket.id}
                className="list__item is-clickable admin-tightItem admin-ticketCard"
                role="button"
                tabIndex={0}
                onClick={() => void openTicket(ticket.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") void openTicket(ticket.id);
                }}
              >
                <div className="admin-ticketCard__head">
                  <div className="admin-ticketCard__title">
                    <UnreadMarker count={ticket.unread ? 1 : 0} />
                    <span className="admin-ticketCard__id">#{ticket.publicNo}</span>
                    <span className="admin-ticketCard__sep">{" · "}</span>
                    <span className="admin-ticketCard__user">{userLabel(ticket, t)}</span>
                  </div>
                  <div className="admin-ticketCard__badges">
                    <span className={`chip chip--${STATUS_TONES[ticket.status]}`}>{statusLabel(ticket.status)}</span>
                    {(ticket.priority === "high" || ticket.priority === "urgent") && (
                      <span className={`chip chip--${PRIORITY_TONES[ticket.priority]}`}>{priorityLabel(ticket.priority)}</span>
                    )}
                  </div>
                </div>
                <div className="admin-ticketCard__meta">
                  {categoryTitles.get(ticket.categoryKey) ?? ticket.categoryKey}
                  {" · "}
                  {sourceLabel(ticket.source)}
                  {ticket.userServiceId ? ` · ${t("support.admin.service_ref", { id: ticket.userServiceId })}` : ""}
                  {" · "}
                  {formatClock(ticket.lastMessageAt, formatDate) || "—"}
                  {" · "}
                  {ticket.assignedTo != null ? t("support.admin.operator_ref", { id: ticket.assignedTo }) : t("support.admin.unassigned")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Detail modal ── */}
      {openedLoading && !opened && (
        <ModalShell title={t("support.admin.loading")} kicker={t("support.admin.kicker")} onClose={closeTicket}>
          <div className="list">
            <div className="skeleton h1" />
            <div className="skeleton p" />
          </div>
        </ModalShell>
      )}

      {opened && (
        <ModalShell
          title={opened.subject ? `#${opened.publicNo} · ${opened.subject}` : `#${opened.publicNo}`}
          kicker={`${categoryTitles.get(opened.categoryKey) ?? opened.categoryKey} · ${sourceLabel(opened.source)}`}
          onClose={closeTicket}
          contentRef={modalContentRef}
        >
          {openedError && <div className="pre">{openedError}</div>}
          {notice && <div className="pre admin-gap-top-sm">{notice}</div>}

          {/* Meta / controls (single place for status & priority) */}
          <div className="supportDetail__meta admin-gap-top-sm">
            <label className="field">
              <span className="field__label">{t("support.admin.filter.status")}</span>
              <select className="input" value={opened.status} disabled={patching} onChange={(e) => void patchTicket({ status: e.target.value })}>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>{statusLabel(status)}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">{t("support.admin.filter.priority")}</span>
              <select className="input" value={opened.priority} disabled={patching} onChange={(e) => void patchTicket({ priority: e.target.value })}>
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>{priorityLabel(priority)}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">{t("support.admin.filter.operator")}</span>
              <div className="supportDetail__operator">
                <input
                  className="input"
                  inputMode="numeric"
                  placeholder={t("support.admin.no_operator_ph")}
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
                  {t("common.ok")}
                </button>
              </div>
            </label>
          </div>

          {/* Compact context */}
          <div className="supportDetail__context">
            <span><strong>{userLabel(opened, t)}</strong> · #{opened.userId}</span>
            {opened.kind === "partnership" ? (
              partnershipOf(opened)?.platform_url ? (
                <span>{t("support.admin.platform")}: {partnershipOf(opened)?.platform_url}</span>
              ) : null
            ) : opened.serviceSnapshot || opened.userServiceId ? (
              <span>
                {t("support.service_word")}{opened.userServiceId ? ` #${opened.userServiceId}` : ""}
                {opened.serviceSnapshot?.name ? ` · ${opened.serviceSnapshot.name}` : ""}
                {opened.serviceSnapshot?.status ? ` · ${opened.serviceSnapshot.status}` : ""}
              </span>
            ) : null}
            <span>{t("support.admin.created_at", { date: formatDateTime(opened.createdAt, formatDate) })}</span>
          </div>

          <Diagnostics ticket={opened} />

          {userHistory && userHistory.user.id === opened.userId ? (
            <div className="supportUserSummary">
              <div className="supportUserSummary__stats">
                <span>{t("support.history.stat.tickets", { n: userHistory.summary.ticketsTotal })}</span>
                <span>{t("support.history.stat.open", { n: userHistory.summary.ticketsOpen })}</span>
                <span>{t("support.history.stat.compensations", { n: userHistory.summary.compensationsTotal })}</span>
              </div>
              {latestSameCompensation ? (
                <div className="supportUserSummary__warn supportUserSummary__warn--strong">
                  <div>{t("support.history.warn.same_title")}</div>
                  <div className="supportUserSummary__warnBody">
                    {formatDateTime(latestSameCompensation.createdAt, formatDate)} · {formatCompAmount(latestSameCompensation)} · {latestSameCompensation.serviceTitleSnapshot || historyServiceTitle(opened)}
                    {compPublicNo(latestSameCompensation) ? ` · #${compPublicNo(latestSameCompensation)}` : ""}
                  </div>
                  {latestSameCompensation.ticketId ? (
                    <button className="btn btn--soft" type="button" onClick={() => void openTicket(latestSameCompensation.ticketId as number)}>
                      {t("support.history.action.open_ticket")}
                    </button>
                  ) : null}
                </div>
              ) : userHistory.summary.compensationsTotal > 0 ? (
                <div className="supportUserSummary__warn">
                  <div>{t("support.history.warn.previous_other")}</div>
                  <button className="btn btn--soft" type="button" onClick={openHistory}>{t("support.history.warn.view")}</button>
                </div>
              ) : null}
              <button className="btn btn--soft" type="button" onClick={openHistory}>{t("support.history.open")}</button>
            </div>
          ) : null}

          {/* Conversation */}
          <div className="supportDetail__thread">
            {messages.length === 0 ? (
              <div className="supportDetail__empty">{t("support.no_messages")}</div>
            ) : (
              messages.map((message) => <MessageBubble key={message.id} message={message} onDelete={deleteMessage} />)
            )}
          </div>
          {hasNewBelow ? (
            <button className="supportNewBelow" type="button" onClick={scrollToNewest}>
              {t("support.admin.new_message")} ↓
            </button>
          ) : null}

          {/* Pinned composer */}
          <div className="supportDetail__composer">
            <div className="supportMode" role="tablist" aria-label={t("support.admin.internal_note")}>
              <button
                type="button"
                role="tab"
                aria-selected={composerMode === "reply"}
                className={`supportMode__btn${composerMode === "reply" ? " supportMode__btn--active" : ""}`}
                onClick={() => setComposerMode("reply")}
              >
                {t("support.admin.mode.reply")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={composerMode === "note"}
                className={`supportMode__btn${composerMode === "note" ? " supportMode__btn--active" : ""}`}
                onClick={() => setComposerMode("note")}
              >
                {t("support.admin.mode.note")}
              </button>
            </div>

            <textarea
              ref={composerInputRef}
              className="input supportDetail__input supportComposer__input"
              rows={4}
              value={composerText}
              maxLength={4000}
              disabled={sending}
              placeholder={composerMode === "note" ? t("support.admin.composer.note_ph") : t("support.admin.composer.reply_ph")}
              onChange={(e) => setComposerText(e.target.value)}
              onPaste={handlePaste}
            />

            <PendingFiles files={attach.pending} onRemove={handleRemovePending} disabled={sending} />
            {attachError && (
              <div className="attachError" role="alert">{t(`support.attach.error.${attachError}`)}</div>
            )}

            <div className="supportComposer__toolbar">
              <button
                className="composerAttach"
                type="button"
                aria-label={t("support.attach")}
                disabled={sending || attach.atMaxFiles}
                onClick={() => fileInputRef.current?.click()}
              >
                📎
              </button>
              <input ref={fileInputRef} type="file" multiple accept={ATTACHMENT_ACCEPT} style={{ display: "none" }} onChange={handlePickFiles} />
              <button
                className={`btn ${composerMode === "note" ? "btn--soft" : "btn--primary"}`}
                type="button"
                disabled={sending || (composerText.trim().length < 2 && attach.pending.length === 0)}
                onClick={() => void sendComposer()}
              >
                {sending ? t("common.sending") : composerMode === "note" ? t("support.admin.save_note") : t("support.admin.send_reply")}
              </button>
            </div>
            <div className="composerAttachHint">{t("support.attach.hint")}</div>
            <div className="composerHint">{t("support.retention")}</div>
          </div>
        </ModalShell>
      )}

      {historyOpen && opened && (
        <ModalShell
          title={t("support.history.title")}
          kicker={`#${opened.userId}`}
          onClose={() => setHistoryOpen(false)}
          cardClassName="admin-modal__card--wide"
        >
          <div className="supportHistory">
            {historyError ? <div className="pre">{historyError}</div> : null}
            {historyLoading && !userHistory ? <p className="p">{t("common.loading")}</p> : null}
            {userHistory ? (
              <>
                {/* Summary — compact: who + 3 numbers */}
                <div className="supportHistory__summary">
                  <div className="supportHistory__user">
                    {userHistory.user.displayName || userHistory.user.login || t("support.admin.user_ref", { id: userHistory.user.id })} · #{userHistory.user.id}
                  </div>
                  <div className="supportHistory__stats">
                    <span>{t("support.history.stat.tickets", { n: userHistory.summary.ticketsTotal })}</span>
                    <span>{t("support.history.stat.open", { n: userHistory.summary.ticketsOpen })}</span>
                    <span>{t("support.history.stat.compensations", { n: userHistory.summary.compensationsTotal })}</span>
                  </div>
                </div>

                {/* Same-service warning — loud, above the fold */}
                {latestSameCompensation ? (
                  <div className="supportHistory__warning supportHistory__warning--strong">
                    <div className="supportHistory__warningTitle">{t("support.history.warn.same_title")}</div>
                    <div className="supportHistory__warningBody">
                      {formatDateTime(latestSameCompensation.createdAt, formatDate)} · {formatCompAmount(latestSameCompensation)} · {latestSameCompensation.serviceTitleSnapshot || historyServiceTitle(opened)}
                      {compPublicNo(latestSameCompensation) ? ` · #${compPublicNo(latestSameCompensation)}` : ""}
                    </div>
                    {latestSameCompensation.ticketId ? (
                      <button className="btn btn--soft" type="button" onClick={() => { setHistoryOpen(false); void openTicket(latestSameCompensation.ticketId as number); }}>
                        {t("support.history.action.open_ticket")}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {/* Generic previous-compensations hint (other services only) */}
                {userHistory.summary.compensationsTotal > 0 && sameServiceCompensations.length === 0 ? (
                  <div className="supportHistory__warning">
                    <div className="supportHistory__warningBody">{t("support.history.warn.previous_other")}</div>
                    <button className="btn btn--soft" type="button" onClick={() => compSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                      {t("support.history.warn.view")}
                    </button>
                  </div>
                ) : null}

                {/* Pinned operator note — always on top */}
                {pinnedNote ? (
                  <div className="supportHistory__pinnedNote">
                    <div className="supportHistory__noteText">{pinnedNote.text}</div>
                    <div className="supportHistory__meta">
                      <span className="chip chip--ok">{t("support.history.note.pinned")}</span>
                      <span>{formatDateTime(pinnedNote.createdAt, formatDate)}{pinnedNote.createdBy ? ` · #${pinnedNote.createdBy}` : ""}</span>
                    </div>
                  </div>
                ) : null}

                {/* Tickets — the main block */}
                <section className="supportHistory__section">
                  <div className="supportHistory__title">{t("support.history.section.tickets")}</div>
                  {userHistory.tickets.map((ht) => {
                    const comp = compForTicket(ht);
                    return (
                      <div className="supportHistory__ticket" key={ht.id}>
                        <div className="supportHistory__ticketMain">
                          <div className="supportHistory__ticketTitle">#{ht.publicNo} · {historyServiceTitle(ht)}</div>
                          <div className="supportHistory__meta">
                            <span>{formatDateTime(ht.createdAt, formatDate)}</span>
                            <span>· {statusLabel(ht.status as TicketStatus)}</span>
                          </div>
                          {comp ? (
                            <div className="supportHistory__ticketComp">
                              {t("support.history.comp.in_ticket")} · {formatCompAmount(comp)}
                            </div>
                          ) : null}
                        </div>
                        {ht.id !== opened.id ? (
                          <button className="btn btn--soft" type="button" onClick={() => { setHistoryOpen(false); void openTicket(ht.id); }}>
                            {t("support.history.action.open_ticket")}
                          </button>
                        ) : (
                          <span className="chip chip--soft">{t("support.history.current")}</span>
                        )}
                      </div>
                    );
                  })}
                </section>

                {/* Compensations */}
                <section className="supportHistory__section" ref={compSectionRef}>
                  <div className="supportHistory__title">{t("support.history.section.compensations")}</div>
                  {userHistory.compensations.length === 0 ? (
                    <p className="supportHistory__empty">{t("support.history.comp.none")}</p>
                  ) : (
                    userHistory.compensations.map((c) => (
                      <div className="supportHistory__comp" key={c.id}>
                        <div className="supportHistory__compMain">
                          <div className="supportHistory__compMark">{formatCompAmount(c)}</div>
                          <div className="supportHistory__meta">
                            {formatDateTime(c.createdAt, formatDate)} · {c.serviceTitleSnapshot || "—"}
                            {compPublicNo(c) ? ` · #${compPublicNo(c)}` : ""}
                          </div>
                          {c.description ? <div className="supportHistory__meta">{c.description}</div> : null}
                        </div>
                        {c.ticketId ? (
                          <button className="btn btn--soft" type="button" onClick={() => { setHistoryOpen(false); void openTicket(c.ticketId as number); }}>
                            {t("support.history.action.open_ticket")}
                          </button>
                        ) : null}
                      </div>
                    ))
                  )}
                  {compFormOpen ? (
                    <div className="supportHistory__form">
                      <label className="field">
                        <span className="field__label">{t("support.history.comp.days")}</span>
                        <input className="input" inputMode="numeric" value={compDraft.days} onChange={(e) => setCompDraft({ ...compDraft, days: e.target.value.replace(/\D/g, "") })} />
                      </label>
                      <label className="field supportHistory__fieldGrow">
                        <span className="field__label">{t("support.history.comp.description")}</span>
                        <input className="input" value={compDraft.description} onChange={(e) => setCompDraft({ ...compDraft, description: e.target.value })} />
                      </label>
                      <button className="btn btn--primary" type="button" disabled={compSaving || !compDraft.description.trim()} onClick={() => void addHistoryCompensation()}>
                        {t("support.history.comp.save")}
                      </button>
                      <button className="btn btn--soft" type="button" onClick={() => setCompFormOpen(false)}>{t("common.cancel")}</button>
                    </div>
                  ) : (
                    <button className="btn btn--soft supportHistory__addBtn" type="button" onClick={() => setCompFormOpen(true)}>
                      {userHistory.compensations.length === 0 ? t("support.history.comp.create") : t("support.history.comp.add_more")}
                    </button>
                  )}
                </section>

                {/* Internal notes */}
                <section className="supportHistory__section">
                  <div className="supportHistory__title">{t("support.history.section.notes")}</div>
                  {userHistory.notes.length === 0 ? (
                    <p className="supportHistory__empty">{t("support.history.note.none")}</p>
                  ) : (
                    userHistory.notes.map((n) => (
                      <div className={`supportHistory__note${n.isPinned ? " supportHistory__note--pinned" : ""}`} key={n.id}>
                        <div className="supportHistory__noteText">{n.text}</div>
                        <div className="supportHistory__meta">
                          {n.isPinned ? <span className="chip chip--ok">{t("support.history.note.pinned")}</span> : null}
                          <span>{formatDateTime(n.createdAt, formatDate)}{n.createdBy ? ` · #${n.createdBy}` : ""}</span>
                        </div>
                      </div>
                    ))
                  )}
                  {noteFormOpen ? (
                    <div className="supportHistory__form">
                      <label className="field supportHistory__fieldGrow">
                        <span className="field__label">{t("support.history.note.add")}</span>
                        <textarea className="input" rows={2} value={noteDraft} placeholder={t("support.history.note.ph")} onChange={(e) => setNoteDraft(e.target.value)} />
                      </label>
                      <button className="btn btn--primary" type="button" disabled={noteSaving || !noteDraft.trim()} onClick={() => void addHistoryNote()}>
                        {t("support.history.note.save")}
                      </button>
                      <button className="btn btn--soft" type="button" onClick={() => setNoteFormOpen(false)}>{t("common.cancel")}</button>
                    </div>
                  ) : (
                    <button className="btn btn--soft supportHistory__addBtn" type="button" onClick={() => setNoteFormOpen(true)}>{t("support.history.note.create")}</button>
                  )}
                </section>
              </>
            ) : null}
          </div>
        </ModalShell>
      )}
    </div>
  );
}
