import { create } from 'zustand';
import { api } from '@/lib/api';
import { setToken, clearToken } from '@/lib/tokenStore';
import { loginWithBiometric, rememberStaffId } from '@/lib/webauthnClient';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  pin_acknowledged: boolean;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  loginWithPin: (staffId: string, pin: string) => Promise<void>;
  loginWithWebAuthn: (staffId: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
  markPinAcknowledged: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  loginWithPin: async (staffId, pin) => {
    const res = await api.post<{ user: User & { session_token?: string } }>('/auth/pin-login', { staff_id: staffId, pin, remember: true });
    if (res.data?.user?.session_token) {
      setToken(res.data.user.session_token);
    }
    const u = res.data?.user;
    if (u) {
      const { session_token: _discard, ...userForStore } = u;
      void _discard;
      rememberStaffId(staffId);
      set({ user: userForStore as User });
    } else {
      set({ user: null });
    }
  },
  loginWithWebAuthn: async (staffId) => {
    const u = await loginWithBiometric(staffId);
    if (u.session_token) setToken(u.session_token);
    const { session_token: _discard, ...userForStore } = u;
    void _discard;
    rememberStaffId(staffId);
    set({ user: userForStore as User });
  },
  logout: async () => {
    clearToken();
    // NOTE: last_staff_id is kept on device so the next biometric login knows who.
    try { await api.post('/auth/logout', {}); } catch { /* best-effort */ }
    set({ user: null });
  },
  checkSession: async () => {
    try {
      const res = await api.get<{ user: User }>('/auth/me');
      set({ user: res.data?.user ?? null, isLoading: false });
    } catch { set({ user: null, isLoading: false }); }
  },
  markPinAcknowledged: () =>
    set((state) => (state.user ? { user: { ...state.user, pin_acknowledged: true } } : state)),
}));
