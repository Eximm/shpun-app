// web/src/pages/admin/BroadcastsSection.tsx

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { useI18n } from "../../shared/i18n";
import { AdminSectionHeader, ModalShell, ADMIN_SECTION_ICON } from "./shared";
import { formatDateTime, truncateText } from "./utils";
import type { BroadcastItem, DeleteResp, HideResp, UpdateResp, ListResp } from "./types";

const PREVIEW_LIMIT = 160;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

type CreateResp = {
  ok: true;
  originId: string;
  event_id: string;
  ts: number;
  dedup: boolean;
  pushRequested?: boolean;
};

function toDateTimeLocal(tsSec?: number) {
  if (!tsSec || !Number.isFinite(tsSec)) return "";
  const date = new Date(tsSec * 1000);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function parseLocalDateTime(value: string): number | null {
  if (!value.trim()) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : null;
}

function isPastCalendarDate(value: string) {
  if (!value.trim()) return false;
  const selected = new Date(value);
  if (!Number.isFinite(selected.getTime())) return false;
  const today = new Date();
  selected.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return selected.getTime() < today.getTime();
}

export function BroadcastsSection() {
  const { t } = useI18n();
  const [loading,     setLoading]     = useState(false);
  const [items,       setItems]       = useState<BroadcastItem[]>([]);
  const [error,       setError]       = useState<string | null>(null);
  const [deletingId,  setDeletingId]  = useState<string | null>(null);
  const [hidingId,    setHidingId]    = useState<string | null>(null);
  const [opened,      setOpened]      = useState<BroadcastItem | null>(null);

  // Редактирование
  const [editMode,    setEditMode]    = useState(false);
  const [editTitle,   setEditTitle]   = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [editPublishedAt, setEditPublishedAt] = useState("");
  const [saving,      setSaving]      = useState(false);
  const [saveError,   setSaveError]   = useState<string | null>(null);

  // Создание
  const [createMode,    setCreateMode]    = useState(false);
  const [newTitle,      setNewTitle]      = useState("");
  const [newMessage,    setNewMessage]    = useState("");
  const [newPublishedAt, setNewPublishedAt] = useState("");
  const [newSendPush,   setNewSendPush]   = useState(true);
  const [creating,      setCreating]      = useState(false);
  const [createError,   setCreateError]   = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await apiFetch<ListResp>("/admin/broadcasts?limit=200", { method: "GET" });
      setItems(Array.isArray(r.items) ? r.items : []);
    } catch (e: unknown) {
      setError(errorMessage(e, t("admin.broadcasts.err.load")));
      setItems([]);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function removeOne(originId: string) {
    if (!window.confirm(`${t("admin.broadcasts.confirm.delete")}\n\n${originId}`)) return;
    setDeletingId(originId);
    try {
      const r = await apiFetch<DeleteResp>(`/admin/broadcast/${encodeURIComponent(originId)}`, { method: "DELETE" });
      setItems((prev) => prev.filter((x) => x.origin_id !== originId));
      if (opened?.origin_id === originId) setOpened(null);
      window.alert(t("admin.broadcasts.alert.deleted", { n: r.deleted }));
    } catch (e: unknown) {
      window.alert(errorMessage(e, t("admin.broadcasts.err.delete")));
    } finally { setDeletingId(null); }
  }

  async function toggleHide(item: BroadcastItem) {
    const nextHidden = !item.hidden;
    setHidingId(item.origin_id);
    try {
      await apiFetch<HideResp>(`/admin/broadcast/${encodeURIComponent(item.origin_id)}/hide`, {
        method: "PATCH",
        body: { hidden: nextHidden },
      });
      setItems((prev) => prev.map((x) =>
        x.origin_id === item.origin_id ? { ...x, hidden: nextHidden } : x
      ));
      if (opened?.origin_id === item.origin_id) setOpened({ ...opened, hidden: nextHidden });
    } catch (e: unknown) {
      window.alert(errorMessage(e, t("admin.broadcasts.err.visibility")));
    } finally { setHidingId(null); }
  }

  function openEdit(item: BroadcastItem) {
    setEditTitle(item.title || "");
    setEditMessage(item.message || "");
    setEditPublishedAt(toDateTimeLocal(item.ts));
    setEditMode(true);
    setSaveError(null);
  }

  async function saveEdit() {
    if (!opened) return;
    const publishedTs = parseLocalDateTime(editPublishedAt);
    if (!publishedTs) {
      setSaveError(t("admin.broadcasts.err.date"));
      return;
    }
    setSaving(true); setSaveError(null);
    try {
      await apiFetch<UpdateResp>(`/admin/broadcast/${encodeURIComponent(opened.origin_id)}`, {
        method: "PUT",
        body: { title: editTitle, message: editMessage, publishedTs },
      });
      const updated = { ...opened, title: editTitle, message: editMessage, ts: publishedTs };
      setItems((prev) => prev.map((x) => x.origin_id === opened.origin_id ? updated : x));
      setOpened(updated);
      setEditMode(false);
    } catch (e: unknown) {
      setSaveError(errorMessage(e, t("admin.broadcasts.err.save")));
    } finally { setSaving(false); }
  }

  async function createBroadcast() {
    if (!newTitle.trim() && !newMessage.trim()) {
      setCreateError(t("admin.broadcasts.err.fill"));
      return;
    }
    const publishedTs = parseLocalDateTime(newPublishedAt);
    if (newPublishedAt && !publishedTs) {
      setCreateError(t("admin.broadcasts.err.date"));
      return;
    }
    setCreating(true); setCreateError(null);
    try {
      await apiFetch<CreateResp>("/admin/broadcast", {
        method: "POST",
        body: {
          title: newTitle.trim(),
          message: newMessage.trim(),
          push: newSendPush,
          ...(publishedTs ? { publishedTs } : {}),
        },
      });
      setNewTitle(""); setNewMessage(""); setNewPublishedAt(""); setNewSendPush(true); setCreateMode(false);
      await load();
    } catch (e: unknown) {
      setCreateError(errorMessage(e, t("admin.broadcasts.err.create")));
    } finally { setCreating(false); }
  }

  const sorted = useMemo(() => items.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)), [items]);

  return (
    <>
      <div className="card">
        <div className="card__body">
          <AdminSectionHeader
          icon={ADMIN_SECTION_ICON.broadcasts}
            kicker={t("admin.tab.broadcasts")}
            title={t("admin.section.broadcasts.title")}
            subtitle={t("admin.section.broadcasts.subtitle")}
            actions={
              <>
                <button className="btn btn--accent" type="button"
                  onClick={() => { setCreateMode((v) => !v); setCreateError(null); }}>
                  {createMode ? t("common.cancel") : `+ ${t("common.create")}`}
                </button>
                <button className="btn btn--soft" type="button" onClick={() => void load()} disabled={loading}>
                  {loading ? t("common.refreshing") : t("common.refresh")}
                </button>
              </>
            }
          />

          {/* Форма создания */}
          {createMode && (
            <div className="list admin-gap-top-md">
              <div className="list__item admin-tightItem">
                <div className="list__main">
                  <div className="list__title">{t("admin.broadcasts.new_title")}</div>
                  <div className="list__sub admin-gap-top-sm">
                    <input
                      className="input"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder={t("admin.broadcasts.field.title_ph")}
                      style={{ marginBottom: 8 }}
                    />
                    <label className="field admin-broadcastDate">
                      <span className="field__label">{t("admin.broadcasts.field.published_at")}</span>
                      <input
                        className="input"
                        type="datetime-local"
                        value={newPublishedAt}
                        max={toDateTimeLocal(Math.floor(Date.now() / 1000))}
                        onChange={(e) => {
                          const next = e.target.value;
                          setNewPublishedAt(next);
                          setNewSendPush(!isPastCalendarDate(next));
                        }}
                      />
                      <span className="admin-fieldHint">
                        {t("admin.broadcasts.field.published_hint")}
                      </span>
                    </label>
                    <label className="admin-pushToggle">
                      <input
                        type="checkbox"
                        checked={newSendPush}
                        onChange={(e) => setNewSendPush(e.target.checked)}
                      />
                      <span className="admin-pushToggle__track" aria-hidden="true" />
                      <span className="admin-pushToggle__text">
                        <strong>{t("admin.broadcasts.push.send")}</strong>
                        <small>
                          {newSendPush
                            ? t("admin.broadcasts.push.on")
                            : t("admin.broadcasts.push.off")}
                        </small>
                      </span>
                    </label>
                    {newSendPush && isPastCalendarDate(newPublishedAt) && (
                      <div className="pre admin-broadcastWarning">
                        {t("admin.broadcasts.push.past_warning")}
                      </div>
                    )}
                    <textarea
                      className="input"
                      style={{ minHeight: 100, resize: "vertical" }}
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      placeholder={t("admin.broadcasts.field.text_ph")}
                    />
                  </div>
                  {createError && <div className="pre" style={{ marginTop: 8 }}>{createError}</div>}
                  <div className="actions actions--1" style={{ marginTop: 10 }}>
                    <button className="btn btn--accent" type="button"
                      onClick={() => void createBroadcast()} disabled={creating}>
                      {creating ? t("admin.broadcasts.action.creating") : `📢 ${t("admin.broadcasts.action.publish")}`}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && <div className="pre admin-gap-top-md">{error}</div>}

          <div className="list admin-gap-top-md">
            {loading && !sorted.length ? (
              <><div className="skeleton h1" /><div className="skeleton p" /><div className="skeleton p" /></>
            ) : sorted.length === 0 ? (
              <div className="pre">{t("admin.broadcasts.empty")}</div>
            ) : sorted.map((item) => (
              <div key={item.origin_id} className="list__item admin-rowCard"
                style={{ opacity: item.hidden ? 0.5 : 1 }}>
                <div className="list__main">
                  <div className="kicker">
                    {formatDateTime(item.ts)}
                    {item.hidden && <span className="chip chip--warn" style={{ marginLeft: 8 }}>{t("admin.broadcasts.badge.hidden")}</span>}
                  </div>
                  <div className="list__title admin-gap-top-xs">{item.title || "—"}</div>
                  {truncateText(item.message, PREVIEW_LIMIT) && (
                    <div className="list__sub">{truncateText(item.message, PREVIEW_LIMIT)}</div>
                  )}
                  <div className="admin-inlineMeta admin-gap-top-sm">
                    <span><strong>origin:</strong> {item.origin_id}</span>
                    <span><strong>copies:</strong> {item.copies}</span>
                  </div>
                </div>
                <div className="admin-rowActions admin-rowActions--inline">
                  <button className="btn btn--soft" type="button"
                    onClick={() => { setOpened(item); setEditMode(false); }}>
                    {t("admin.broadcasts.action.open")}
                  </button>
                  <button className="btn btn--soft" type="button"
                    disabled={hidingId === item.origin_id}
                    onClick={() => void toggleHide(item)}>
                    {hidingId === item.origin_id ? "…" : item.hidden ? t("admin.broadcasts.action.show") : t("admin.broadcasts.action.hide")}
                  </button>
                  <button className="btn btn--danger" type="button"
                    disabled={deletingId === item.origin_id}
                    onClick={() => void removeOne(item.origin_id)}>
                    {deletingId === item.origin_id ? t("admin.broadcasts.action.deleting") : t("admin.broadcasts.action.delete")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Модалка просмотра / редактирования */}
      {opened && (
        <ModalShell
          title={opened.title || "—"}
          kicker={formatDateTime(opened.ts)}
          onClose={() => { setOpened(null); setEditMode(false); }}
        >
          {editMode ? (
            <>
              <div className="list">
                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">{t("admin.broadcasts.field.title")}</div>
                    <input className="input" value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder={t("admin.broadcasts.field.title_news_ph")} />
                  </div>
                </div>
                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">{t("admin.broadcasts.field.published_at")}</div>
                    <input
                      className="input"
                      type="datetime-local"
                      value={editPublishedAt}
                      max={toDateTimeLocal(Math.floor(Date.now() / 1000))}
                      onChange={(e) => setEditPublishedAt(e.target.value)}
                    />
                    <div className="admin-fieldHint">{t("admin.broadcasts.field.date_hint")}</div>
                  </div>
                </div>
                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">{t("admin.broadcasts.field.text")}</div>
                    <textarea className="input" style={{ minHeight: 120, resize: "vertical" }}
                      value={editMessage} onChange={(e) => setEditMessage(e.target.value)}
                      placeholder={t("admin.broadcasts.field.text_ph")} />
                  </div>
                </div>
              </div>
              {saveError && <div className="pre" style={{ marginTop: 8 }}>{saveError}</div>}
              <div className="actions actions--2 admin-gap-top-lg">
                <button className="btn btn--soft" type="button"
                  onClick={() => setEditMode(false)} disabled={saving}>
                  {t("common.cancel")}
                </button>
                <button className="btn btn--accent" type="button"
                  onClick={() => void saveEdit()} disabled={saving}>
                  {saving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="list">
                {opened.hidden && (
                  <div className="list__item admin-tightItem">
                    <div className="list__main">
                      <div className="list__title">{t("admin.broadcasts.status")}</div>
                      <div className="list__sub">
                        <span className="chip chip--warn">{t("admin.broadcasts.status.hidden_users")}</span>
                      </div>
                    </div>
                  </div>
                )}
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">origin</div>
                    <div className="list__sub feed__fulltext">{opened.origin_id}</div>
                  </div>
                </div>
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">copies</div>
                    <div className="list__sub">{opened.copies}</div>
                  </div>
                </div>
                {opened.message && (
                  <div className="list__item">
                    <div className="list__main">
                      <div className="list__title">message</div>
                      <div className="list__sub feed__fulltext">{opened.message}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="actions actions--2 admin-gap-top-lg">
                <button className="btn btn--soft" type="button" onClick={() => openEdit(opened)}>
                  ✏️ {t("admin.broadcasts.action.edit")}
                </button>
                <button className="btn btn--soft" type="button"
                  disabled={hidingId === opened.origin_id}
                  onClick={() => void toggleHide(opened)}>
                  {hidingId === opened.origin_id ? "…" : opened.hidden ? `👁 ${t("admin.broadcasts.action.show")}` : `🙈 ${t("admin.broadcasts.action.hide")}`}
                </button>
              </div>
              <div className="actions actions--1 admin-gap-top-md">
                <button className="btn btn--danger" type="button"
                  disabled={deletingId === opened.origin_id}
                  onClick={() => void removeOne(opened.origin_id)}>
                  {deletingId === opened.origin_id ? t("admin.broadcasts.action.deleting") : t("admin.broadcasts.action.delete_all")}
                </button>
              </div>
            </>
          )}
        </ModalShell>
      )}
    </>
  );
}
