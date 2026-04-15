import { create } from 'zustand';
import { api } from '@/lib/api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ChatState {
  isOpen: boolean;
  messages: ChatMessage[];
  isLoading: boolean;
  toggle: () => void;
  close: () => void;
  sendMessage: (content: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  isOpen: false,
  messages: [],
  isLoading: false,

  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  close: () => set({ isOpen: false }),

  sendMessage: async (content: string) => {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    set((s) => ({ messages: [...s.messages, userMessage], isLoading: true }));

    try {
      const history = get().messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await api.post<{ reply: string }>('/assistant/chat', {
        messages: history,
      });

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: res.data?.reply ?? 'Sorry, I could not process that.',
        timestamp: Date.now(),
      };

      set((s) => ({ messages: [...s.messages, assistantMessage], isLoading: false }));
    } catch {
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I am temporarily unavailable. Please try again later.',
        timestamp: Date.now(),
      };

      set((s) => ({ messages: [...s.messages, errorMessage], isLoading: false }));
    }
  },
}));
