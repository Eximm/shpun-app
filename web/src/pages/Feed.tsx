// web/src/pages/Feed.tsx

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../shared/api/client";
import { useI18n } from "../shared/i18n";
import { buildFeedPreview, shouldShowFeedMore, isNewsEvent } from "../shared/ui/newsPreview";

/* ─── Types ─────────────────────────────────────────────────────────────── */

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
type Cursor  = { ts: number; id: string };
type FeedResp = { ok: true; items: NotifEvent[]; nextBefore: Cursor };
type Category = "all" | "money" | "services" | "news";

const PAGE_LIMIT = 50;

/* ─── Utils ─────────────────────────────────────────────────────────────── */

function pad2(n: number) { return String(n).padStart(2, "0"); }

function formatDateTime(tsSec: number) {
  const d = new Date(tsSec * 1000);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function normalizeType(t: any) { return String(t ?? "").trim().toLowerCase(); }

function categoryOf(e: NotifEvent): Category {
  const t = normalizeType(e.type);
  if (t.startsWith("balance.") || t.startsWith("payment.") || t.startsWith("invoice.")) return "money";
  if (t.startsWith("service.") || t.startsWith("services.")) return "services";
  if (t === "broadcast.news" || t.startsWith("broadcast.")) return "news";
  return "all";
}

function chipKind(level?: NotifLevel): "ok" | "warn" | "soft" {
  if (level === "success") return "ok";
  if (level === "error")   return "warn";
  return "soft";
}

function chipText(e: NotifEvent, t: (k: string) => string) {
  const type = normalizeType(e.type);
  if (type === "broadcast.news" || type.startsWith("broadcast.")) return t("feed.chip.news");
  if (type === "service.blocked") return t("feed.chip.alert");
  return t("feed.chip.info");
}

function pick(obj: any, path: string): any {
  return path.split(".").reduce((a, k) => a?.[k], obj);
}

function isForecastEvent(e: NotifEvent) { return normalizeType(e.type) === "service.forecast"; }

function eventLink(e: NotifEvent): string | null {
  const actionTo = pick(e.meta, "action.to");
  if (typeof actionTo === "string" && actionTo.trim()) {
    const to  = actionTo.trim();
    const usi = pick(e.meta, "action.usi");
    if (usi != null && to.startsWith("/services")) return `/services?usi=${encodeURIComponent(String(usi))}`;
    return to;
  }
  const type = normalizeType(e.type);
  if (type.startsWith("broadcast.")) return null;
  if (type.startsWith("balance.") || type.startsWith("payment.") || type.startsWith("invoice.")) return "/payments";
  if (type.startsWith("service.") || type.startsWith("services.")) {
    const usi = pick(e.meta, "service.id") ?? pick(e.meta, "usi") ?? pick(e.meta, "service.usi");
    return usi != null ? `/services?usi=${encodeURIComponent(String(usi))}` : "/services";
  }
  return null;
}

function getPreview(e: NotifEvent): string {
  if (isForecastEvent(e)) {
    const short = pick(e.meta, "short.message");
    if (typeof short === "string" && short.trim()) return short.trim();
  }
  return buildFeedPreview(e);
}

function canOpenDetails(e: NotifEvent, preview: string): boolean {
  if (isNewsEvent(e) || isForecastEvent(e)) return true;
  const full  = String(e.message ?? "").trim();
  const short = preview.trim();
  if (!full || !short || full === short) return false;
  return shouldShowFeedMore(e, preview);
}

function uniqAppend(prev: NotifEvent[], next: NotifEvent[]): NotifEvent[] {
  if (!next.length) return prev;
  const seen = new Set(prev.map((x) => x.event_id));
  const out  = prev.slice();
  for (const it of next) {
    if (!it?.event_id || seen.has(it.event_id)) continue;
    seen.add(it.event_id);
    out.push(it);
  }
  return out;
}

function buildFeedUrl(cat: Category, cursor?: Cursor | null): string {
  let url = `/notifications/feed?limit=${PAGE_LIMIT}`;
  if (cat === "news") url += "&onlyNews=1";
  const c = cursor;
  if (c?.ts || c?.id) {
    url += `&beforeTs=${encodeURIComponent(String(c.ts || 0))}`;
    url += `&beforeId=${encodeURIComponent(String(c.id || ""))}`;
  }
  return url;
}

/* ─── FilterBtn ──────────────────────────────────────────────────────────── */

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={active ? "btn btn--accent" : "btn btn--soft"} onClick={onClick} type="button" aria-pressed={active}>
      {children}
    </button>
  );
}

/* ─── Feed ───────────────────────────────────────────────────────────────── */

export function Feed() {
  const { t } = useI18n();
  const nav   = useNavigate();

  const [loading,      setLoading]      = useState(false);
  const [items,        setItems]        = useState<NotifEvent[]>([]);
  const [nextBefore,   setNextBefore]   = useState<Cursor>({ ts: 0, id: "" });
  const [hasMore,      setHasMore]      = useState(true);
  const [cat,          setCat]          = useState<Category>("all");
  const [openedEvent,  setOpenedEvent]  = useState<NotifEvent | null>(null);

  async function loadFirst(activeCat: Category) {
    setLoading(true);
    try {
      const r   = await apiFetch<FeedResp>(buildFeedUrl(activeCat, null));
      const arr = Array.isArray(r.items) ? r.items : [];
      setItems(arr);
      const nb = r?.nextBefore;
      setNextBefore(nb && Number.isFinite(Number(nb.ts)) ? { ts: Number(nb.ts), id: String(nb.id ?? "") } : { ts: 0, id: "" });
      setHasMore(arr.length >= PAGE_LIMIT);
    } finally { setLoading(false); }
  }

  async function loadMore() {
    if (!hasMore || loading) return;
    setLoading(true);
    try {
      const c = nextBefore;
      if (!c.ts && !c.id) { setHasMore(false); return; }
      const r   = await apiFetch<FeedResp>(buildFeedUrl(cat, c));
      const arr = Array.isArray(r.items) ? r.items : [];
      setItems((prev) => uniqAppend(prev, arr));
      const nb         = r?.nextBefore;
      const nextCursor = nb && Number.isFinite(Number(nb.ts)) ? { ts: Number(nb.ts), id: String(nb.id ?? "") } : c;
      const advanced   = nextCursor.ts !== c.ts || nextCursor.id !== c.id;
      setNextBefore(nextCursor);
      if (arr.length < PAGE_LIMIT || !advanced) setHasMore(false);
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadFirst(cat); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadFirst(cat);
    setOpenedEvent(null);
  }, [cat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock body scroll when modal open
  useEffect(() => {
    if (!openedEvent) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenedEvent(null); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [openedEvent]);

  const filtered = useMemo(() => {
    if (cat === "all" || cat === "news") return items;
    return items.filter((e) => categoryOf(e) === cat);
  }, [items, cat]);

  const openedLink       = openedEvent ? eventLink(openedEvent) : null;
  const openedIsForecast = openedEvent ? isForecastEvent(openedEvent) : false;

  /* ── Render ────────────────────────────────────────────────────────────── */

  return (
    <>
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("feed.title")}</h1>
            <p className="p">{t("feed.subtitle")}</p>

            {/* Фильтры */}
            <div className="actions actions--4" style={{ marginTop: 12 }}>
              <FilterBtn active={cat === "all"}      onClick={() => setCat("all")}>      {t("feed.filter.all")}</FilterBtn>
              <FilterBtn active={cat === "money"}    onClick={() => setCat("money")}>     {t("feed.filter.money")}</FilterBtn>
              <FilterBtn active={cat === "services"} onClick={() => setCat("services")}>  {t("feed.filter.services")}</FilterBtn>
              <FilterBtn active={cat === "news"}     onClick={() => setCat("news")}>      {t("feed.filter.news")}</FilterBtn>
            </div>

            <p className="p" style={{ marginTop: 10, opacity: 0.7 }}>
              {filtered.length} {cat === "all" ? t("feed.filter.all") : cat === "money" ? t("feed.filter.money") : cat === "services" ? t("feed.filter.services") : t("feed.filter.news")}
            </p>

            {/* Список */}
            <div className="list" style={{ marginTop: 12 }}>
              {loading && items.length === 0 ? (
                <>
                  <div className="skeleton h1" />
                  <div className="skeleton p" />
                  <div className="skeleton p" />
                </>
              ) : filtered.length === 0 ? (
                <div className="pre">
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>{t("feed.empty.title")}</div>
                  <div style={{ opacity: 0.85 }}>{t("feed.empty.text")}</div>
                </div>
              ) : filtered.map((e) => {
                const title      = e.title || t("feed.item.fallback");
                const preview    = getPreview(e);
                const news       = isNewsEvent(e);
                const hasDetails = canOpenDetails(e, preview);
                const dt         = formatDateTime(e.ts);
                const link       = eventLink(e);
                const clickable  = !!link && !hasDetails;

                const openDetail = () => setOpenedEvent(e);
                const navigate   = () => { if (link) nav(link); };

                if (news) {
                  return (
                    <div key={e.event_id} className="list__item feed-newsCard">
                      <div className="feed-newsCard__top">
                        <div className="kicker">{dt}</div>
                        <span className={`chip chip--${chipKind(e.level)}`}>{chipText(e, t)}</span>
                      </div>
                      <div className="feed-newsCard__title">{title}</div>
                      {preview && <div className="list__sub feed-news__preview">{preview}</div>}
                      {hasDetails && (
                        <div className="feed__more">
                          <button type="button" className="btn btn--soft" onClick={openDetail}>
                            {t("feed.more")}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <div
                    key={e.event_id}
                    className={`list__item${clickable ? " is-clickable" : ""}`}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? navigate : undefined}
                    onKeyDown={clickable ? (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); navigate(); } } : undefined}
                  >
                    <div className="list__main">
                      <div className="kicker">{dt}</div>
                      <div className="list__title" style={{ marginTop: 6 }}>{title}</div>
                      {preview && <div className="list__sub">{preview}</div>}
                      {hasDetails && (
                        <div className="feed__more" style={{ marginTop: 8 }}>
                          <button type="button" className="btn btn--soft"
                            onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); openDetail(); }}>
                            {t("feed.more")}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="list__side">
                      <span className={`chip chip--${chipKind(e.level)}`}>{chipText(e, t)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Загрузить ещё */}
            {filtered.length > 0 && (
              <div className="actions actions--1" style={{ marginTop: 12 }}>
                <button className="btn btn--accent" onClick={() => void loadMore()} disabled={!hasMore || loading} type="button">
                  {loading ? t("feed.load.loading") : hasMore ? t("feed.load.more") : t("feed.load.end")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Модалка детали — через portal */}
      {openedEvent && createPortal(
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="feed-modal-title"
          onMouseDown={() => setOpenedEvent(null)}>
          <div className="card modal__card feed-modalCard" onMouseDown={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="modal__head">
                <div>
                  <div className="kicker">{formatDateTime(openedEvent.ts)}</div>
                  <div id="feed-modal-title" className="modal__title">
                    {openedEvent.title || t("feed.item.fallback")}
                  </div>
                </div>
                <button className="btn modal__close" type="button" onClick={() => setOpenedEvent(null)} aria-label={t("common.close")}>✕</button>
              </div>

              <div className="modal__content">
                <div className="list__sub feed__fulltext">{openedEvent.message || ""}</div>
              </div>

              {openedIsForecast && openedLink?.startsWith("/payments") && (
                <div className="actions actions--1" style={{ marginTop: 12 }}>
                  <button type="button" className="btn btn--primary"
                    onClick={() => { setOpenedEvent(null); nav(openedLink); }}>
                    {t("payments.page.title")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default Feed;