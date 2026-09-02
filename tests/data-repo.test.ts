import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyLog } from '../shared/contracts.js';

let temporary = '';
afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = ''; delete process.env.DATA_REPO; delete process.env.RUNTIME_DIR; delete process.env.DEV_FIXTURES; vi.resetModules();
});

describe('Git-backed snapshots', () => {
  it('starts with unknown profiles and exposes data only after commit', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'fitness-data-'));
    process.env.DATA_REPO = path.join(temporary, 'data'); process.env.RUNTIME_DIR = path.join(temporary, 'runtime'); process.env.DEV_FIXTURES = 'false';
    const repo = await import('../server/data-repo.js');
    await repo.ensureDataRepo('2026-09-01');
    const before = await repo.daySnapshot('2026-09-01');
    expect(before.plan).toBeNull(); expect(before.logs.zhuzhu.nutrition_status).toBe('unlogged');
    const log = emptyLog('2026-09-01', 'zhuzhu'); log.notes.push('虚构测试记录');
    const revision = await repo.applyData('zhuzhu', 'request-test', before.revision, [{ path: 'logs/2026-09-01/zhuzhu.json', content: log }]);
    const after = await repo.daySnapshot('2026-09-01');
    expect(after.revision).toBe(revision); expect(after.logs.zhuzhu.notes).toEqual(['虚构测试记录']);
  });
});
