import type { AdminTab } from "./types";

export function OverviewSection({ onOpenTab }: { onOpenTab: (tab: AdminTab) => void }) {
  return (
    <div className="card">
      <div className="card__body">
        <div className="kicker">Overview</div>
        <h2 className="h2">Разделы админки</h2>
        <p className="p">Все основные инструменты управления собраны в одном компактном экране.</p>

        <div className="admin-overviewGrid admin-gap-top-md">
          <div className="mini admin-miniCard">
            <div className="mini__title">Broadcasts</div>
            <div className="mini__list">
              <div className="list__sub">Просмотр и удаление разосланных новостей.</div>
              <div>
                <span className="chip chip--ok">ГОТОВО</span>
              </div>
              <div className="actions actions--1">
                <button className="btn btn--soft" type="button" onClick={() => onOpenTab("broadcasts")}>
                  Открыть
                </button>
              </div>
            </div>
          </div>

          <div className="mini admin-miniCard">
            <div className="mini__title">Правила заказов</div>
            <div className="mini__list">
              <div className="list__sub">Управление orderBlockMode для неоплаченных услуг.</div>
              <div>
                <span className="chip chip--ok">ACTIVE</span>
              </div>
              <div className="actions actions--1">
                <button className="btn btn--soft" type="button" onClick={() => onOpenTab("orderRules")}>
                  Открыть
                </button>
              </div>
            </div>
          </div>

          <div className="mini admin-miniCard">
            <div className="mini__title">Trial Protection</div>
            <div className="mini__list">
              <div className="list__sub">Anti-abuse, режимы, TTL, журнал и активные блокировки.</div>
              <div>
                <span className="chip chip--warn">CONTROL</span>
              </div>
              <div className="actions actions--1">
                <button className="btn btn--soft" type="button" onClick={() => onOpenTab("trialProtection")}>
                  Открыть
                </button>
              </div>
            </div>
          </div>

          <div className="mini admin-miniCard">
            <div className="mini__title">Дальнейшее расширение</div>
            <div className="mini__list">
              <div className="list__sub">Поиск по IP, фильтры, whitelist и дополнительная диагностика.</div>
              <div>
                <span className="chip chip--soft">FUTURE</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}