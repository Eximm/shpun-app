import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
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
import { PaymentsHistory } from "./pages/PaymentsHistory";
import { PaymentsReceipts } from "./pages/PaymentsReceipts";
import { ServicesRouter } from "./pages/help/ServicesRouter";

import { AuthGate } from "./app/auth/AuthGate";
import { BottomNav } from "./app/layout/BottomNav";
import { I18nProvider, useI18n } from "./shared/i18n";
import { ToastProvider } from "./shared/ui/toast/ToastProvider";
import { useBillingNotifications } from "./app/notifications/useBillingNotifications";
import { usePushAutoregister } from "./app/notifications/usePushAutoregister";
import { usePushOnboarding } from "./app/notifications/usePushOnboarding";

/* ============================================================
   Service Worker (production only)
   ============================================================ */

if (import.meta.env.PROD) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      const RELOAD_KEY = "pwa:sw-reloaded";
      const alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === "1";

      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          if (!alreadyReloaded) {
            sessionStorage.setItem(RELOAD_KEY, "1");
            updateSW(true);
            window.location.reload();
          }
        },
        onOfflineReady() {},
      });

      try {
        updateSW(false);
      } catch {}
    })
    .catch(() => {});
}

/* ============================================================
   Small UI: Push Onboarding Modal
   ============================================================ */

function PushOnboardingModal({
  open,
  busy,
  standalone,
  permission,
  onAccept,
  onDismiss,
}: {
  open: boolean;
  busy: boolean;
  standalone: boolean;
  permission: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  if (!open) return null;

  const hint =
    permission === "denied"
      ? "Уведомления запрещены в браузере. Разреши их в настройках сайта."
      : !standalone
        ? "Для push нужно установить приложение (PWA)."
        : "Включи уведомления, чтобы получать баланс и продления даже когда приложение закрыто.";

  const primaryText = !standalone ? "Ок" : "Включить";

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={onDismiss}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 9999,
      }}
    >
      <div className="card" onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(680px, 100%)" }}>
        <div className="card__body">
          <div className="h1" style={{ fontSize: 18, margin: 0 }}>
            🔔 Уведомления
          </div>

          <p className="p" style={{ marginTop: 8 }}>
            {hint}
          </p>

          <div className="row" style={{ marginTop: 12, justifyContent: "flex-end", gap: 10 }}>
            <button className="btn" type="button" onClick={onDismiss} disabled={busy}>
              Не сейчас
            </button>

            <button className="btn btn--primary" type="button" onClick={onAccept} disabled={busy}>
              {busy ? "…" : primaryText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   AppShell
   ============================================================ */

function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const loc = useLocation();

  const hideNav = loc.pathname === "/login" || loc.pathname.startsWith("/transfer");

  // Toasts + polling only when in main app UI (as before)
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
  // ✅ Push subscription auto-restore for authed area (independent from hideNav)
  usePushAutoregister(true);

  // ✅ Onboarding prompt right after auth (in-app modal + user-gesture button)
  const po = usePushOnboarding(true);

  return (
    <>
      <AuthGate>{children}</AuthGate>

      <PushOnboardingModal
        open={po.open}
        busy={po.busy}
        standalone={po.state.standalone}
        permission={String(po.state.permission)}
        onAccept={po.accept}
        onDismiss={po.dismiss}
      />
    </>
  );
}

/* ============================================================
   Redirect helper: /app -> / (preserve search/hash)
   ============================================================ */

function AppPathRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: "/", search: loc.search }} replace />;
}

/* ============================================================
   Page transition wrapper
   ============================================================ */

function PageContainer({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const [showProgress, setShowProgress] = React.useState(false);

  React.useEffect(() => {
    setShowProgress(true);
    const t = window.setTimeout(() => setShowProgress(false), 700);
    return () => clearTimeout(t);
  }, [loc.pathname]);

  return (
    <>
      {showProgress && (
        <div className="top-progress">
          <div className="top-progress__bar" />
        </div>
      )}

      <div
        className="page-frost"
        style={{
          opacity: showProgress ? 1 : 0,
          pointerEvents: "none",
        }}
      />

      <div key={loc.pathname} className="page">
        {children}
      </div>
    </>
  );
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
            <PageContainer>
              <Routes>
                {/* Public */}
                <Route path="/login" element={<Login />} />
                <Route path="/transfer" element={<Transfer />} />

                {/* Compatibility: backend redirects to /app */}
                <Route path="/app" element={<AppPathRedirect />} />

                {/* Authed main */}
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

                <Route
                  path="/help/router"
                  element={
                    <Authed>
                      <ServicesRouter />
                    </Authed>
                  }
                />

                <Route
                  path="/payments"
                  element={
                    <Authed>
                      <Payments />
                    </Authed>
                  }
                />

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

                <Route path="/home" element={<Navigate to="/" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </PageContainer>
          </AppShell>
        </BrowserRouter>
      </ToastProvider>
    </I18nProvider>
  </React.StrictMode>
);