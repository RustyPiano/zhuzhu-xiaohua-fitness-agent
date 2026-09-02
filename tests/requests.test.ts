import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

let temporary = '';
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = ''; delete process.env.RUNTIME_DIR; delete process.env.DATA_REPO; delete process.env.DEV_FIXTURES; vi.resetModules(); });

describe('idempotent request records include attachments', () => {
  it('returns an existing identical request and conflicts when an image changes', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'fitness-request-'));
    process.env.RUNTIME_DIR = temporary;
    const { createRequest } = await import('../server/requests.js');
    const input = { id: 'request_12345678', actor: 'zhuzhu' as const, text: '记录午餐', attachment_ids: ['a'], attachment_hashes: ['hash-a'] };
    expect((await createRequest(input)).existing).toBe(false);
    expect((await createRequest(input)).existing).toBe(true);
    await expect(createRequest({ ...input, attachment_hashes: ['hash-b'] })).rejects.toThrow('内容或附件已改变');
  });

  it('persists new-session generation across module reloads', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'fitness-request-')); process.env.RUNTIME_DIR = temporary;
    const first = await import('../server/requests.js'); await first.markNewThread('xiaohua'); const generation = (await first.loadThreadState('xiaohua')).session_generation;
    vi.resetModules(); const second = await import('../server/requests.js'); expect((await second.loadThreadState('xiaohua')).session_generation).toBe(generation); expect(generation).toMatch(/^[a-f0-9-]{36}$/);
  });

  it('recovers a committed request receipt after restart', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'fitness-request-')); process.env.RUNTIME_DIR = path.join(temporary, 'runtime'); process.env.DATA_REPO = path.join(temporary, 'data'); process.env.DEV_FIXTURES = 'false';
    const repo = await import('../server/data-repo.js'); await repo.ensureDataRepo('2026-09-01'); const requests = await import('../server/requests.js');
    const { record } = await requests.createRequest({ id: 'request_recovery', actor: 'zhuzhu', text: '测试恢复', attachment_ids: [], attachment_hashes: [] }); record.status = 'running'; await requests.saveRequest(record);
    const { emptyLog } = await import('../shared/contracts.js'); await repo.applyData('zhuzhu', record.id, await repo.headRevision(), [{ path: 'logs/2026-09-01/zhuzhu.json', content: emptyLog('2026-09-01', 'zhuzhu') }]);
    await requests.markInterruptedRequests(); const recovered = await requests.loadRequest(record.id); expect(recovered.status).toBe('done'); expect(recovered.committed_revision).toMatch(/^[a-f0-9]{40}$/); expect(recovered.messages.at(-1)?.receipts[0]?.type).toBe('data');
  });
});
