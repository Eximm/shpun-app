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

import { Login }            from "./pages/Login";
import { Home }             from "./pages/Home";
import { Feed }             from "./pages/Feed";
import { Services }         from "./pages/Services";
import { ServicesOrder }    from "./pages/ServicesOrder";
import { Payments }         from "./pages/Payments";
import { Profile }          from "./pages/Profile";
import { Transfer }         from "./pages/Transfer";
import { Referrals }        from "./pages/Referrals";
import { PaymentsHistory }  from "./pages/PaymentsHistory";
import { PaymentsReceipts } from "./pages/PaymentsReceipts";
import { ServicesRouter }   from "./pages/help/ServicesRouter";
import { AdminPage }        from "./pages/AdminPage";

import { AuthGate }                from "./app/auth/AuthGate";
import { BottomNav }               from "./app/layout/BottomNav";
import { I18nProvider, useI18n }   from "./shared/i18n";
import { ToastProvider }           from "./shared/ui/toast/ToastProvider";
import { useBillingNotifications } from "./app/notifications/useBillingNotifications";
import { apiFetch }                from "./shared/api/client";

/* ─── PWA install prompt ─────────────────────────────────────────────────── */

declare global {
  interface Window { __pwaInstallPrompt: BeforeInstallPromptEvent | null; }
}
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

window.__pwaInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); window.__pwaInstallPrompt = e as BeforeInstallPromptEvent; });
window.addEventListener("appinstalled", () => { window.__pwaInstallPrompt = null; });

/* ─── PWA service worker ─────────────────────────────────────────────────── */

if (import.meta.env.PROD) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      const RELOAD_KEY      = "pwa:sw-reloaded";
      const alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === "1";
      const updateSW        = registerSW({
        immediate: true,
        onNeedRefresh() {
          if (!alreadyReloaded) { sessionStorage.setItem(RELOAD_KEY, "1"); updateSW(true); window.location.reload(); }
        },
        onOfflineReady() {},
      });
    })
    .catch(() => {});
}

/* ─── Types ──────────────────────────────────────────────────────────────── */

type ServicesSummaryResp = { ok: true; summary?: { active?: number } };

const ROUTE_ORDER = ["/", "/home", "/feed", "/services", "/payments", "/profile"];

function routeTone(pathname: string) {
  if (pathname === "/" || pathname === "/home") return "home";
  if (pathname.startsWith("/feed")) return "feed";
  if (pathname.startsWith("/services") || pathname.startsWith("/help")) return "services";
  if (pathname.startsWith("/payments")) return "payments";
  if (pathname.startsWith("/profile")) return "profile";
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/login")) return "login";
  return "default";
}

function routeRank(pathname: string) {
  if (pathname.startsWith("/services")) return ROUTE_ORDER.indexOf("/services");
  if (pathname.startsWith("/payments")) return ROUTE_ORDER.indexOf("/payments");
  const exact = ROUTE_ORDER.indexOf(pathname);
  return exact >= 0 ? exact : -1;
}

/* ─── AppShell ───────────────────────────────────────────────────────────── */

function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const loc   = useLocation();
  const hideNav = loc.pathname === "/login" || loc.pathname.startsWith("/transfer");
  const tone = routeTone(loc.pathname);

  return (
    <div className={`app app--${tone}`}>
      <div className="app-ambient" aria-hidden="true" />
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
      {!hideNav && <BottomNav />}
    </div>
  );
}

/* ─── AuthedLayout ───────────────────────────────────────────────────────── */

function AuthedLayout() {
  const loc  = useLocation();
  const hide = loc.pathname === "/login" || loc.pathname.startsWith("/transfer");
  useBillingNotifications(!hide);
  return <AuthGate><Outlet /></AuthGate>;
}

/* ─── LandingRoute ───────────────────────────────────────────────────────── */

function LandingRoute() {
  const { t } = useI18n();
  const loc   = useLocation();
  const alreadyChecked = sessionStorage.getItem("landing_checked") === "1";
  const [state, setState] = React.useState<"loading" | "home" | "services">(
    alreadyChecked ? "home" : "loading"
  );

  React.useEffect(() => {
    if (alreadyChecked) return;
    let cancelled = false;
    void (async () => {
      try {
        const resp   = await apiFetch<ServicesSummaryResp>("/services", { method: "GET" });
        const active = Number(resp?.summary?.active ?? 0);
        if (cancelled) return;
        sessionStorage.setItem("landing_checked", "1");
        setState(active > 0 ? "home" : "services");
      } catch { if (!cancelled) setState("home"); }
    })();
    return () => { cancelled = true; };
  }, [loc.search]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === "loading") {
    return (
      <div className="app-loader" style={{ opacity: 1, transition: "opacity 180ms ease", pointerEvents: "auto" }}>
        <div className="app-loader__card">
          <div className="app-loader__shine" />
          <div className="app-loader__brandRow"><div className="app-loader__mark" /><div className="app-loader__title">Shpun App</div></div>
          <div className="app-loader__text">{t("home.loading.text")}</div>
        </div>
      </div>
    );
  }
  return state === "home" ? <Home /> : <Services />;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function AppPathRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: "/", search: loc.search }} replace />;
}

// Корневой маршрут.
// Биллинг шлёт ссылки вида https://app.sdnonline.online?token=XXX —
// редиректим на /login?token=XXX, там Login.tsx сам откроет модалку смены пароля.
function RootRoute() {
  const loc   = useLocation();
  const token = new URLSearchParams(loc.search).get("token");
  if (token) {
    return <Navigate to={`/login?token=${encodeURIComponent(token)}`} replace />;
  }
  return <AuthGateRoot />;
}

function AuthGateRoot() {
  useBillingNotifications(true);
  return <AuthGate><LandingRoute /></AuthGate>;
}

function PageContainer({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const [showProgress, setShowProgress] = React.useState(false);
  const prevPathRef = React.useRef(loc.pathname);
  const [motion, setMotion] = React.useState<"forward" | "back" | "soft">("soft");

  React.useEffect(() => {
    const prevRank = routeRank(prevPathRef.current);
    const nextRank = routeRank(loc.pathname);
    if (prevRank >= 0 && nextRank >= 0 && prevRank !== nextRank) {
      setMotion(nextRank > prevRank ? "forward" : "back");
    } else {
      setMotion("soft");
    }
    prevPathRef.current = loc.pathname;

    setShowProgress(true);
    const id = window.setTimeout(() => setShowProgress(false), 700);
    return () => clearTimeout(id);
  }, [loc.pathname]);

  return (
    <>
      {showProgress && <div className="top-progress"><div className="top-progress__bar" /></div>}
      {showProgress && <div className="page-frost" aria-hidden="true" />}
      <div key={loc.pathname} className={`page page--${motion}`}>{children}</div>
    </>
  );
}

/* ─── Root ───────────────────────────────────────────────────────────────── */

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <ToastProvider>
        <BrowserRouter>
          <AppShell>
            <PageContainer>
              <Routes>
                {/* Публичные маршруты */}
                <Route path="/login"    element={<Login />} />
                <Route path="/transfer" element={<Transfer />} />
                <Route path="/app"      element={<AppPathRedirect />} />

                {/* Корень: перехватывает ?token= и редиректит на /login */}
                <Route path="/" element={<RootRoute />} />

                <Route element={<AuthedLayout />}>
                  <Route path="/home"              element={<Home />} />
                  <Route path="/referrals"         element={<Referrals />} />
                  <Route path="/feed"              element={<Feed />} />
                  <Route path="/services"          element={<Services />} />
                  <Route path="/services/order"    element={<ServicesOrder />} />
                  <Route path="/help/router"       element={<ServicesRouter />} />
                  <Route path="/payments"          element={<Payments />} />
                  <Route path="/payments/history"  element={<PaymentsHistory />} />
                  <Route path="/payments/receipts" element={<PaymentsReceipts />} />
                  <Route path="/profile"           element={<Profile />} />
                  <Route path="/admin"             element={<AdminPage />} />
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </PageContainer>
          </AppShell>
        </BrowserRouter>
      </ToastProvider>
    </I18nProvider>
  </React.StrictMode>
);
