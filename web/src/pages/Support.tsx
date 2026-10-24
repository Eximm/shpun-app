// web/src/pages/Support.tsx
//
// User-facing support: my tickets + create + ticket chat + close.
// Uses the existing /api/support/* endpoints. No manual user/service data entry:
// identity and service snapshot are resolved server-side.

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch, ApiError } from "../shared/api/client";
import { PageBackButton } from "../shared/ui/PageBackButton";
import { toast } from "../shared/ui/toast";
import { useI18n } from "../shared/i18n";
import {
  ATTACHMENT_ACCEPT,
  buildMessageFormData,
  type TicketAttachment,
} from "../shared/support/attachments";
import { AttachmentList, PendingFiles } from "../shared/support/AttachmentViews";
import { useAttachmentComposer, type AttachmentAddError } from "../shared/support/useAttachmentComposer";
import { ticketStatusLabel } from "../shared/support/ticketLabels";

type TicketStatus =
  | "open"
  | "in_progress"
  | "waiting_user"
  | "waiting_staff"
  | "resolved"
  | "closed";

type TicketMessage = {
  id: number;
  authorType: "user" | "staff" | "system";
  authorName: string | null;
  text: string;
  isInternalNote: boolean;
  createdAt: string;
  attachments?: TicketAttachment[];
};

type UserTicket = {
  id: number;
  publicNo: string;
  kind: "support" | "partnership";
  categoryKey: string;
  subject: string | null;
  status: TicketStatus;
  userServiceId: number | null;
  lastMessageAt: string;
  createdAt: string;
  closedAt: string | null;
  unread?: boolean;
  messages?: TicketMessage[];
  assistant?: { enabled: boolean; mode: "active" | "staff" | "resolved"; pending?:boolean };
};

type SupportCategory = { key: string; title: string; description: string | null };

type ServiceItem = {
  userServiceId: number;
  title: string;
  category: string;
  status: string;
  statusRaw?: string;
};

const STATUS_TONES: Record<TicketStatus, string> = {
  open: "warn",
  in_progress: "accent",
  waiting_user: "bad",
  waiting_staff: "soft",
  resolved: "ok",
  closed: "soft",
};

const CLOSEABLE: TicketStatus[] = ["open", "waiting_staff", "waiting_user", "resolved"];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function Support() {
  const { t, formatDate } = useI18n();
  const [searchParams] = useSearchParams();
  const autoOpenedRef = useRef(false);
  const [view, setView] = useState<"list" | "create" | "detail">("list");
  const [tickets, setTickets] = useState<UserTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [categories, setCategories] = useState<SupportCategory[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);

  const [opened, setOpened] = useState<UserTicket | null>(null);
  const [pendingAssistantIds, setPendingAssistantIds] = useState<number[]>([]);
  const assistantTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAssistantIdsRef = useRef(new Set<number>());
  const isAssistantMessage = (m: TicketMessage) => m.authorType === "system" && m.authorName === "Помощник Shpun";
  function finishAssistantAnimation() {
    if (assistantTimerRef.current) clearTimeout(assistantTimerRef.current);
    assistantTimerRef.current = null;
    setPendingAssistantIds([]);
  }
  function showReply(ticket: UserTicket) {
    finishAssistantAnimation();
    const alreadyVisible = new Set(opened?.id === ticket.id ? (opened.messages ?? []).map(m => m.id) : []);
    const fresh = (ticket.messages ?? []).filter(m => isAssistantMessage(m) && !alreadyVisible.has(m.id) && !shownAssistantIdsRef.current.has(m.id));
    for (const m of ticket.messages ?? []) if (isAssistantMessage(m)) shownAssistantIdsRef.current.add(m.id);
    setOpened(ticket);
    if (fresh.length) {
      setPendingAssistantIds(fresh.map(m => m.id));
      assistantTimerRef.current = setTimeout(() => {
        assistantTimerRef.current = null;
        setPendingAssistantIds([]);
      }, 1600);
    }
  }
  useEffect(() => () => { if (assistantTimerRef.current) clearTimeout(assistantTimerRef.current); }, []);
  useEffect(() => { if (view !== "detail") finishAssistantAnimation(); }, [view]);
  const [replyText, setReplyText] = useState("");
  const [attachError, setAttachError] = useState<AttachmentAddError | null>(null);
  const attach = useAttachmentComposer({ onError: setAttachError });
  const [sending, setSending] = useState(false);
  const sendLockRef = useRef(false);
  const createLockRef = useRef(false);
  const ticketRevisionRef = useRef(0);
  const cooldownUntilRef = useRef(0);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCooldownSeconds(Math.max(0, Math.ceil((cooldownUntilRef.current - Date.now()) / 1000)));
    }, 250);
    return () => window.clearInterval(timer);
  }, []);
  const [closing, setClosing] = useState(false);
  const [requestingStaff, setRequestingStaff] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Create form
  const [selService, setSelService] = useState<number | null>(null);
  const [selCategory, setSelCategory] = useState("");
  const [describe, setDescribe] = useState("");
  const [creating, setCreating] = useState(false);

  const threadRef = useRef<HTMLDivElement | null>(null);

  const statusLabel = (status: TicketStatus) => ticketStatusLabel(status, "user", t);

  const fmt = (value?: string | null) => {
    const d = parseDate(value);
    if (!d) return value || "—";
    const today = new Date();
    return d.toDateString() === today.toDateString()
      ? formatDate(d, { hour: "2-digit", minute: "2-digit" })
      : formatDate(d, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  function Bubble({ message }: { message: TicketMessage }) {
    const isUser = message.authorType === "user";
    const isSystem = message.authorType === "system";
    const isAssistant = isAssistantMessage(message);
    const cls = isAssistant ? "supportMsg supportMsg--assistant" : isSystem ? "supportMsg supportMsg--system" : isUser ? "supportMsg supportMsg--user" : "supportMsg supportMsg--staff";
    const author = isUser ? t("support.author.you") : isSystem && message.authorName === "Помощник Shpun"
      ? t("support.assistant.name") : isSystem ? t("support.author.system") : t("support.author.staff");
    return (
      <div className={cls}>
        <div className="supportMsg__meta">
          <strong>{author}</strong>
          {isAssistant ? <span className="supportAssistantBadge">{t("support.assistant.badge")}</span> : null}
          {!isUser && !isSystem && message.authorName ? <span>· {message.authorName}</span> : null}
          <span className="supportMsg__time">{fmt(message.createdAt)}</span>
        </div>
        {message.text ? <div className="supportMsg__text">{message.text}</div> : null}
        <AttachmentList attachments={message.attachments} />
      </div>
    );
  }

  const categoryTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.key, c.title);
    return map;
  }, [categories]);

  useEffect(() => {
    void loadList();
    void loadCategories();
    void loadServices();
  }, []);

  // Deep link: /support?ticket=<id> opens the specific ticket once
  // (used by staff-reply notifications for app-source tickets).
  useEffect(() => {
    if (autoOpenedRef.current) return;
    const id = Number(searchParams.get("ticket") ?? 0);
    if (!Number.isFinite(id) || id <= 0) return;
    autoOpenedRef.current = true;
    void openTicket(id);
  }, [searchParams]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [opened?.id, opened?.messages?.length, pendingAssistantIds.length, opened?.assistant?.pending]);

  useEffect(() => {
    if (view === "detail" && opened) threadRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [view, opened?.id]);

  async function loadList() {
    setLoading(true);
    setError("");
    try {
      const r = await apiFetch<{ ok: true; items: UserTicket[]; total: number }>(
        "/support/tickets?kind=support",
        { method: "GET" }
      );
      setTickets(r.items ?? []);
    } catch (e) {
      setError(errorMessage(e, t("support.load_failed")));
    } finally {
      setLoading(false);
    }
  }

  async function loadCategories() {
    try {
      const r = await apiFetch<{ ok: true; items: SupportCategory[] }>("/support/categories", { method: "GET" });
      setCategories(r.items ?? []);
    } catch {
      /* optional */
    }
  }

  async function loadServices() {
    try {
      const r = await apiFetch<{ ok: true; items: ServiceItem[] }>("/services", { method: "GET" });
      const items = (r.items ?? []).filter((s) => String(s.statusRaw ?? "").toUpperCase() !== "REMOVED");
      setServices(items);
    } catch {
      /* optional */
    }
  }

  async function openTicket(id: number) {
    finishAssistantAnimation();
    ticketRevisionRef.current++;
    setError("");
    try {
      const r = await apiFetch<{ ok: true; ticket: UserTicket }>(`/support/tickets/${id}`, { method: "GET" });
      setOpened(r.ticket);
      for (const m of r.ticket.messages ?? []) if (isAssistantMessage(m)) shownAssistantIdsRef.current.add(m.id);
      setReplyText("");
      setConfirmClose(false);
      setView("detail");
      setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, unread: false } : t)));
    } catch (e) {
      setError(errorMessage(e, t("support.open_failed")));
    }
  }

  async function submitCreate() {
    if (createLockRef.current) return;
    const text = describe.trim();
    if (text.length < 2 || !selCategory) {
      setError(t("support.select_hint"));
      return;
    }
    createLockRef.current = true;
    ticketRevisionRef.current++;
    setCreating(true);
    setError("");
    try {
      const created = await apiFetch<{ ok: true; ticket: UserTicket }>("/support/tickets", {
        method: "POST",
        body: { categoryKey: selCategory, text, userServiceId: selService },
      });
      setDescribe("");
      setSelCategory("");
      setSelService(null);
      showReply(created.ticket);
      setReplyText("");
      setConfirmClose(false);
      setView("detail");
      await loadList();
    } catch (e) {
      setError(errorMessage(e, t("support.create_failed")));
    } finally {
      createLockRef.current = false;
      setCreating(false);
    }
  }

  async function sendReply() {
    if (!opened || sendLockRef.current || Date.now() < cooldownUntilRef.current) return;
    const text = replyText.trim();
    if (text.length < 2 && attach.pending.length === 0) return;
    sendLockRef.current = true;
    ticketRevisionRef.current++;
    setSending(true);
    setError("");
    try {
      const body = attach.pending.length
        ? buildMessageFormData(text, attach.pending.map((f) => f.file))
        : { text };
      const r = await apiFetch<{ ok: true; ticket: UserTicket }>(
        `/support/tickets/${opened.id}/messages`,
        { method: "POST", body }
      );
      showReply(r.ticket);
      cooldownUntilRef.current = Date.now() + 5000;
      setCooldownSeconds(5);
      attach.clearPending();
      setAttachError(null);
      setReplyText("");
    } catch (e) {
      if (e instanceof ApiError && (e.code === "support_message_cooldown" || e.code === "support_duplicate_message")) {
        const seconds = e.code === "support_duplicate_message" ? 5
          : Math.min(60, Math.max(1, Number(e.data?.retryAfter) || 5));
        cooldownUntilRef.current = Date.now() + seconds * 1000;
        setCooldownSeconds(Math.ceil(seconds));
        setError(t(e.code === "support_duplicate_message" ? "support.duplicate_message" : "support.cooldown_hint"));
      } else setError(errorMessage(e, t("support.send_failed")));
    } finally {
      sendLockRef.current = false;
      ticketRevisionRef.current++;
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

  async function closeTicket() {
    if (!opened || closing) return;
    ticketRevisionRef.current++;
    setClosing(true);
    setError("");
    try {
      const r = await apiFetch<{ ok: true; ticket: UserTicket }>(
        `/support/tickets/${opened.id}/close`,
        { method: "POST" }
      );
      setOpened(r.ticket);
      setConfirmClose(false);
      toast.success(t("support.closed_toast"));
      await loadList();
    } catch (e) {
      setError(errorMessage(e, t("support.close_failed")));
    } finally {
      setClosing(false);
      ticketRevisionRef.current++;
    }
  }

  async function requestStaff() {
    if (!opened || requestingStaff) return;
    const ticketId = opened.id;
    finishAssistantAnimation();
    ticketRevisionRef.current++;
    setRequestingStaff(true);
    setError("");
    try {
      const r = await apiFetch<{ ok: true; ticket: UserTicket }>(`/support/tickets/${ticketId}/staff`, { method: "POST" });
      setOpened(current => current?.id === ticketId ? r.ticket : current);
    } catch (e) { setError(errorMessage(e, t("support.assistant.staff_failed"))); }
    finally { setRequestingStaff(false); ticketRevisionRef.current++; }
  }

  // Receive human replies without requiring the customer to reopen the ticket.
  useEffect(() => {
    if (view !== "detail" || !opened || opened.status === "closed") return;
    const id = opened.id;
    let disposed = false;
    let refreshing = false;
    const timer = window.setInterval(async () => {
      if (document.hidden || sendLockRef.current || refreshing) return;
      const revision = ticketRevisionRef.current;
      refreshing = true;
      try {
        const r = await apiFetch<{ ok: true; ticket: UserTicket }>(`/support/tickets/${id}`, { method: "GET" });
        if (!disposed && !sendLockRef.current && ticketRevisionRef.current === revision)
          if((r.ticket.messages??[]).some(m=>isAssistantMessage(m)&&!shownAssistantIdsRef.current.has(m.id)))showReply(r.ticket);
          else setOpened(current => current?.id === id ? r.ticket : current);
      } catch { /* Sending and staff request remain available during transient refresh failures. */ }
      finally { refreshing = false; }
    }, opened.assistant?.pending ? 1200 : 10000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [view, opened?.id, opened?.status, opened?.assistant?.pending]);

  const canClose = opened ? CLOSEABLE.includes(opened.status) : false;

  /* ─── List ─────────────────────────────────────────────────────────────── */
  if (view === "list") {
    return (
      <div className="section miniPage support-page">
        <PageBackButton />
        <div className="card miniPage__hero">
          <div className="card__body">
            <div className="miniPage__head">
              <div>
                <h1 className="h1">{t("support.title")}</h1>
                <p className="p miniPage__subtitle">{t("support.subtitle")}</p>
              </div>
            </div>
            <div className="actions actions--2 miniPage__actions">
              <button className="btn btn--primary" type="button" onClick={() => { setView("create"); setError(""); }}>
                ➕ {t("support.create")}
              </button>
              <button className="btn" type="button" onClick={() => void loadList()} disabled={loading}>
                {loading ? t("common.refreshing") : t("common.refresh")}
              </button>
            </div>
          </div>
        </div>

        {error ? <div className="pre admin-gap-top-md">{error}</div> : null}

        <div className="card admin-gap-top-md">
          <div className="card__body">
            <h2 className="h2">{t("support.my_tickets")}</h2>
            {loading ? (
              <div className="list admin-gap-top-sm">
                <div className="skeleton h1" />
                <div className="skeleton p" />
              </div>
            ) : tickets.length === 0 ? (
              <p className="p admin-gap-top-sm">{t("support.empty")}</p>
            ) : (
              <div className="list admin-gap-top-sm">
                {tickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="list__item is-clickable admin-tightItem"
                    role="button"
                    tabIndex={0}
                    onClick={() => void openTicket(ticket.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") void openTicket(ticket.id); }}
                  >
                    <div className="list__main">
                      <div className="list__title">
                        {ticket.unread ? <span className="supportUnreadDot" aria-label={t("support.unread")} /> : null}
                        #{ticket.publicNo} · {ticket.subject || categoryTitles.get(ticket.categoryKey) || ticket.categoryKey}
                      </div>
                      <div className="list__sub" style={{ marginTop: 6 }}>
                        {ticket.userServiceId ? t("support.service_line", { id: ticket.userServiceId }) : ""}
                        {fmt(ticket.lastMessageAt)}
                      </div>
                    </div>
                    <div className="list__side" style={{ flexDirection: "column", alignItems: "flex-end" }}>
                      <span className={`chip chip--${STATUS_TONES[ticket.status]}`}>{statusLabel(ticket.status)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ─── Create ───────────────────────────────────────────────────────────── */
  if (view === "create") {
    return (
      <div className="section miniPage support-page">
        <PageBackButton onClick={() => setView("list")} label={t("support.back_to_list")} />
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("support.new_ticket")}</h1>

            <div className="admin-gap-top-md">
              <div className="kicker">{t("support.step.service")}</div>
              <div className="supportChips">
                <button className={`chipBtn${selService === null ? " chipBtn--active" : ""}`} type="button" onClick={() => setSelService(null)}>
                  {t("support.general_question")}
                </button>
                {services.map((s) => (
                  <button
                    key={s.userServiceId}
                    className={`chipBtn${selService === s.userServiceId ? " chipBtn--active" : ""}`}
                    type="button"
                    onClick={() => setSelService(s.userServiceId)}
                  >
                    #{s.userServiceId} · {s.title}
                  </button>
                ))}
              </div>
            </div>

            <div className="admin-gap-top-md">
              <div className="kicker">{t("support.step.category")}</div>
              <div className="supportChips">
                {categories.map((c) => (
                  <button
                    key={c.key}
                    className={`chipBtn${selCategory === c.key ? " chipBtn--active" : ""}`}
                    type="button"
                    onClick={() => setSelCategory(c.key)}
                  >
                    {c.title}
                  </button>
                ))}
              </div>
            </div>

            <div className="admin-gap-top-md">
              <div className="kicker">{t("support.step.describe")}</div>
              <textarea
                className="input supportDetail__input"
                value={describe}
                maxLength={4000}
                placeholder={t("support.describe_ph")}
                onChange={(e) => setDescribe(e.target.value)}
              />
            </div>

            {error ? <div className="pre admin-gap-top-md">{error}</div> : null}

            <div className="actions actions--2 admin-gap-top-md">
              <button className="btn btn--primary" type="button" disabled={creating || !selCategory || describe.trim().length < 2} onClick={() => void submitCreate()}>
                {creating ? t("common.sending") : t("support.create")}
              </button>
              <button className="btn" type="button" onClick={() => setView("list")} disabled={creating}>{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Detail ───────────────────────────────────────────────────────────── */
  return (
    <div className="section miniPage support-page">
      <PageBackButton onClick={() => { setView("list"); void loadList(); }} label={t("support.back_to_list")} />
      <div className="card">
        <div className="card__body">
          <div className="supportDetail__headerRow">
            <div>
              <h1 className="h1">#{opened?.publicNo}</h1>
              <div className="supportDetail__context">
                <span>{opened ? (categoryTitles.get(opened.categoryKey) || opened.categoryKey) : ""}</span>
                {opened?.userServiceId ? <span>{t("support.service_ref", { id: opened.userServiceId })}</span> : null}
                <span>{opened ? fmt(opened.createdAt) : ""}</span>
              </div>
            </div>
            {opened ? <span className={`chip chip--${STATUS_TONES[opened.status]}`}>{statusLabel(opened.status)}</span> : null}
          </div>

          <div className="supportDetail__thread" ref={threadRef} role="log" aria-live="polite" aria-relevant="additions">
            {(opened?.messages ?? []).length === 0 ? (
              <div className="supportDetail__empty">{t("support.no_messages")}</div>
            ) : (
              (opened?.messages ?? []).filter(m => !pendingAssistantIds.includes(m.id)).map((m) => <Bubble key={m.id} message={m} />)
            )}
            {(pendingAssistantIds.length > 0 || opened?.assistant?.pending) && (
              <div className="supportMsg supportMsg--assistant supportAssistantTyping" role="status">
                <strong>{t("support.assistant.typing")}</strong>
                <span className="supportAssistantDots" aria-hidden="true"><i /><i /><i /></span>
              </div>
            )}
          </div>

          {opened?.kind === "support" && opened.status !== "closed" && (
            <div className="supportAssistantBar">
              <p className="p" aria-live="polite">{t(pendingAssistantIds.length > 0 || opened.assistant?.mode === "active" ? "support.assistant.intro" :
                opened.assistant?.mode === "resolved" ? "support.assistant.resolved" : "support.assistant.staff_hint")}</p>
              <button className="btn btn--soft" type="button" disabled={requestingStaff}
                onClick={() => void requestStaff()}>{t(requestingStaff ? "support.assistant.requesting" : "support.assistant.call_staff")}</button>
            </div>
          )}

          {error ? <div className="pre admin-gap-top-sm">{error}</div> : null}

          {opened?.status === "closed" ? (
            <div className="supportClosedNotice">
              🔒 {t("support.closed_notice")}
              <button className="btn btn--soft admin-gap-top-sm" type="button" onClick={() => { setView("create"); setError(""); }}>
                {t("support.create_new")}
              </button>
            </div>
          ) : (
            <div className="supportDetail__composer">
              <PendingFiles files={attach.pending} onRemove={handleRemovePending} disabled={sending} />
              {attachError && (
                <div className="attachError" role="alert">
                  {t(`support.attach.error.${attachError}`)}
                </div>
              )}
              <div className="composerRow">
                <button
                  className="composerAttach"
                  type="button"
                  aria-label={t("support.attach")}
                  disabled={sending || attach.atMaxFiles}
                  onClick={() => fileInputRef.current?.click()}
                >
                  📎
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ATTACHMENT_ACCEPT}
                  style={{ display: "none" }}
                  onChange={handlePickFiles}
                />
                <textarea
                  className="input supportDetail__input"
                  value={replyText}
                  maxLength={4000}
                  disabled={sending}
                  placeholder={t("support.reply_ph")}
                  onChange={(e) => setReplyText(e.target.value)}
                  onPaste={handlePaste}
                />
              </div>
              <div className="composerAttachHint">{t("support.attach.hint")}</div>
              <div className="actions actions--2 admin-gap-top-sm">
                <button className="btn btn--primary" type="button" disabled={sending || cooldownSeconds > 0 || (replyText.trim().length < 2 && attach.pending.length === 0)} onClick={() => void sendReply()}>
                  {sending ? t("common.sending") : cooldownSeconds > 0 ? t("support.cooldown_button", { seconds: cooldownSeconds }) : `💬 ${t("support.reply")}`}
                </button>
                {canClose ? (
                  <button className="btn btn--soft" type="button" disabled={closing} onClick={() => setConfirmClose(true)}>
                    ✅ {t("support.close_ticket")}
                  </button>
                ) : null}
              </div>
              <div className="composerHint">{t("support.retention")}</div>
            </div>
          )}
        </div>
      </div>

      {confirmClose && (
        <div className="modal admin-modal" role="dialog" aria-modal="true" onClick={() => setConfirmClose(false)}>
          <div className="modal__card card admin-modal__card" onClick={(e) => e.stopPropagation()}>
            <div className="card__body admin-modal__body">
              <div className="modal__title admin-modal__title">{t("support.confirm.title")}</div>
              <p className="p">{t("support.confirm.text", { no: opened?.publicNo ?? "" })}</p>
              <div className="actions actions--2 admin-gap-top-md">
                <button className="btn btn--primary" type="button" disabled={closing} onClick={() => void closeTicket()}>
                  {closing ? t("support.confirm.closing") : t("support.confirm.yes")}
                </button>
                <button className="btn" type="button" disabled={closing} onClick={() => setConfirmClose(false)}>{t("common.cancel")}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
