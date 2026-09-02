import type { Bootstrap, DaySnapshot, ThreadMessage } from '../../shared/contracts';

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

export async function api<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { credentials: 'same-origin', ...init, headers: { ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...init?.headers } });
  const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error ?? `HTTP ${response.status}`, response.status);
  return data;
}

export const getBootstrap = () => api<Bootstrap>('/api/bootstrap');
export const getDay = (date: string) => api<DaySnapshot>(`/api/day?date=${encodeURIComponent(date)}`);
export const getThread = () => api<{ messages: ThreadMessage[] }>('/api/thread');
