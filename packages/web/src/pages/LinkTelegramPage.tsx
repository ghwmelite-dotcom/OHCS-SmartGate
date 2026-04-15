import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export function LinkTelegramPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const code = searchParams.get('code');

  const [status, setStatus] = useState<'linking' | 'success' | 'error'>('linking');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!code) {
      setStatus('error');
      setErrorMsg('No linking code provided.');
      return;
    }

    api.post('/telegram/link', { code })
      .then(() => setStatus('success'))
      .catch((err) => {
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : 'Failed to link account');
      });
  }, [code]);

  return (
    <div className="max-w-sm mx-auto text-center space-y-4">
      {status === 'linking' && (
        <>
          <Loader2 className="h-10 w-10 text-primary mx-auto animate-spin" />
          <h2 className="text-lg font-semibold text-foreground">Linking Telegram...</h2>
          <p className="text-sm text-muted">Connecting your Telegram account to SmartGate</p>
        </>
      )}

      {status === 'success' && (
        <>
          <div className="w-14 h-14 bg-success/10 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-7 w-7 text-success" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Telegram Linked!</h2>
          <p className="text-sm text-muted">
            You will now receive visitor arrival notifications on Telegram.
          </p>
          <button
            onClick={() => navigate('/')}
            className="h-10 px-5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light transition-colors"
          >
            Go to Dashboard
          </button>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="w-14 h-14 bg-danger/10 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="h-7 w-7 text-danger" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Linking Failed</h2>
          <p className="text-sm text-muted">{errorMsg}</p>
          <button
            onClick={() => navigate('/')}
            className="h-10 px-5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light transition-colors"
          >
            Go to Dashboard
          </button>
        </>
      )}
    </div>
  );
}
