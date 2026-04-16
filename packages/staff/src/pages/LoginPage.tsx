import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import { KeyRound } from 'lucide-react';

export function LoginPage() {
  const [staffId, setStaffId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { loginWithPin } = useAuthStore();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await loginWithPin(staffId, pin);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-5" style={{
      background: 'linear-gradient(165deg, #1A4D2E 0%, #0F2E1B 50%, #071A0F 100%)',
    }}>
      <div className="absolute inset-0 opacity-[0.04]" style={{
        backgroundImage: `repeating-linear-gradient(45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 16px),
          repeating-linear-gradient(-45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 16px)`,
      }} />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl overflow-hidden ring-2 ring-[#D4A017]/20 shadow-2xl mx-auto mb-4">
            <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Staff Attendance</h1>
          <p className="text-[11px] text-[#D4A017]/70 tracking-[0.2em] uppercase mt-1">OHCS Clock System</p>
        </div>

        <div className="bg-white/[0.08] backdrop-blur-sm rounded-2xl p-6 border border-white/10">
          <div className="flex items-center gap-2 mb-5">
            <KeyRound className="h-4 w-4 text-[#D4A017]" />
            <span className="text-[14px] font-semibold text-white">Sign In</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1.5">Staff ID</label>
              <input type="text" required value={staffId} onChange={e => setStaffId(e.target.value.toUpperCase())}
                placeholder="1334685" autoFocus
                className="w-full h-12 px-4 rounded-xl bg-white/10 border border-white/10 text-white text-[15px] font-medium tracking-wider placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-[#D4A017]/30 focus:border-[#D4A017]/40 transition-all" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1.5">PIN</label>
              <input type="password" required maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="****" inputMode="numeric"
                className="w-full h-14 px-4 rounded-xl bg-white/10 border border-white/10 text-white text-center text-2xl font-bold tracking-[0.5em] font-mono placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-[#D4A017]/30 focus:border-[#D4A017]/40 transition-all" />
            </div>
            {error && <p className="text-red-400 text-[13px] font-medium">{error}</p>}
            <button type="submit" disabled={isLoading || pin.length !== 4}
              className="w-full h-12 bg-[#D4A017] text-[#071A0F] rounded-xl font-bold text-[15px] hover:brightness-110 disabled:opacity-50 shadow-lg shadow-[#D4A017]/20 active:scale-[0.98] transition-all">
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <div className="flex items-center justify-center gap-3 mt-8" style={{ color: '#D4A017' }}>
          <span className="text-[9px] tracking-[0.2em] uppercase font-semibold opacity-50">Loyalty</span>
          <div className="w-1 h-1 rounded-full bg-[#D4A017] opacity-30" />
          <span className="text-[9px] tracking-[0.2em] uppercase font-semibold opacity-50">Excellence</span>
          <div className="w-1 h-1 rounded-full bg-[#D4A017] opacity-30" />
          <span className="text-[9px] tracking-[0.2em] uppercase font-semibold opacity-50">Service</span>
        </div>
      </div>
    </div>
  );
}
