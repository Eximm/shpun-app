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
  meta?: any; // ✅ важно для маршрутизации (service.id, usi и т.д.)
};

type FeedResp = { ok: true; items: NotifEvent[]; nextBefore: number };

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

function eventLink(e: NotifEvent): string | null {
  const type = String(e.type || "").trim();

  if (type === "balance.credited") return "/payments";

  if (type === "service.forecast") return "/services/order";

  if (type === "service.blocked" || type === "service.renewed") {
    const usi = pick(e.meta, "service.id") ?? pick(e.meta, "usi") ?? pick(e.meta, "service.usi");
    if (usi != null) return `/services?usi=${encodeURIComponent(String(usi))}`;
    return "/services";
  }

  if (type === "broadcast.news") return "/help";

  // fallback: по категории
  const c = categoryOf(e);
  if (c === "money") return "/payments";
  if (c === "services") return "/services";
  if (c === "news") return "/help";

  return null;
}

export function Feed() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotifEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<number>(0);
  const [hasMore, setHasMore] = useState(true);

  const [cat, setCat] = useState<Category>("all");

  async function loadFirst() {
    setLoading(true);
    try {
      const r = await apiFetch<FeedResp>(`/notifications/feed?limit=50`);
      const arr = Array.isArray(r.items) ? r.items : [];
      setItems(arr);
      setNextBefore(Number(r.nextBefore || 0));
      setHasMore(arr.length > 0);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!hasMore || loading) return;
    setLoading(true);
    try {
      const before = Number(nextBefore || 0);
      const r = await apiFetch<FeedResp>(
        `/notifications/feed?limit=50&beforeTs=${encodeURIComponent(String(before))}`
      );
      const arr = Array.isArray(r.items) ? r.items : [];
      setItems((prev) => [...prev, ...arr]);
      setNextBefore(Number(r.nextBefore || before || 0));
      if (arr.length === 0) setHasMore(false);
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

          {/* 4 фильтра */}
          <div className="actions actions--4" style={{ marginTop: 12 }}>
            <FilterBtn active={cat === "all"} onClick={() => setCat("all")}>Все</FilterBtn>
            <FilterBtn active={cat === "money"} onClick={() => setCat("money")}>Деньги</FilterBtn>
            <FilterBtn active={cat === "services"} onClick={() => setCat("services")}>Услуги</FilterBtn>
            <FilterBtn active={cat === "news"} onClick={() => setCat("news")}>Новости</FilterBtn>
          </div>

          {/* Маленький статус */}
          <p className="p" style={{ marginTop: 10, opacity: 0.85 }}>
            {catLabel(cat)} · {countText}
          </p>

          {/* Лента */}
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
                      <span className={`chip chip--${chipKindByLevel(e.level)}`}>
                        {chipTextByLevel(e.level)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Загрузить ещё */}
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