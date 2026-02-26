// web/src/pages/Feed.tsx
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
  meta?: any; // важно для маршрутизации (service.id, usi и т.д.)
};

type Cursor = { ts: number; id: string };
type FeedResp = { ok: true; items: NotifEvent[]; nextBefore: Cursor };

type Category = "all" | "money" | "services" | "news";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateTime(tsSec: number) {
  const d = new Date(tsSec * 1000);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}`;
}

function categoryOf(e: NotifEvent): Category {
  const t = String(e.type || "").trim().toLowerCase();

  if (t.startsWith("balance.") || t.startsWith("payment.") || t.startsWith("invoice.")) return "money";
  if (t.startsWith("service.") || t.startsWith("services.")) return "services";
  if (t.startsWith("broadcast.") || t.includes("news")) return "news";

  const text = `${e.title || ""} ${e.message || ""}`.toLowerCase();
  if (text.includes("пополн") || text.includes("оплат") || text.includes("баланс") || text.includes("зачисл"))
    return "money";
  if (text.includes("услуг") || text.includes("продл") || text.includes("ключ") || text.includes("блок"))
    return "services";
  if (text.includes("работ") || text.includes("новост") || text.includes("перебои")) return "news";

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
 * Where should the feed item lead?
 * Rules:
 * - service.blocked / activated / renewed -> Services
 * - service.forecast -> Payments
 * - broadcast/news -> nowhere
 *
 * Also supports meta.action = { kind:"nav", to:"/services", usi?:... } (optional future)
 */
function eventLink(e: NotifEvent): string | null {
  // 0) Optional explicit action from backend
  const actionTo = pick(e.meta, "action.to");
  if (typeof actionTo === "string" && actionTo.trim()) {
    const to = actionTo.trim();
    const usi = pick(e.meta, "action.usi");
    if (usi != null && to.startsWith("/services")) {
      return `/services?usi=${encodeURIComponent(String(usi))}`;
    }
    return to;
  }

  const type = String(e.type || "").trim();

  // 1) Money
  if (type === "balance.credited") return "/payments";

  // 2) Forecast -> Payments (your rule)
  if (type === "service.forecast") return "/payments";

  // 3) Service lifecycle -> Services (your rule)
  if (type === "service.blocked" || type === "service.renewed" || type === "service.activated") {
    const usi = pick(e.meta, "service.id") ?? pick(e.meta, "usi") ?? pick(e.meta, "service.usi");
    if (usi != null) return `/services?usi=${encodeURIComponent(String(usi))}`;
    return "/services";
  }

  // 4) News -> nowhere (your rule)
  if (type === "broadcast.news") return null;

  // 5) Fallback by category: only money/services should navigate, news -> nowhere
  const c = categoryOf(e);
  if (c === "money") return "/payments";
  if (c === "services") return "/services";
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

const PAGE_LIMIT = 50;

export function Feed() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotifEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<Cursor>({ ts: 0, id: "" });
  const [hasMore, setHasMore] = useState(true);

  const [cat, setCat] = useState<Category>("all");

  async function loadFirst() {
    setLoading(true);
    try {
      const r = await apiFetch<FeedResp>(`/notifications/feed?limit=${PAGE_LIMIT}`);
      const arr = Array.isArray(r.items) ? r.items : [];
      setItems(arr);

      const nb = r?.nextBefore;
      setNextBefore(
        nb && Number.isFinite(Number(nb.ts)) ? { ts: Number(nb.ts), id: String(nb.id ?? "") } : { ts: 0, id: "" }
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

      const url =
        `/notifications/feed?limit=${PAGE_LIMIT}` +
        `&beforeTs=${encodeURIComponent(String(c.ts || 0))}` +
        `&beforeId=${encodeURIComponent(String(c.id || ""))}`;

      const r = await apiFetch<FeedResp>(url);
      const arr = Array.isArray(r.items) ? r.items : [];

      setItems((prev) => uniqAppend(prev, arr));

      const nb = r?.nextBefore;
      const nextCursor =
        nb && Number.isFinite(Number(nb.ts)) ? { ts: Number(nb.ts), id: String(nb.id ?? "") } : c;

      const advanced = nextCursor.ts !== c.ts || nextCursor.id !== c.id;
      setNextBefore(nextCursor);

      if (arr.length < PAGE_LIMIT || !advanced) setHasMore(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFirst();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (cat === "all") return items;
    return items.filter((e) => categoryOf(e) === cat);
  }, [items, cat]);

  const countText = `${filtered.length} ${pluralRu(filtered.length, "сообщение", "сообщения", "сообщений")}`;

  return (
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
                const msg = e.message || "";
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
                      {msg ? <div className="list__sub">{msg}</div> : null}
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
  );
}