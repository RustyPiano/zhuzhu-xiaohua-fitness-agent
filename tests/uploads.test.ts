import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

let temporary = '';
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = ''; delete process.env.UPLOADS_DIR; vi.resetModules(); });

describe('image ingestion', () => {
  it('decodes and normalizes a real image instead of trusting its filename', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'fitness-upload-')); process.env.UPLOADS_DIR = temporary;
    const png = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#f25246' } }).png().toBuffer();
    const { saveUpload, readAttachmentMeta } = await import('../server/uploads.js');
    const meta = await saveUpload('zhuzhu', new File([new Uint8Array(png)], 'not-really-a-photo.txt', { type: 'text/plain' }));
    expect(meta).toMatchObject({ owner: 'zhuzhu', mime: 'image/png', width: 80, height: 40 });
    expect((await readAttachmentMeta(meta.id)).sha256).toBe(meta.sha256);
  });

  it('rejects SVG even when the client claims it is PNG', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'fitness-upload-')); process.env.UPLOADS_DIR = temporary;
    const { saveUpload } = await import('../server/uploads.js');
    const fake = new File(['<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'], 'image.png', { type: 'image/png' });
    await expect(saveUpload('xiaohua', fake)).rejects.toThrow();
  });
});
