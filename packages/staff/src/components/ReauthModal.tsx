import { useEffect, useRef, useState } from 'react';

interface ReauthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<{ ok: boolean; rateLimited?: boolean; message?: string }>;
  /**
   * If true, copy reflects "biometric unavailable, use PIN" rather than
   * a primary "confirm with PIN" prompt.
   */
  fallback?: boolean;
}

export function ReauthModal({ isOpen, onClose, onSubmit, fallback }: ReauthModalProps) {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 4 || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await onSubmit(pin);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.message ?? (res.rateLimited ? 'Too many wrong attempts. Try tomorrow.' : 'Wrong PIN'));
      setShake(true);
      setTimeout(() => setShake(false), 400);
      setPin('');
      inputRef.current?.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className={`w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl ${shake ? 'animate-shake' : ''}`}
      >
        <h2 className="text-lg font-semibold text-slate-900">
          {fallback ? 'Enter your PIN' : 'Confirm clock-in'}
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          {fallback
            ? 'Biometric is unavailable on this device. Enter your PIN to continue.'
            : 'Enter your PIN to confirm this clock-in.'}
        </p>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={10}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="mt-4 w-full px-4 py-3 text-2xl text-center tracking-widest border-2 border-slate-200 rounded-2xl focus:border-emerald-500 focus:outline-none"
          placeholder="••••••"
          aria-label="PIN"
        />
        {error && (
          <p className="mt-2 text-sm text-rose-600 text-center" role="alert">{error}</p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-3 rounded-2xl text-slate-700 bg-slate-100 font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pin.length < 4 || submitting}
            className="px-4 py-3 rounded-2xl text-white bg-emerald-600 font-medium disabled:opacity-50"
          >
            {submitting ? '…' : 'Confirm'}
          </button>
        </div>
      </form>
    </div>
  );
}
