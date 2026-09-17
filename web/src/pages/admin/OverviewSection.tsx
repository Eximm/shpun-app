// web/src/pages/admin/OverviewSection.tsx
//
// Admin home dashboard. Compact launcher over the same navigation items that
// power the sidebar/mobile picker (single source of truth in AdminPage).
// It is only rendered when the "overview" tab is selected.

import type { AdminTab } from "./types";
import { AdminSectionIcon, UnreadMarker, type AdminNavItem } from "./shared";

export function OverviewSection({
  items,
  onOpenTab,
}: {
  items: AdminNavItem[];
  onOpenTab: (tab: AdminTab) => void;
}) {
  const shortcuts = items.filter((item) => item.tab !== "overview");

  return (
    <div className="card">
      <div className="card__body">
        <div className="kicker">Обзор</div>
        <h2 className="h2">Панель управления</h2>
        <p className="p">Быстрый переход к разделам админки.</p>

        <div className="admin-shortcutGrid admin-gap-top-md">
          {shortcuts.map((item) => (
            <button
              key={item.tab}
              type="button"
              className="admin-shortcut"
              onClick={() => onOpenTab(item.tab)}
            >
              <span className="admin-shortcut__icon" aria-hidden="true">
                <AdminSectionIcon name={item.icon} />
              </span>
              <span className="admin-shortcut__main">
                <span className="admin-shortcut__title">{item.title}</span>
                <span className="admin-shortcut__sub">{item.subtitle}</span>
              </span>
              {item.badge ? <UnreadMarker count={item.badge} variant="badge" /> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
