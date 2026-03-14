// FILE: web/src/pages/AdminBroadcasts.tsx
import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { apiFetch } from "../shared/api/client";

type BroadcastItem = {
  origin_id: string;
  ts: number;
  type?: string;
  level?: "info" | "success" | "error";
  title?: string;
  message?: string;
  copies: number;
};

type ListResp = { ok: true; items: BroadcastItem[] };
type DeleteResp = { ok: true; originId: string; deleted: number };

const PREVIEW_LIMIT = 180;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateTime(tsSec: number) {
  const d = new Date(tsSec * 1000);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(
    d.getMinutes(),
  )}`;
}

function truncateText(text: string | null | undefined, limit: number) {
  const source = String(text || "").trim();
  if (!source) return "";
  if (source.length <= limit) return source;
  return source.slice(0, limit).trimEnd() + "…";
}

export function AdminBroadcasts() {
  const { me, loading: meLoading } = useMe() as any;
  const isAdmin = Boolean(me?.profile?.isAdmin || me?.admin?.isAdmin);

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
    if (isAdmin) void load();
  }, [isAdmin]);

  useEffect(() => {
    if (!opened) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpened(null);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [opened]);

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

  const sorted = useMemo(
    () => items.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    [items],
  );

  if (meLoading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Broadcasts</h1>
            <p className="p">Загрузка…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/profile" replace />;
  }

  return (
    <>
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Broadcasts</h1>
            <p className="p">Удаление broadcast-новостей у всех пользователей.</p>

            <div className="actions actions--2" style={{ marginTop: 12 }}>
              <button className="btn btn--accent" type="button" onClick={load} disabled={loading}>
                {loading ? "Обновляю…" : "Обновить"}
              </button>
            </div>

            {error ? <div className="pre" style={{ marginTop: 12 }}>{error}</div> : null}

            <div className="list" style={{ marginTop: 12 }}>
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
                    <div key={item.origin_id} className="list__item">
                      <div className="list__main">
                        <div className="kicker">{formatDateTime(item.ts)}</div>
                        <div className="list__title" style={{ marginTop: 6 }}>
                          {item.title || "Без заголовка"}
                        </div>
                        {preview ? <div className="list__sub">{preview}</div> : null}
                        <div className="list__sub" style={{ marginTop: 8 }}>
                          <strong>origin:</strong> {item.origin_id}
                        </div>
                        <div className="list__sub">
                          <strong>copies:</strong> {item.copies}
                        </div>

                        <div className="actions actions--2" style={{ marginTop: 12 }}>
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

                      <div className="list__side">
                        <span className="chip chip--soft">BROADCAST</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {opened ? (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-broadcast-title"
          onClick={() => setOpened(null)}
        >
          <div className="modal__card card" onClick={(ev) => ev.stopPropagation()}>
            <div className="card__body">
              <div className="modal__head">
                <div>
                  <div className="kicker">{formatDateTime(opened.ts)}</div>
                  <div id="admin-broadcast-title" className="modal__title">
                    {opened.title || "Без заголовка"}
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn--soft modal__close"
                  onClick={() => setOpened(null)}
                  aria-label="Закрыть"
                >
                  ✕
                </button>
              </div>

              <div className="modal__content">
                <div className="list__sub feed__fulltext">
                  <strong>origin:</strong> {opened.origin_id}
                </div>
                <div className="list__sub" style={{ marginTop: 8 }}>
                  <strong>copies:</strong> {opened.copies}
                </div>
                {opened.message ? (
                  <div className="list__sub feed__fulltext" style={{ marginTop: 14 }}>
                    {opened.message}
                  </div>
                ) : null}

                <div className="actions actions--1" style={{ marginTop: 16 }}>
                  <button
                    className="btn btn--danger"
                    type="button"
                    disabled={deletingId === opened.origin_id}
                    onClick={() => removeOne(opened.origin_id)}
                  >
                    {deletingId === opened.origin_id ? "Удаляю…" : "Удалить у всех"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default AdminBroadcasts;