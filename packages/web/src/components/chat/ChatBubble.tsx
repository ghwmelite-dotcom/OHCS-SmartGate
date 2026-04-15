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
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-primary text-white rounded-full shadow-lg hover:bg-primary-light transition-all flex items-center justify-center hover:scale-105 active:scale-95"
        aria-label={isOpen ? 'Close assistant' : 'Open assistant'}
      >
        {isOpen ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>
    </>
  );
}
