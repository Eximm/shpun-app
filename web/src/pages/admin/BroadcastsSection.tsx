// web/src/pages/admin/BroadcastsSection.tsx

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { ModalShell } from "./shared";
import { formatDateTime, truncateText } from "./utils";
import type { BroadcastItem, DeleteResp, HideResp, UpdateResp, ListResp } from "./types";

const PREVIEW_LIMIT = 160;

export function BroadcastsSection() {
  const [loading,     setLoading]     = useState(false);
  const [items,       setItems]       = useState<BroadcastItem[]>([]);
  const [error,       setError]       = useState<string | null>(null);
  const [deletingId,  setDeletingId]  = useState<string | null>(null);
  const [hidingId,    setHidingId]    = useState<string | null>(null);
  const [opened,      setOpened]      = useState<BroadcastItem | null>(null);

  // Режим редактирования
  const [editMode,    setEditMode]    = useState(false);
  const [editTitle,   setEditTitle]   = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [saving,      setSaving]      = useState(false);
  const [saveError,   setSaveError]   = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await apiFetch<ListResp>("/admin/broadcasts?limit=200", { method: "GET" });
      setItems(Array.isArray(r.items) ? r.items : []);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить список broadcast-новостей.");
      setItems([]);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function removeOne(originId: string) {
    if (!window.confirm(`Удалить broadcast у всех пользователей?\n\n${originId}`)) return;
    setDeletingId(originId);
    try {
      const r = await apiFetch<DeleteResp>(`/admin/broadcast/${encodeURIComponent(originId)}`, { method: "DELETE" });
      setItems((prev) => prev.filter((x) => x.origin_id !== originId));
      if (opened?.origin_id === originId) setOpened(null);
      window.alert(`Удалено копий: ${r.deleted}`);
    } catch (e: any) {
      window.alert(e?.message || "Не удалось удалить broadcast.");
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
    } catch (e: any) {
      window.alert(e?.message || "Не удалось изменить видимость.");
    } finally { setHidingId(null); }
  }

  function openEdit(item: BroadcastItem) {
    setEditTitle(item.title || "");
    setEditMessage(item.message || "");
    setEditMode(true);
    setSaveError(null);
  }

  async function saveEdit() {
    if (!opened) return;
    setSaving(true); setSaveError(null);
    try {
      await apiFetch<UpdateResp>(`/admin/broadcast/${encodeURIComponent(opened.origin_id)}`, {
        method: "PUT",
        body: { title: editTitle, message: editMessage },
      });
      const updated = { ...opened, title: editTitle, message: editMessage };
      setItems((prev) => prev.map((x) => x.origin_id === opened.origin_id ? updated : x));
      setOpened(updated);
      setEditMode(false);
    } catch (e: any) {
      setSaveError(e?.message || "Не удалось сохранить изменения.");
    } finally { setSaving(false); }
  }

  const sorted = useMemo(() => items.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)), [items]);

  return (
    <>
      <div className="card">
        <div className="card__body">
          <div className="admin-sectionHead">
            <div>
              <div className="kicker">Broadcasts</div>
              <h2 className="h2">Управление broadcast-новостями</h2>
              <p className="p">Просмотр, скрытие от пользователей и редактирование.</p>
            </div>
            <button className="btn btn--accent" type="button" onClick={() => void load()} disabled={loading}>
              {loading ? "Обновляю…" : "Обновить"}
            </button>
          </div>

          {error && <div className="pre admin-gap-top-md">{error}</div>}

          <div className="list admin-gap-top-md">
            {loading && !sorted.length ? (
              <><div className="skeleton h1" /><div className="skeleton p" /><div className="skeleton p" /></>
            ) : sorted.length === 0 ? (
              <div className="pre">Broadcast-новостей пока нет.</div>
            ) : sorted.map((item) => (
              <div key={item.origin_id} className="list__item admin-rowCard" style={{ opacity: item.hidden ? 0.5 : 1 }}>
                <div className="list__main">
                  <div className="kicker">
                    {formatDateTime(item.ts)}
                    {item.hidden && <span className="chip chip--warn" style={{ marginLeft: 8 }}>скрыто</span>}
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
                <div className="admin-rowActions">
                  <button className="btn btn--soft" type="button" onClick={() => { setOpened(item); setEditMode(false); }}>
                    Открыть
                  </button>
                  <button className="btn btn--soft" type="button"
                    disabled={hidingId === item.origin_id}
                    onClick={() => void toggleHide(item)}>
                    {hidingId === item.origin_id ? "…" : item.hidden ? "Показать" : "Скрыть"}
                  </button>
                  <button className="btn btn--danger" type="button"
                    disabled={deletingId === item.origin_id}
                    onClick={() => void removeOne(item.origin_id)}>
                    {deletingId === item.origin_id ? "Удаляю…" : "Удалить"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {opened && (
        <ModalShell
          title={opened.title || "—"}
          kicker={formatDateTime(opened.ts)}
          onClose={() => { setOpened(null); setEditMode(false); }}
        >
          {editMode ? (
            /* ── Режим редактирования ── */
            <>
              <div className="list">
                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">Заголовок</div>
                    <input
                      className="input"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Заголовок новости"
                    />
                  </div>
                </div>
                <div className="list__item admin-tightItem">
                  <div className="list__main">
                    <div className="list__title">Текст</div>
                    <textarea
                      className="input"
                      style={{ minHeight: 120, resize: "vertical" }}
                      value={editMessage}
                      onChange={(e) => setEditMessage(e.target.value)}
                      placeholder="Текст новости"
                    />
                  </div>
                </div>
              </div>
              {saveError && <div className="pre" style={{ marginTop: 8 }}>{saveError}</div>}
              <div className="actions actions--2 admin-gap-top-lg">
                <button className="btn btn--soft" type="button" onClick={() => setEditMode(false)} disabled={saving}>
                  Отмена
                </button>
                <button className="btn btn--accent" type="button" onClick={() => void saveEdit()} disabled={saving}>
                  {saving ? "Сохраняю…" : "Сохранить"}
                </button>
              </div>
            </>
          ) : (
            /* ── Просмотр ── */
            <>
              <div className="list">
                {opened.hidden && (
                  <div className="list__item admin-tightItem">
                    <div className="list__main">
                      <div className="list__title">Статус</div>
                      <div className="list__sub">
                        <span className="chip chip--warn">Скрыто от пользователей</span>
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
                  ✏️ Редактировать
                </button>
                <button className="btn btn--soft" type="button"
                  disabled={hidingId === opened.origin_id}
                  onClick={() => void toggleHide(opened)}>
                  {hidingId === opened.origin_id ? "…" : opened.hidden ? "👁 Показать" : "🙈 Скрыть"}
                </button>
              </div>
              <div className="actions actions--1 admin-gap-top-md">
                <button className="btn btn--danger" type="button"
                  disabled={deletingId === opened.origin_id}
                  onClick={() => void removeOne(opened.origin_id)}>
                  {deletingId === opened.origin_id ? "Удаляю…" : "Удалить у всех"}
                </button>
              </div>
            </>
          )}
        </ModalShell>
      )}
    </>
  );
}