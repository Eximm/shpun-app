import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";

import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Feed } from "./pages/Feed";
import { Dashboard } from "./pages/Dashboard";
import { Services } from "./pages/Services";
import { Payments } from "./pages/Payments";
import { Profile } from "./pages/Profile";
import { SetPassword } from "./pages/SetPassword";
import { Transfer } from "./pages/Transfer";

import { AuthGate } from "./app/auth/AuthGate";
import { BottomNav } from "./app/layout/BottomNav";

import { I18nProvider, useI18n } from "./shared/i18n";

if (import.meta.env.PROD) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onRegisterError(error: unknown) {
          console.error("SW register error", error);
        },
      });
    })
    .catch((e: unknown) => console.error("SW import error", e));
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner safe">
          <div className="brand">
            <span className="brand__dot" />
            <div>
              <div className="brand__title">Shpun App</div>
              <div className="brand__subtitle">SDN System</div>
            </div>
          </div>

          <span className="badge">{t("app.beta")}</span>
        </div>
      </header>

      <main className="main">
        <div className="container safe">{children}</div>
      </main>

      <BottomNav />
    </div>
  );
}

function Authed(el: React.ReactNode) {
  return <AuthGate>{el}</AuthGate>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <AppShell>
          <Routes>
            {/* Desktop / PWA transfer-login entry */}
            <Route path="/transfer" element={<Transfer />} />

            {/* Public */}
            <Route path="/login" element={<Login />} />

            {/* App root */}
            <Route path="/app" element={<Navigate to="/app/home" replace />} />

            {/* Главная витрина */}
            <Route path="/app/home" element={Authed(<Home />)} />

            {/* Новости (бывший Cabinet) */}
            <Route path="/app/feed" element={Authed(<Feed />)} />

            {/* Внутренние/служебные страницы */}
            <Route path="/app/dashboard" element={Authed(<Dashboard />)} />

            {/* Остальное */}
            <Route path="/app/services" element={Authed(<Services />)} />
            <Route path="/app/payments" element={Authed(<Payments />)} />
            <Route path="/app/profile" element={Authed(<Profile />)} />
            <Route path="/app/set-password" element={Authed(<SetPassword />)} />

            {/* Совместимость со старыми ссылками */}
            <Route path="/app/cabinet" element={<Navigate to="/app/feed" replace />} />

            {/* Default */}
            <Route path="/" element={<Navigate to="/app/home" replace />} />
            <Route path="*" element={<Navigate to="/app/home" replace />} />
          </Routes>
        </AppShell>
      </BrowserRouter>
    </I18nProvider>
  </React.StrictMode>
);
