import { create } from 'zustand';
import { getToken } from '@/lib/tokenStore';
import { API_BASE } from '@/lib/constants';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  streaming?: boolean;
}

interface ChatState {
  isOpen: boolean;
  messages: ChatMessage[];
  isLoading: boolean;
  toggle: () => void;
  close: () => void;
  sendMessage: (content: string) => Promise<void>;
}

const STREAM_ENDPOINT = `${API_BASE}/assistant/chat/stream`;

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

    const assistantId = crypto.randomUUID();
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
    };

    set((s) => ({
      messages: [...s.messages, userMessage, assistantPlaceholder],
      isLoading: true,
    }));

    const history = get().messages
      .filter(m => m.id !== assistantId) // exclude the empty placeholder we just added
      .map((m) => ({ role: m.role, content: m.content }));

    const token = getToken();

    try {
      const res = await fetch(STREAM_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') {
            reader.cancel().catch(() => { /* ignore */ });
            break;
          }
          try {
            const json = JSON.parse(data) as { text?: string };
            if (json.text) {
              accumulated += json.text;
              const snapshot = accumulated;
              set((s) => ({
                messages: s.messages.map(m =>
                  m.id === assistantId ? { ...m, content: snapshot } : m
                ),
              }));
            }
          } catch { /* ignore bad chunk */ }
        }
      }

      set((s) => ({
        messages: s.messages.map(m =>
          m.id === assistantId
            ? { ...m, streaming: false, content: m.content || 'Sorry, I could not process that.' }
            : m
        ),
        isLoading: false,
      }));
    } catch {
      set((s) => ({
        messages: s.messages.map(m =>
          m.id === assistantId
            ? { ...m, streaming: false, content: 'Sorry, I am temporarily unavailable. Please try again later.' }
            : m
        ),
        isLoading: false,
      }));
    }
  },
}));
