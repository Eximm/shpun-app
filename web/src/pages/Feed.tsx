import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../shared/api/client";
import { useI18n } from "../shared/i18n";
import { buildFeedPreview, shouldShowFeedMore, isNewsEvent } from "../shared/ui/newsPreview";

type NotifLevel = "info" | "success" | "error";
type NotifEvent = {
  event_id: string;
  ts: number;
  type?: string;
  level?: NotifLevel;
  title?: string;
  message?: string;
  meta?: any;
};

type Cursor = { ts: number; id: string };
type FeedResp = { ok: true; items: NotifEvent[]; nextBefore: Cursor };

type Category = "all" | "money" | "services" | "news";

const PAGE_LIMIT = 50;

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

function categoryOf(e: NotifEvent): Category {
  const t = normalizeType(e.type);

  if (t.startsWith("balance.") || t.startsWith("payment.") || t.startsWith("invoice.")) return "money";
  if (t.startsWith("service.") || t.startsWith("services.")) return "services";
  if (t === "broadcast.news" || t.startsWith("broadcast.news.") || t.startsWith("broadcast.")) return "news";

  return "all";
}

function chipKindByLevel(level?: NotifLevel): "ok" | "warn" | "soft" {
  if (level === "success") return "ok";
  if (level === "error") return "warn";
  return "soft";
}

function chipTextByEvent(e: NotifEvent, t: (key: string, fallback?: string) => string) {
  const type = normalizeType(e.type);

  if (type === "broadcast.news" || type.startsWith("broadcast.news.")) return t("feed.chip.news", "NEWS");
  if (type === "service.blocked") return t("feed.chip.alert", "ALERT");

  return t("feed.chip.info", "INFO");
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

function catLabel(cat: Category, t: (key: string, fallback?: string) => string) {
  if (cat === "money") return t("feed.filter.money", "Деньги");
  if (cat === "services") return t("feed.filter.services", "Услуги");
  if (cat === "news") return t("feed.filter.news", "Новости");
  return t("feed.filter.all", "Все");
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

  const type = normalizeType(e.type);

  if (type === "broadcast.news" || type.startsWith("broadcast.news.") || type.startsWith("broadcast.")) return null;
  if (type.startsWith("balance.") || type.startsWith("payment.") || type.startsWith("invoice.")) return "/payments";

  if (type.startsWith("service.") || type.startsWith("services.")) {
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

function getCardTitle(e: NotifEvent, t: (key: string, fallback?: string) => string) {
  const shortTitle = pick(e.meta, "short.title");
  if (typeof shortTitle === "string" && shortTitle.trim()) return shortTitle.trim();
  return e.title || t("feed.item.fallback", "Сообщение");
}

function getCardPreview(e: NotifEvent) {
  const shortMessage = pick(e.meta, "short.message");
  if (typeof shortMessage === "string" && shortMessage.trim()) return shortMessage.trim();
  return buildFeedPreview(e);
}

export function Feed() {
  const nav = useNavigate();
  const { t } = useI18n();

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

  useEffect(() => {
    void loadFirst(cat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (cat === "news") return items;
    if (cat === "all") return items;
    return items.filter((e) => categoryOf(e) === cat);
  }, [items, cat]);

  const countText = `${filtered.length} ${pluralRu(
    filtered.length,
    t("feed.count.one", "сообщение"),
    t("feed.count.few", "сообщения"),
    t("feed.count.many", "сообщений"),
  )}`;

  const openedLink = openedEvent ? eventLink(openedEvent) : null;

  return (
    <>
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("feed.title", "Инфоцентр")}</h1>
            <p className="p">{t("feed.subtitle", "Здесь всё, что важно.")}</p>

            <div className="actions actions--4" style={{ marginTop: 12 }}>
              <FilterBtn active={cat === "all"} onClick={() => setCat("all")}>
                {t("feed.filter.all", "Все")}
              </FilterBtn>
              <FilterBtn active={cat === "money"} onClick={() => setCat("money")}>
                {t("feed.filter.money", "Деньги")}
              </FilterBtn>
              <FilterBtn active={cat === "services"} onClick={() => setCat("services")}>
                {t("feed.filter.services", "Услуги")}
              </FilterBtn>
              <FilterBtn active={cat === "news"} onClick={() => setCat("news")}>
                {t("feed.filter.news", "Новости")}
              </FilterBtn>
            </div>

            <p className="p" style={{ marginTop: 10, opacity: 0.85 }}>
              {catLabel(cat, t)} · {countText}
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
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>{t("feed.empty.title", "Пока здесь тихо")}</div>
                  <div style={{ opacity: 0.85 }}>
                    {t(
                      "feed.empty.text",
                      "Как только появятся пополнения, продления или новости — они будут в Инфоцентре.",
                    )}
                  </div>
                </div>
              ) : (
                filtered.map((e) => {
                  const title = getCardTitle(e, t);
                  const preview = getCardPreview(e);
                  const news = isNewsEvent(e);
                  const hasFullView = shouldShowFeedMore(e, preview);
                  const dt = formatDateTime(e.ts);

                  const link = eventLink(e);
                  const clickable = !!link;

                  const onOpen = () => {
                    if (!link) return;
                    nav(link);
                  };

                  if (news) {
                    return (
                      <div key={e.event_id} className="list__item feed-newsCard">
                        <div className="feed-newsCard__top">
                          <div className="kicker">{dt}</div>
                          <span className={`chip chip--${chipKindByLevel(e.level)}`}>{chipTextByEvent(e, t)}</span>
                        </div>

                        <div className="feed-newsCard__title">{title}</div>

                        {preview ? <div className="list__sub feed-news__preview">{preview}</div> : null}

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
                              {t("feed.more", "Подробнее")}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  }

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
                          <div className="feed__more" style={{ marginTop: 8 }}>
                            <button
                              type="button"
                              className="btn btn--soft"
                              onClick={(ev) => {
                                ev.preventDefault();
                                ev.stopPropagation();
                                setOpenedEvent(e);
                              }}
                            >
                              {t("feed.more", "Подробнее")}
                            </button>
                          </div>
                        ) : null}
                      </div>

                      <div className="list__side">
                        <span className={`chip chip--${chipKindByLevel(e.level)}`}>{chipTextByEvent(e, t)}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {filtered.length > 0 ? (
              <div className="actions actions--1" style={{ marginTop: 12 }}>
                <button className="btn btn--accent" onClick={loadMore} disabled={!hasMore || loading} type="button">
                  {loading
                    ? t("feed.load.loading", "Загружаю…")
                    : hasMore
                      ? t("feed.load.more", "Загрузить ещё")
                      : t("feed.load.end", "Больше нет")}
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
          <div className="modal__card card feed-modalCard" onClick={(ev) => ev.stopPropagation()}>
            <div className="card__body">
              <div className="feed-modalCard__head">
                <div className="kicker">{formatDateTime(openedEvent.ts)}</div>
                <div id="feed-modal-title" className="modal__title feed-modalCard__title">
                  {openedEvent.title || t("feed.item.fallback", "Сообщение")}
                </div>
              </div>

              <div className="modal__content feed-modalCard__content">
                <div className="list__sub feed__fulltext">{openedEvent.message || ""}</div>
              </div>

              <div className="feed-modalCard__actions">
                {openedLink ? (
                  <button
                    type="button"
                    className="btn btn--accent"
                    onClick={() => {
                      setOpenedEvent(null);
                      nav(openedLink);
                    }}
                  >
                    {openedLink.startsWith("/payments")
                      ? t("feed.modal.openPayments", "Перейти к оплате")
                      : t("feed.modal.openTarget", "Перейти")}
                  </button>
                ) : null}

                <button type="button" className="btn btn--soft" onClick={() => setOpenedEvent(null)}>
                  {t("feed.modal.close", "Закрыть")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default Feed;