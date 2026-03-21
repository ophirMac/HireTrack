import type {
  CompaniesResponse,
  CompanyDetailResponse,
  ScanStatus,
  LeadsResponse,
  LeadDetailResponse,
  ConvertLeadResponse,
  Lead,
  LeadMove,
} from './types';

export const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
export const GOOGLE_AUTH_URL = `${API_BASE}/auth/google`;

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

export const deleteCompany = (id: number): Promise<{ success: boolean }> =>
  request<{ success: boolean }>(`/api/companies/${id}`, { method: 'DELETE' });

export const updateCompanyStatus = (
  id: number,
  status: string
): Promise<{ company: { id: number } }> =>
  request<{ company: { id: number } }>(`/api/companies/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

// ─── Scan ─────────────────────────────────────────────────────────────────────

export const fetchScanStatus = (): Promise<ScanStatus> =>
  request<ScanStatus>('/api/scan/status');

export const triggerScan = (): Promise<{ message: string }> =>
  request<{ message: string }>('/api/scan/trigger', { method: 'POST' });

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const fetchAuthStatus = (): Promise<{ authenticated: boolean }> =>
  request<{ authenticated: boolean }>('/auth/status');

// ─── Leads ────────────────────────────────────────────────────────────────────

export const fetchLeads = (status?: string): Promise<LeadsResponse> => {
  const qs = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
  return request<LeadsResponse>(`/api/leads${qs}`);
};

export const fetchLead = (id: number): Promise<LeadDetailResponse> =>
  request<LeadDetailResponse>(`/api/leads/${id}`);

export const createLead = (data: Partial<Lead>): Promise<{ lead: Lead }> =>
  request<{ lead: Lead }>('/api/leads', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateLead = (id: number, data: Partial<Lead>): Promise<{ lead: Lead }> =>
  request<{ lead: Lead }>(`/api/leads/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const deleteLead = (id: number): Promise<{ success: boolean }> =>
  request<{ success: boolean }>(`/api/leads/${id}`, { method: 'DELETE' });

export const createLeadMove = (
  leadId: number,
  data: Partial<LeadMove>
): Promise<{ move: LeadMove }> =>
  request<{ move: LeadMove }>(`/api/leads/${leadId}/moves`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const deleteLeadMove = (
  leadId: number,
  moveId: number
): Promise<{ success: boolean }> =>
  request<{ success: boolean }>(`/api/leads/${leadId}/moves/${moveId}`, {
    method: 'DELETE',
  });

export const convertLead = (id: number): Promise<ConvertLeadResponse> =>
  request<ConvertLeadResponse>(`/api/leads/${id}/convert`, { method: 'POST' });
