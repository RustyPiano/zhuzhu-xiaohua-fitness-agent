import type { Bootstrap, DayPlan, DaySnapshot, ThreadMessage } from '../../shared/contracts';
import { emptyLog } from '../../shared/contracts';

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

const preview = import.meta.env.VITE_PREVIEW_MODE === 'true';
const previewBootstrap: Bootstrap = { actor: 'zhuzhu', timezone: 'Asia/Shanghai', today: '2026-09-02', app_version: 'preview', agent: { configured: false, reason: '预览模式不执行写操作' }, image: { configured: false, max_files: 4, max_bytes: 10_485_760, max_pixels: 20_000_000, reason: '预览模式' }, web: { provider: 'exa', configured: false, reason: '预览模式', budget: { month: '2026-09', used_microusd: 0, warn_microusd: 8_000_000, stop_microusd: 9_000_000, warning: false, stopped: false } }, ui_editing: { configured: false, reason: '预览模式' } };
const meal = (id: string, name: string) => ({ id, name, amount: 1, unit: '份', nutrition: { kcal: null, protein_g: null, carbs_g: null, fat_g: null }, value_kind: 'unknown' as const, assumptions: ['虚构预览数据'] });
const personPlan = (person: 'zhuzhu' | 'xiaohua') => ({ nutrition: { targets: { kcal: null, protein_g: null, carbs_g: null, fat_g: null }, meals: [{ meal: person === 'zhuzhu' ? 'breakfast' as const : 'lunch' as const, label: person === 'zhuzhu' ? '虚构早餐' : '虚构午餐', items: [meal(`${person}-preview-meal`, person === 'zhuzhu' ? '预览燕麦' : '预览米饭')] }] }, training: { type: '虚构训练', exercises: [{ exercise_id: 'preview-squat', name: '预览深蹲', equipment: null, sets: 3, reps: '8–10', load: null, load_unit: null, rest_seconds: 90, notes: ['此页面不读取生产数据。'] }, ...(person === 'xiaohua' ? [{ exercise_id: 'preview-deadlift', name: '小花专属预览硬拉', equipment: '杠铃', sets: 3, reps: '6', load: null, load_unit: 'kg', rest_seconds: 120, notes: [] }] : [])], cardio: null } });
const previewPlan: DayPlan = { schema_version: 1, date: previewBootstrap.today, status: 'active', title: '候选界面 · 虚构数据', people: { zhuzhu: personPlan('zhuzhu'), xiaohua: personPlan('xiaohua') }, notes: ['仅用于隔离预览'] };
const previewLogs = { zhuzhu: emptyLog(previewBootstrap.today, 'zhuzhu'), xiaohua: emptyLog(previewBootstrap.today, 'xiaohua') };
const previewSource = { recorded_by: 'zhuzhu' as const, request_id: 'preview-request', attachment_ids: [], recorded_at: '2026-09-02T09:00:00+08:00' };
previewLogs.zhuzhu.training_status = 'partial'; previewLogs.zhuzhu.sets.push({ id: 'preview-set-1', exercise_id: 'preview-squat', equipment: null, load: 30, load_unit: 'kg', reps: 12, side: 'both', kind: 'work', source: previewSource });
previewLogs.zhuzhu.nutrition_status = 'partial'; previewLogs.zhuzhu.meals.push({ id: 'preview-breakfast', meal: 'breakfast', items: [meal('preview-actual-oats', '实际预览燕麦')], occurred_at: '2026-09-02T08:00:00+08:00', source: previewSource });
const previewSnapshot: DaySnapshot = { revision: 'preview', date: previewBootstrap.today, plan: previewPlan, logs: previewLogs };
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
