import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { PersonId, AttachmentMeta } from '../shared/contracts.js';
import { config } from './config.js';
import { isAttachmentShared } from './data-repo.js';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const MIME_TO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

function metaPath(id: string): string { return path.join(config.uploadsDir, `${id}.json`); }
function checkId(id: string): void { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('附件 ID 无效'); }

export async function saveUpload(actor: PersonId, file: File): Promise<AttachmentMeta> {
  if (file.size <= 0 || file.size > MAX_BYTES) throw new Error('图片必须小于 10 MiB');
  const input = Buffer.from(await file.arrayBuffer());
  const image = sharp(input, { limitInputPixels: MAX_PIXELS, animated: false, failOn: 'error' });
  const info = await image.metadata();
  const mime = info.format === 'jpeg' ? 'image/jpeg' : info.format === 'png' ? 'image/png' : info.format === 'webp' && (info.pages ?? 1) === 1 ? 'image/webp' : null;
  if (!mime) throw new Error('仅支持 JPEG、PNG 和静态 WebP；不支持 SVG、HEIC 或动图');
  if (!info.width || !info.height || info.width * info.height > MAX_PIXELS) throw new Error('图片像素超过 2000 万上限');
  let pipeline = image.rotate();
  if (Math.max(info.width, info.height) > 4096) pipeline = pipeline.resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true });
  if (mime === 'image/jpeg') pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true });
  else if (mime === 'image/png') pipeline = pipeline.png({ compressionLevel: 9 });
  else pipeline = pipeline.webp({ quality: 90 });
  const { data, info: output } = await pipeline.toBuffer({ resolveWithObject: true });
  const id = randomUUID(); const extension = MIME_TO_EXT[mime];
  const meta: AttachmentMeta = {
    id, owner: actor, mime, extension, bytes: data.byteLength, width: output.width, height: output.height,
    sha256: createHash('sha256').update(data).digest('hex'), created_at: new Date().toISOString(),
  };
  await mkdir(config.uploadsDir, { recursive: true });
  const tempImage = path.join(config.uploadsDir, `${id}.image.tmp`); const tempMeta = path.join(config.uploadsDir, `${id}.meta.tmp`);
  await writeFile(tempImage, data, { mode: 0o600 }); await writeFile(tempMeta, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
  await rename(tempImage, path.join(config.uploadsDir, `${id}.${extension}`)); await rename(tempMeta, metaPath(id));
  return meta;
}

export async function readAttachmentMeta(id: string): Promise<AttachmentMeta> {
  checkId(id); return JSON.parse(await readFile(metaPath(id), 'utf8')) as AttachmentMeta;
}

export async function assertAttachmentAccess(actor: PersonId, id: string): Promise<AttachmentMeta> {
  const meta = await readAttachmentMeta(id);
  if (meta.owner !== actor && !(await isAttachmentShared(id))) throw new Error('无权读取此附件');
  return meta;
}

export async function readAttachmentBytes(actor: PersonId, id: string): Promise<{ meta: AttachmentMeta; bytes: Buffer }> {
  const meta = await assertAttachmentAccess(actor, id);
  return { meta, bytes: await readFile(path.join(config.uploadsDir, `${id}.${meta.extension}`)) };
}

export const uploadLimits = { max_files: 4, max_bytes: MAX_BYTES, max_pixels: MAX_PIXELS };
