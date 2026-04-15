import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import { Shield, KeyRound, Mail } from 'lucide-react';

type AuthMode = 'pin' | 'email' | 'otp';

export function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('pin');
  const [staffId, setStaffId] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { loginWithPin, login, verify } = useAuthStore();
  const navigate = useNavigate();

  async function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await loginWithPin(staffId, pin, remember);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid staff ID or PIN');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await login(email);
      setMode('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await verify(email, code, remember);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid OTP');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[540px] relative overflow-hidden flex-col"
        style={{
          background: 'linear-gradient(165deg, #1A4D2E 0%, #0F2E1B 50%, #071A0F 100%)',
        }}
      >
        {/* Kente overlay */}
        <div className="absolute inset-0 opacity-[0.05]" style={{
          backgroundImage: `repeating-linear-gradient(45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 16px),
            repeating-linear-gradient(-45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 16px)`,
        }} />

        {/* Ghana flag bar at top */}
        <div className="h-1 w-full shrink-0" style={{
          background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)',
        }} />

        {/* Content */}
        <div className="relative flex-1 flex flex-col items-center justify-center px-12">
          <div className="w-28 h-28 rounded-2xl overflow-hidden ring-2 ring-accent/20 shadow-2xl shadow-black/30 mb-8">
            <img src="/ohcs-logo.jpg" alt="Ghana Civil Service" className="w-full h-full object-cover" />
          </div>

          <h1 className="text-3xl font-bold text-white tracking-tight text-center" style={{ fontFamily: 'var(--font-display)' }}>
            OHCS SmartGate
          </h1>

          <div className="flex items-center gap-2 mt-3">
            <div className="h-[1px] w-8" style={{
              background: 'linear-gradient(90deg, transparent, #D4A017)',
            }} />
            <p className="text-accent/80 text-xs tracking-[0.25em] uppercase font-medium">
              Visitor Management System
            </p>
            <div className="h-[1px] w-8" style={{
              background: 'linear-gradient(90deg, #D4A017, transparent)',
            }} />
          </div>

          <p className="text-white/40 text-sm text-center mt-6 max-w-[280px] leading-relaxed">
            Secure digital visitor management for the Office of the Head of Civil Service
          </p>

          {/* Motto */}
          <div className="absolute bottom-10 flex items-center gap-4 text-white/20">
            <span className="text-[10px] tracking-[0.2em] uppercase font-medium">Loyalty</span>
            <div className="w-1 h-1 rounded-full bg-accent/40" />
            <span className="text-[10px] tracking-[0.2em] uppercase font-medium">Excellence</span>
            <div className="w-1 h-1 rounded-full bg-accent/40" />
            <span className="text-[10px] tracking-[0.2em] uppercase font-medium">Service</span>
          </div>
        </div>

        <div className="h-[1px] w-full" style={{
          background: 'linear-gradient(90deg, transparent, #D4A017 30%, #F5D76E 50%, #D4A017 70%, transparent)',
        }} />
      </div>

      {/* Right panel — form */}
      <div className="flex-1 bg-background bg-kente flex items-center justify-center p-6">
        <div className="w-full max-w-[400px] animate-fade-in-up">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="w-20 h-20 rounded-2xl overflow-hidden ring-2 ring-accent/20 shadow-lg mx-auto mb-4">
              <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
            </div>
            <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              OHCS SmartGate
            </h1>
            <p className="text-muted text-xs tracking-[0.15em] uppercase mt-1">Visitor Management System</p>
          </div>

          {/* Form card */}
          <div className="bg-surface rounded-2xl shadow-lg shadow-primary/[0.03] border border-border overflow-hidden">
            <div className="h-[2px]" style={{
              background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)',
            }} />

            <div className="p-7">
              {/* Header */}
              <div className="flex items-center gap-2.5 mb-6">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  {mode === 'pin' ? (
                    <KeyRound className="h-4 w-4 text-primary" />
                  ) : (
                    <Shield className="h-4 w-4 text-primary" />
                  )}
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                    {mode === 'pin' ? 'Staff Sign In' : mode === 'email' ? 'Email Sign In' : 'Verification'}
                  </h2>
                  <p className="text-[13px] text-muted">
                    {mode === 'pin' ? 'Enter your staff ID and PIN' : mode === 'email' ? 'We\'ll send a code to your email' : 'Enter the code sent to your email'}
                  </p>
                </div>
              </div>

              {/* PIN Login */}
              {mode === 'pin' && (
                <form onSubmit={handlePinSubmit}>
                  <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-2">
                    Staff ID
                  </label>
                  <input
                    type="text"
                    required
                    value={staffId}
                    onChange={(e) => setStaffId(e.target.value.toUpperCase())}
                    placeholder="OHCS-001"
                    className="w-full h-12 px-4 rounded-xl border border-border bg-background text-sm font-medium tracking-wide uppercase focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    autoFocus
                  />

                  <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-2 mt-4">
                    4-Digit PIN
                  </label>
                  <input
                    type="password"
                    required
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="****"
                    className="w-full h-14 px-4 rounded-xl border border-border bg-background text-center tracking-[0.5em] font-mono text-2xl font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    inputMode="numeric"
                  />

                  {error && <p className="text-danger text-xs mt-3 font-medium">{error}</p>}

                  {/* Remember device */}
                  <label className="flex items-center gap-2.5 mt-4 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20 accent-primary"
                    />
                    <span className="text-[12px] text-muted group-hover:text-foreground transition-colors">
                      Remember this device for 30 days
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={isLoading || pin.length !== 4}
                    className="w-full h-12 mt-5 bg-primary text-white rounded-xl font-semibold text-sm hover:bg-primary-light transition-all disabled:opacity-50 shadow-lg shadow-primary/20 active:scale-[0.98]"
                  >
                    {isLoading ? 'Signing in...' : 'Sign In'}
                  </button>

                  <div className="mt-4 pt-4 border-t border-border">
                    <button
                      type="button"
                      onClick={() => { setMode('email'); setError(''); }}
                      className="w-full flex items-center justify-center gap-2 text-[12px] text-muted hover:text-primary transition-colors py-1"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      Sign in with email instead
                    </button>
                  </div>
                </form>
              )}

              {/* Email Login */}
              {mode === 'email' && (
                <form onSubmit={handleEmailSubmit}>
                  <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@ohcs.gov.gh"
                    className="w-full h-12 px-4 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    autoFocus
                  />

                  {error && <p className="text-danger text-xs mt-3 font-medium">{error}</p>}

                  <label className="flex items-center gap-2.5 mt-4 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20 accent-primary"
                    />
                    <span className="text-[12px] text-muted group-hover:text-foreground transition-colors">
                      Remember this device for 30 days
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-12 mt-5 bg-primary text-white rounded-xl font-semibold text-sm hover:bg-primary-light transition-all disabled:opacity-50 shadow-lg shadow-primary/20 active:scale-[0.98]"
                  >
                    {isLoading ? 'Sending Code...' : 'Send Verification Code'}
                  </button>

                  <div className="mt-4 pt-4 border-t border-border">
                    <button
                      type="button"
                      onClick={() => { setMode('pin'); setError(''); }}
                      className="w-full flex items-center justify-center gap-2 text-[12px] text-muted hover:text-primary transition-colors py-1"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Sign in with PIN instead
                    </button>
                  </div>
                </form>
              )}

              {/* OTP Verification */}
              {mode === 'otp' && (
                <form onSubmit={handleOtpSubmit}>
                  <p className="text-sm text-muted mb-5">
                    Enter the 6-digit code sent to <strong className="text-foreground">{email}</strong>
                  </p>
                  <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-2">
                    Verification Code
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-full h-14 px-4 rounded-xl border border-border bg-background text-center tracking-[0.4em] font-mono text-xl font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    autoFocus
                  />
                  {error && <p className="text-danger text-xs mt-3 font-medium">{error}</p>}
                  <button
                    type="submit"
                    disabled={isLoading || code.length !== 6}
                    className="w-full h-12 mt-5 bg-primary text-white rounded-xl font-semibold text-sm hover:bg-primary-light transition-all disabled:opacity-50 shadow-lg shadow-primary/20 active:scale-[0.98]"
                  >
                    {isLoading ? 'Verifying...' : 'Verify & Sign In'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode('email'); setCode(''); setError(''); }}
                    className="w-full text-[12px] text-muted mt-3 hover:text-foreground transition-colors py-2"
                  >
                    Use a different email
                  </button>
                </form>
              )}
            </div>
          </div>

          <p className="text-center text-[10px] text-muted-foreground mt-6 tracking-wide">
            Office of the Head of Civil Service, Ghana
          </p>
        </div>
      </div>
    </div>
  );
}
