import { useState } from 'react';
import { api } from '@/lib/api';
import { KeyRound, X, Check } from 'lucide-react';

export function PinChangeButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsOpen(true)} className="text-[12px] text-white/50 hover:text-white/80 transition-colors flex items-center gap-1">
        <KeyRound className="h-3 w-3" /> PIN
      </button>
      {isOpen && <PinChangeModal onClose={() => setIsOpen(false)} />}
    </>
  );
}

function PinChangeModal({ onClose }: { onClose: () => void }) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPin !== confirmPin) {
      setErrorMsg('New PINs do not match');
      setStatus('error');
      return;
    }
    setStatus('loading');
    setErrorMsg('');
    try {
      await api.post('/auth/change-pin', { current_pin: currentPin, new_pin: newPin });
      setStatus('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to change PIN');
      setStatus('error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="p-6">
          {status === 'success' ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <Check className="h-7 w-7 text-green-600" />
              </div>
              <p className="text-[18px] font-bold text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>PIN Changed</p>
              <p className="text-[14px] text-gray-500 mt-1">Your new PIN is now active</p>
              <button onClick={onClose} className="mt-4 h-10 px-6 bg-[#1A4D2E] text-white text-[14px] font-semibold rounded-xl">Done</button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-[#1A4D2E]" />
                  <h3 className="text-[18px] font-bold text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>Change PIN</h3>
                </div>
                <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Current PIN</label>
                  <input type="password" required maxLength={4} value={currentPin}
                    onChange={e => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                    className="w-full h-12 px-4 rounded-xl border border-gray-200 bg-gray-50 text-center tracking-[0.5em] font-mono text-xl font-bold focus:outline-none focus:ring-2 focus:ring-[#1A4D2E]/20 focus:border-[#1A4D2E]"
                    inputMode="numeric" autoFocus />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">New PIN</label>
                  <input type="password" required maxLength={4} value={newPin}
                    onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
                    className="w-full h-12 px-4 rounded-xl border border-gray-200 bg-gray-50 text-center tracking-[0.5em] font-mono text-xl font-bold focus:outline-none focus:ring-2 focus:ring-[#1A4D2E]/20 focus:border-[#1A4D2E]"
                    inputMode="numeric" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Confirm New PIN</label>
                  <input type="password" required maxLength={4} value={confirmPin}
                    onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                    className="w-full h-12 px-4 rounded-xl border border-gray-200 bg-gray-50 text-center tracking-[0.5em] font-mono text-xl font-bold focus:outline-none focus:ring-2 focus:ring-[#1A4D2E]/20 focus:border-[#1A4D2E]"
                    inputMode="numeric" />
                </div>
                {errorMsg && <p className="text-red-600 text-[13px] font-medium">{errorMsg}</p>}
                <button type="submit" disabled={status === 'loading' || currentPin.length !== 4 || newPin.length !== 4 || confirmPin.length !== 4}
                  className="w-full h-12 bg-[#1A4D2E] text-white rounded-xl font-bold text-[15px] hover:brightness-110 disabled:opacity-50 transition-all">
                  {status === 'loading' ? 'Changing...' : 'Change PIN'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

