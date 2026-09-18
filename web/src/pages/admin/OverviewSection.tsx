// web/src/pages/admin/OverviewSection.tsx
//
// Admin home dashboard. Deliberately NOT a second section launcher — the
// navigation (sidebar / mobile picker) is the single source of truth.
// Shows only real data that is already available (support unread counters).

import type { SupportUnreadCounts } from "../../app/notifications/supportUnread";
import { AdminSectionHeader } from "./shared";

export function OverviewSection({ unread }: { unread: SupportUnreadCounts }) {
  return (
    <div className="card">
      <div className="card__body">
        <AdminSectionHeader
          kicker="Обзор"
          title="Панель управления"
          subtitle="Сводка по обращениям. Разделы открываются из навигации."
        />

        <div className="admin-summaryGrid admin-gap-top-md">
          <div className="admin-summary">
            <span className="admin-summary__label">Поддержка</span>
            <strong className="admin-summary__value">{unread.support}</strong>
            <span className="admin-summary__hint">без ответа</span>
          </div>
          <div className="admin-summary">
            <span className="admin-summary__label">Сотрудничество</span>
            <strong className="admin-summary__value">{unread.partnership}</strong>
            <span className="admin-summary__hint">без ответа</span>
          </div>
        </div>

        {unread.total === 0 ? (
          <p className="p admin-gap-top-md">Новых обращений нет.</p>
        ) : null}
      </div>
    </div>
  );
}