// web/src/pages/admin/OverviewSection.tsx
//
// Admin operational dashboard ("control center"): what needs attention right
// now, whether the service is healthy, and where to click to fix it.
// Aggregates the existing admin overview endpoint (counts only) and links into
// the existing URL-driven admin tabs. No business logic lives here.

import type { AdminOverviewState, AdminOverviewSystemStatus } from "../../app/notifications/adminOverview";
import { refreshAdminOverview } from "../../app/notifications/adminOverview";
import { useI18n } from "../../shared/i18n";
import { AdminSectionHeader, AdminSectionIcon, type AdminNavIconName } from "./shared";
import type { AdminTab } from "./types";

type Tone = "critical" | "attention" | "normal" | "muted";

function DashboardCard({
  icon,
  title,
  status,
  count,
  tone,
  wide,
  onClick,
}: {
  icon: AdminNavIconName;
  title: string;
  status: string;
  count?: number;
  tone: Tone;
  wide?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`admin-dashCard admin-dashCard--${tone}${wide ? " admin-dashCard--wide" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={title}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <span className="admin-dashCard__icon" aria-hidden="true">
        <AdminSectionIcon name={icon} size={20} />
      </span>
      <span className="admin-dashCard__body">
        <span className="admin-dashCard__title">{title}</span>
        <span className="admin-dashCard__status">{status}</span>
      </span>
      {typeof count === "number" && count > 0 ? (
        <span className="admin-dashCard__count" aria-hidden="true">{count > 99 ? "99+" : count}</span>
      ) : null}
      <span className="admin-dashCard__arrow" aria-hidden="true">›</span>
    </div>
  );
}

function systemStatusText(status: AdminOverviewSystemStatus, t: (k: string, p?: Record<string, string | number>) => string): string {
  switch (status) {
    case "ok":       return t("admin.overview.system.ok");
    case "degraded": return t("admin.overview.system.degraded");
    case "down":     return t("admin.overview.system.down");
    default:         return t("admin.overview.system.unknown");
  }
}

export function OverviewSection({
  overview,
  onOpen,
}: {
  overview: AdminOverviewState;
  onOpen: (tab: AdminTab, extra?: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const data = overview.data;
  const stale = overview.failed;
  const supportDown = stale || data.errors.support;
  const reviewsDown = stale || data.errors.reviews;
  const systemDown = stale || data.errors.system;
  const summaryDown = stale || data.errors.summary;

  const loadingFirst = overview.loading && overview.lastFetchedAt === 0;
  const attentionTotal = data.attention.total;
  const systemQuiet = data.system.status === "ok" || data.system.status === "unknown";
  const allCalm = !overview.failed && !loadingFirst && attentionTotal === 0 && data.system.issues === 0 && systemQuiet;

  const supportStatus = supportDown
    ? t("admin.overview.unavailable")
    : data.attention.support > 0
      ? t("admin.overview.support.waiting", { count: data.attention.support })
      : t("admin.overview.none");
  const partnershipStatus = supportDown
    ? t("admin.overview.unavailable")
    : data.attention.partnership > 0
      ? t("admin.overview.partnership.waiting", { count: data.attention.partnership })
      : t("admin.overview.none");
  const reviewsStatus = reviewsDown
    ? t("admin.overview.unavailable")
    : data.attention.reviews > 0
      ? t("admin.overview.reviews.waiting", { count: data.attention.reviews })
      : t("admin.overview.none");
  const systemStatus = systemDown
    ? t("admin.overview.unavailable")
    : data.system.issues > 0
      ? t("admin.overview.system.issues", { count: data.system.issues })
      : systemStatusText(data.system.status, t);

  const systemTone: Tone = systemDown
    ? "muted"
    : data.system.status === "down"
      ? "critical"
      : data.system.status === "degraded" || data.system.issues > 0
        ? "attention"
        : "normal";

  return (
    <div className="card">
      <div className="card__body">
        <AdminSectionHeader
          kicker={t("admin.tab.overview")}
          title={t("admin.overview.title")}
          subtitle={t("admin.overview.subtitle")}
          actions={
            <button
              className="btn btn--soft"
              type="button"
              onClick={() => void refreshAdminOverview()}
              aria-label={t("common.refresh")}
              title={t("common.refresh")}
            >
              ↻
            </button>
          }
        />

        {allCalm && (
          <div className="admin-allCalm admin-gap-top-md">
            <span className="admin-allCalm__icon" aria-hidden="true">✓</span>
            <div>
              <div className="admin-allCalm__title">{t("admin.overview.allgood.title")}</div>
              <div className="admin-allCalm__text">{t("admin.overview.allgood.text")}</div>
            </div>
          </div>
        )}

        <h3 className="h2 admin-gap-top-md">{t("admin.overview.attention.title")}</h3>
        {loadingFirst ? (
          <div className="admin-dashGrid admin-gap-top-sm" aria-busy="true">
            <div className="skeleton admin-dashSkeleton" />
            <div className="skeleton admin-dashSkeleton" />
            <div className="skeleton admin-dashSkeleton" />
            <div className="skeleton admin-dashSkeleton" />
          </div>
        ) : (
          <div className="admin-dashGrid admin-gap-top-sm">
            <DashboardCard
              icon="support"
              title={t("admin.overview.support")}
              status={supportStatus}
              count={supportDown ? 0 : data.attention.support}
              tone={supportDown ? "muted" : data.attention.support > 0 ? "attention" : "normal"}
              onClick={() => onOpen("support")}
            />
            <DashboardCard
              icon="referral"
              title={t("admin.overview.partnership")}
              status={partnershipStatus}
              count={supportDown ? 0 : data.attention.partnership}
              tone={supportDown ? "muted" : data.attention.partnership > 0 ? "attention" : "normal"}
              onClick={() => onOpen("support", { kind: "partnership" })}
            />
            <DashboardCard
              icon="reviews"
              title={t("admin.overview.reviews")}
              status={reviewsStatus}
              count={reviewsDown ? 0 : data.attention.reviews}
              tone={reviewsDown ? "muted" : data.attention.reviews > 0 ? "attention" : "normal"}
              onClick={() => onOpen("reviews")}
            />
            <DashboardCard
              icon="servers"
              title={t("admin.overview.system")}
              status={systemStatus}
              count={systemDown ? 0 : data.system.issues}
              tone={systemTone}
              wide
              onClick={() => onOpen("serverStatus")}
            />
          </div>
        )}

        <h3 className="h2 admin-gap-top-md">{t("admin.overview.project.title")}</h3>
        {summaryDown ? (
          <p className="p admin-gap-top-sm">{t("admin.overview.unavailable")}</p>
        ) : (
          <div className="admin-projectGrid admin-gap-top-sm">
            <div className="admin-projectStat">
              <span className="admin-projectStat__value">{data.summary.aliases}</span>
              <span className="admin-projectStat__label">{t("admin.overview.project.aliases")}</span>
            </div>
            <div className="admin-projectStat">
              <span className="admin-projectStat__value">{data.summary.partners}</span>
              <span className="admin-projectStat__label">{t("admin.overview.project.partners")}</span>
            </div>
            <div className="admin-projectStat">
              <span className="admin-projectStat__value">{data.summary.campaigns}</span>
              <span className="admin-projectStat__label">{t("admin.overview.project.campaigns")}</span>
            </div>
            <div className="admin-projectStat">
              <span className="admin-projectStat__value">{data.summary.enabledAliases}</span>
              <span className="admin-projectStat__label">{t("admin.overview.project.enabled")}</span>
            </div>
          </div>
        )}

        <div className="admin-gap-top-md">
          <button className="btn btn--soft" type="button" onClick={() => onOpen("support")}>
            {t("admin.overview.open_support")}
          </button>
        </div>
      </div>
    </div>
  );
}