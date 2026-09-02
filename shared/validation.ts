import type { DayLog, DayPlan, MemoryFile, PersonId, PersonProfile } from './contracts.js';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PERSONS = ['zhuzhu', 'xiaohua'] as const;

export function isPerson(value: unknown): value is PersonId {
  return typeof value === 'string' && PERSONS.includes(value as PersonId);
}

function object(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
}

export function validateBusinessJson(relativePath: string, value: unknown): void {
  object(value, relativePath);
  if (value.schema_version !== 1) throw new Error(`${relativePath} 的 schema_version 必须为 1`);
  if (relativePath.startsWith('people/')) validateProfile(value as unknown as PersonProfile);
  else if (relativePath.startsWith('plans/')) validatePlan(value as unknown as DayPlan);
  else if (relativePath.startsWith('logs/')) validateLog(value as unknown as DayLog);
  else if (relativePath.startsWith('memory/')) validateMemory(value as unknown as MemoryFile);
}

function validateProfile(value: PersonProfile): void {
  if (!isPerson(value.person_id) || typeof value.display_name !== 'string') throw new Error('人物档案主体无效');
  if (value.height_cm !== null && (!Number.isFinite(value.height_cm) || value.height_cm <= 0)) throw new Error('身高必须为正数或 null');
}

function validatePlan(value: DayPlan): void {
  if (!DATE_RE.test(value.date) || !['draft', 'active'].includes(value.status)) throw new Error('计划日期或状态无效');
  object(value.people, 'people');
  for (const person of PERSONS) {
    object(value.people[person], `people.${person}`);
    if (!Array.isArray(value.people[person].nutrition?.meals) || !Array.isArray(value.people[person].training?.exercises)) {
      throw new Error(`people.${person} 的计划结构无效`);
    }
  }
}

function validateLog(value: DayLog): void {
  if (!DATE_RE.test(value.date) || !isPerson(value.person_id)) throw new Error('日志日期或人物无效');
  if (!['unlogged', 'partial', 'complete'].includes(value.nutrition_status)) throw new Error('营养记录状态无效');
  if (!['unlogged', 'partial', 'complete'].includes(value.training_status)) throw new Error('训练记录状态无效');
  if (!Array.isArray(value.meals) || !Array.isArray(value.sets)) throw new Error('日志条目必须为数组');
}

function validateMemory(value: MemoryFile): void {
  if (!Array.isArray(value.items) || value.items.length > 200) throw new Error('记忆条目必须为不超过 200 项的数组');
  for (const item of value.items) {
    if (!item.id || !item.key || !item.text || !isPerson(item.source?.actor)) throw new Error('记忆条目缺少必要字段');
  }
}

export function assertAllowedDataPath(path: string): void {
  if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || path.includes('\0')) throw new Error('路径越界');
  const allowed = /^(people\/(zhuzhu|xiaohua)\.json|plans\/\d{4}-\d{2}-\d{2}\.json|logs\/\d{4}-\d{2}-\d{2}\/(zhuzhu|xiaohua)\.json|memory\/(zhuzhu|xiaohua|shared)\.json|exercises\/[a-z0-9][a-z0-9-]*\.md|ui\.json)$/;
  if (!allowed.test(path)) throw new Error(`不允许的数据路径：${path}`);
}
