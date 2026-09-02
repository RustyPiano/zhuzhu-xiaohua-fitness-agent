import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

let temporary = '';
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = ''; vi.resetModules(); });

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
});
