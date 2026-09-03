import { constants } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { DayLog, DayPlan, DaySnapshot, MemoryFile, PersonId, PersonProfile, ReviewSnapshot } from '../shared/contracts.js';
import { emptyLog } from '../shared/contracts.js';
import { assertAllowedDataPath } from '../shared/validation.js';
import { config } from './config.js';

function git(args: string[], cwd = config.dataRepo): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
    });
    let out = ''; let err = '';
    child.stdout.on('data', (data) => { out += String(data); });
    child.stderr.on('data', (data) => { err += String(data); });
    child.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `git 退出 ${code}`)));
  });
}

const profile = (person: PersonId, name: string): PersonProfile => ({
  schema_version: 1, person_id: person, display_name: name, height_cm: null,
  age_at_confirmation: null, confirmed_at: null, training_experience: null, goal: null, constraints: [],
});
const memory = (): MemoryFile => ({ schema_version: 1, items: [] });

async function exists(file: string): Promise<boolean> {
  try { await access(file, constants.F_OK); return true; } catch { return false; }
}

async function safeWrite(relative: string, value: unknown): Promise<void> {
  const target = path.join(config.dataRepo, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function fixturePlan(date: string): DayPlan {
  const exercise = (id: string, name: string, load: number) => ({ exercise_id: id, name, equipment: '哑铃', sets: 4, reps: '8–10', load, load_unit: 'kg（每只）', rest_seconds: 90, notes: [] });
  const meals = (prefix: string) => [
    { meal: 'breakfast' as const, label: '早餐', items: [{ id: `${prefix}-oats`, name: '燕麦粥', amount: 60, unit: 'g（生重）', nutrition: { kcal: 228, protein_g: 8, carbs_g: 40, fat_g: 4 }, value_kind: 'weighed' as const, assumptions: [] }] },
    { meal: 'lunch' as const, label: '午餐', items: [{ id: `${prefix}-rice`, name: '糙米饭', amount: 150, unit: 'g（熟重）', nutrition: { kcal: 180, protein_g: 4, carbs_g: 38, fat_g: 1 }, value_kind: 'weighed' as const, assumptions: [] }] },
    { meal: 'dinner' as const, label: '晚餐', items: [{ id: `${prefix}-beef`, name: '牛肉与时蔬', amount: 1, unit: '份', nutrition: { kcal: null, protein_g: null, carbs_g: null, fat_g: null }, value_kind: 'unknown' as const, assumptions: [] }] },
  ];
  return { schema_version: 1, date, status: 'active', title: '全身力量 · A', notes: ['这是仅在 DEV_FIXTURES=true 时生成的虚构演示数据。'], people: {
    zhuzhu: { nutrition: { targets: { kcal: 1900, protein_g: 110, carbs_g: null, fat_g: null }, meals: meals('z') }, training: { type: '全身力量', exercises: [exercise('goblet-squat', '高脚杯深蹲', 14), exercise('dumbbell-row', '单臂哑铃划船', 10), exercise('floor-press', '哑铃卧推', 8)], cardio: null } },
    xiaohua: { nutrition: { targets: { kcal: 1700, protein_g: 95, carbs_g: null, fat_g: null }, meals: meals('x') }, training: { type: '全身力量', exercises: [exercise('goblet-squat', '高脚杯深蹲', 10), exercise('dumbbell-row', '单臂哑铃划船', 8), exercise('floor-press', '哑铃卧推', 6), exercise('xiaohua-deadlift', '小花专属硬拉', 20)], cardio: null } },
  } };
}

function fixtureLog(date: string): DayLog {
  const log = emptyLog(date, 'zhuzhu'); const source = { recorded_by: 'zhuzhu' as const, request_id: 'dev-fixture', attachment_ids: [], recorded_at: `${date}T08:00:00+08:00` };
  log.training_status = 'partial'; log.sets.push({ id: 'fixture-set', exercise_id: 'goblet-squat', equipment: '哑铃', load: 30, load_unit: 'kg', reps: 12, side: 'both', kind: 'work', source });
  log.nutrition_status = 'partial'; log.meals.push({ id: 'fixture-breakfast', meal: 'breakfast', occurred_at: `${date}T08:00:00+08:00`, source, items: [{ id: 'fixture-oats', name: '实际燕麦', amount: 60, unit: 'g', nutrition: { kcal: 228, protein_g: 8, carbs_g: 40, fat_g: 4 }, value_kind: 'weighed', assumptions: [] }] });
  log.measurements.push({ id: 'fixture-weight', metric: 'weight', value: 68.4, unit: 'kg', measured_at: `${date}T07:30:00+08:00`, notes: ['晨起空腹'], source }); return log;
}

export async function ensureDataRepo(today: string): Promise<void> {
  await mkdir(config.dataRepo, { recursive: true });
  if (!(await exists(path.join(config.dataRepo, '.git')))) {
    await git(['init', '--initial-branch=main']);
    await git(['config', 'user.name', 'Fitness Agent']);
    await git(['config', 'user.email', 'fitness-agent@localhost']);
  }
  const initial: Array<[string, unknown]> = [
    ['people/zhuzhu.json', profile('zhuzhu', '珠珠')], ['people/xiaohua.json', profile('xiaohua', '小花')],
    ['memory/zhuzhu.json', memory()], ['memory/xiaohua.json', memory()], ['memory/shared.json', memory()],
    ['ui.json', { schema_version: 1, theme: 'light', compact: false }],
  ];
  for (const [relative, value] of initial) if (!(await exists(path.join(config.dataRepo, relative)))) await safeWrite(relative, value);
  if (config.devFixtures && !(await exists(path.join(config.dataRepo, `plans/${today}.json`)))) await safeWrite(`plans/${today}.json`, fixturePlan(today));
  if (config.devFixtures && !(await exists(path.join(config.dataRepo, `logs/${today}/zhuzhu.json`)))) await safeWrite(`logs/${today}/zhuzhu.json`, fixtureLog(today));
  await git(['add', '--', 'people', 'memory', 'ui.json', 'plans', 'logs']).catch(async () => git(['add', '--', 'people', 'memory', 'ui.json']));
  const staged = await git(['diff', '--cached', '--name-only']);
  if (staged) await git(['commit', '-m', 'bootstrap: initialize empty profiles and memory']);
}

export async function headRevision(): Promise<string> { return git(['rev-parse', 'HEAD']); }

async function readAt<T>(revision: string, relative: string): Promise<T | null> {
  assertAllowedDataPath(relative);
  try { return JSON.parse(await git(['show', `${revision}:${relative}`])) as T; } catch { return null; }
}

async function readDayAt(revision: string, date: string): Promise<Omit<DaySnapshot, 'revision'>> {
  const [plan, z, x] = await Promise.all([
    readAt<DayPlan>(revision, `plans/${date}.json`),
    readAt<DayLog>(revision, `logs/${date}/zhuzhu.json`),
    readAt<DayLog>(revision, `logs/${date}/xiaohua.json`),
  ]);
  return { date, plan, logs: { zhuzhu: z ?? emptyLog(date, 'zhuzhu'), xiaohua: x ?? emptyLog(date, 'xiaohua') } };
}

export async function daySnapshot(date: string): Promise<DaySnapshot> {
  const revision = await headRevision();
  return { revision, ...await readDayAt(revision, date) };
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function reviewSnapshot(endDate: string): Promise<ReviewSnapshot> {
  const revision = await headRevision();
  const dates = Array.from({ length: 7 }, (_, index) => shiftDate(endDate, index - 6));
  return {
    revision,
    start: dates[0],
    end: endDate,
    days: await Promise.all(dates.map((date) => readDayAt(revision, date))),
  };
}

export async function findRequestRevision(requestId: string): Promise<string | null> {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) return null;
  try {
    const revision = await git(['log', '-n', '200', '--format=%H', '--fixed-strings', '--grep', `Request-Id: ${requestId}`]);
    return revision.split('\n').find(Boolean) ?? null;
  } catch { return null; }
}

export async function readMemory(subject: PersonId | 'shared'): Promise<MemoryFile> {
  const revision = await headRevision();
  return (await readAt<MemoryFile>(revision, `memory/${subject}.json`)) ?? memory();
}

export async function readDataFile(relative: string): Promise<string | null> {
  assertAllowedDataPath(relative);
  const revision = await headRevision();
  try { return await git(['show', `${revision}:${relative}`]); } catch { return null; }
}

export async function isAttachmentShared(id: string): Promise<boolean> {
  if (!/^[a-f0-9-]{36}$/.test(id)) return false;
  let names: string;
  try { names = await git(['grep', '-l', id, 'HEAD', '--', 'logs', 'plans']); } catch { return false; }
  for (const raw of names.split('\n').filter(Boolean)) {
    const relative = raw.replace(/^HEAD:/, '');
    try {
      const value = JSON.parse(await git(['show', `HEAD:${relative}`])) as unknown;
      const visit = (node: unknown): boolean => {
        if (Array.isArray(node)) return node.some(visit);
        if (node && typeof node === 'object') {
          const record = node as Record<string, unknown>;
          if (Array.isArray(record.attachment_ids) && record.attachment_ids.includes(id)) return true;
          return Object.values(record).some(visit);
        }
        return false;
      };
      if (visit(value)) return true;
    } catch { /* ignore malformed unreachable content */ }
  }
  return false;
}
