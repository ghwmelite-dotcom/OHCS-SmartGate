import { useState } from 'react';
import { KeyRound, ShieldCheck, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { PinChangeModal } from '@/hooks/usePinChange';

export function FirstLoginPinPrompt() {
  const markPinAcknowledged = useAuthStore((s) => s.markPinAcknowledged);
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [keepStatus, setKeepStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [keepError, setKeepError] = useState('');

  async function handleKeep() {
    setKeepStatus('loading');
    setKeepError('');
    try {
      await api.post('/auth/acknowledge-pin', {});
      markPinAcknowledged();
    } catch (err) {
      setKeepError(err instanceof Error ? err.message : 'Failed to save your choice');
      setKeepStatus('error');
    }
  }

  if (showChangeModal) {
    return (
      <PinChangeModal
        onClose={() => setShowChangeModal(false)}
        onSuccess={() => {
          markPinAcknowledged();
        }}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-login-pin-title"
    >
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="p-6">
          <div className="w-14 h-14 bg-[#1A4D2E]/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="h-7 w-7 text-[#1A4D2E]" />
          </div>
          <h3
            id="first-login-pin-title"
            className="text-[20px] font-bold text-gray-900 text-center"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Secure your account
          </h3>
          <p className="text-[14px] text-gray-600 text-center mt-2 leading-relaxed">
            You're currently using the PIN set by your administrator. Would you like to change it now, or keep it?
          </p>

          {keepError && (
            <p className="text-red-600 text-[13px] font-medium text-center mt-3">{keepError}</p>
          )}

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={() => setShowChangeModal(true)}
              disabled={keepStatus === 'loading'}
              className="w-full h-12 bg-[#1A4D2E] text-white rounded-xl font-bold text-[15px] hover:brightness-110 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              <KeyRound className="h-4 w-4" />
              Change PIN
            </button>
            <button
              type="button"
              onClick={handleKeep}
              disabled={keepStatus === 'loading'}
              className="w-full h-12 bg-white border-2 border-gray-200 text-gray-700 rounded-xl font-semibold text-[15px] hover:border-gray-300 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {keepStatus === 'loading' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Keep Current PIN'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
