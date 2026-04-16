import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CheckInPage } from './pages/CheckInPage';
import { VisitorsPage } from './pages/VisitorsPage';
import { VisitorDetailPage } from './pages/VisitorDetailPage';
import { LinkTelegramPage } from './pages/LinkTelegramPage';
import { BadgeCheckoutPage } from './pages/BadgeCheckoutPage';
import { AdminPage } from './pages/AdminPage';
import { VisitLogPage } from './pages/VisitLogPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { ReportsPage } from './pages/ReportsPage';
import { AppLayout } from './components/layout/AppLayout';
import { useAuthStore } from './stores/auth';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  const { checkSession, isLoading } = useAuthStore();

  useEffect(() => { checkSession(); }, [checkSession]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center" style={{
        background: 'linear-gradient(165deg, #1A4D2E 0%, #0F2E1B 50%, #071A0F 100%)',
      }}>
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: `repeating-linear-gradient(45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 16px),
            repeating-linear-gradient(-45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 16px)`,
        }} />
        <div className="relative flex flex-col items-center animate-fade-in">
          <div className="w-20 h-20 rounded-2xl overflow-hidden ring-2 ring-[#D4A017]/20 shadow-2xl shadow-black/30 mb-5">
            <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
            SmartGate
          </h1>
          <p className="text-[10px] tracking-[0.2em] uppercase text-[#D4A017]/70 font-medium mt-1">
            Visitor Management System
          </p>
          <div className="mt-6 h-1 w-16 rounded-full overflow-hidden bg-white/10">
            <div className="h-full w-full rounded-full animate-pulse" style={{
              background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)',
            }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route index element={<DashboardPage />} />
            <Route path="check-in" element={<CheckInPage />} />
            <Route path="visitors" element={<VisitorsPage />} />
            <Route path="visitors/:id" element={<VisitorDetailPage />} />
            <Route path="link-telegram" element={<LinkTelegramPage />} />
            <Route path="checkout/:code" element={<BadgeCheckoutPage />} />
            <Route path="visit-log" element={<VisitLogPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="admin" element={<AdminPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
