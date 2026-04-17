import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import { useInstallStore } from './stores/install';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  const store = useInstallStore.getState();
  store.setDeferredPrompt(e as Parameters<typeof store.setDeferredPrompt>[0]);
});

window.addEventListener('appinstalled', () => {
  useInstallStore.getState().setInstalled(true);
});

// Register service worker for PWA — auto-reload on update
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');

      // Check for updates every 60 seconds
      setInterval(() => reg.update(), 60_000);

      // When a new service worker is ready, reload to get the latest version
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
            // New version activated — reload silently
            window.location.reload();
          }
        });
      });

      window.addEventListener('online', () => {
        navigator.serviceWorker.controller?.postMessage({ type: 'flush-queue' });
      });
    } catch {
      // SW registration failed — app works fine without it
    }
  });
}
