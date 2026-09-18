// web/src/pages/Partnership.tsx
//
// Public-ish intake for advertising/cooperation proposals.
// Flow: conditions -> short form -> summary -> submit -> my proposals + chat.
// Stored as tickets with kind=partnership (same infra as support, separate UI).

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { apiFetch } from "../shared/api/client";
import { PageBackButton } from "../shared/ui/PageBackButton";
import { toast } from "../shared/ui/toast";
import { useI18n } from "../shared/i18n";
import {
  ATTACHMENT_ACCEPT,
  buildMessageFormData,
  releasePendingFiles,
  toPendingFiles,
  type PendingFile,
  type TicketAttachment,
} from "../shared/support/attachments";
import { AttachmentList, PendingFiles } from "../shared/support/AttachmentViews";

type TicketMessage = {
  id: number;
  authorType: "user" | "staff" | "system";
  authorName: string | null;
  text: string;
  createdAt: string;
  attachments?: TicketAttachment[];
};

type UserTicket = {
  id: number;
  publicNo: string;
  kind: "partnership";
  subject: string | null;
  status: string;
  lastMessageAt: string;
  createdAt: string;
  unread?: boolean;
  messages?: TicketMessage[];
};

const PROPOSAL_TYPES = [
  { key: "blogger", labelKey: "partnership.type.blogger" },
  { key: "channel", labelKey: "partnership.type.channel" },
  { key: "youtube", labelKey: "partnership.type.youtube" },
  { key: "site", labelKey: "partnership.type.site" },
  { key: "other", labelKey: "partnership.type.other" },
];

const OFFER_KEYS = [
  { icon: "🔗", key: "partnership.offer.individual_link" },
  { icon: "🎁", key: "partnership.offer.promo" },
  { icon: "📊", key: "partnership.offer.stats" },
  { icon: "💰", key: "partnership.offer.reward" },
  { icon: "⚙️", key: "partnership.offer.custom" },
];

const PRINCIPLE_KEYS = [
  "partnership.principle.audience",
  "partnership.principle.stats",
  "partnership.principle.terms",
  "partnership.principle.no_bots",
  "partnership.principle.no_prepay",
];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

type Form = {
  proposalType: string;
  platformUrl: string;
  audienceSize: string;
  offer: string;
  comment: string;
};

const EMPTY_FORM: Form = { proposalType: "channel", platformUrl: "", audienceSize: "", offer: "", comment: "" };

export function Partnership() {
  const { t, formatDate } = useI18n();
  const [view, setView] = useState<"conditions" | "form" | "summary" | "list" | "detail">("conditions");
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [tickets, setTickets] = useState<UserTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState<UserTicket | null>(null);
  const [replyText, setReplyText] = useState("");
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [sending, setSending] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function fmt(value?: string | null) {
    if (!value) return "—";
    const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? value
      : formatDate(d, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function Bubble({ message }: { message: TicketMessage }) {
    const isUser = message.authorType === "user";
    const isSystem = message.authorType === "system";
    const cls = isSystem ? "supportMsg supportMsg--system" : isUser ? "supportMsg supportMsg--user" : "supportMsg supportMsg--staff";
    const author = isUser ? t("support.author.you") : isSystem ? t("support.author.system") : t("partnership.team");
    return (
      <div className={cls}>
        <div className="supportMsg__meta">
          <strong>{author}</strong>
          <span className="supportMsg__time">{fmt(message.createdAt)}</span>
        </div>
        {message.text ? <div className="supportMsg__text">{message.text}</div> : null}
        <AttachmentList attachments={message.attachments} />
      </div>
    );
  }

  useEffect(() => {
    if (view === "list") void loadList();
  }, [view]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [opened?.id, opened?.messages?.length]);

  async function loadList() {
    setLoading(true);
    setError("");
    try {
      const r = await apiFetch<{ ok: true; items: UserTicket[] }>("/support/tickets?kind=partnership", { method: "GET" });
      setTickets(r.items ?? []);
    } catch (e) {
      setError(errorMessage(e, t("partnership.load_failed")));
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      await apiFetch("/support/partnership", {
        method: "POST",
        body: {
          proposalType: form.proposalType,
          platformUrl: form.platformUrl.trim(),
          audienceSize: form.audienceSize.trim() || null,
          offer: form.offer.trim(),
          comment: form.comment.trim() || null,
        },
      });
      toast.success(t("partnership.sent"), { description: t("partnership.sent_desc") });
      setForm(EMPTY_FORM);
      setView("list");
    } catch (e) {
      setError(errorMessage(e, t("partnership.submit_failed")));
    } finally {
      setSubmitting(false);
    }
  }

  async function openTicket(id: number) {
    try {
      const r = await apiFetch<{ ok: true; ticket: UserTicket }>(`/support/tickets/${id}`, { method: "GET" });
      setOpened(r.ticket);
      setReplyText("");
      setView("detail");
    } catch (e) {
      setError(errorMessage(e, t("partnership.open_failed")));
    }
  }

  async function sendReply() {
    if (!opened || sending) return;
    const text = replyText.trim();
    if (text.length < 2 && pending.length === 0) return;
    setSending(true);
    setError("");
    try {
      const body = pending.length
        ? buildMessageFormData(text, pending.map((f) => f.file))
        : { text };
      const r = await apiFetch<{ ok: true; ticket: UserTicket }>(`/support/tickets/${opened.id}/messages`, { method: "POST", body });
      setOpened(r.ticket);
      releasePendingFiles(pending);
      setPending([]);
      setReplyText("");
    } catch (e) {
      setError(errorMessage(e, t("support.send_failed")));
    } finally {
      setSending(false);
    }
  }

  function onPickFiles(event: ChangeEvent<HTMLInputElement>) {
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

  const formValid = form.platformUrl.trim().length >= 2 && form.offer.trim().length >= 10;
  const statusLabel = (status?: string) =>
    status === "closed" ? t("partnership.status.closed") : t("partnership.status.open");

  if (view === "conditions") {
    return (
      <div className="section miniPage support-page">
        <PageBackButton onClick={() => window.history.back()} label={t("common.back")} />
        <div className="card miniPage__hero">
          <div className="card__body">
            <h1 className="h1">🤝 {t("partnership.title")}</h1>
            <p className="p">{t("partnership.intro1")}</p>
            <p className="p admin-gap-top-sm">{t("partnership.intro2")}</p>
            <p className="p admin-gap-top-sm">{t("partnership.intro3")}</p>
          </div>
        </div>

        <div className="card admin-gap-top-md">
          <div className="card__body">
            <h2 className="h2">{t("partnership.offers_title")}</h2>
            <ul className="supportBullets supportBullets--plain">
              {OFFER_KEYS.map((o) => <li key={o.key}>{o.icon} {t(o.key)}</li>)}
            </ul>

            <h2 className="h2 admin-gap-top-md">{t("partnership.principles_title")}</h2>
            <ul className="supportBullets supportBullets--plain">
              {PRINCIPLE_KEYS.map((key) => <li key={key}>✅ {t(key)}</li>)}
            </ul>

            <p className="p admin-gap-top-md">{t("partnership.payment_note")}</p>
            <p className="p admin-gap-top-md">{t("partnership.any_format_note")}</p>

            <div className="actions actions--2 admin-gap-top-md">
              <button className="btn btn--primary" type="button" onClick={() => { setView("form"); setError(""); }}>
                🤝 {t("partnership.cta")}
              </button>
              <button className="btn" type="button" onClick={() => setView("list")}>
                {t("partnership.my")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === "form") {
    return (
      <div className="section miniPage support-page">
        <PageBackButton onClick={() => setView("conditions")} label={t("partnership.to_conditions")} />
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("partnership.form_title")}</h1>

            <div className="admin-gap-top-md">
              <div className="kicker">{t("partnership.type")}</div>
              <div className="supportChips">
                {PROPOSAL_TYPES.map((item) => (
                  <button key={item.key} className={`chipBtn${form.proposalType === item.key ? " chipBtn--active" : ""}`} type="button" onClick={() => setForm((p) => ({ ...p, proposalType: item.key }))}>
                    {t(item.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <label className="field admin-gap-top-md">
              <span className="field__label">{t("partnership.platform_label")}</span>
              <input className="input" value={form.platformUrl} maxLength={300} placeholder={t("partnership.platform_ph")} onChange={(e) => setForm((p) => ({ ...p, platformUrl: e.target.value }))} />
            </label>

            <label className="field admin-gap-top-sm">
              <span className="field__label">{t("partnership.audience_label")}</span>
              <input className="input" value={form.audienceSize} maxLength={100} placeholder={t("partnership.audience_ph")} onChange={(e) => setForm((p) => ({ ...p, audienceSize: e.target.value }))} />
            </label>

            <label className="field admin-gap-top-sm">
              <span className="field__label">{t("partnership.offer_label")}</span>
              <textarea className="input supportDetail__input" value={form.offer} maxLength={2000} placeholder={t("partnership.offer_ph")} onChange={(e) => setForm((p) => ({ ...p, offer: e.target.value }))} />
            </label>

            <label className="field admin-gap-top-sm">
              <span className="field__label">{t("partnership.comment_label")}</span>
              <textarea className="input supportDetail__input" style={{ minHeight: 64 }} value={form.comment} maxLength={500} onChange={(e) => setForm((p) => ({ ...p, comment: e.target.value }))} />
            </label>

            {error ? <div className="pre admin-gap-top-md">{error}</div> : null}

            <div className="actions actions--2 admin-gap-top-md">
              <button className="btn btn--primary" type="button" disabled={!formValid} onClick={() => setView("summary")}>{t("partnership.check")}</button>
              <button className="btn" type="button" onClick={() => setView("conditions")}>{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === "summary") {
    const typeLabel = t(PROPOSAL_TYPES.find((item) => item.key === form.proposalType)?.labelKey ?? "partnership.type.other");
    return (
      <div className="section miniPage support-page">
        <PageBackButton onClick={() => setView("form")} label={t("partnership.edit")} />
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("partnership.summary_title")}</h1>
            <div className="supportDiag__grid admin-gap-top-md">
              <div className="supportDiag__cell"><div className="supportDiag__label">{t("partnership.summary.type")}</div><div className="supportDiag__value">{typeLabel}</div></div>
              <div className="supportDiag__cell"><div className="supportDiag__label">{t("partnership.summary.platform")}</div><div className="supportDiag__value">{form.platformUrl}</div></div>
              <div className="supportDiag__cell"><div className="supportDiag__label">{t("partnership.summary.audience")}</div><div className="supportDiag__value">{form.audienceSize || "—"}</div></div>
            </div>
            <div className="admin-gap-top-sm">
              <div className="supportDiag__label">{t("partnership.summary.offer")}</div>
              <div className="supportDiag__value" style={{ whiteSpace: "pre-wrap" }}>{form.offer}</div>
            </div>
            {form.comment ? (
              <div className="admin-gap-top-sm">
                <div className="supportDiag__label">{t("partnership.summary.comment")}</div>
                <div className="supportDiag__value" style={{ whiteSpace: "pre-wrap" }}>{form.comment}</div>
              </div>
            ) : null}

            {error ? <div className="pre admin-gap-top-md">{error}</div> : null}

            <div className="actions actions--2 admin-gap-top-md">
              <button className="btn btn--primary" type="button" disabled={submitting} onClick={() => void submit()}>
                {submitting ? t("partnership.submitting") : t("partnership.submit")}
              </button>
              <button className="btn" type="button" disabled={submitting} onClick={() => setView("form")}>{t("partnership.edit")}</button>
            </div>
            <div className="actions actions--1 admin-gap-top-sm">
              <button className="btn btn--soft" type="button" disabled={submitting} onClick={() => { setForm(EMPTY_FORM); setView("conditions"); }}>{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === "list") {
    return (
      <div className="section miniPage support-page">
        <PageBackButton onClick={() => setView("conditions")} label={t("partnership.to_conditions")} />
        <div className="card miniPage__hero">
          <div className="card__body">
            <h1 className="h1">{t("partnership.my")}</h1>
            <div className="actions actions--2 miniPage__actions">
              <button className="btn btn--primary" type="button" onClick={() => { setView("form"); setError(""); }}>➕ {t("partnership.new")}</button>
              <button className="btn" type="button" onClick={() => void loadList()} disabled={loading}>{loading ? t("common.refreshing") : t("common.refresh")}</button>
            </div>
          </div>
        </div>

        {error ? <div className="pre admin-gap-top-md">{error}</div> : null}

        <div className="card admin-gap-top-md">
          <div className="card__body">
            {loading ? (
              <div className="list"><div className="skeleton h1" /><div className="skeleton p" /></div>
            ) : tickets.length === 0 ? (
              <p className="p">{t("partnership.empty")}</p>
            ) : (
              <div className="list">
                {tickets.map((ticket) => (
                  <div key={ticket.id} className="list__item is-clickable admin-tightItem" role="button" tabIndex={0}
                    onClick={() => void openTicket(ticket.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") void openTicket(ticket.id); }}>
                    <div className="list__main">
                      <div className="list__title">
                        {ticket.unread ? <span className="supportUnreadDot" aria-label={t("support.unread")} /> : null}
                        #{ticket.publicNo} · {ticket.subject || t("partnership.default_subject")}
                      </div>
                      <div className="list__sub" style={{ marginTop: 6 }}>{fmt(ticket.lastMessageAt)}</div>
                    </div>
                    <div className="list__side"><span className="chip chip--soft">{statusLabel(ticket.status)}</span></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // detail
  return (
    <div className="section miniPage support-page">
      <PageBackButton onClick={() => { setView("list"); void loadList(); }} label={t("partnership.to_proposals")} />
      <div className="card">
        <div className="card__body">
          <div className="supportDetail__headerRow">
            <h1 className="h1">#{opened?.publicNo}</h1>
            <span className="chip chip--soft">{statusLabel(opened?.status)}</span>
          </div>

          <div className="supportDetail__thread" ref={threadRef}>
            {(opened?.messages ?? []).map((m) => <Bubble key={m.id} message={m} />)}
          </div>

          {error ? <div className="pre admin-gap-top-sm">{error}</div> : null}

          {opened?.status === "closed" ? (
            <div className="supportClosedNotice">🔒 {t("support.closed_notice")}</div>
          ) : (
            <div className="supportDetail__composer">
              <PendingFiles files={pending} onRemove={removePending} disabled={sending} />
              <div className="composerRow">
                <button className="composerAttach" type="button" aria-label={t("support.attach")} disabled={sending || pending.length >= 5} onClick={() => fileInputRef.current?.click()}>
                  📎
                </button>
                <input ref={fileInputRef} type="file" multiple accept={ATTACHMENT_ACCEPT} style={{ display: "none" }} onChange={onPickFiles} />
                <textarea className="input supportDetail__input" value={replyText} maxLength={4000} disabled={sending} placeholder={t("support.reply_ph")} onChange={(e) => setReplyText(e.target.value)} />
              </div>
              <div className="actions actions--1 admin-gap-top-sm">
                <button className="btn btn--primary" type="button" disabled={sending || (replyText.trim().length < 2 && pending.length === 0)} onClick={() => void sendReply()}>
                  {sending ? t("common.sending") : t("common.send")}
                </button>
              </div>
              <div className="composerHint">{t("support.retention")}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}