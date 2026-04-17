import { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { enablePush, disablePush, getPushStatus } from '@/lib/pushClient';

export function PushToggle() {
  const [state, setState] = useState<'idle' | 'loading' | 'on' | 'off' | 'unsupported'>('loading');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }
    getPushStatus().then(s => setState(s.subscribed ? 'on' : 'off')).catch(() => setState('off'));
  }, []);

  if (state === 'unsupported') {
    return <div className="text-[12px] text-gray-500 text-center py-2">Push notifications not supported on this browser.</div>;
  }

  async function toggle() {
    setErr('');
    const was = state;
    setState('loading');
    try {
      if (was === 'on') {
        await disablePush();
        setState('off');
      } else {
        await enablePush();
        setState('on');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
      setState(was);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={toggle}
        disabled={state === 'loading'}
        className="w-full h-11 px-4 bg-white border border-gray-200 text-gray-800 rounded-xl font-semibold text-[14px] hover:bg-gray-50 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
      >
        {state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> :
         state === 'on' ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        {state === 'on' ? 'Disable notifications' : 'Enable notifications'}
      </button>
      {err && <p className="text-red-600 text-[11px] font-medium text-center">{err}</p>}
    </div>
  );
}
