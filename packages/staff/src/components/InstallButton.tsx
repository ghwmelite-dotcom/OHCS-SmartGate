import { useState } from 'react';
import { Download } from 'lucide-react';
import { useInstallStore, isIosSafari, isAppInstalled } from '@/stores/install';
import { IosInstallInstructions } from './IosInstallInstructions';

export function InstallButton() {
  const deferredPrompt = useInstallStore((s) => s.deferredPrompt);
  const installed = useInstallStore((s) => s.installed);
  const setDeferredPrompt = useInstallStore((s) => s.setDeferredPrompt);
  const [showIos, setShowIos] = useState(false);

  if (installed || isAppInstalled()) return null;

  const iosFallback = isIosSafari();
  if (!deferredPrompt && !iosFallback) return null;

  async function handleClick() {
    if (iosFallback && !deferredPrompt) {
      setShowIos(true);
      return;
    }
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="w-full h-11 px-4 bg-white border border-gray-200 text-gray-800 rounded-xl font-semibold text-[14px] hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
      >
        <Download className="h-4 w-4" />
        Install app
      </button>
      {showIos && <IosInstallInstructions onClose={() => setShowIos(false)} />}
    </>
  );
}
