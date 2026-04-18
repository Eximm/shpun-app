// web/src/pages/AdminPage.tsx

import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { useI18n } from "../shared/i18n";

import { AdminTabButton } from "./admin/shared";
import { OverviewSection } from "./admin/OverviewSection";
import { BroadcastsSection } from "./admin/BroadcastsSection";
import { OrderRulesSection } from "./admin/OrderRulesSection";
import { TrialProtectionSection } from "./admin/TrialProtectionSection";
import { ServiceCategoriesSection } from "./admin/ServiceCategoriesSection";
import type { AdminTab } from "./admin/types";

export function AdminPage() {
  const { me, loading } = useMe() as any;
  const { t } = useI18n();
  const isAdmin = Boolean(me?.profile?.isAdmin || me?.admin?.isAdmin);
  const [tab, setTab] = useState<AdminTab>("overview");

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
      <div className="card admin-hero">
        <div className="card__body">
          <div className="kicker">Admin panel</div>
          <h1 className="h1">{t("admin.title")}</h1>
          <p className="p">{t("admin.subtitle")}</p>

          <div className="admin-tabsGrid admin-gap-top-md">
            <AdminTabButton active={tab === "overview"}        onClick={() => setTab("overview")}        title={t("admin.tab.overview")}   subtitle={t("admin.tab.overview.sub")} />
            <AdminTabButton active={tab === "broadcasts"}      onClick={() => setTab("broadcasts")}      title={t("admin.tab.broadcasts")} subtitle={t("admin.tab.broadcasts.sub")} />
            <AdminTabButton active={tab === "orderRules"}      onClick={() => setTab("orderRules")}      title={t("admin.tab.orders")}     subtitle={t("admin.tab.orders.sub")} />
            <AdminTabButton active={tab === "trialProtection"} onClick={() => setTab("trialProtection")} title={t("admin.tab.trial")}      subtitle={t("admin.tab.trial.sub")} />
            <AdminTabButton active={tab === "serviceCategories"} onClick={() => setTab("serviceCategories")} title={t("admin.tab.categories")} subtitle={t("admin.tab.categories.sub")} />
          </div>
        </div>
      </div>

      <div className="admin-content admin-gap-top-md">
        {tab === "overview"        && <OverviewSection onOpenTab={setTab} />}
        {tab === "broadcasts"      && <BroadcastsSection />}
        {tab === "orderRules"      && <OrderRulesSection />}
        {tab === "trialProtection" && <TrialProtectionSection />}
        {tab === "serviceCategories" && <ServiceCategoriesSection />}
      </div>
    </div>
  );
}

export default AdminPage;