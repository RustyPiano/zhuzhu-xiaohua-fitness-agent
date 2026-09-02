import type { Bootstrap, DayPlan, DaySnapshot, ThreadMessage } from '../../shared/contracts';
import { emptyLog } from '../../shared/contracts';

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

const preview = import.meta.env.VITE_PREVIEW_MODE === 'true';
const previewBootstrap: Bootstrap = { actor: 'zhuzhu', timezone: 'Asia/Shanghai', today: '2026-09-02', app_version: 'preview', agent: { configured: false, reason: '预览模式不执行写操作' }, image: { configured: false, max_files: 4, max_bytes: 10_485_760, max_pixels: 20_000_000, reason: '预览模式' }, web: { provider: 'exa', configured: false, reason: '预览模式', budget: { month: '2026-09', used_microusd: 0, warn_microusd: 8_000_000, stop_microusd: 9_000_000, warning: false, stopped: false } }, ui_editing: { configured: false, reason: '预览模式' } };
const meal = (id: string, name: string) => ({ id, name, amount: 1, unit: '份', nutrition: { kcal: null, protein_g: null, carbs_g: null, fat_g: null }, value_kind: 'unknown' as const, assumptions: ['虚构预览数据'] });
const personPlan = { nutrition: { targets: { kcal: null, protein_g: null, carbs_g: null, fat_g: null }, meals: [{ meal: 'breakfast' as const, label: '虚构早餐', items: [meal('preview-meal', '预览餐食')] }] }, training: { type: '虚构训练', exercises: [{ exercise_id: 'preview-squat', name: '预览深蹲', equipment: null, sets: 3, reps: '8–10', load: null, load_unit: null, rest_seconds: 90, notes: ['此页面不读取生产数据。'] }], cardio: null } };
const previewPlan: DayPlan = { schema_version: 1, date: previewBootstrap.today, status: 'active', title: '候选界面 · 虚构数据', people: { zhuzhu: personPlan, xiaohua: personPlan }, notes: ['仅用于隔离预览'] };
const previewSnapshot: DaySnapshot = { revision: 'preview', date: previewBootstrap.today, plan: previewPlan, logs: { zhuzhu: emptyLog(previewBootstrap.today, 'zhuzhu'), xiaohua: emptyLog(previewBootstrap.today, 'xiaohua') } };
const previewMessages: ThreadMessage[] = [{ id: 'preview-message', role: 'assistant', text: '这是隔离候选预览，不包含真实对话或个人数据。', attachment_ids: [], receipts: [], created_at: '2026-09-02T09:00:00+08:00', status: 'complete' }];

export async function api<T>(input: string, init?: RequestInit): Promise<T> {
  if (preview) {
    if (input === '/api/bootstrap') return previewBootstrap as T;
    if (input.startsWith('/api/day')) return previewSnapshot as T;
    if (input === '/api/thread') return { messages: previewMessages } as T;
    throw new ApiError('预览模式不执行写操作', 403);
  }
  const response = await fetch(input, { credentials: 'same-origin', ...init, headers: { ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...init?.headers } });
  const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error ?? `HTTP ${response.status}`, response.status);
  return data;
}

export const getBootstrap = () => api<Bootstrap>('/api/bootstrap');
export const getDay = (date: string) => api<DaySnapshot>(`/api/day?date=${encodeURIComponent(date)}`);
export const getThread = () => api<{ messages: ThreadMessage[] }>('/api/thread');
