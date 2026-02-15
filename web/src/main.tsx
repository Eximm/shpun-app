// web/src/main.tsx
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
   Env / Telegram helpers
   ============================================================ */

function isTelegramWebApp(): boolean {
  try {
    return !!(window as any)?.Telegram?.WebApp;
  } catch {
    return false;
  }
}

const IN_TELEGRAM = isTelegramWebApp();

/* ============================================================
   ✅ Service Worker: register ONLY outside Telegram WebApp
   ============================================================ */

if (import.meta.env.PROD && !IN_TELEGRAM) {
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

/* ============================================================
   Global error hooks (helps Telegram WebView debugging)
   ============================================================ */

try {
  window.addEventListener("error", (e: any) => {
    // eslint-disable-next-line no-console
    console.error("[window.error]", e?.error || e?.message || e);
  });
  window.addEventListener("unhandledrejection", (e: any) => {
    // eslint-disable-next-line no-console
    console.error("[unhandledrejection]", e?.reason || e);
  });
} catch {
  // ignore
}

/* ============================================================
   ErrorBoundary (prevents blank screen in Telegram)
   ============================================================ */

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack?: string }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(err: any) {
    return {
      hasError: true,
      message: String(err?.message || err || "Unknown error"),
      stack: String(err?.stack || ""),
    };
  }

  componentDidCatch(err: any) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", err);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="app">
        <main className="main">
          <div className="container safe">
            <div className="card">
              <div className="card__body">
                <div style={{ fontWeight: 900, marginBottom: 10 }}>
                  ⚠️ App crashed
                </div>
                <div className="pre" style={{ whiteSpace: "pre-wrap" }}>
                  {this.state.message}
                </div>

                <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                  <button
                    className="btn btn--primary"
                    type="button"
                    onClick={() => window.location.reload()}
                  >
                    Reload
                  </button>

                  <button
                    className="btn"
                    type="button"
                    onClick={async () => {
                      const text =
                        `Shpun App crash\n` +
                        `ua: ${navigator.userAgent}\n` +
                        `url: ${location.href}\n\n` +
                        `message: ${this.state.message}\n\n` +
                        `stack:\n${this.state.stack || ""}`;
                      try {
                        await navigator.clipboard.writeText(text);
                      } catch {
                        // fallback
                        const ta = document.createElement("textarea");
                        ta.value = text;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand("copy");
                        document.body.removeChild(ta);
                      }
                      alert("Copied crash report");
                    }}
                  >
                    Copy crash report
                  </button>
                </div>

                {!IN_TELEGRAM && this.state.stack ? (
                  <div className="pre" style={{ marginTop: 14 }}>
                    {this.state.stack}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }
}

/* ============================================================
   AppShell
   ============================================================ */

function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const loc = useLocation();

  // Hide bottom nav on public routes
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
    <ErrorBoundary>
      <I18nProvider>
        <BrowserRouter>
          <AppShell>
            <Routes>
              {/* Transfer login entry (desktop / external browser) */}
              <Route path="/transfer" element={<Transfer />} />

              {/* Public */}
              <Route path="/login" element={<Login />} />

              {/* App root */}
              <Route path="/app" element={<Navigate to="/app/home" replace />} />

              {/* Main */}
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

              {/* Utility */}
              <Route
                path="/app/dashboard"
                element={
                  <Authed>
                    <Dashboard />
                  </Authed>
                }
              />

              {/* Core */}
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

              {/* Legacy */}
              <Route
                path="/app/cabinet"
                element={<Navigate to="/app/feed" replace />}
              />

              {/* Default */}
              <Route path="/" element={<Navigate to="/app/home" replace />} />
              <Route path="*" element={<Navigate to="/app/home" replace />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
