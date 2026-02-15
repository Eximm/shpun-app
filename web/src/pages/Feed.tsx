// web/src/pages/Feed.tsx
import { Link } from "react-router-dom";

type NewsItem = {
  id: string;
  title: string;
  text: string;
  badge?: { text: string; kind?: "ok" | "warn" | "soft" };
  dateLabel?: string;
};

const DEMO_NEWS: NewsItem[] = [
  {
    id: "app-launched",
    title: "🚀 Shpun App запущен",
    text: "Новый PWA-кабинет доступен. Дальше — делаем главную и ленту по-взрослому.",
    badge: { text: "today", kind: "ok" },
    dateLabel: "Today",
  },
  {
    id: "cabinet-to-feed",
    title: "🧭 Cabinet переехал в “Новости”",
    text: "Главная стала витриной. В “Услугах” появятся реальные статусы и действия.",
    badge: { text: "new", kind: "soft" },
    dateLabel: "This week",
  },
  {
    id: "transfer-login",
    title: "🔐 Вход с рабочего стола через Telegram",
    text: "Transfer-login: одноразовая ссылка переносит авторизацию в браузер/PWA.",
    badge: { text: "soon", kind: "warn" },
    dateLabel: "Soon",
  },
];

function Chip({ kind, children }: { kind?: "ok" | "warn" | "soft"; children: React.ReactNode }) {
  const cls =
    kind === "ok" ? "chip chip--ok" : kind === "warn" ? "chip chip--warn" : "chip chip--soft";
  return <span className={cls}>{children}</span>;
}

export function Feed() {
  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <h1 className="h1">Новости</h1>
              <p className="p">
                Лента обновлений Shpun SDN: анонсы, изменения, статусы инфраструктуры и полезные заметки.
              </p>
            </div>

            <Link className="btn" to="/app/home" title="На главную">
              Главная
            </Link>
          </div>

          <div className="list" style={{ marginTop: 12 }}>
            {DEMO_NEWS.map((n) => (
              <div key={n.id} className="list__item">
                <div className="list__main">
                  {n.dateLabel ? <div className="kicker">{n.dateLabel}</div> : null}
                  <div className="list__title" style={{ marginTop: n.dateLabel ? 6 : 0 }}>
                    {n.title}
                  </div>
                  <div className="list__sub">{n.text}</div>
                </div>

                <div className="list__side">{n.badge ? <Chip kind={n.badge.kind}>{n.badge.text}</Chip> : null}</div>
              </div>
            ))}
          </div>

          <div className="pre" style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Дальше</div>
            <div style={{ opacity: 0.85 }}>
              Тут подключим реальные новости из биллинга (или из отдельного “news” сервиса) и сделаем фильтры/категории.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
