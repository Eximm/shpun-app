// FILE: web/src/pages/Feed.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../shared/api/client";

type NotifLevel = "info" | "success" | "error";
type NotifEvent = {
  event_id: string;
  ts: number;
  type?: string;
  level?: NotifLevel;
  title?: string;
  message?: string;
  meta?: any; // для маршрутизации (service.id, usi и т.д.)
};

type Cursor = { ts: number; id: string };
type FeedResp = { ok: true; items: NotifEvent[]; nextBefore: Cursor };

type Category = "all" | "money" | "services" | "news";

const PAGE_LIMIT = 50;
const FEED_PREVIEW_LIMIT = 240;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateTime(tsSec: number) {
  const d = new Date(tsSec * 1000);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(
    d.getMinutes(),
  )}`;
}

function normalizeType(t: any) {
  return String(t ?? "").trim().toLowerCase();
}

function truncateText(text: string | null | undefined, limit: number) {
  const source = String(text || "").trim();
  if (!source) return "";
  if (source.length <= limit) return source;
  return source.slice(0, limit).trimEnd() + "…";
}

function isLongText(text: string | null | undefined, limit: number) {
  return String(text || "").trim().length > limit;
}

/**
 * STRICT категоризация — только по type, без эвристик по тексту.
 */
function categoryOf(e: NotifEvent): Category {
  const t = normalizeType(e.type);

  if (t.startsWith("balance.") || t.startsWith("payment.") || t.startsWith("invoice.")) return "money";
  if (t.startsWith("service.") || t.startsWith("services.")) return "services";

  // broadcast.* => news
  if (t === "broadcast.news" || t.startsWith("broadcast.news.") || t.startsWith("broadcast.")) return "news";

  return "all";
}

function chipKindByLevel(level?: NotifLevel): "ok" | "warn" | "soft" {
  if (level === "success") return "ok";
  if (level === "error") return "warn";
  return "soft";
}

function chipTextByLevel(level?: NotifLevel) {
  if (level === "success") return "OK";
  if (level === "error") return "ALERT";
  return "INFO";
}

function FilterBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={active ? "btn btn--accent" : "btn btn--soft"}
      onClick={onClick}
      type="button"
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function catLabel(cat: Category) {
  if (cat === "money") return "Деньги";
  if (cat === "services") return "Услуги";
  if (cat === "news") return "Новости";
  return "Все";
}

function pluralRu(n: number, one: string, few: string, many: string) {
  const x = Math.abs(n) % 100;
  const y = x % 10;
  if (x > 10 && x < 20) return many;
  if (y > 1 && y < 5) return few;
  if (y === 1) return one;
  return many;
}

function pick(obj: any, path: string) {
  try {
    return path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), obj);
  } catch {
    return undefined;
  }
}

/**
 * STRICT навигация:
 * - деньги -> /payments
 * - услуги -> /services (+ usi если нашли)
 * - broadcast/news -> null
 * - всё остальное -> null
 *
 * Дополнительно поддерживаем meta.action.to (явная команда бэка).
 */
function eventLink(e: NotifEvent): string | null {
  const actionTo = pick(e.meta, "action.to");
  if (typeof actionTo === "string" && actionTo.trim()) {
    const to = actionTo.trim();
    const usi = pick(e.meta, "action.usi");
    if (usi != null && to.startsWith("/services")) {
      return `/services?usi=${encodeURIComponent(String(usi))}`;
    }
    return to;
  }

  const t = normalizeType(e.type);

  // broadcast/news: никуда
  if (t === "broadcast.news" || t.startsWith("broadcast.news.") || t.startsWith("broadcast.")) return null;

  // деньги
  if (t.startsWith("balance.") || t.startsWith("payment.") || t.startsWith("invoice.")) return "/payments";

  // услуги
  if (t.startsWith("service.") || t.startsWith("services.")) {
    const usi = pick(e.meta, "service.id") ?? pick(e.meta, "usi") ?? pick(e.meta, "service.usi");
    if (usi != null) return `/services?usi=${encodeURIComponent(String(usi))}`;
    return "/services";
  }

  return null;
}

function uniqAppend(prev: NotifEvent[], next: NotifEvent[]) {
  if (!next.length) return prev;
  const seen = new Set(prev.map((x) => x.event_id));
  const out = prev.slice();
  for (const it of next) {
    if (!it?.event_id) continue;
    if (seen.has(it.event_id)) continue;
    seen.add(it.event_id);
    out.push(it);
  }
  return out;
}

/**
 * Сервер умеет фильтровать новости через onlyNews=1.
 * Для остальных категорий фильтруем клиентом (строго по type).
 */
function buildFeedUrl(cat: Category, cursor?: Cursor | null) {
  const limit = PAGE_LIMIT;
  const onlyNews = cat === "news" ? 1 : 0;

  const c = cursor || { ts: 0, id: "" };
  const hasCursor = Boolean(c.ts) || Boolean(c.id);

  let url = `/notifications/feed?limit=${encodeURIComponent(String(limit))}`;
  if (onlyNews) url += `&onlyNews=1`;

  if (hasCursor) {
    url += `&beforeTs=${encodeURIComponent(String(c.ts || 0))}`;
    url += `&beforeId=${encodeURIComponent(String(c.id || ""))}`;
  }

  return url;
}

export function Feed() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotifEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<Cursor>({ ts: 0, id: "" });
  const [hasMore, setHasMore] = useState(true);

  const [cat, setCat] = useState<Category>("all");
  const [openedEvent, setOpenedEvent] = useState<NotifEvent | null>(null);

  async function loadFirst(activeCat: Category) {
    setLoading(true);
    try {
      const r = await apiFetch<FeedResp>(buildFeedUrl(activeCat, null));
      const arr = Array.isArray(r.items) ? r.items : [];
      setItems(arr);

      const nb = r?.nextBefore;
      setNextBefore(
        nb && Number.isFinite(Number(nb.ts)) ? { ts: Number(nb.ts), id: String(nb.id ?? "") } : { ts: 0, id: "" },
      );

      setHasMore(arr.length >= PAGE_LIMIT);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!hasMore || loading) return;
    setLoading(true);
    try {
      const c = nextBefore || { ts: 0, id: "" };
      if (!c.ts && !c.id) {
        setHasMore(false);
        return;
      }

      const r = await apiFetch<FeedResp>(buildFeedUrl(cat, c));
      const arr = Array.isArray(r.items) ? r.items : [];

      setItems((prev) => uniqAppend(prev, arr));

      const nb = r?.nextBefore;
      const nextCursor = nb && Number.isFinite(Number(nb.ts)) ? { ts: Number(nb.ts), id: String(nb.id ?? "") } : c;

      const advanced = nextCursor.ts !== c.ts || nextCursor.id !== c.id;
      setNextBefore(nextCursor);

      if (arr.length < PAGE_LIMIT || !advanced) setHasMore(false);
    } finally {
      setLoading(false);
    }
  }

  // initial
  useEffect(() => {
    void loadFirst(cat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reload when category changes
  useEffect(() => {
    void loadFirst(cat);
    setOpenedEvent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat]);

  useEffect(() => {
    if (!openedEvent) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpenedEvent(null);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openedEvent]);

  const filtered = useMemo(() => {
    if (cat === "news") return items; // already server-filtered
    if (cat === "all") return items;
    return items.filter((e) => categoryOf(e) === cat);
  }, [items, cat]);

  const countText = `${filtered.length} ${pluralRu(filtered.length, "сообщение", "сообщения", "сообщений")}`;

  return (
    <>
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Инфоцентр</h1>
            <p className="p">Здесь всё, что важно.</p>

            <div className="actions actions--4" style={{ marginTop: 12 }}>
              <FilterBtn active={cat === "all"} onClick={() => setCat("all")}>
                Все
              </FilterBtn>
              <FilterBtn active={cat === "money"} onClick={() => setCat("money")}>
                Деньги
              </FilterBtn>
              <FilterBtn active={cat === "services"} onClick={() => setCat("services")}>
                Услуги
              </FilterBtn>
              <FilterBtn active={cat === "news"} onClick={() => setCat("news")}>
                Новости
              </FilterBtn>
            </div>

            <p className="p" style={{ marginTop: 10, opacity: 0.85 }}>
              {catLabel(cat)} · {countText}
            </p>

            <div className="list" style={{ marginTop: 12 }}>
              {loading && items.length === 0 ? (
                <>
                  <div className="skeleton h1" />
                  <div className="skeleton p" />
                  <div className="skeleton p" />
                </>
              ) : filtered.length === 0 ? (
                <div className="pre">
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>Пока здесь тихо</div>
                  <div style={{ opacity: 0.85 }}>
                    Как только появятся пополнения, продления или новости — они будут в Инфоцентре.
                  </div>
                </div>
              ) : (
                filtered.map((e) => {
                  const title = e.title || "Сообщение";
                  const fullMessage = String(e.message || "");
                  const preview = truncateText(fullMessage, FEED_PREVIEW_LIMIT);
                  const hasFullView = isLongText(fullMessage, FEED_PREVIEW_LIMIT);
                  const dt = formatDateTime(e.ts);

                  const link = eventLink(e);
                  const clickable = !!link;

                  const onOpen = () => {
                    if (!link) return;
                    nav(link);
                  };

                  return (
                    <div
                      key={e.event_id}
                      className={`list__item${clickable ? " is-clickable" : ""}`}
                      role={clickable ? "button" : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={clickable ? onOpen : undefined}
                      onKeyDown={
                        clickable
                          ? (ev) => {
                              if (ev.key === "Enter" || ev.key === " ") {
                                ev.preventDefault();
                                onOpen();
                              }
                            }
                          : undefined
                      }
                    >
                      <div className="list__main">
                        <div className="kicker">{dt}</div>
                        <div className="list__title" style={{ marginTop: 6 }}>
                          {title}
                        </div>
                        {preview ? <div className="list__sub">{preview}</div> : null}

                        {hasFullView ? (
                          <div className="feed__more">
                            <button
                              type="button"
                              className="btn btn--soft"
                              onClick={(ev) => {
                                ev.preventDefault();
                                ev.stopPropagation();
                                setOpenedEvent(e);
                              }}
                            >
                              Подробнее
                            </button>
                          </div>
                        ) : null}
                      </div>

                      <div className="list__side">
                        <span className={`chip chip--${chipKindByLevel(e.level)}`}>{chipTextByLevel(e.level)}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {filtered.length > 0 ? (
              <div className="actions actions--1" style={{ marginTop: 12 }}>
                <button className="btn btn--accent" onClick={loadMore} disabled={!hasMore || loading} type="button">
                  {loading ? "Загружаю…" : hasMore ? "Загрузить ещё" : "Больше нет"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {openedEvent ? (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="feed-modal-title"
          onClick={() => setOpenedEvent(null)}
        >
          <div className="modal__card card" onClick={(ev) => ev.stopPropagation()}>
            <div className="card__body">
              <div className="modal__head">
                <div>
                  <div className="kicker">{formatDateTime(openedEvent.ts)}</div>
                  <div id="feed-modal-title" className="modal__title">
                    {openedEvent.title || "Сообщение"}
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn--soft modal__close"
                  onClick={() => setOpenedEvent(null)}
                  aria-label="Закрыть"
                >
                  ✕
                </button>
              </div>

              <div className="modal__content">
                <div className="list__sub feed__fulltext">{openedEvent.message || ""}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default Feed;