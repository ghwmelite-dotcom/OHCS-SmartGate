import { useState } from 'react';

const STORAGE_KEY = 'webauthn-nudge-dismissed';

interface WebAuthnNudgeBannerProps {
  /** Show only when last clock-in fell back to PIN AND user has no enrolled credential. */
  shouldShow: boolean;
  onEnroll: () => void;
}

export function WebAuthnNudgeBanner({ shouldShow, onEnroll }: WebAuthnNudgeBannerProps) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');

  if (!shouldShow || dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="mx-4 my-3 rounded-2xl bg-emerald-50 border border-emerald-200 p-4 flex items-start gap-3">
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-emerald-600 text-white grid place-items-center text-lg" aria-hidden>
        🔒
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-emerald-900">Faster clock-in with Face ID</p>
        <p className="text-sm text-emerald-800 mt-1">
          You used your PIN this time. Set up Face ID or fingerprint so next time it's instant.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={onEnroll}
            className="px-3 py-1.5 text-sm font-medium rounded-xl bg-emerald-600 text-white"
          >
            Set up
          </button>
          <button
            onClick={handleDismiss}
            className="px-3 py-1.5 text-sm font-medium rounded-xl text-emerald-700"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
