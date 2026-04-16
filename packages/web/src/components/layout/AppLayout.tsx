import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ChatBubble } from '../chat/ChatBubble';
import { Toaster } from '../Toaster';
import { useSidebarStore } from '@/stores/sidebar';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

export function AppLayout() {
  const { isMobileOpen, closeMobile } = useSidebarStore();
  const location = useLocation();

  useKeyboardShortcuts();

  // Close mobile sidebar on route change
  useEffect(() => { closeMobile(); }, [location.pathname, closeMobile]);

  return (
    <div className="flex h-screen overflow-hidden relative">
      {/* Desktop/laptop sidebar — always visible, collapsible (lg+ = 1024px+) */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile/tablet overlay sidebar (below lg) */}
      {isMobileOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40 lg:hidden animate-fade-in" onClick={closeMobile} />
          <div className="fixed left-0 top-0 bottom-0 z-50 lg:hidden" style={{
            animation: 'slideInLeft 0.25s ease-out both',
          }}>
            <Sidebar forceExpanded />
          </div>
        </>
      )}

      <div className="flex flex-col flex-1 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto bg-background bg-kente p-4 md:p-6">
          <Outlet />
        </main>
      </div>
      <ChatBubble />
      <Toaster />

      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
