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
  loginWithPin: (staffId: string, pin: string, remember: boolean) => Promise<void>;
  login: (email: string) => Promise<void>;
  verify: (email: string, code: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  loginWithPin: async (staffId: string, pin: string, remember: boolean) => {
    const res = await api.post<{ user: User }>('/auth/pin-login', { staff_id: staffId, pin, remember });
    set({ user: res.data?.user ?? null });
  },

  login: async (email: string) => {
    await api.post('/auth/login', { email });
  },

  verify: async (email: string, code: string, remember: boolean) => {
    const res = await api.post<{ user: User }>('/auth/verify', { email, code, remember });
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
