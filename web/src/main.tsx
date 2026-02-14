import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'

import { Login } from './pages/Login'
import { Cabinet } from './pages/Cabinet'
import { Home } from './pages/Home'
import { Services } from './pages/Services'
import { Payments } from './pages/Payments'
import { Profile } from './pages/Profile'
import { SetPassword } from './pages/SetPassword'

import { AuthGate } from './app/auth/AuthGate'
import { InstallBanner } from './app/pwa/InstallBanner'
import { BottomNav } from './app/layout/BottomNav'

import { I18nProvider, useI18n } from './shared/i18n'

// PWA: auto-update service worker (только в production)
if (import.meta.env.PROD) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onRegisterError(error: unknown) {
          console.error('SW register error', error)
        },
      })
    })
    .catch((e: unknown) => console.error('SW import error', e))
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()

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

          <span className="badge">{t('app.beta')}</span>
        </div>
      </header>

      <main className="main">
        <div className="container safe">
          <div style={{ marginBottom: 16 }}>
            <InstallBanner />
          </div>

          {children}
        </div>
      </main>

      <BottomNav />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <AppShell>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route
              path="/app"
              element={
                <AuthGate>
                  <Home />
                </AuthGate>
              }
            />

            {/* Onboarding: set password right after Telegram auth */}
            <Route
              path="/app/set-password"
              element={
                <AuthGate>
                  <SetPassword />
                </AuthGate>
              }
            />

            <Route
              path="/app/services"
              element={
                <AuthGate>
                  <Services />
                </AuthGate>
              }
            />
            <Route
              path="/app/payments"
              element={
                <AuthGate>
                  <Payments />
                </AuthGate>
              }
            />
            <Route
              path="/app/profile"
              element={
                <AuthGate>
                  <Profile />
                </AuthGate>
              }
            />

            {/* Old route kept for now (compat) */}
            <Route
              path="/app/cabinet"
              element={
                <AuthGate>
                  <Cabinet />
                </AuthGate>
              }
            />

            <Route path="/" element={<Navigate to="/app" replace />} />
            <Route path="*" element={<Navigate to="/app" replace />} />
          </Routes>
        </AppShell>
      </BrowserRouter>
    </I18nProvider>
  </React.StrictMode>
)
