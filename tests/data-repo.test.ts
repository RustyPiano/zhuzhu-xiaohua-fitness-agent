import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyLog } from '../shared/contracts.js';
const exec = promisify(execFile);
let temporary = '';
afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = ''; delete process.env.DATA_REPO; delete process.env.RUNTIME_DIR; delete process.env.DEV_FIXTURES; vi.resetModules();
});

describe('Git-backed snapshots', () => {
  it('starts with unknown profiles and no invented daily data', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'fitness-data-'));
    process.env.DATA_REPO = path.join(temporary, 'data'); process.env.RUNTIME_DIR = path.join(temporary, 'runtime'); process.env.DEV_FIXTURES = 'false';
    const repo = await import('../server/data-repo.js');
    await repo.ensureDataRepo('2026-09-01');
    const before = await repo.daySnapshot('2026-09-01');
    expect(before.plan).toBeNull(); expect(before.logs.zhuzhu.nutrition_status).toBe('unlogged');
    expect(before.logs.xiaohua.training_status).toBe('unlogged');
  });

  it('reads seven days from one revision and preserves missing logs', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'fitness-data-'));
    process.env.DATA_REPO = path.join(temporary, 'data'); process.env.RUNTIME_DIR = path.join(temporary, 'runtime'); process.env.DEV_FIXTURES = 'false';
    const repo = await import('../server/data-repo.js');
    await repo.ensureDataRepo('2024-03-01');

    const leapDay = emptyLog('2024-02-29', 'zhuzhu');
    leapDay.nutrition_status = 'partial'; leapDay.notes.push('有记录');
    const directory = path.join(process.env.DATA_REPO, 'logs', leapDay.date);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'zhuzhu.json'), `${JSON.stringify(leapDay, null, 2)}\n`);
    await exec('git', ['add', '.'], { cwd: process.env.DATA_REPO });
    await exec('git', ['commit', '-m', 'test: add leap-day log'], { cwd: process.env.DATA_REPO });

    const review = await repo.reviewSnapshot('2024-03-01');
    expect(review.start).toBe('2024-02-24'); expect(review.end).toBe('2024-03-01');
    expect(review.days.map(({ date }) => date)).toEqual([
      '2024-02-24', '2024-02-25', '2024-02-26', '2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01',
    ]);
    expect(review.days[5].logs.zhuzhu.notes).toEqual(['有记录']);
    expect(review.days[0].logs.zhuzhu).toEqual(emptyLog('2024-02-24', 'zhuzhu'));
    expect(review.days.every((day) => !('revision' in day))).toBe(true);
    expect(review.revision).toBe(await repo.headRevision());
  });
});
