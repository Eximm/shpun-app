// web/src/pages/AdminPage.tsx
//
// Admin shell: compact navigation + focused workspace.
// The active section is derived from the URL (?tab=...), so deep links,
// browser back/forward and notification links (support/partnership + ticket)
// all stay in sync without a second navigation layer.

import { useLayoutEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { useSupportUnread } from "../app/notifications/supportUnread";
import { useI18n } from "../shared/i18n";
import { PageBackButton } from "../shared/ui/PageBackButton";

import { AdminSectionIcon, UnreadMarker, type AdminNavItem } from "./admin/shared";
import { OverviewSection } from "./admin/OverviewSection";
import { BroadcastsSection } from "./admin/BroadcastsSection";
import { OrderRulesSection } from "./admin/OrderRulesSection";
import { TrialProtectionSection } from "./admin/TrialProtectionSection";
import { ServiceCategoriesSection } from "./admin/ServiceCategoriesSection";
import { ReferralAliasesSection } from "./admin/ReferralAliasesSection";
import { ServerStatusSection } from "./admin/ServerStatusSection";
import { ReviewsSection } from "./admin/ReviewsSection";
import { SupportSection } from "./admin/SupportSection";
import { ADMIN_TABS, type AdminTab } from "./admin/types";

const TAB_SET: readonly string[] = ADMIN_TABS;

export function AdminPage() {
  const { me, loading } = useMe();
  const { t } = useI18n();
  const isAdmin = Boolean(me?.profile?.isAdmin || me?.admin?.isAdmin);
  const supportUnread = useSupportUnread(isAdmin);
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get("tab") ?? "";
  const kindParam = searchParams.get("kind");
  // ?tab=partnership is the partnership deep link, but it still belongs to the
  // single "Поддержка" navigation item — the split lives inside the workspace.
  const activeTab: AdminTab =
    tabParam === "partnership"
      ? "support"
      : TAB_SET.includes(tabParam)
        ? (tabParam as AdminTab)
        : "overview";
  const initialKind: "support" | "partnership" =
    tabParam === "partnership" || kindParam === "partnership" ? "partnership" : "support";
  const initialTicketId = Number(searchParams.get("ticket") ?? 0) || undefined;
  // Remount support when the deep-linked ticket/kind changes so the requested
  // conversation opens immediately instead of keeping a previously opened one.
  const supportKey = `${initialKind}:${initialTicketId ?? "list"}`;

  // Single source of truth for navigation, overview shortcuts and mobile picker.
  const navItems: AdminNavItem[] = [
    { tab: "overview", title: t("admin.tab.overview"), subtitle: "Панель", icon: "overview" },
    { tab: "reviews", title: "Отзывы", subtitle: "Модерация", icon: "reviews" },
    { tab: "broadcasts", title: t("admin.tab.broadcasts"), subtitle: t("admin.tab.broadcasts.sub"), icon: "broadcasts" },
    { tab: "orderRules", title: t("admin.tab.orders"), subtitle: "Правила", icon: "orders" },
    { tab: "trialProtection", title: t("admin.tab.trial"), subtitle: t("admin.tab.trial.sub"), icon: "trial" },
    { tab: "serviceCategories", title: t("admin.tab.categories"), subtitle: t("admin.tab.categories.sub"), icon: "categories" },
    { tab: "referralAliases", title: "Реклама и блогеры", subtitle: "Партнёры", icon: "referral" },
    { tab: "support", title: "Поддержка", subtitle: "Тикеты", icon: "support", badge: supportUnread.total },
    { tab: "serverStatus", title: "Статус серверов", subtitle: "Мониторинг", icon: "servers" },
  ];
  const activeItem = navItems.find((item) => item.tab === activeTab) ?? navItems[0];

  // Mobile picker open state is keyed to the active section, so external
  // navigation (notification deep links) collapses it without an effect.
  const [navState, setNavState] = useState<{ tab: AdminTab; open: boolean }>({ tab: activeTab, open: false });
  const navOpen = navState.tab === activeTab && navState.open;

  // A new section always starts at the top of the page so the workspace is in
  // view immediately (no leftover scroll position from the previous section).
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [activeTab]);

  function toggleNav() {
    setNavState({ tab: activeTab, open: !navOpen });
  }

  function selectTab(next: AdminTab) {
    setNavState({ tab: next, open: false });
    const params = new URLSearchParams();
    if (next !== "overview") params.set("tab", next);
    // Skip no-op navigation so the active item does not push duplicate history.
    if (params.toString() === searchParams.toString()) return;
    setSearchParams(params);
  }

  if (loading) {
    return (
      <div className="app-loader" style={{ opacity: 1, transition: "opacity 180ms ease", pointerEvents: "auto" }}>
        <div className="app-loader__card">
          <div className="app-loader__shine" />
          <div className="app-loader__brandRow">
            <div className="app-loader__mark" />
            <div className="app-loader__title">Shpun App</div>
          </div>
          <div className="app-loader__text">{t("home.loading.text")}</div>
        </div>
      </div>
    );
  }

  if (!isAdmin) return <Navigate to="/profile" replace />;

  return (
    <div className="section admin-page">
      <div className="admin-shell">
        <nav className="admin-nav" aria-label="Разделы админки">
          <div className="admin-nav__top">
            <div className="admin-nav__brand">
              <span className="kicker">Admin</span>
              <span className="admin-nav__brandTitle">Панель управления</span>
            </div>
            <PageBackButton to="/profile" label="В профиль" className="admin-nav__back" />
          </div>

          <button
            type="button"
            className="admin-nav__toggle"
            aria-expanded={navOpen}
            aria-controls="admin-nav-list"
            onClick={toggleNav}
          >
            <span className="admin-nav__icon" aria-hidden="true">
              <AdminSectionIcon name={activeItem.icon} />
            </span>
            <span className="admin-nav__text">
              <span className="admin-nav__title">{activeItem.title}</span>
              <span className="admin-nav__sub">Разделы</span>
            </span>
            <span className={`admin-nav__chevron${navOpen ? " is-open" : ""}`} aria-hidden="true">
              ▾
            </span>
          </button>

          <ul id="admin-nav-list" className={`admin-nav__list${navOpen ? " is-open" : ""}`}>
            {navItems.map((item) => {
              const isActive = item.tab === activeTab;
              return (
                <li key={item.tab}>
                  <button
                    type="button"
                    className={`admin-nav__item${isActive ? " is-active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => selectTab(item.tab)}
                  >
                    <span className="admin-nav__icon" aria-hidden="true">
                      <AdminSectionIcon name={item.icon} />
                    </span>
                    <span className="admin-nav__text">
                      <span className="admin-nav__title">{item.title}</span>
                      <span className="admin-nav__sub">{item.subtitle}</span>
                    </span>
                    {item.badge ? <UnreadMarker count={item.badge} variant="badge" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section className="admin-workspace" aria-label={activeItem.title}>
          {activeTab === "overview" && <OverviewSection items={navItems} onOpenTab={selectTab} />}
          {activeTab === "reviews" && <ReviewsSection />}
          {activeTab === "broadcasts" && <BroadcastsSection />}
          {activeTab === "orderRules" && <OrderRulesSection />}
          {activeTab === "trialProtection" && <TrialProtectionSection />}
          {activeTab === "serviceCategories" && <ServiceCategoriesSection />}
          {activeTab === "referralAliases" && <ReferralAliasesSection />}
          {activeTab === "support" && (
            <SupportSection key={supportKey} initialKind={initialKind} initialTicketId={initialTicketId} />
          )}
          {activeTab === "serverStatus" && <ServerStatusSection />}
        </section>
      </div>
    </div>
  );
}

export default AdminPage;
