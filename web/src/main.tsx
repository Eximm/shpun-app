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
import { ServicesOrder } from "./pages/ServicesOrder";
import { Payments } from "./pages/Payments";
import { Profile } from "./pages/Profile";
import { SetPassword } from "./pages/SetPassword";
import { Transfer } from "./pages/Transfer";
import { Referrals } from "./pages/Referrals";

// ✅ NEW: payments mini-pages
import { PaymentsHistory } from "./pages/PaymentsHistory";
import { PaymentsReceipts } from "./pages/PaymentsReceipts";

// ✅ NEW: help page (Router VPN / Shpun Router)
import { ServicesRouter } from "./pages/help/ServicesRouter";

import { AuthGate } from "./app/auth/AuthGate";
import { BottomNav } from "./app/layout/BottomNav";
import { I18nProvider, useI18n } from "./shared/i18n";

// ✅ Toast provider
import { ToastProvider } from "./shared/ui/toast/ToastProvider";

// ✅ Billing notifications polling (broadcast + per-user later)
import { useBillingNotifications } from "./app/notifications/useBillingNotifications";

/* ============================================================
   Service Worker (production only)
   ============================================================ */

/**
 * Важно для Telegram WebView:
 * - регистрируем SW сразу (immediate)
 * - просим SW обновиться при старте
 * - если новый SW готов — делаем ОДИН мягкий reload, чтобы не сидеть на старом app-shell
 */
if (import.meta.env.PROD) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      // защита от циклических reload
      const RELOAD_KEY = "pwa:sw-reloaded";
      const alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === "1";

      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          // Новый SW установлен, но еще не активирован/не применён к странице.
          // В Telegram prompt часто бесполезен, поэтому делаем мягкий reload один раз.
          if (!alreadyReloaded) {
            sessionStorage.setItem(RELOAD_KEY, "1");
            // попросим SW примениться (внутри плагина это отправит SKIP_WAITING)
            updateSW(true);
            // и перезагрузим страницу, чтобы подхватить новый index.html + чанки
            window.location.reload();
          }
        },
        onOfflineReady() {
          // можно ничего не делать
        },
      });

      // Дополнительно: при старте попросим проверить обновление
      // (актуально если WebView долго держит процесс)
      try {
        updateSW(false);
      } catch {
        /* ignore */
      }
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
    loc.pathname === "/login" || loc.pathname.startsWith("/transfer");

  // ✅ Enable polling only on authed app screens (not login/transfer)
  useBillingNotifications(!hideNav);

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
      <ToastProvider>
        <BrowserRouter>
          <AppShell>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<Login />} />
              <Route path="/transfer" element={<Transfer />} />

              {/* Authed main sections */}
              <Route
                path="/"
                element={
                  <Authed>
                    <Home />
                  </Authed>
                }
              />

              <Route
                path="/referrals"
                element={
                  <Authed>
                    <Referrals />
                  </Authed>
                }
              />

              <Route
                path="/feed"
                element={
                  <Authed>
                    <Feed />
                  </Authed>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <Authed>
                    <Dashboard />
                  </Authed>
                }
              />

              <Route
                path="/services"
                element={
                  <Authed>
                    <Services />
                  </Authed>
                }
              />
              <Route
                path="/services/order"
                element={
                  <Authed>
                    <ServicesOrder />
                  </Authed>
                }
              />

              {/* ✅ NEW: Router VPN help/instruction page */}
              <Route
                path="/help/router"
                element={
                  <Authed>
                    <ServicesRouter />
                  </Authed>
                }
              />

              {/* Payments */}
              <Route
                path="/payments"
                element={
                  <Authed>
                    <Payments />
                  </Authed>
                }
              />

              {/* ✅ Payments mini-pages */}
              <Route
                path="/payments/history"
                element={
                  <Authed>
                    <PaymentsHistory />
                  </Authed>
                }
              />
              <Route
                path="/payments/receipts"
                element={
                  <Authed>
                    <PaymentsReceipts />
                  </Authed>
                }
              />

              <Route
                path="/profile"
                element={
                  <Authed>
                    <Profile />
                  </Authed>
                }
              />
              <Route
                path="/set-password"
                element={
                  <Authed>
                    <SetPassword />
                  </Authed>
                }
              />

              {/* Clean routing: /home is not used */}
              <Route path="/home" element={<Navigate to="/" replace />} />

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
      </ToastProvider>
    </I18nProvider>
  </React.StrictMode>
);