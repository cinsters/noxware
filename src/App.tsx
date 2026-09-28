import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { SiteFooter, SiteNav } from './components/Layout'
import { RequireAuth } from './components/RequireAuth'
import { GatePage } from './pages/Gate'
import { DashboardPage } from './pages/Dashboard'
import { StorePage } from './pages/Store'
import { StatusPage } from './pages/Status'
import { CheckoutCancelPage, CheckoutSuccessPage } from './pages/Checkout'
import { PrivacyPage, TermsPage } from './pages/Legal'
import { StaffPage } from './pages/Staff'
import { AdminPage } from './pages/Admin'
import { LauncherAuthorizePage } from './pages/LauncherAuthorize'

function Shell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="page-shell gate-shell">
        <div className="gate-loading">
          <span className="cursor-blink">_</span>
        </div>
      </div>
    )
  }

  return (
    <div className={`page-shell ${user ? '' : 'gate-shell'}`}>
      {user && <div className="bg-grid" aria-hidden="true" />}
      <SiteNav />
      <main>{children}</main>
      <SiteFooter />
    </div>
  )
}

function AppRoutes() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<GatePage />} />
        <Route path="/login" element={<Navigate to="/?tab=login" replace />} />
        <Route path="/register" element={<Navigate to="/?tab=register" replace />} />
        <Route path="/launcher/authorize" element={<LauncherAuthorizePage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/store" element={<StorePage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/checkout/success" element={<CheckoutSuccessPage />} />
          <Route path="/checkout/cancel" element={<CheckoutCancelPage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
