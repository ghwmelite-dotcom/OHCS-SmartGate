import { X, Share, Plus } from 'lucide-react';

export function IosInstallInstructions({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[18px] font-bold text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>
              Install on iPhone
            </h3>
            <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100">
              <X className="h-4 w-4" />
            </button>
          </div>
          <ol className="space-y-4">
            <li className="flex gap-3 items-start">
              <span className="h-7 w-7 rounded-full bg-[#1A4D2E] text-white text-[13px] font-bold flex items-center justify-center flex-shrink-0">1</span>
              <div className="pt-0.5 text-[14px] text-gray-700 leading-relaxed">
                Tap the <span className="inline-flex items-center gap-1 font-semibold"><Share className="h-4 w-4 inline" /> Share</span> button at the bottom of Safari.
              </div>
            </li>
            <li className="flex gap-3 items-start">
              <span className="h-7 w-7 rounded-full bg-[#1A4D2E] text-white text-[13px] font-bold flex items-center justify-center flex-shrink-0">2</span>
              <div className="pt-0.5 text-[14px] text-gray-700 leading-relaxed">
                Scroll and tap <span className="inline-flex items-center gap-1 font-semibold"><Plus className="h-4 w-4 inline" /> Add to Home Screen</span>.
              </div>
            </li>
            <li className="flex gap-3 items-start">
              <span className="h-7 w-7 rounded-full bg-[#1A4D2E] text-white text-[13px] font-bold flex items-center justify-center flex-shrink-0">3</span>
              <div className="pt-0.5 text-[14px] text-gray-700 leading-relaxed">
                Tap <span className="font-semibold">Add</span>. The app icon will appear on your home screen.
              </div>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
