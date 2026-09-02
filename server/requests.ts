import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PersonId, ThreadMessage } from '../shared/contracts.js';
import { config } from './config.js';

export type RequestStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled' | 'interrupted';
export type WebCall = {
  id: string; kind: 'search' | 'read'; key: string; month: string; started_at: string;
  reserved_microusd: number; charged_microusd: number; status: 'reserved' | 'completed' | 'failed'; provider_request_id?: string;
};
export type RequestRecord = {
  id: string; actor: PersonId; digest: string; text: string; attachment_ids: string[]; attachment_hashes: string[];
  status: RequestStatus; created_at: string; updated_at: string; error: string | null;
  messages: ThreadMessage[]; web_calls: WebCall[]; tool_cache: Record<string, unknown>; committed_revision: string | null;
};

const emitters = new Map<string, EventEmitter>();
let queueTail = Promise.resolve();

function directory(): string { return path.join(config.runtimeDir, 'requests'); }
function file(id: string): string {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new Error('request id 无效');
  return path.join(directory(), `${id}.json`);
}
function digest(actor: PersonId, text: string, ids: string[], hashes: string[]): string {
  return createHash('sha256').update(JSON.stringify({ actor, text, ids, hashes })).digest('hex');
}
async function atomicWrite(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

export async function loadRequest(id: string): Promise<RequestRecord> {
  return JSON.parse(await readFile(file(id), 'utf8')) as RequestRecord;
}
export async function saveRequest(record: RequestRecord): Promise<void> {
  record.updated_at = new Date().toISOString();
  await atomicWrite(file(record.id), record);
}

export async function createRequest(input: { id: string; actor: PersonId; text: string; attachment_ids: string[]; attachment_hashes: string[] }): Promise<{ record: RequestRecord; existing: boolean }> {
  const expected = digest(input.actor, input.text, input.attachment_ids, input.attachment_hashes);
  try {
    const current = await loadRequest(input.id);
    if (current.actor !== input.actor) throw new Error('无权访问此请求');
    if (current.digest !== expected) throw new Error('同一 client_request_id 的内容或附件已改变');
    return { record: current, existing: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const now = new Date().toISOString();
  const record: RequestRecord = {
    id: input.id, actor: input.actor, digest: expected, text: input.text,
    attachment_ids: input.attachment_ids, attachment_hashes: input.attachment_hashes,
    status: 'queued', created_at: now, updated_at: now, error: null, web_calls: [], tool_cache: {}, committed_revision: null,
    messages: [{ id: randomUUID(), role: 'user', text: input.text, attachment_ids: input.attachment_ids, receipts: [], created_at: now, status: 'complete' }],
  };
  await saveRequest(record);
  return { record, existing: false };
}

export function enqueue(id: string, runner: (record: RequestRecord, signal: AbortSignal) => Promise<void>): void {
  const controller = new AbortController();
  controllers.set(id, controller);
  queueTail = queueTail.then(async () => {
    const record = await loadRequest(id);
    if (record.status !== 'queued') return;
    record.status = 'running'; await saveRequest(record); emit(id, 'status', { status: 'running' });
    try {
      await runner(record, controller.signal);
      const latest = await loadRequest(id);
      if (latest.status === 'running') { latest.status = 'done'; await saveRequest(latest); }
      emit(id, 'done', { status: (await loadRequest(id)).status });
    } catch (error) {
      const latest = await loadRequest(id);
      latest.status = controller.signal.aborted ? 'cancelled' : 'error';
      latest.error = error instanceof Error ? error.message : '请求失败';
      await saveRequest(latest); emit(id, 'error', { error: latest.error });
    } finally { controllers.delete(id); }
  }).catch(() => undefined);
}

const controllers = new Map<string, AbortController>();
export async function cancelRequest(id: string, actor: PersonId): Promise<void> {
  const record = await loadRequest(id);
  if (record.actor !== actor) throw new Error('无权访问此请求');
  controllers.get(id)?.abort();
  if (record.status === 'queued') { record.status = 'cancelled'; await saveRequest(record); }
}

export function emit(id: string, event: string, data: unknown): void { emitters.get(id)?.emit('event', { event, data }); }
export function subscribe(id: string, listener: (value: { event: string; data: unknown }) => void): () => void {
  const emitter = emitters.get(id) ?? new EventEmitter(); emitters.set(id, emitter); emitter.on('event', listener);
  return () => { emitter.off('event', listener); if (!emitter.listenerCount('event')) emitters.delete(id); };
}

export async function listActorMessages(actor: PersonId): Promise<ThreadMessage[]> {
  await mkdir(directory(), { recursive: true });
  const names = (await readdir(directory())).filter((name) => name.endsWith('.json'));
  const records: RequestRecord[] = [];
  for (const name of names) {
    try { const item = JSON.parse(await readFile(path.join(directory(), name), 'utf8')) as RequestRecord; if (item.actor === actor) records.push(item); } catch { /* malformed request is not exposed */ }
  }
  let started = '';
  try { started = (JSON.parse(await readFile(path.join(config.runtimeDir, 'threads', `${actor}.json`), 'utf8')) as { started_at: string }).started_at; } catch { /* first thread */ }
  return records.filter((record) => !started || record.created_at >= started).sort((a, b) => a.created_at.localeCompare(b.created_at)).flatMap((record) => record.messages);
}

export async function markNewThread(actor: PersonId): Promise<void> {
  await atomicWrite(path.join(config.runtimeDir, 'threads', `${actor}.json`), { actor, started_at: new Date().toISOString() });
}

export async function markInterruptedRequests(): Promise<void> {
  await mkdir(directory(), { recursive: true });
  for (const name of await readdir(directory())) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = JSON.parse(await readFile(path.join(directory(), name), 'utf8')) as RequestRecord;
      if (record.status === 'running') { record.status = 'interrupted'; record.error = '服务重启中断了请求；不会自动重复副作用'; await saveRequest(record); }
    } catch { /* fail closed for that record */ }
  }
}
