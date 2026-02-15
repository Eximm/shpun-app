import React from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
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

/* ============================================================
   ✅ Service Worker (production only)
   ============================================================ */

if (import.meta.env.PROD) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW();
    })
    .catch(() => {
      /* ignore */
    });
}

/* ============================================================
   AppShell
   ============================================================ */

function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const loc = useLocation();

  const hideNav =
    loc.pathname === "/login" ||
    loc.pathname.startsWith("/transfer");

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
          <span className="badge">{t("app.beta", "beta")}</span>
        </div>
      </header>

      <main className="main">
        <div className="container safe">{children}</div>
      </main>

      {!hideNav ? <BottomNav /> : null}
    </div>
  );
}

function Authed({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}

/* ============================================================
   Render
   ============================================================ */

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <AppShell>
          <Routes>
            <Route path="/transfer" element={<Transfer />} />
            <Route path="/login" element={<Login />} />

            <Route path="/app" element={<Navigate to="/app/home" replace />} />

            <Route
              path="/app/home"
              element={
                <Authed>
                  <Home />
                </Authed>
              }
            />
            <Route
              path="/app/feed"
              element={
                <Authed>
                  <Feed />
                </Authed>
              }
            />
            <Route
              path="/app/dashboard"
              element={
                <Authed>
                  <Dashboard />
                </Authed>
              }
            />
            <Route
              path="/app/services"
              element={
                <Authed>
                  <Services />
                </Authed>
              }
            />
            <Route
              path="/app/payments"
              element={
                <Authed>
                  <Payments />
                </Authed>
              }
            />
            <Route
              path="/app/profile"
              element={
                <Authed>
                  <Profile />
                </Authed>
              }
            />
            <Route
              path="/app/set-password"
              element={
                <Authed>
                  <SetPassword />
                </Authed>
              }
            />

            <Route path="/" element={<Navigate to="/app/home" replace />} />
            <Route path="*" element={<Navigate to="/app/home" replace />} />
          </Routes>
        </AppShell>
      </BrowserRouter>
    </I18nProvider>
  </React.StrictMode>
);
