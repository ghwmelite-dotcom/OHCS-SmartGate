import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';

export function LoginPage() {
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, verify } = useAuthStore();
  const navigate = useNavigate();

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await login(email);
      setStep('otp');
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
      await verify(email, code);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid OTP');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary rounded-xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-xl">SG</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">OHCS SmartGate</h1>
          <p className="text-muted mt-1">Visitor Management System</p>
        </div>

        <div className="bg-surface rounded-xl shadow-md p-6 border border-border">
          {step === 'email' ? (
            <form onSubmit={handleEmailSubmit}>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@ohcs.gov.gh"
                className="w-full h-11 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
              {error && <p className="text-danger text-xs mt-2">{error}</p>}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 mt-4 bg-primary text-white rounded-lg font-medium text-sm hover:bg-primary-light transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Sending...' : 'Send OTP'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleOtpSubmit}>
              <p className="text-sm text-muted mb-4">Enter the 6-digit code sent to <strong>{email}</strong></p>
              <label htmlFor="code" className="block text-sm font-medium text-foreground mb-1.5">
                Verification Code
              </label>
              <input
                id="code"
                type="text"
                required
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full h-11 px-3 rounded-lg border border-border bg-background text-sm text-center tracking-widest font-mono text-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                autoFocus
              />
              {error && <p className="text-danger text-xs mt-2">{error}</p>}
              <button
                type="submit"
                disabled={isLoading || code.length !== 6}
                className="w-full h-11 mt-4 bg-primary text-white rounded-lg font-medium text-sm hover:bg-primary-light transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Verifying...' : 'Verify & Sign In'}
              </button>
              <button type="button" onClick={() => { setStep('email'); setCode(''); setError(''); }} className="w-full text-sm text-muted mt-3 hover:text-foreground">
                Use a different email
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Office of the Head of Civil Service, Ghana
        </p>
      </div>
    </div>
  );
}
