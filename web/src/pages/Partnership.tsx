// web/src/pages/Partnership.tsx
//
// Public-ish intake for advertising/cooperation proposals.
// Flow: conditions -> short form -> summary -> submit -> my proposals + chat.
// Stored as tickets with kind=partnership (same infra as support, separate UI).

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../shared/api/client";
import { PageBackButton } from "../shared/ui/PageBackButton";
import { toast } from "../shared/ui/toast";
import {
  ATTACHMENT_ACCEPT,
  AttachmentList,
  PendingFiles,
  buildMessageFormData,
  releasePendingFiles,
  toPendingFiles,
  type PendingFile,
  type TicketAttachment,
} from "../shared/support/attachments";

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
  { key: "blogger", label: "Блогер / автор" },
  { key: "channel", label: "Telegram-канал / сообщество" },
  { key: "youtube", label: "YouTube / Twitch" },
  { key: "site", label: "Сайт / проект" },
  { key: "other", label: "Другое" },
];

const OFFERS = [
  "🔗 индивидуальную ссылку",
  "🎁 промокод или специальное предложение",
  "📊 статистику по переходам и пользователям",
  "💰 партнёрское вознаграждение",
  "⚙️ индивидуальные условия",
];

const PRINCIPLES = [
  "честная аудитория",
  "прозрачная статистика",
  "понятные условия",
  "без накруток и ботов",
  "без сомнительных схем с предоплатой",
];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function fmt(value?: string | null) {
  if (!value) return "—";
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Bubble({ message }: { message: TicketMessage }) {
  const isUser = message.authorType === "user";
  const isSystem = message.authorType === "system";
  const cls = isSystem ? "supportMsg supportMsg--system" : isUser ? "supportMsg supportMsg--user" : "supportMsg supportMsg--staff";
  return (
    <div className={cls}>
      <div className="supportMsg__meta">
        <strong>{isUser ? "Вы" : isSystem ? "Система" : "Команда Shpun"}</strong>
        <span className="supportMsg__time">{fmt(message.createdAt)}</span>
      </div>
      {message.text ? <div className="supportMsg__text">{message.text}</div> : null}
      <AttachmentList attachments={message.attachments} />
    </div>
  );
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
      setError(errorMessage(e, "Не удалось загрузить предложения."));
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
      toast.success("Предложение отправлено", { description: "Мы свяжемся с вами." });
      setForm(EMPTY_FORM);
      setView("list");
    } catch (e) {
      setError(errorMessage(e, "Не удалось отправить предложение."));
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
      setError(errorMessage(e, "Не удалось открыть предложение."));
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
      setError(errorMessage(e, "Не удалось отправить сообщение."));
    } finally {
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

  const formValid = form.platformUrl.trim().length >= 2 && form.offer.trim().length >= 10;

  if (view === "conditions") {
    return (
      <div className="section miniPage support-page">
        <PageBackButton onClick={() => window.history.back()} label="Назад" />
        <div className="card miniPage__hero">
          <div className="card__body">
            <h1 className="h1">🤝 Реклама и сотрудничество</h1>
            <p className="p">Мы открыты к разным форматам сотрудничества.</p>
            <p className="p admin-gap-top-sm">
              Это могут быть блогеры, каналы, сайты, сообщества, сервисы, проекты или любые другие площадки
              и идеи. Если вы видите, как можем быть полезны друг другу — присылайте предложение.
            </p>
            <p className="p admin-gap-top-sm">
              Особенно хорошо подходят проекты с живой аудиторией, которой могут быть интересны VPN, технологии,
              приватность, роутеры, gaming, YouTube/Twitch, удалённая работа и похожие темы. Но этим список
              не ограничивается.
            </p>
          </div>
        </div>

        <div className="card admin-gap-top-md">
          <div className="card__body">
            <h2 className="h2">Что можем предложить</h2>
            <ul className="supportBullets supportBullets--plain">
              {OFFERS.map((o) => <li key={o}>{o}</li>)}
            </ul>

            <h2 className="h2 admin-gap-top-md">Для нас главное</h2>
            <ul className="supportBullets supportBullets--plain">
              {PRINCIPLES.map((p) => <li key={p}>✅ {p}</li>)}
            </ul>

            <p className="p admin-gap-top-md">
              Формат оплаты обсуждаем индивидуально: после размещения, по результату, RevShare или другая
              понятная модель.
            </p>

            <p className="p admin-gap-top-md">
              Даже если ваш формат не указан выше — всё равно отправляйте предложение. Рассматриваем любые
              адекватные варианты сотрудничества.
            </p>

            <div className="actions actions--2 admin-gap-top-md">
              <button className="btn btn--primary" type="button" onClick={() => { setView("form"); setError(""); }}>
                🤝 Предложить сотрудничество
              </button>
              <button className="btn" type="button" onClick={() => setView("list")}>
                Мои предложения
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
        <PageBackButton onClick={() => setView("conditions")} label="К условиям" />
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Предложение</h1>

            <div className="admin-gap-top-md">
              <div className="kicker">Тип</div>
              <div className="supportChips">
                {PROPOSAL_TYPES.map((t) => (
                  <button key={t.key} className={`chipBtn${form.proposalType === t.key ? " chipBtn--active" : ""}`} type="button" onClick={() => setForm((p) => ({ ...p, proposalType: t.key }))}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="field admin-gap-top-md">
              <span className="field__label">Площадка (ссылка / @username)</span>
              <input className="input" value={form.platformUrl} maxLength={300} placeholder="@example или https://..." onChange={(e) => setForm((p) => ({ ...p, platformUrl: e.target.value }))} />
            </label>

            <label className="field admin-gap-top-sm">
              <span className="field__label">Аудитория (примерно, по желанию)</span>
              <input className="input" value={form.audienceSize} maxLength={100} placeholder="~15 000" onChange={(e) => setForm((p) => ({ ...p, audienceSize: e.target.value }))} />
            </label>

            <label className="field admin-gap-top-sm">
              <span className="field__label">Предложение: что предлагаете, формат, оплата</span>
              <textarea className="input supportDetail__input" value={form.offer} maxLength={2000} placeholder="Опишите площадку, формат размещения и ожидаемую модель оплаты" onChange={(e) => setForm((p) => ({ ...p, offer: e.target.value }))} />
            </label>

            <label className="field admin-gap-top-sm">
              <span className="field__label">Комментарий (по желанию)</span>
              <textarea className="input supportDetail__input" style={{ minHeight: 64 }} value={form.comment} maxLength={500} onChange={(e) => setForm((p) => ({ ...p, comment: e.target.value }))} />
            </label>

            {error ? <div className="pre admin-gap-top-md">{error}</div> : null}

            <div className="actions actions--2 admin-gap-top-md">
              <button className="btn btn--primary" type="button" disabled={!formValid} onClick={() => setView("summary")}>Проверить заявку</button>
              <button className="btn" type="button" onClick={() => setView("conditions")}>Отмена</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === "summary") {
    const typeLabel = PROPOSAL_TYPES.find((t) => t.key === form.proposalType)?.label ?? form.proposalType;
    return (
      <div className="section miniPage support-page">
        <PageBackButton onClick={() => setView("form")} label="Изменить" />
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Проверить заявку</h1>
            <div className="supportDiag__grid admin-gap-top-md">
              <div className="supportDiag__cell"><div className="supportDiag__label">Тип</div><div className="supportDiag__value">{typeLabel}</div></div>
              <div className="supportDiag__cell"><div className="supportDiag__label">Площадка</div><div className="supportDiag__value">{form.platformUrl}</div></div>
              <div className="supportDiag__cell"><div className="supportDiag__label">Аудитория</div><div className="supportDiag__value">{form.audienceSize || "—"}</div></div>
            </div>
            <div className="admin-gap-top-sm">
              <div className="supportDiag__label">Предложение</div>
              <div className="supportDiag__value" style={{ whiteSpace: "pre-wrap" }}>{form.offer}</div>
            </div>
            {form.comment ? (
              <div className="admin-gap-top-sm">
                <div className="supportDiag__label">Комментарий</div>
                <div className="supportDiag__value" style={{ whiteSpace: "pre-wrap" }}>{form.comment}</div>
              </div>
            ) : null}

            {error ? <div className="pre admin-gap-top-md">{error}</div> : null}

            <div className="actions actions--2 admin-gap-top-md">
              <button className="btn btn--primary" type="button" disabled={submitting} onClick={() => void submit()}>
                {submitting ? "Отправляю…" : "Отправить"}
              </button>
              <button className="btn" type="button" disabled={submitting} onClick={() => setView("form")}>Изменить</button>
            </div>
            <div className="actions actions--1 admin-gap-top-sm">
              <button className="btn btn--soft" type="button" disabled={submitting} onClick={() => { setForm(EMPTY_FORM); setView("conditions"); }}>Отмена</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === "list") {
    return (
      <div className="section miniPage support-page">
        <PageBackButton onClick={() => setView("conditions")} label="К условиям" />
        <div className="card miniPage__hero">
          <div className="card__body">
            <h1 className="h1">Мои предложения</h1>
            <div className="actions actions--2 miniPage__actions">
              <button className="btn btn--primary" type="button" onClick={() => { setView("form"); setError(""); }}>➕ Новое предложение</button>
              <button className="btn" type="button" onClick={() => void loadList()} disabled={loading}>{loading ? "Обновляю…" : "Обновить"}</button>
            </div>
          </div>
        </div>

        {error ? <div className="pre admin-gap-top-md">{error}</div> : null}

        <div className="card admin-gap-top-md">
          <div className="card__body">
            {loading ? (
              <div className="list"><div className="skeleton h1" /><div className="skeleton p" /></div>
            ) : tickets.length === 0 ? (
              <p className="p">Предложений пока нет.</p>
            ) : (
              <div className="list">
                {tickets.map((t) => (
                  <div key={t.id} className="list__item is-clickable admin-tightItem" role="button" tabIndex={0}
                    onClick={() => void openTicket(t.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") void openTicket(t.id); }}>
                    <div className="list__main">
                      <div className="list__title">
                        {t.unread ? <span className="supportUnreadDot" /> : null}
                        #{t.publicNo} · {t.subject || "Предложение"}
                      </div>
                      <div className="list__sub" style={{ marginTop: 6 }}>{fmt(t.lastMessageAt)}</div>
                    </div>
                    <div className="list__side"><span className="chip chip--soft">{t.status === "closed" ? "Закрыто" : "Открыто"}</span></div>
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
      <PageBackButton onClick={() => { setView("list"); void loadList(); }} label="К предложениям" />
      <div className="card">
        <div className="card__body">
          <div className="supportDetail__headerRow">
            <h1 className="h1">#{opened?.publicNo}</h1>
            <span className="chip chip--soft">{opened?.status === "closed" ? "Закрыто" : "Открыто"}</span>
          </div>

          <div className="supportDetail__thread" ref={threadRef}>
            {(opened?.messages ?? []).map((m) => <Bubble key={m.id} message={m} />)}
          </div>

          {error ? <div className="pre admin-gap-top-sm">{error}</div> : null}

          {opened?.status === "closed" ? (
            <div className="supportClosedNotice">🔒 Обращение закрыто</div>
          ) : (
            <div className="supportDetail__composer">
              <PendingFiles files={pending} onRemove={removePending} disabled={sending} />
              <div className="composerRow">
                <button className="composerAttach" type="button" aria-label="Прикрепить файл" disabled={sending || pending.length >= 5} onClick={() => fileInputRef.current?.click()}>
                  📎
                </button>
                <input ref={fileInputRef} type="file" multiple accept={ATTACHMENT_ACCEPT} style={{ display: "none" }} onChange={onPickFiles} />
                <textarea className="input supportDetail__input" value={replyText} maxLength={4000} disabled={sending} placeholder="Ваше сообщение" onChange={(e) => setReplyText(e.target.value)} />
              </div>
              <div className="actions actions--1 admin-gap-top-sm">
                <button className="btn btn--primary" type="button" disabled={sending || (replyText.trim().length < 2 && pending.length === 0)} onClick={() => void sendReply()}>
                  {sending ? "Отправляю…" : "Отправить"}
                </button>
              </div>
              <div className="composerHint">Вложения хранятся до 180 дней и затем автоматически удаляются.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
