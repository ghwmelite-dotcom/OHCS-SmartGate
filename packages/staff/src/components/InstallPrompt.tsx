import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useInstallStore, isAppInstalled, isIosSafari } from '@/stores/install';
import { IosInstallInstructions } from './IosInstallInstructions';

const SNOOZE_KEY = 'install-snoozed-until';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function isMobileOrTablet(): boolean {
  if (typeof window === 'undefined') return false;
  const narrow = window.matchMedia('(max-width: 1024px)').matches;
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  return narrow && touch;
}

function isSnoozed(): boolean {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return false;
    const until = Number.parseInt(raw, 10);
    return Number.isFinite(until) && Date.now() < until;
  } catch {
    return false;
  }
}

function snooze(): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {}
}

export function InstallPrompt() {
  const deferredPrompt = useInstallStore((s) => s.deferredPrompt);
  const installed = useInstallStore((s) => s.installed);
  const setDeferredPrompt = useInstallStore((s) => s.setDeferredPrompt);

  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showIos, setShowIos] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (isSnoozed()) setDismissed(true);
  }, []);

  useEffect(() => {
    if (!mounted || dismissed) return;
    const t = setTimeout(() => setAnimateIn(true), 50);
    return () => clearTimeout(t);
  }, [mounted, dismissed]);

  if (!mounted || dismissed) return null;
  if (installed || isAppInstalled()) return null;
  if (!isMobileOrTablet()) return null;

  const ios = isIosSafari();
  const canPrompt = Boolean(deferredPrompt);
  if (!canPrompt && !ios) return null;

  async function handleInstall() {
    if (ios && !canPrompt) {
      setShowIos(true);
      return;
    }
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (choice.outcome === 'dismissed') {
      snooze();
      setDismissed(true);
    }
  }

  function handleNotNow() {
    snooze();
    setAnimateIn(false);
    setTimeout(() => setDismissed(true), 200);
  }

  return (
    <>
      <div
        className="fixed left-0 right-0 z-40 px-4 pointer-events-none"
        style={{
          bottom: 'calc(env(safe-area-inset-bottom) + 12px)',
          transition: 'transform 220ms ease-out, opacity 220ms ease-out',
          transform: animateIn ? 'translateY(0)' : 'translateY(120%)',
          opacity: animateIn ? 1 : 0,
        }}
      >
        <div
          className="mx-auto max-w-md bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 overflow-hidden pointer-events-auto"
          role="dialog"
          aria-label="Install OHCS Staff Attendance"
        >
          <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
          <div className="p-4 flex items-start gap-3">
            <div className="h-11 w-11 rounded-xl overflow-hidden ring-1 ring-black/5 flex-shrink-0">
              <img src="/icons/icon-192.png" alt="" className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <h3
                className="text-[15px] font-bold text-gray-900 leading-tight"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                {ios && !canPrompt ? 'Install on your iPhone or iPad' : 'Install OHCS Staff Attendance'}
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5 leading-snug">
                Faster clock-in, offline support, and home-screen access.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleInstall}
                  className="h-10 px-4 rounded-lg bg-[#1A4D2E] hover:bg-[#0F2E1B] active:bg-[#0F2E1B] text-white text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Install
                </button>
                <button
                  type="button"
                  onClick={handleNotNow}
                  className="h-10 px-4 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-[13px] font-semibold transition-colors"
                >
                  Not now
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={handleNotNow}
              aria-label="Dismiss"
              className="h-8 w-8 -mt-1 -mr-1 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 flex-shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      {showIos && <IosInstallInstructions onClose={() => setShowIos(false)} />}
    </>
  );
}
