import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/types';
import { getToken } from './tokenStore';

const API_BASE = import.meta.env.PROD ? 'https://ohcs-smartgate-api.ohcsghana-main.workers.dev' : '';

const LAST_STAFF_ID_KEY = 'ohcs.last_staff_id';

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function rememberStaffId(staffId: string): void {
  try { localStorage.setItem(LAST_STAFF_ID_KEY, staffId.toUpperCase()); } catch { /* ignore */ }
}

export function getLastStaffId(): string | null {
  try { return localStorage.getItem(LAST_STAFF_ID_KEY); } catch { return null; }
}

export function clearLastStaffId(): void {
  try { localStorage.removeItem(LAST_STAFF_ID_KEY); } catch { /* ignore */ }
}

export function supportsWebAuthn(): boolean {
  return browserSupportsWebAuthn();
}

export async function supportsPlatformAuthenticator(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

export interface StoredCredentialSummary {
  id: string;
  device_label: string | null;
  created_at: string;
  last_used_at: string | null;
}

function defaultDeviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android device';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  return 'This device';
}

/** Enroll the current authenticated user's device as a biometric credential. */
export async function registerBiometric(deviceLabel?: string): Promise<StoredCredentialSummary> {
  if (!browserSupportsWebAuthn()) throw new Error('Biometrics not supported on this browser');

  const optsRes = await fetch(`${API_BASE}/api/auth/webauthn/register/options`, {
    method: 'POST', credentials: 'include', headers: authHeaders(),
  });
  if (!optsRes.ok) throw new Error(`Could not start enrollment (${optsRes.status})`);
  const { data: options } = await optsRes.json() as { data: PublicKeyCredentialCreationOptionsJSON };

  const attResp = await startRegistration({ optionsJSON: options });

  const verifyRes = await fetch(`${API_BASE}/api/auth/webauthn/register/verify`, {
    method: 'POST', credentials: 'include', headers: authHeaders(),
    body: JSON.stringify({ response: attResp, device_label: deviceLabel ?? defaultDeviceLabel() }),
  });
  if (!verifyRes.ok) {
    const detail = await verifyRes.text().catch(() => '');
    throw new Error(`Enrollment failed: ${detail || verifyRes.status}`);
  }
  const { data } = await verifyRes.json() as { data: { id: string; device_label: string | null } };
  return {
    id: data.id,
    device_label: data.device_label,
    created_at: new Date().toISOString(),
    last_used_at: null,
  };
}

export interface WebAuthnUser {
  id: string;
  name: string;
  email: string;
  role: string;
  pin_acknowledged: boolean;
  session_token?: string;
}

export async function loginWithBiometric(staffId: string): Promise<WebAuthnUser> {
  if (!browserSupportsWebAuthn()) throw new Error('Biometrics not supported on this browser');
  const upper = staffId.toUpperCase();

  const optsRes = await fetch(`${API_BASE}/api/auth/webauthn/login/options`, {
    method: 'POST', credentials: 'include', headers: authHeaders(),
    body: JSON.stringify({ staff_id: upper }),
  });
  if (!optsRes.ok) throw new Error(`Could not start sign-in (${optsRes.status})`);
  const { data: options } = await optsRes.json() as { data: PublicKeyCredentialRequestOptionsJSON };

  const assertion = await startAuthentication({ optionsJSON: options });

  const verifyRes = await fetch(`${API_BASE}/api/auth/webauthn/login/verify`, {
    method: 'POST', credentials: 'include', headers: authHeaders(),
    body: JSON.stringify({ staff_id: upper, response: assertion, remember: true }),
  });
  if (!verifyRes.ok) {
    const body = await verifyRes.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Sign-in failed (${verifyRes.status})`);
  }
  const { data } = await verifyRes.json() as { data: { user: WebAuthnUser } };
  return data.user;
}

export async function listCredentials(): Promise<StoredCredentialSummary[]> {
  const res = await fetch(`${API_BASE}/api/auth/webauthn/credentials`, {
    credentials: 'include', headers: authHeaders(),
  });
  if (!res.ok) return [];
  const { data } = await res.json() as { data: StoredCredentialSummary[] };
  return data ?? [];
}

export async function removeCredential(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/auth/webauthn/credentials/${encodeURIComponent(id)}`, {
    method: 'DELETE', credentials: 'include', headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Could not remove credential (${res.status})`);
}
