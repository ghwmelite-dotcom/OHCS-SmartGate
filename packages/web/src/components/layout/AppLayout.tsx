import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ChatBubble } from '../chat/ChatBubble';
import { Toaster } from '../Toaster';
import { useSidebarStore } from '@/stores/sidebar';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

export function AppLayout() {
  const { isOpen, close } = useSidebarStore();
  const location = useLocation();

  useKeyboardShortcuts();

  // Close sidebar on route change (tablet navigation)
  useEffect(() => { close(); }, [location.pathname, close]);

  return (
    <div className="flex h-screen overflow-hidden relative">
      {/* Sidebar — always visible on desktop (xl+), overlay on tablet/mobile */}
      <div className="hidden xl:block">
        <Sidebar />
      </div>

      {/* Mobile/tablet overlay sidebar */}
      {isOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40 xl:hidden animate-fade-in" onClick={close} />
          <div className="fixed left-0 top-0 bottom-0 z-50 xl:hidden animate-slide-in-right">
            <Sidebar />
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
    </div>
  );
}
