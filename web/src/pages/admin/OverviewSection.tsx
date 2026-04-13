// web/src/pages/admin/OverviewSection.tsx

import type { AdminTab } from "./types";

type CardItem = {
  title: string;
  sub: string;
  chip: { label: string; tone: "ok" | "warn" | "soft" };
  tab?: AdminTab;
};

const ITEMS: CardItem[] = [
  {
    title: "Broadcasts",
    sub: "Просмотр и удаление разосланных новостей.",
    chip: { label: "ГОТОВО", tone: "ok" },
    tab: "broadcasts",
  },
  {
    title: "Правила заказов",
    sub: "Управление orderBlockMode для неоплаченных услуг.",
    chip: { label: "ACTIVE", tone: "ok" },
    tab: "orderRules",
  },
  {
    title: "Trial Protection",
    sub: "Anti-abuse, режимы, TTL, журнал и активные блокировки.",
    chip: { label: "CONTROL", tone: "warn" },
    tab: "trialProtection",
  },
  {
    title: "Дальнейшее расширение",
    sub: "Поиск по IP, фильтры, whitelist и дополнительная диагностика.",
    chip: { label: "FUTURE", tone: "soft" },
  },
];

export function OverviewSection({ onOpenTab }: { onOpenTab: (tab: AdminTab) => void }) {
  return (
    <div className="card">
      <div className="card__body">
        <div className="kicker">Overview</div>
        <h2 className="h2">Разделы админки</h2>
        <p className="p">Все основные инструменты управления собраны в одном компактном экране.</p>

        <div className="admin-overviewGrid admin-gap-top-md">
          {ITEMS.map(({ title, sub, chip, tab }) => (
            <div key={title} className="mini admin-miniCard">
              <div className="mini__title">{title}</div>
              <div className="mini__list">
                <div className="list__sub">{sub}</div>
                <div><span className={`chip chip--${chip.tone}`}>{chip.label}</span></div>
                {tab && (
                  <div className="actions actions--1">
                    <button className="btn btn--soft" type="button" onClick={() => onOpenTab(tab)}>
                      Открыть
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}