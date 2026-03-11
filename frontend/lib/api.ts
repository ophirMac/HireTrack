import type {
  CompaniesResponse,
  CompanyDetailResponse,
  ScanStatus,
} from './types';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ─── Companies ────────────────────────────────────────────────────────────────

export const fetchCompanies = (): Promise<CompaniesResponse> =>
  request<CompaniesResponse>('/api/companies');

export const fetchCompany = (id: number): Promise<CompanyDetailResponse> =>
  request<CompanyDetailResponse>(`/api/companies/${id}`);

// ─── Scan ─────────────────────────────────────────────────────────────────────

export const fetchScanStatus = (): Promise<ScanStatus> =>
  request<ScanStatus>('/api/scan/status');

export const triggerScan = (): Promise<{ message: string }> =>
  request<{ message: string }>('/api/scan/trigger', { method: 'POST' });

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const fetchAuthStatus = (): Promise<{ authenticated: boolean }> =>
  request<{ authenticated: boolean }>('/auth/status');
