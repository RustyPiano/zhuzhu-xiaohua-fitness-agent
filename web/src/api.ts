import type { Bootstrap, DayPlan, DaySnapshot, ReviewSnapshot, ThreadMessage } from '../../shared/contracts';
import { emptyLog } from '../../shared/contracts';

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

const preview = import.meta.env.VITE_PREVIEW_MODE === 'true';
const previewBootstrap: Bootstrap = { actor: 'zhuzhu', timezone: 'Asia/Shanghai', today: '2026-09-02', app_version: 'preview', agent: { configured: false, reason: '当前为界面预览' }, image: { configured: false, max_files: 4, max_bytes: 10_485_760, max_pixels: 20_000_000, reason: '当前为界面预览' }, web: { provider: 'exa', configured: false, reason: '当前为界面预览', budget: { month: '2026-09', used_microusd: 0, warn_microusd: 8_000_000, stop_microusd: 9_000_000, warning: false, stopped: false } }, ui_editing: { configured: false, reason: '当前为界面预览' } };
const meal = (id: string, name: string, amount = 1, unit = '份') => ({ id, name, amount, unit, nutrition: { kcal: null, protein_g: null, carbs_g: null, fat_g: null }, value_kind: 'unknown' as const, assumptions: [] });
const personPlan = (person: 'zhuzhu' | 'xiaohua') => ({ nutrition: { targets: { kcal: null, protein_g: null, carbs_g: null, fat_g: null }, meals: [{ meal: 'breakfast' as const, label: '早餐', items: [meal(`${person}-oats`, '燕麦粥', 60, 'g')] }, { meal: 'lunch' as const, label: '午餐', items: [meal(`${person}-rice`, '糙米饭', 150, 'g')] }, { meal: 'dinner' as const, label: '晚餐', items: [meal(`${person}-beef`, '牛肉与时蔬')] }] }, training: { type: '全身力量', exercises: [{ exercise_id: 'preview-squat', name: '高脚杯深蹲', equipment: '哑铃', sets: 4, reps: '8–10', load: person === 'zhuzhu' ? 14 : 10, load_unit: 'kg', rest_seconds: 90, notes: [] }, { exercise_id: 'preview-row', name: '单臂哑铃划船', equipment: '哑铃', sets: 4, reps: '8–10', load: person === 'zhuzhu' ? 10 : 8, load_unit: 'kg', rest_seconds: 90, notes: [] }, { exercise_id: 'preview-press', name: '哑铃卧推', equipment: '哑铃', sets: 4, reps: '8–10', load: person === 'zhuzhu' ? 8 : 6, load_unit: 'kg', rest_seconds: 90, notes: [] }, ...(person === 'xiaohua' ? [{ exercise_id: 'preview-deadlift', name: '小花专属硬拉', equipment: '杠铃', sets: 3, reps: '6', load: 20, load_unit: 'kg', rest_seconds: 120, notes: [] }] : [])], cardio: null } });
const previewPlan: DayPlan = { schema_version: 1, date: previewBootstrap.today, status: 'active', title: '全身力量 · A', people: { zhuzhu: personPlan('zhuzhu'), xiaohua: personPlan('xiaohua') }, notes: [] };
const previewLogs = { zhuzhu: emptyLog(previewBootstrap.today, 'zhuzhu'), xiaohua: emptyLog(previewBootstrap.today, 'xiaohua') };
const previewSource = { recorded_by: 'zhuzhu' as const, request_id: 'preview-request', attachment_ids: [], recorded_at: '2026-09-02T09:00:00+08:00' };
previewLogs.zhuzhu.training_status = 'partial'; previewLogs.zhuzhu.sets.push({ id: 'preview-set-1', exercise_id: 'preview-squat', equipment: null, load: 30, load_unit: 'kg', reps: 12, side: 'both', kind: 'work', source: previewSource });
previewLogs.zhuzhu.nutrition_status = 'partial'; previewLogs.zhuzhu.meals.push({ id: 'preview-breakfast', meal: 'breakfast', items: [meal('preview-actual-oats', '燕麦粥', 60, 'g')], occurred_at: '2026-09-02T08:00:00+08:00', source: previewSource });
previewLogs.zhuzhu.cardio.push({ id: 'preview-cardio', activity: '快走', duration_minutes: 30, distance_km: null, intensity: '轻松', occurred_at: '2026-09-02T18:00:00+08:00', notes: [], source: previewSource });
previewLogs.zhuzhu.measurements.push({ id: 'preview-weight', metric: 'weight', value: 68.4, unit: 'kg', measured_at: '2026-09-02T07:30:00+08:00', notes: ['晨起空腹'], source: previewSource });
const previewSnapshot: DaySnapshot = { revision: 'preview', date: previewBootstrap.today, plan: previewPlan, logs: previewLogs };
const previewDates = ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'];
const previewReview: ReviewSnapshot = { revision: 'preview', start: previewDates[0], end: previewDates[6], days: previewDates.map((date, index) => {
  const zhuzhu = emptyLog(date, 'zhuzhu'); const xiaohua = emptyLog(date, 'xiaohua');
  const source = { ...previewSource, recorded_at: `${date}T09:00:00+08:00` };
  if ([0, 2, 4, 6].includes(index)) { zhuzhu.nutrition_status = 'partial'; zhuzhu.meals.push({ id: `review-z-meal-${index}`, meal: 'breakfast', items: [meal(`review-z-food-${index}`, '燕麦粥', 60, 'g')], occurred_at: `${date}T08:00:00+08:00`, source }); }
  if ([1, 3, 5].includes(index)) { xiaohua.nutrition_status = 'partial'; xiaohua.meals.push({ id: `review-x-meal-${index}`, meal: 'dinner', items: [meal(`review-x-food-${index}`, '牛肉与时蔬')], occurred_at: `${date}T18:30:00+08:00`, source }); }
  if ([0, 3, 6].includes(index)) { zhuzhu.training_status = 'partial'; zhuzhu.sets.push({ id: `review-z-set-${index}`, exercise_id: 'preview-squat', equipment: '哑铃', load: 14, load_unit: 'kg', reps: 10, side: 'both', kind: 'work', source }); }
  if ([2, 5].includes(index)) { xiaohua.training_status = 'partial'; xiaohua.sets.push({ id: `review-x-set-${index}`, exercise_id: 'preview-row', equipment: '哑铃', load: 8, load_unit: 'kg', reps: 10, side: 'both', kind: 'work', source }); }
  if (index === 3) { zhuzhu.cardio.push({ id: 'review-cardio', activity: '椭圆机', duration_minutes: 35, distance_km: null, intensity: '中等', occurred_at: `${date}T17:20:00+08:00`, notes: [], source }); }
  if ([0, 3, 6].includes(index)) zhuzhu.measurements.push({ id: `review-z-weight-${index}`, metric: 'weight', value: 68.8 - index * .07, unit: 'kg', measured_at: `${date}T07:30:00+08:00`, notes: [], source });
  if ([3, 6].includes(index)) xiaohua.measurements.push({ id: `review-x-weight-${index}`, metric: 'weight', value: 52.1 - index * .05, unit: 'kg', measured_at: `${date}T07:40:00+08:00`, notes: [], source });
  return { date, plan: index === 6 ? previewPlan : null, logs: { zhuzhu, xiaohua } };
}) };
const previewMessages: ThreadMessage[] = [{ id: 'preview-message', role: 'assistant', text: '想改哪里？告诉我就好。', attachment_ids: [], receipts: [], created_at: '2026-09-02T09:00:00+08:00', status: 'complete' }];

export async function api<T>(input: string, init?: RequestInit): Promise<T> {
  if (preview) {
    if (input === '/api/bootstrap') return previewBootstrap as T;
    if (input.startsWith('/api/day')) return previewSnapshot as T;
    if (input.startsWith('/api/review')) return previewReview as T;
    if (input === '/api/thread') return { messages: previewMessages } as T;
    throw new ApiError('预览中暂时不能保存', 403);
  }
  const response = await fetch(input, { credentials: 'same-origin', ...init, headers: { ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...init?.headers } });
  const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error ?? `HTTP ${response.status}`, response.status);
  return data;
}

export const getBootstrap = () => api<Bootstrap>('/api/bootstrap');
export const getDay = (date: string) => api<DaySnapshot>(`/api/day?date=${encodeURIComponent(date)}`);
export const getReview = (end: string) => api<ReviewSnapshot>(`/api/review?end=${encodeURIComponent(end)}`);
export const getThread = () => api<{ messages: ThreadMessage[] }>('/api/thread');
