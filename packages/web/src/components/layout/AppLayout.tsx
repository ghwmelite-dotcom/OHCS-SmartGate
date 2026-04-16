import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ChatBubble } from '../chat/ChatBubble';
import { Toaster } from '../Toaster';
import { useSidebarStore } from '@/stores/sidebar';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

export function AppLayout() {
  const { isMobileOpen } = useSidebarStore();

  useKeyboardShortcuts();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop (lg+): always visible, collapsible */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Tablet/mobile (below lg): sidebar in flow, toggleable via hamburger */}
      <div
        className={`lg:hidden overflow-hidden transition-all duration-300 ease-in-out ${
          isMobileOpen ? 'w-64' : 'w-0'
        }`}
      >
        <div className="w-64 h-full">
          <Sidebar forceExpanded />
        </div>
      </div>

      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
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
