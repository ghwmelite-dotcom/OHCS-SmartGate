import { create } from 'zustand';

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

interface InstallState {
  deferredPrompt: BIPEvent | null;
  installed: boolean;
  setDeferredPrompt: (e: BIPEvent | null) => void;
  setInstalled: (v: boolean) => void;
}

export const useInstallStore = create<InstallState>((set) => ({
  deferredPrompt: null,
  installed: false,
  setDeferredPrompt: (e) => set({ deferredPrompt: e }),
  setInstalled: (v) => set((state) => ({ installed: v, deferredPrompt: v ? null : state.deferredPrompt })),
}));

export function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isStandalone = (window.matchMedia('(display-mode: standalone)').matches) ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return isIos && !isStandalone;
}

export function isAppInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}
