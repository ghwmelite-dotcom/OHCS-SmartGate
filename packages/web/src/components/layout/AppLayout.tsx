import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { ChatBubble } from '../chat/ChatBubble';
import { Toaster } from '../Toaster';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

export function AppLayout() {
  useKeyboardShortcuts();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop (lg+): collapsible sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <Header />
        <main className="flex-1 overflow-auto bg-background bg-kente p-4 md:p-6 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] lg:pb-6">
          <Outlet />
        </main>
      </div>

      {/* Mobile/tablet: bottom navigation bar */}
      <BottomNav />

      {/* Chat bubble — positioned above bottom nav on mobile */}
      <div className="lg:bottom-6 bottom-20 fixed right-6 z-30">
        <ChatBubble />
      </div>

      <Toaster />
    </div>
  );
}
