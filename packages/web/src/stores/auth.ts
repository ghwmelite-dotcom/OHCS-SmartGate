import { create } from 'zustand';
import { api } from '@/lib/api';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  login: (email: string) => Promise<void>;
  verify: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  login: async (email: string) => {
    await api.post('/auth/login', { email });
  },

  verify: async (email: string, code: string) => {
    const res = await api.post<{ user: User }>('/auth/verify', { email, code });
    set({ user: res.data?.user ?? null });
  },

  logout: async () => {
    await api.post('/auth/logout', {});
    set({ user: null });
  },

  checkSession: async () => {
    try {
      const res = await api.get<{ user: User }>('/auth/me');
      set({ user: res.data?.user ?? null, isLoading: false });
    } catch {
      set({ user: null, isLoading: false });
    }
  },
}));
