import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useMe } from "../app/auth/useMe";

import { AdminTabButton } from "./admin/shared";
import { OverviewSection } from "./admin/OverviewSection";
import { BroadcastsSection } from "./admin/BroadcastsSection";
import { OrderRulesSection } from "./admin/OrderRulesSection";
import { TrialProtectionSection } from "./admin/TrialProtectionSection";
import type { AdminTab } from "./admin/types";

export function AdminPage() {
  const { me, loading: meLoading } = useMe() as any;
  const isAdmin = Boolean(me?.profile?.isAdmin || me?.admin?.isAdmin);
  const [tab, setTab] = useState<AdminTab>("overview");

  if (meLoading) {
    return (
      <div className="section admin-page">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Admin</h1>
            <p className="p">Загрузка…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/profile" replace />;
  }

  return (
    <div className="section admin-page">
      <div className="card admin-hero">
        <div className="card__body">
          <div className="kicker">Admin panel</div>
          <h1 className="h1">Мини-админка</h1>
          <p className="p">Компактная служебная панель для управления ключевыми функциями приложения.</p>

          <div className="admin-tabsGrid admin-gap-top-md">
            <AdminTabButton
              active={tab === "overview"}
              onClick={() => setTab("overview")}
              title="Обзор"
              subtitle="Структура"
            />
            <AdminTabButton
              active={tab === "broadcasts"}
              onClick={() => setTab("broadcasts")}
              title="Broadcasts"
              subtitle="Новости"
            />
            <AdminTabButton
              active={tab === "orderRules"}
              onClick={() => setTab("orderRules")}
              title="Заказы"
              subtitle="Order rules"
            />
            <AdminTabButton
              active={tab === "trialProtection"}
              onClick={() => setTab("trialProtection")}
              title="Trial Protection"
              subtitle="Anti-abuse"
            />
          </div>
        </div>
      </div>

      <div className="admin-content admin-gap-top-md">
        {tab === "overview" ? <OverviewSection onOpenTab={setTab} /> : null}
        {tab === "broadcasts" ? <BroadcastsSection /> : null}
        {tab === "orderRules" ? <OrderRulesSection /> : null}
        {tab === "trialProtection" ? <TrialProtectionSection /> : null}
      </div>
    </div>
  );
}

export default AdminPage;