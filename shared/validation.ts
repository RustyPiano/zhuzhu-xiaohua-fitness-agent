import { Type, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { PersonId } from './contracts.js';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PERSONS = ['zhuzhu', 'xiaohua'] as const;
const date = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
const timestamp = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}T[^\\s]{5,40}$', maxLength: 64 });
const id = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' });
const text = (maxLength = 2_000) => Type.String({ maxLength });
const nullableText = (maxLength = 500) => Type.Union([text(maxLength), Type.Null()]);
const number = Type.Number({ minimum: 0, maximum: 10_000_000 });
const nullableNumber = Type.Union([number, Type.Null()]);
const nullableSetCount = Type.Union([Type.Integer({ minimum: 0, maximum: 100 }), Type.Null()]);
const person = Type.Union([Type.Literal('zhuzhu'), Type.Literal('xiaohua')]);
const stringList = Type.Array(text(1_000), { maxItems: 100 });
const nutrition = Type.Object({ kcal: nullableNumber, protein_g: nullableNumber, carbs_g: nullableNumber, fat_g: nullableNumber }, { additionalProperties: false });
const mealItem = Type.Object({ id, name: text(200), amount: nullableNumber, unit: nullableText(80), nutrition, value_kind: Type.Union([Type.Literal('label'), Type.Literal('weighed'), Type.Literal('estimated'), Type.Literal('unknown')]), assumptions: stringList }, { additionalProperties: false });
const source = Type.Object({ recorded_by: person, request_id: text(100), attachment_ids: Type.Array(Type.String({ pattern: '^[a-f0-9-]{36}$' }), { maxItems: 4 }), recorded_at: timestamp }, { additionalProperties: false });
const exercise = Type.Object({ exercise_id: id, name: text(200), equipment: nullableText(200), sets: nullableSetCount, reps: nullableText(100), load: nullableNumber, load_unit: nullableText(100), rest_seconds: nullableNumber, notes: stringList }, { additionalProperties: false });
const plannedMeal = Type.Object({ meal: Type.Union([Type.Literal('breakfast'), Type.Literal('lunch'), Type.Literal('dinner'), Type.Literal('snack')]), label: text(200), items: Type.Array(mealItem, { maxItems: 100 }) }, { additionalProperties: false });
const personPlan = Type.Object({ nutrition: Type.Object({ targets: nutrition, meals: Type.Array(plannedMeal, { maxItems: 20 }) }, { additionalProperties: false }), training: Type.Object({ type: nullableText(200), exercises: Type.Array(exercise, { maxItems: 100 }), cardio: nullableText(2_000) }, { additionalProperties: false }) }, { additionalProperties: false });
const profile = Type.Object({ schema_version: Type.Literal(1), person_id: person, display_name: text(100), height_cm: nullableNumber, age_at_confirmation: nullableNumber, confirmed_at: Type.Union([timestamp, Type.Null()]), training_experience: nullableText(2_000), goal: nullableText(2_000), constraints: Type.Array(Type.Object({ text: text(2_000), source: text(2_000) }, { additionalProperties: false }), { maxItems: 100 }) }, { additionalProperties: false });
const plan = Type.Object({ schema_version: Type.Literal(1), date, status: Type.Union([Type.Literal('draft'), Type.Literal('active')]), title: nullableText(300), people: Type.Object({ zhuzhu: personPlan, xiaohua: personPlan }, { additionalProperties: false }), notes: stringList }, { additionalProperties: false });
const mealLog = Type.Object({ id, meal: Type.Union([Type.Literal('breakfast'), Type.Literal('lunch'), Type.Literal('dinner'), Type.Literal('snack')]), items: Type.Array(mealItem, { maxItems: 100 }), occurred_at: Type.Union([timestamp, Type.Null()]), source }, { additionalProperties: false });
const setLog = Type.Object({ id, exercise_id: id, equipment: nullableText(200), load: nullableNumber, load_unit: nullableText(100), reps: nullableNumber, side: Type.Union([Type.Literal('both'), Type.Literal('left'), Type.Literal('right'), Type.Null()]), kind: Type.Union([Type.Literal('warmup'), Type.Literal('work')]), source }, { additionalProperties: false });
const cardioLog = Type.Object({ id, activity: text(200), duration_minutes: nullableNumber, distance_km: nullableNumber, intensity: nullableText(200), occurred_at: Type.Union([timestamp, Type.Null()]), notes: stringList, source }, { additionalProperties: false });
const measurementLog = Type.Object({ id, metric: Type.Union([Type.Literal('weight'), Type.Literal('waist'), Type.Literal('body_fat'), Type.Literal('other')]), value: number, unit: text(40), measured_at: Type.Union([timestamp, Type.Null()]), notes: stringList, source }, { additionalProperties: false });
const log = Type.Object({ schema_version: Type.Literal(1), date, person_id: person, plan_revision: nullableText(100), nutrition_status: Type.Union([Type.Literal('unlogged'), Type.Literal('partial'), Type.Literal('complete')]), meals: Type.Array(mealLog, { maxItems: 100 }), training_status: Type.Union([Type.Literal('unlogged'), Type.Literal('partial'), Type.Literal('complete')]), sets: Type.Array(setLog, { maxItems: 500 }), cardio: Type.Array(cardioLog, { maxItems: 100 }), measurements: Type.Array(measurementLog, { maxItems: 100 }), notes: stringList }, { additionalProperties: false });
const memory = Type.Object({ schema_version: Type.Literal(1), items: Type.Array(Type.Object({ id, key: text(200), text: text(4_000), evidence: Type.Union([Type.Literal('explicit_statement'), Type.Literal('confirmed_inference')]), source: Type.Object({ actor: person, request_id: text(100) }, { additionalProperties: false }), updated_at: timestamp }, { additionalProperties: false }), { maxItems: 200 }) }, { additionalProperties: false });
const ui = Type.Object({ schema_version: Type.Literal(1), theme: Type.Union([Type.Literal('light'), Type.Literal('dark')]), compact: Type.Boolean() }, { additionalProperties: false });

export function isPerson(value: unknown): value is PersonId { return typeof value === 'string' && PERSONS.includes(value as PersonId); }
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function check(schema: TSchema, value: unknown, label: string): void {
  if (Value.Check(schema, value)) return;
  const issue = [...Value.Errors(schema, value)][0];
  throw new Error(`${label} 结构无效${issue ? `：${issue.path || '/'} ${issue.message}` : ''}`);
}
function unique(values: string[], label: string): void { if (new Set(values).size !== values.length) throw new Error(`${label} 包含重复 ID`); }

export function validateBusinessJson(relativePath: string, value: unknown): void {
  if (relativePath.startsWith('people/')) check(profile, value, relativePath);
  else if (relativePath.startsWith('plans/')) {
    check(plan, value, relativePath); const typed = value as any;
    for (const who of PERSONS) { unique(typed.people[who].training.exercises.map((item: any) => item.exercise_id), `${who}.exercises`); for (const meal of typed.people[who].nutrition.meals) unique(meal.items.map((item: any) => item.id), `${who}.${meal.meal}.items`); }
  } else if (relativePath.startsWith('logs/')) {
    check(log, value, relativePath); const typed = value as any; for (const key of ['meals', 'sets', 'cardio', 'measurements']) unique(typed[key].map((item: any) => item.id), key); for (const meal of typed.meals) unique(meal.items.map((item: any) => item.id), `${meal.id}.items`);
  } else if (relativePath.startsWith('memory/')) { check(memory, value, relativePath); unique((value as any).items.map((item: any) => item.id), 'memory.items'); }
  else if (relativePath === 'ui.json') check(ui, value, relativePath);
}

export function assertAllowedDataPath(path: string): void {
  if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || path.includes('\0')) throw new Error('路径越界');
  const allowed = /^(people\/(zhuzhu|xiaohua)\.json|plans\/\d{4}-\d{2}-\d{2}\.json|logs\/\d{4}-\d{2}-\d{2}\/(zhuzhu|xiaohua)\.json|memory\/(zhuzhu|xiaohua|shared)\.json|exercises\/[a-z0-9][a-z0-9-]*\.md|ui\.json)$/;
  if (!allowed.test(path)) throw new Error(`不允许的数据路径：${path}`);
}
