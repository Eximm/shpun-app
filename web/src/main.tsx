// FILE: web/src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  Outlet,
} from "react-router-dom";
import "./index.css";

import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Feed } from "./pages/Feed";
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
import { AdminPage } from "./pages/AdminPage";

import { AuthGate } from "./app/auth/AuthGate";
import { BottomNav } from "./app/layout/BottomNav";
import { I18nProvider, useI18n } from "./shared/i18n";
import { ToastProvider } from "./shared/ui/toast/ToastProvider";
import { useBillingNotifications } from "./app/notifications/useBillingNotifications";
import { apiFetch } from "./shared/api/client";

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
      } catch {
        // ignore
      }
    })
    .catch(() => {});
}

type ServicesSummaryResp = {
  ok: true;
  summary?: {
    active?: number;
  };
};

function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const loc = useLocation();

  const hideNav = loc.pathname === "/login" || loc.pathname.startsWith("/transfer");

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

function AuthedLayout() {
  const loc = useLocation();

  const hide = loc.pathname === "/login" || loc.pathname.startsWith("/transfer");
  useBillingNotifications(!hide);

  return (
    <AuthGate>
      <Outlet />
    </AuthGate>
  );
}

function LandingRoute() {
  const loc = useLocation();
  const [state, setState] = React.useState<"loading" | "home" | "services">("loading");

  React.useEffect(() => {
    let cancelled = false;

    async function decide() {
      try {
        const alreadyRedirected = sessionStorage.getItem("landing_checked") === "1";

        const resp = await apiFetch<ServicesSummaryResp>("/services", { method: "GET" });
        const active = Number(resp?.summary?.active ?? 0);

        if (cancelled) return;

        // если уже проверяли — не мешаем пользователю
        if (alreadyRedirected) {
          setState("home");
          return;
        }

        // первый заход
        sessionStorage.setItem("landing_checked", "1");

        if (active > 0) {
          setState("home");
        } else {
          setState("services");
        }
      } catch {
        if (cancelled) return;
        setState("home");
      }
    }

    void decide();

    return () => {
      cancelled = true;
    };
  }, [loc.search]);

  if (state === "loading") {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Shpun App</h1>
            <p className="p">Загрузка…</p>
          </div>
        </div>
      </div>
    );
  }

  return state === "home" ? <Home /> : <Services />;
}

function AppPathRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: "/", search: loc.search }} replace />;
}

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <ToastProvider>
        <BrowserRouter>
          <AppShell>
            <PageContainer>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/transfer" element={<Transfer />} />

                <Route path="/app" element={<AppPathRedirect />} />

                <Route element={<AuthedLayout />}>
                  <Route path="/" element={<LandingRoute />} />
                  <Route path="/home" element={<Home />} />
                  <Route path="/referrals" element={<Referrals />} />
                  <Route path="/feed" element={<Feed />} />
                  <Route path="/services" element={<Services />} />
                  <Route path="/services/order" element={<ServicesOrder />} />
                  <Route path="/help/router" element={<ServicesRouter />} />
                  <Route path="/payments" element={<Payments />} />
                  <Route path="/payments/history" element={<PaymentsHistory />} />
                  <Route path="/payments/receipts" element={<PaymentsReceipts />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/set-password" element={<SetPassword />} />
                  <Route path="/admin" element={<AdminPage />} />
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </PageContainer>
          </AppShell>
        </BrowserRouter>
      </ToastProvider>
    </I18nProvider>
  </React.StrictMode>,
);