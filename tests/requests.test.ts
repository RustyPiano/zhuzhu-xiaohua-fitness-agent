import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'node:util';

const exec = promisify(execFile);

let temporary = '';
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = ''; delete process.env.RUNTIME_DIR; delete process.env.DATA_REPO; delete process.env.DEV_FIXTURES; vi.resetModules(); });

describe('idempotent request records include attachments', () => {
  it('returns an existing identical request and conflicts when an image changes', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'fitness-request-'));
    process.env.RUNTIME_DIR = temporary;
    const { createRequest } = await import('../server/requests.js');
    const input = { id: 'request_12345678', actor: 'zhuzhu' as const, text: '记录午餐', attachment_ids: ['a', 'b'], attachment_hashes: ['hash-a', 'hash-b'] };
    expect((await createRequest(input)).existing).toBe(false);
    expect((await createRequest(input)).existing).toBe(true);
    await expect(createRequest({ ...input, attachment_hashes: ['hash-c', 'hash-b'] })).rejects.toThrow('内容或附件已改变');
    await expect(createRequest({ ...input, attachment_ids: ['b', 'a'], attachment_hashes: ['hash-b', 'hash-a'] })).rejects.toThrow('内容或附件已改变');
  });

  it('emits done for failed and queued-cancelled requests', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'fitness-request-')); process.env.RUNTIME_DIR = temporary;
    const requests = await import('../server/requests.js');
    const failed = (await requests.createRequest({ id: 'request_failed_1', actor: 'zhuzhu', text: '失败请求', attachment_ids: [], attachment_hashes: [] })).record;
    const failedEvents: string[] = []; const failedDone = new Promise<void>((resolve) => requests.subscribe(failed.id, ({ event }) => { failedEvents.push(event); if (event === 'done') resolve(); }));
    requests.enqueue(failed.id, async () => { throw new Error('模拟失败'); }); await failedDone;
    expect((await requests.loadRequest(failed.id)).status).toBe('error'); expect(failedEvents).toContain('error');

    let release!: () => void; const blocker = new Promise<void>((resolve) => { release = resolve; });
    const first = (await requests.createRequest({ id: 'request_blocker', actor: 'zhuzhu', text: '占用队列', attachment_ids: [], attachment_hashes: [] })).record;
    const firstDone = new Promise<void>((resolve) => requests.subscribe(first.id, ({ event }) => { if (event === 'done') resolve(); })); requests.enqueue(first.id, async () => blocker);
    const queued = (await requests.createRequest({ id: 'request_queued_1', actor: 'zhuzhu', text: '等待取消', attachment_ids: [], attachment_hashes: [] })).record; requests.enqueue(queued.id, async () => undefined);
    const cancelledDone = new Promise<void>((resolve) => requests.subscribe(queued.id, ({ event }) => { if (event === 'done') resolve(); }));
    await requests.cancelRequest(queued.id, 'zhuzhu'); await cancelledDone; release(); await firstDone;
    expect((await requests.loadRequest(queued.id)).status).toBe('cancelled');
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
    const { emptyLog } = await import('../shared/contracts.js'); const data = process.env.DATA_REPO; await mkdir(path.join(data, 'logs', '2026-09-01'), { recursive: true }); await writeFile(path.join(data, 'logs', '2026-09-01', 'zhuzhu.json'), `${JSON.stringify(emptyLog('2026-09-01', 'zhuzhu'), null, 2)}\n`); await exec('git', ['add', '.'], { cwd: data }); await exec('git', ['commit', '-m', 'test recovery', '-m', `Request-Id: ${record.id}`], { cwd: data });
    await requests.markInterruptedRequests(); const recovered = await requests.loadRequest(record.id); expect(recovered.status).toBe('done'); expect(recovered.committed_revision).toMatch(/^[a-f0-9]{40}$/); expect(recovered.messages.at(-1)?.receipts[0]?.type).toBe('data');
  });
});
