import { create } from 'zustand';

interface SidebarState {
  isCollapsed: boolean;   // Desktop: collapsed to icons only
  isMobileOpen: boolean;  // Mobile/tablet: overlay open
  toggleCollapse: () => void;
  toggleMobile: () => void;
  closeMobile: () => void;
}

const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('sidebar-collapsed') : null;

export const useSidebarStore = create<SidebarState>((set) => ({
  isCollapsed: stored === 'true',
  isMobileOpen: false,

  toggleCollapse: () => set((s) => {
    const next = !s.isCollapsed;
    localStorage.setItem('sidebar-collapsed', String(next));
    return { isCollapsed: next };
  }),

  toggleMobile: () => set((s) => ({ isMobileOpen: !s.isMobileOpen })),
  closeMobile: () => set({ isMobileOpen: false }),
}));
