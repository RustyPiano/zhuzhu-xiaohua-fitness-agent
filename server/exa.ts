import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PersonId, ToolReceipt, WebBudgetStatus } from '../shared/contracts.js';
import { businessMonth, config } from './config.js';
import { loadRequest, saveRequest, type RequestRecord, type WebCall } from './requests.js';

const SEARCH_RESERVE = 7_000;
const READ_RESERVE = 1_000;
const MAX_RESPONSE = 2 * 1024 * 1024;
const MAX_CALLS = 6;

function privateIp(host: string): boolean {
  const version = isIP(host);
  if (!version) return false;
  if (version === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const normalized = host.toLowerCase();
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
}

export function assertPublicUrl(input: string): URL {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅允许不含凭据的公开 HTTP(S) URL');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || privateIp(host)) throw new Error('不允许读取本地或内部地址');
  for (const origin of [config.origin, config.previewOrigin]) if (host === new URL(origin).hostname.toLowerCase()) throw new Error('不允许读取本应用地址');
  if (url.href.length > 2_048) throw new Error('URL 过长');
  return url;
}

export async function webBudgetStatus(now = new Date()): Promise<WebBudgetStatus> {
  const month = businessMonth(now); const directory = path.join(config.runtimeDir, 'requests');
  let used = 0;
  try {
    for (const name of await readdir(directory)) {
      if (!name.endsWith('.json')) continue;
      const record = JSON.parse(await readFile(path.join(directory, name), 'utf8')) as RequestRecord;
      for (const call of record.web_calls ?? []) if (call.month === month) used += call.charged_microusd || call.reserved_microusd;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('联网用量记录不可读，已暂停联网');
  }
  return { month, used_microusd: used, warn_microusd: config.webWarnMicrousd, stop_microusd: config.webStopMicrousd, warning: used >= config.webWarnMicrousd, stopped: used >= config.webStopMicrousd };
}

async function reserve(record: RequestRecord, kind: 'search' | 'read', key: string): Promise<WebCall> {
  if (record.web_calls.length >= MAX_CALLS) throw new Error('本任务已达到 6 次联网调用上限');
  const reserveAmount = kind === 'search' ? SEARCH_RESERVE : READ_RESERVE;
  const budget = await webBudgetStatus();
  if (budget.used_microusd + reserveAmount > budget.stop_microusd) throw new Error('本应用估算用量已到停止线，未发送联网请求');
  const call: WebCall = { id: randomUUID(), kind, key, month: budget.month, started_at: new Date().toISOString(), reserved_microusd: reserveAmount, charged_microusd: reserveAmount, status: 'reserved' };
  record.web_calls.push(call); await saveRequest(record); return call;
}

async function exaFetch(endpoint: 'search' | 'contents', body: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (!config.exaKey) throw new Error('未配置 EXA_API_KEY');
  const response = await fetch(`https://api.exa.ai/${endpoint}`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    headers: { 'content-type': 'application/json', 'x-api-key': config.exaKey }, body: JSON.stringify(body),
  });
  if (!response.body) throw new Error('Exa 返回了空响应');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.byteLength; if (length > MAX_RESPONSE) { await reader.cancel(); throw new Error('Exa 响应超过 2 MiB 上限'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let json: Record<string, unknown>;
  try { json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>; } catch { throw new Error(`Exa 返回了不可解析响应（HTTP ${response.status}）`); }
  if (!response.ok) {
    const kind = response.status === 402 ? '额度不足' : response.status === 429 ? '请求过快' : response.status === 401 || response.status === 403 ? '密钥或权限错误' : `HTTP ${response.status}`;
    throw new Error(`Exa ${kind}`);
  }
  return json;
}

function charge(call: WebCall, response: Record<string, unknown>): void {
  const cost = (response.costDollars as { total?: unknown } | undefined)?.total;
  const reported = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? Math.round(cost * 1_000_000) : 0;
  call.charged_microusd = Math.max(call.reserved_microusd, reported); call.status = 'completed';
  if (typeof response.requestId === 'string') call.provider_request_id = response.requestId;
}

export async function webSearch(requestId: string, actor: PersonId, query: string, signal: AbortSignal): Promise<ToolReceipt[]> {
  const clean = query.trim(); if (!clean || clean.length > 500) throw new Error('搜索词必须为 1–500 个字符');
  if (/珠珠|小花|体重|病历|身份证|手机号/.test(clean)) throw new Error('搜索词疑似包含私人资料，请改写为通用公开问题');
  const record = await loadRequest(requestId); if (record.actor !== actor) throw new Error('无权访问请求');
  const key = `search:${clean}`; const cached = record.tool_cache[key] as ToolReceipt[] | undefined; if (cached) return cached;
  const call = await reserve(record, 'search', key);
  try {
    const response = await exaFetch('search', { query: clean, type: 'auto', numResults: 5, contents: { text: false, highlights: true } }, signal);
    charge(call, response);
    const results = Array.isArray(response.results) ? response.results : [];
    const receipts = results.slice(0, 5).flatMap((raw): ToolReceipt[] => {
      const item = raw as Record<string, unknown>; if (typeof item.url !== 'string') return [];
      const highlights = Array.isArray(item.highlights) ? item.highlights.filter((x): x is string => typeof x === 'string').join(' ') : '';
      return [{ type: 'source', status: 'searched', title: typeof item.title === 'string' ? item.title : item.url, url: item.url, snippet: highlights.slice(0, 1500) }];
    });
    record.tool_cache[key] = receipts; await saveRequest(record); return receipts;
  } catch (error) { call.status = 'failed'; await saveRequest(record); throw error; }
}

export async function webRead(requestId: string, actor: PersonId, input: string, fresh: boolean, signal: AbortSignal): Promise<{ receipt: ToolReceipt; text: string; truncated: boolean }> {
  const url = assertPublicUrl(input); const record = await loadRequest(requestId); if (record.actor !== actor) throw new Error('无权访问请求');
  const key = `read:${url.href}:${fresh}`; const cached = record.tool_cache[key] as { receipt: ToolReceipt; text: string; truncated: boolean } | undefined; if (cached) return cached;
  const call = await reserve(record, 'read', key);
  try {
    const response = await exaFetch('contents', { urls: [url.href], text: true, highlights: false, maxAgeHours: fresh ? 0 : 24 }, signal);
    charge(call, response);
    const results = Array.isArray(response.results) ? response.results : [];
    const statuses = Array.isArray(response.statuses) ? response.statuses : [];
    const status = statuses.find((raw) => (raw as Record<string, unknown>).id === url.href || (raw as Record<string, unknown>).url === url.href) as Record<string, unknown> | undefined;
    if (status && status.status && status.status !== 'success') throw new Error(`Exa 未能提取目标 URL：${String(status.status)}`);
    const item = results.find((raw) => (raw as Record<string, unknown>).url === url.href) as Record<string, unknown> | undefined;
    if (!item || typeof item.text !== 'string' || !item.text.trim()) throw new Error('Exa 未返回该 URL 的正文');
    const truncated = item.text.length > 20_000; const text = item.text.slice(0, 20_000);
    const value = { receipt: { type: 'source', status: 'read', title: typeof item.title === 'string' ? item.title : url.href, url: url.href } as ToolReceipt, text, truncated };
    record.tool_cache[key] = value; await saveRequest(record); return value;
  } catch (error) { call.status = 'failed'; await saveRequest(record); throw error; }
}
