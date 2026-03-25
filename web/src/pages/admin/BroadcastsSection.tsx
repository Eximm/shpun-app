import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { ModalShell } from "./shared";
import { formatDateTime, truncateText } from "./utils";
import type { BroadcastItem, DeleteResp, ListResp } from "./types";

const PREVIEW_LIMIT = 160;

export function BroadcastsSection() {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<BroadcastItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [opened, setOpened] = useState<BroadcastItem | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch<ListResp>("/admin/broadcasts?limit=200", { method: "GET" });
      setItems(Array.isArray(r.items) ? r.items : []);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить список broadcast-новостей.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function removeOne(originId: string) {
    const ok = window.confirm(`Удалить broadcast у всех пользователей?\n\n${originId}`);
    if (!ok) return;

    setDeletingId(originId);
    try {
      const encoded = encodeURIComponent(originId);
      const r = await apiFetch<DeleteResp>(`/admin/broadcast/${encoded}`, { method: "DELETE" });

      setItems((prev) => prev.filter((x) => x.origin_id !== originId));
      if (opened?.origin_id === originId) setOpened(null);

      window.alert(`Удалено копий: ${r.deleted}`);
    } catch (e: any) {
      window.alert(e?.message || "Не удалось удалить broadcast.");
    } finally {
      setDeletingId(null);
    }
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
              <p className="p">Компактный список с быстрым открытием и удалением.</p>
            </div>

            <button className="btn btn--accent" type="button" onClick={load} disabled={loading}>
              {loading ? "Обновляю…" : "Обновить"}
            </button>
          </div>

          {error ? <div className="pre admin-gap-top-md">{error}</div> : null}

          <div className="list admin-gap-top-md">
            {loading && !sorted.length ? (
              <>
                <div className="skeleton h1" />
                <div className="skeleton p" />
                <div className="skeleton p" />
              </>
            ) : sorted.length === 0 ? (
              <div className="pre">Broadcast-новостей пока нет.</div>
            ) : (
              sorted.map((item) => {
                const preview = truncateText(item.message, PREVIEW_LIMIT);

                return (
                  <div key={item.origin_id} className="list__item admin-rowCard">
                    <div className="list__main">
                      <div className="kicker">{formatDateTime(item.ts)}</div>
                      <div className="list__title admin-gap-top-xs">{item.title || "Без заголовка"}</div>
                      {preview ? <div className="list__sub">{preview}</div> : null}
                      <div className="admin-inlineMeta admin-gap-top-sm">
                        <span>
                          <strong>origin:</strong> {item.origin_id}
                        </span>
                        <span>
                          <strong>copies:</strong> {item.copies}
                        </span>
                      </div>
                    </div>

                    <div className="admin-rowActions">
                      <button className="btn btn--soft" type="button" onClick={() => setOpened(item)}>
                        Открыть
                      </button>
                      <button
                        className="btn btn--danger"
                        type="button"
                        disabled={deletingId === item.origin_id}
                        onClick={() => removeOne(item.origin_id)}
                      >
                        {deletingId === item.origin_id ? "Удаляю…" : "Удалить"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {opened ? (
        <ModalShell
          title={opened.title || "Без заголовка"}
          kicker={formatDateTime(opened.ts)}
          onClose={() => setOpened(null)}
        >
          <div className="list">
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

            {opened.message ? (
              <div className="list__item">
                <div className="list__main">
                  <div className="list__title">message</div>
                  <div className="list__sub feed__fulltext">{opened.message}</div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="actions actions--1 admin-gap-top-lg">
            <button
              className="btn btn--danger"
              type="button"
              disabled={deletingId === opened.origin_id}
              onClick={() => removeOne(opened.origin_id)}
            >
              {deletingId === opened.origin_id ? "Удаляю…" : "Удалить у всех"}
            </button>
          </div>
        </ModalShell>
      ) : null}
    </>
  );
}