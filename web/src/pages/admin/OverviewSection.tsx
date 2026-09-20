// web/src/pages/admin/OverviewSection.tsx
//
// Admin operational dashboard ("control center"): what needs attention right
// now, what happened recently, and what happened in the last 24 hours.
// Aggregates the existing admin overview endpoint (counts + activity only) and
// links into the existing URL-driven admin tabs. No business logic lives here.

import type {
  AdminOverviewActivityItem,
  AdminOverviewState,
  AdminOverviewSystemStatus,
} from "../../app/notifications/adminOverview";
import { refreshAdminOverview } from "../../app/notifications/adminOverview";
import { useI18n } from "../../shared/i18n";
import { AdminSectionHeader, AdminSectionIcon, ADMIN_SECTION_ICON, activityIconName, type AdminNavIconName } from "./shared";
import type { AdminTab } from "./types";

type Tone = "critical" | "attention" | "normal" | "muted";
type OpenTarget = { tab: AdminTab; extra?: Record<string, string> };

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

function systemStatusText(
  status: AdminOverviewSystemStatus,
  t: (k: string, p?: Record<string, string | number>) => string
): string {
  switch (status) {
    case "ok":       return t("admin.overview.system.ok");
    case "degraded": return t("admin.overview.system.degraded");
    case "down":     return t("admin.overview.system.down");
    default:         return t("admin.overview.system.unknown");
  }
}

/** Map an activity item to a label, optional context and a destination. */
function activityText(
  item: AdminOverviewActivityItem,
  t: (k: string, p?: Record<string, string | number>) => string
): { title: string; context?: string; to: OpenTarget | null } {
  const no = item.publicNo || (item.ticketId ? String(item.ticketId) : "");
  switch (item.type) {
    case "support.ticket":
      return {
        title: item.reason === "message"
          ? t("admin.overview.activity.support.message")
          : t("admin.overview.activity.support.created"),
        context: no ? t("admin.overview.activity.ticket_ref", { no }) : undefined,
        to: item.ticketId ? { tab: "support", extra: { ticket: String(item.ticketId) } } : { tab: "support" },
      };
    case "partnership.ticket":
      return {
        title: item.reason === "message"
          ? t("admin.overview.activity.partnership.message")
          : t("admin.overview.activity.partnership.created"),
        context: no ? t("admin.overview.activity.ticket_ref", { no }) : undefined,
        to: item.ticketId
          ? { tab: "support", extra: { kind: "partnership", ticket: String(item.ticketId) } }
          : { tab: "support", extra: { kind: "partnership" } },
      };
    case "review.new":
      return { title: t("admin.overview.activity.review.new"), to: { tab: "reviews" } };
    case "referral.registration":
      return {
        title: t("admin.overview.activity.referral"),
        context: item.alias || undefined,
        to: { tab: "referralAliases" },
      };
    case "monitoring.incident":
      return {
        title: item.message || t("admin.overview.activity.monitoring.incident"),
        to: { tab: "serverStatus" },
      };
    case "monitoring.event":
      return {
        title: item.message || t("admin.overview.activity.monitoring.event"),
        to: { tab: "serverStatus" },
      };
    default:
      return { title: t("admin.overview.activity.unknown"), to: null };
  }
}

export function OverviewSection({
  overview,
  onOpen,
}: {
  overview: AdminOverviewState;
  onOpen: (tab: AdminTab, extra?: Record<string, string>) => void;
}) {
  const { t, formatDate, formatRelative } = useI18n();
  const data = overview.data;
  const stale = overview.failed;
  const supportDown = stale || data.errors.support;
  const reviewsDown = stale || data.errors.reviews;
  const systemDown = stale || data.errors.system;
  const summaryDown = stale || data.errors.summary;
  const todayDown = stale || data.errors.today;
  const activityDown = stale || data.errors.activity;

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
    : data.system.incidents > 0
      ? t("admin.overview.system.monitoring", { count: data.system.incidents })
      : data.system.issues > 0
        ? t("admin.overview.system.issues", { count: data.system.issues })
        : systemStatusText(data.system.status, t);

  const systemTone: Tone = systemDown
    ? "muted"
    : data.system.status === "down"
      ? "critical"
      : data.system.status === "degraded" || data.system.issues > 0 || data.system.incidents > 0
        ? "attention"
        : "normal";

  const updatedLabel = data.updatedAt
    ? t("admin.overview.updated", { time: formatDate(data.updatedAt, { hour: "2-digit", minute: "2-digit" }) })
    : "";

  return (
    <div className="card">
      <div className="card__body">
        <AdminSectionHeader
          kicker={t("admin.tab.overview")}
          title={t("admin.overview.title")}
          subtitle={t("admin.overview.subtitle")}
          actions={
            <div className="admin-refreshBox">
              {updatedLabel ? <span className="admin-refreshBox__time">{updatedLabel}</span> : null}
              <button
                className={`btn btn--soft admin-refreshBox__btn${overview.loading ? " is-refreshing" : ""}`}
                type="button"
                onClick={() => void refreshAdminOverview()}
                aria-label={t("common.refresh")}
                title={t("common.refresh")}
              >
                <AdminSectionIcon name="refresh" size={16} />
              </button>
            </div>
          }
        />

        {stale && (
          <p className="p admin-staleNote admin-gap-top-sm">{t("admin.overview.stale")}</p>
        )}

        {allCalm && (
          <div className="admin-allCalm admin-gap-top-md">
            <span className="admin-allCalm__icon" aria-hidden="true">
              <AdminSectionIcon name="check" size={18} />
            </span>
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
              icon={ADMIN_SECTION_ICON.support}
              title={t("admin.overview.support")}
              status={supportStatus}
              count={supportDown ? 0 : data.attention.support}
              tone={supportDown ? "muted" : data.attention.support > 0 ? "attention" : "normal"}
              onClick={() => onOpen("support")}
            />
            <DashboardCard
              icon={activityIconName("partnership.ticket")}
              title={t("admin.overview.partnership")}
              status={partnershipStatus}
              count={supportDown ? 0 : data.attention.partnership}
              tone={supportDown ? "muted" : data.attention.partnership > 0 ? "attention" : "normal"}
              onClick={() => onOpen("support", { kind: "partnership" })}
            />
            <DashboardCard
              icon={ADMIN_SECTION_ICON.reviews}
              title={t("admin.overview.reviews")}
              status={reviewsStatus}
              count={reviewsDown ? 0 : data.attention.reviews}
              tone={reviewsDown ? "muted" : data.attention.reviews > 0 ? "attention" : "normal"}
              onClick={() => onOpen("reviews")}
            />
            <DashboardCard
              icon={ADMIN_SECTION_ICON.serverStatus}
              title={t("admin.overview.system")}
              status={systemStatus}
              count={systemDown ? 0 : data.system.incidents || data.system.issues}
              tone={systemTone}
              wide
              onClick={() => onOpen("serverStatus")}
            />
          </div>
        )}

        <h3 className="h2 admin-gap-top-md">
          <span className="admin-blockTitle">
            <AdminSectionIcon name="activity" size={16} />
            {t("admin.overview.activity.title")}
          </span>
        </h3>
        {activityDown ? (
          <p className="p admin-gap-top-sm">{t("admin.overview.unavailable")}</p>
        ) : loadingFirst ? (
          <div className="list admin-gap-top-sm">
            <div className="skeleton p" />
            <div className="skeleton p" />
            <div className="skeleton p" />
          </div>
        ) : data.activity.length === 0 ? (
          <p className="p admin-gap-top-sm">{t("admin.overview.activity.empty")}</p>
        ) : (
          <div className="admin-activityList admin-gap-top-sm">
            {data.activity.map((item, index) => {
              const meta = activityText(item, t);
              const clickable = Boolean(meta.to);
              return (
                <div
                  key={`${item.type}:${item.ts}:${index}`}
                  className={`admin-activityRow${clickable ? " admin-activityRow--clickable" : ""}`}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable && meta.to ? () => onOpen(meta.to!.tab, meta.to!.extra) : undefined}
                  onKeyDown={clickable && meta.to ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpen(meta.to!.tab, meta.to!.extra);
                    }
                  } : undefined}
                >
                  <span className="admin-activityRow__icon" aria-hidden="true">
                    <AdminSectionIcon name={activityIconName(item.type)} size={16} />
                  </span>
                  <span className="admin-activityRow__body">
                    <span className="admin-activityRow__title">{meta.title}</span>
                    {meta.context ? <span className="admin-activityRow__context">{meta.context}</span> : null}
                  </span>
                  <span className="admin-activityRow__time">{formatRelative(item.ts)}</span>
                </div>
              );
            })}
          </div>
        )}

        <h3 className="h2 admin-gap-top-md">
          <span className="admin-blockTitle">
            <AdminSectionIcon name="clock" size={16} />
            {t("admin.overview.today.title")}
          </span>
        </h3>
        {todayDown ? (
          <p className="p admin-gap-top-sm">{t("admin.overview.unavailable")}</p>
        ) : (
          <div className="admin-todayGrid admin-gap-top-sm">
            <div className="admin-todayStat">
              <AdminSectionIcon name={ADMIN_SECTION_ICON.support} size={16} />
              <span className="admin-todayStat__value">{data.today.supportTickets}</span>
              <span className="admin-todayStat__label">{t("admin.overview.today.support")}</span>
            </div>
            <div className="admin-todayStat">
              <AdminSectionIcon name={activityIconName("partnership.ticket")} size={16} />
              <span className="admin-todayStat__value">{data.today.partnershipTickets}</span>
              <span className="admin-todayStat__label">{t("admin.overview.today.partnership")}</span>
            </div>
            <div className="admin-todayStat">
              <AdminSectionIcon name={ADMIN_SECTION_ICON.referralAliases} size={16} />
              <span className="admin-todayStat__value">{data.today.referrals}</span>
              <span className="admin-todayStat__label">{t("admin.overview.today.referrals")}</span>
            </div>
            <div className="admin-todayStat">
              <AdminSectionIcon name={ADMIN_SECTION_ICON.reviews} size={16} />
              <span className="admin-todayStat__value">{data.today.reviews}</span>
              <span className="admin-todayStat__label">{t("admin.overview.today.reviews")}</span>
            </div>
          </div>
        )}

        <h3 className="admin-projectTitle admin-gap-top-md">{t("admin.overview.project.title")}</h3>
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
      </div>
    </div>
  );
}