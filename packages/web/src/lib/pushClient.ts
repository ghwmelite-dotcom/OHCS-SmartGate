export async function getPushStatus(): Promise<{ subscribed: boolean; endpoints: number }> {
  const apiBase = import.meta.env.PROD ? 'https://ohcs-smartgate-api.ghwmelite.workers.dev' : '';
  const res = await fetch(`${apiBase}/api/notifications/push/status`, { credentials: 'include' });
  if (!res.ok) return { subscribed: false, endpoints: 0 };
  const { data } = await res.json() as { data: { subscribed: boolean; endpoints: number } };
  return data;
}

function urlB64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enablePush(): Promise<void> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('Push not supported');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permission denied');
  const vapidPub = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidPub) throw new Error('VAPID public key not configured');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(vapidPub),
  });
  const apiBase = import.meta.env.PROD ? 'https://ohcs-smartgate-api.ghwmelite.workers.dev' : '';
  const json = sub.toJSON();
  await fetch(`${apiBase}/api/notifications/push/subscribe`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  const apiBase = import.meta.env.PROD ? 'https://ohcs-smartgate-api.ghwmelite.workers.dev' : '';
  await fetch(`${apiBase}/api/notifications/push/unsubscribe`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
}
