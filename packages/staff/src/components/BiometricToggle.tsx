import { useEffect, useState } from 'react';
import { Fingerprint, Loader2, Check, Trash2 } from 'lucide-react';
import {
  listCredentials,
  registerBiometric,
  removeCredential,
  supportsPlatformAuthenticator,
  type StoredCredentialSummary,
} from '@/lib/webauthnClient';

export function BiometricToggle() {
  const [available, setAvailable] = useState<'loading' | 'yes' | 'no'>('loading');
  const [credentials, setCredentials] = useState<StoredCredentialSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await supportsPlatformAuthenticator();
      if (cancelled) return;
      setAvailable(ok ? 'yes' : 'no');
      if (ok) {
        try {
          const list = await listCredentials();
          if (!cancelled) setCredentials(list);
        } catch { /* ignore */ }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function enroll() {
    setErr('');
    setBusy(true);
    try {
      const c = await registerBiometric();
      setCredentials((cur) => [c, ...cur]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Enrollment failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setErr('');
    setBusy(true);
    try {
      await removeCredential(id);
      setCredentials((cur) => cur.filter(c => c.id !== id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Remove failed');
    } finally {
      setBusy(false);
    }
  }

  if (available === 'loading') {
    return (
      <div className="flex items-center justify-center py-2 text-[12px] text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Checking biometrics…
      </div>
    );
  }

  if (available === 'no') {
    return (
      <div className="text-[12px] text-gray-500 text-center py-2">
        Biometric sign-in not supported on this device.
      </div>
    );
  }

  const enrolled = credentials.length > 0;

  return (
    <div className="space-y-1.5">
      {enrolled ? (
        <>
          <div className="flex items-center gap-2 px-2 py-1.5 bg-green-50 border border-green-100 rounded-lg">
            <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
            <span className="text-[12px] font-medium text-green-800">Biometric sign-in enabled</span>
          </div>
          {credentials.map(c => (
            <div key={c.id} className="flex items-center justify-between gap-2 px-2 py-1.5 bg-gray-50 rounded-lg">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-gray-800 truncate">{c.device_label ?? 'This device'}</p>
                <p className="text-[10px] text-gray-500">
                  {c.last_used_at ? `Last used ${new Date(c.last_used_at).toLocaleDateString('en-GB')}` : 'Never used'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(c.id)}
                disabled={busy}
                className="h-7 w-7 rounded-md flex items-center justify-center text-red-600 hover:bg-red-50 disabled:opacity-40"
                aria-label="Remove device"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={enroll}
            disabled={busy}
            className="w-full h-10 text-[12px] text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <Fingerprint className="h-3.5 w-3.5" />
            Add another device
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={enroll}
          disabled={busy}
          className="w-full h-11 px-4 bg-white border border-gray-200 text-gray-800 rounded-xl font-semibold text-[14px] hover:bg-gray-50 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
          {busy ? 'Enrolling…' : 'Enable biometric sign-in'}
        </button>
      )}
      {err && <p className="text-red-600 text-[11px] font-medium text-center">{err}</p>}
    </div>
  );
}
