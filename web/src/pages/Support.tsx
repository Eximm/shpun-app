import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { PageBackButton } from "../shared/ui/PageBackButton";

const SUPPORT_URL = "https://t.me/shpun_staff";
const NEWS_URL = "https://t.me/shpunsdn";
const BOT_URL = "https://t.me/shpunvpn_bot";

function param(search: string, key: string) {
  try {
    return new URLSearchParams(search).get(key)?.trim() || "";
  } catch {
    return "";
  }
}

function supportText(topic: string, usi: string) {
  if (topic === "service" && usi) {
    return `Здравствуйте! Нужна помощь по услуге #${usi}. Опишу, что происходит: `;
  }
  return "Здравствуйте! Нужна помощь по Shpun App. ";
}

export function Support() {
  const loc = useLocation();
  const topic = param(loc.search, "topic");
  const usi = param(loc.search, "usi");
  const text = useMemo(() => supportText(topic, usi), [topic, usi]);
  const supportHref = `${SUPPORT_URL}?text=${encodeURIComponent(text)}`;

  return (
    <div className="section miniPage support-page">
      <PageBackButton />
      <div className="card miniPage__hero support-hero">
        <div className="card__body">
          <div className="miniPage__head">
            <div>
              <h1 className="h1">Поддержка Shpun</h1>
              <p className="p miniPage__subtitle">
                Если что-то ведёт себя странно — пишите. Разберёмся без шаманского бубна, хотя бубен на всякий случай где-то рядом.
              </p>
            </div>
          </div>
          <div className="support-topic">
            <span>Тема</span>
            <strong>{topic === "service" && usi ? `Услуга #${usi}` : "Общий вопрос"}</strong>
          </div>
          <div className="actions actions--2 miniPage__actions">
            <a className="btn btn--primary" href={supportHref} target="_blank" rel="noopener noreferrer">Открыть поддержку</a>
            <a className="btn" href={NEWS_URL} target="_blank" rel="noopener noreferrer">Новости Shpun</a>
          </div>
        </div>
      </div>

      <div className="support-grid">
        <div className="card support-card">
          <div className="card__body">
            <div className="support-card__icon">💬</div>
            <h2>Куда писать</h2>
            <p>Основной канал поддержки — Telegram: <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">@shpun_staff</a>.</p>
          </div>
        </div>
        <div className="card support-card">
          <div className="card__body">
            <div className="support-card__icon">🤖</div>
            <h2>Бот-кабинет</h2>
            <p>Если удобнее открыть кабинет через Telegram, используйте <a href={BOT_URL} target="_blank" rel="noopener noreferrer">@shpunvpn_bot</a>.</p>
          </div>
        </div>
        <div className="card support-card">
          <div className="card__body">
            <div className="support-card__icon">📣</div>
            <h2>Новости</h2>
            <p>Изменения, важные объявления и служебные заметки публикуются в группе <a href={NEWS_URL} target="_blank" rel="noopener noreferrer">@shpunsdn</a>.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
