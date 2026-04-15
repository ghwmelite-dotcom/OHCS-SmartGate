import { useChatStore } from '@/stores/chat';
import { MessageCircle, X } from 'lucide-react';
import { ChatPanel } from './ChatPanel';

export function ChatBubble() {
  const { isOpen, toggle } = useChatStore();

  return (
    <>
      {isOpen && <ChatPanel />}
      <button
        onClick={toggle}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-2xl shadow-xl hover:shadow-2xl transition-all flex items-center justify-center hover:scale-105 active:scale-95 text-white"
        style={{
          background: 'linear-gradient(135deg, #1A4D2E, #0F2E1B)',
          boxShadow: '0 8px 32px rgba(26, 77, 46, 0.3), 0 0 0 1px rgba(212, 160, 23, 0.15)',
        }}
        aria-label={isOpen ? 'Close assistant' : 'Open assistant'}
      >
        {isOpen ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>
    </>
  );
}
