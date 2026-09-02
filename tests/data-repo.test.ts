import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
});
