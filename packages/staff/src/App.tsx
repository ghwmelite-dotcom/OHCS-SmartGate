import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './pages/LoginPage';
import { ClockPage } from './pages/ClockPage';
import { useAuthStore } from './stores/auth';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
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
        <div className="w-20 h-20 rounded-2xl overflow-hidden ring-2 ring-[#D4A017]/20 shadow-2xl mb-5">
          <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
        </div>
        <h1 className="text-xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Staff Attendance</h1>
        <div className="mt-4 h-1 w-16 rounded-full overflow-hidden bg-white/10">
          <div className="h-full w-full rounded-full" style={{
            width: '40%', background: 'linear-gradient(90deg, #D4A017, #F5D76E)',
            animation: 'loading-slide 1.5s ease-in-out infinite',
          }} />
        </div>
        <style>{`@keyframes loading-slide { 0% { transform: translateX(-100%); } 50% { transform: translateX(250%); } 100% { transform: translateX(-100%); } }`}</style>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ProtectedRoute><ClockPage /></ProtectedRoute>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
