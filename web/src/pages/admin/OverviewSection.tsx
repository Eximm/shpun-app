// web/src/pages/admin/OverviewSection.tsx
//
// Admin home dashboard. Deliberately NOT a second section launcher — the
// navigation (sidebar / mobile picker) is the single source of truth.
// Shows only real data that is already available (support unread counters).

import type { SupportUnreadCounts } from "../../app/notifications/supportUnread";
import { useI18n } from "../../shared/i18n";
import { AdminSectionHeader } from "./shared";

export function OverviewSection({ unread }: { unread: SupportUnreadCounts }) {
  const { t } = useI18n();
  return (
    <div className="card">
      <div className="card__body">
        <AdminSectionHeader
          kicker={t("admin.tab.overview")}
          title={t("admin.overview.title")}
          subtitle={t("admin.overview.subtitle")}
        />

        <div className="admin-summaryGrid admin-gap-top-md">
          <div className="admin-summary">
            <span className="admin-summary__label">{t("admin.overview.support")}</span>
            <strong className="admin-summary__value">{unread.support}</strong>
            <span className="admin-summary__hint">{t("admin.overview.awaiting")}</span>
          </div>
          <div className="admin-summary">
            <span className="admin-summary__label">{t("admin.overview.partnership")}</span>
            <strong className="admin-summary__value">{unread.partnership}</strong>
            <span className="admin-summary__hint">{t("admin.overview.awaiting")}</span>
          </div>
        </div>

        {unread.total === 0 ? (
          <p className="p admin-gap-top-md">{t("admin.overview.empty")}</p>
        ) : null}
      </div>
    </div>
  );
}