import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { secureHeaders } from 'hono/secure-headers';
import { login, logout, requireAuth, requireExactOrigin } from './auth.js';
import { businessDate, config } from './config.js';
import { daySnapshot, ensureDataRepo } from './data-repo.js';
import { webBudgetStatus } from './exa.js';
import { resetAgentSession, runAgent } from './agent.js';
import { cancelRequest, createRequest, enqueue, listActorMessages, loadRequest, markInterruptedRequests, markNewThread, subscribe } from './requests.js';
import { assertAttachmentAccess, readAttachmentBytes, readAttachmentMeta, saveUpload, uploadLimits } from './uploads.js';
import { currentWebRoot, deploymentInfo, publishUiJob, rollbackUi } from './ui-jobs.js';
import { DATE_RE } from '../shared/validation.js';

const app = new Hono();
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'],
    connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
  },
  crossOriginResourcePolicy: 'same-origin', referrerPolicy: 'no-referrer', xContentTypeOptions: 'nosniff',
}));

app.get('/api/health', (c) => c.json({ ok: true }));
app.post('/api/login', async (c) => requireExactOrigin(c) ?? login(c));
app.post('/api/logout', requireAuth, (c) => requireExactOrigin(c) ?? logout(c));
app.use('/api/*', requireAuth);

app.get('/api/bootstrap', async (c) => {
  let budget;
  try { budget = await webBudgetStatus(); } catch { budget = { month: businessDate().slice(0, 7), used_microusd: config.webStopMicrousd, warn_microusd: config.webWarnMicrousd, stop_microusd: config.webStopMicrousd, warning: true, stopped: true }; }
  const modelConfigured = Boolean(config.modelProvider && config.modelId && config.modelKey);
  return c.json({
    actor: c.get('actor'), timezone: config.timezone, today: businessDate(), app_version: '1.0.0',
    image: { configured: modelConfigured, ...uploadLimits, reason: modelConfigured ? null : '未配置支持图片和工具调用的模型' },
    web: { provider: 'exa', configured: Boolean(config.exaKey), reason: config.exaKey ? null : '未配置 EXA_API_KEY', budget },
    ui_editing: { configured: Boolean(config.uiSandboxImage), reason: config.uiSandboxImage ? null : '未配置固定 rootless Podman 构建镜像' },
  });
});

app.get('/api/day', async (c) => {
  const date = c.req.query('date') ?? businessDate(); if (!DATE_RE.test(date)) return c.json({ error: '日期格式应为 YYYY-MM-DD' }, 400);
  return c.json(await daySnapshot(date));
});
app.get('/api/thread', async (c) => c.json({ messages: await listActorMessages(c.get('actor')) }));
app.post('/api/thread/new', async (c) => {
  const originError = requireExactOrigin(c); if (originError) return originError;
  await resetAgentSession(c.get('actor')); await markNewThread(c.get('actor')); return c.json({ ok: true });
});

app.post('/api/messages', async (c) => {
  const originError = requireExactOrigin(c); if (originError) return originError;
  const body = await c.req.json().catch(() => null) as { client_request_id?: unknown; text?: unknown; attachment_ids?: unknown } | null;
  if (!body || typeof body.client_request_id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.client_request_id)) return c.json({ error: 'client_request_id 无效' }, 400);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const ids = Array.isArray(body.attachment_ids) && body.attachment_ids.every((id) => typeof id === 'string') ? body.attachment_ids as string[] : [];
  if (!text && !ids.length) return c.json({ error: '消息文字和附件不能同时为空' }, 400);
  if (text.length > 20_000 || ids.length > uploadLimits.max_files || new Set(ids).size !== ids.length) return c.json({ error: '消息或附件数量超过限制' }, 400);
  const metas = [];
  try { for (const id of ids) metas.push(await assertAttachmentAccess(c.get('actor'), id)); } catch (error) { return c.json({ error: (error as Error).message }, 403); }
  try {
    const { record, existing } = await createRequest({ id: body.client_request_id, actor: c.get('actor'), text, attachment_ids: ids, attachment_hashes: metas.map((meta) => meta.sha256) });
    if (!existing) enqueue(record.id, runAgent);
    return c.json({ request_id: record.id, status: record.status, existing }, existing ? 200 : 202);
  } catch (error) { return c.json({ error: (error as Error).message }, 409); }
});

app.get('/api/requests/:id', async (c) => {
  try { const record = await loadRequest(c.req.param('id')); if (record.actor !== c.get('actor')) return c.json({ error: '无权访问此请求' }, 403); return c.json(record); }
  catch (error) { return c.json({ error: (error as Error).message }, 404); }
});
app.get('/api/requests/:id/events', async (c) => {
  const id = c.req.param('id'); let record;
  try { record = await loadRequest(id); } catch { return c.json({ error: '请求不存在' }, 404); }
  if (record.actor !== c.get('actor')) return c.json({ error: '无权访问此请求' }, 403);
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: 'status', data: JSON.stringify({ status: record.status }) });
    if (['done', 'error', 'cancelled', 'interrupted'].includes(record.status)) { await stream.writeSSE({ event: 'done', data: JSON.stringify({ status: record.status }) }); return; }
    let closed = false;
    const unsubscribe = subscribe(id, ({ event, data }) => { if (!closed) void stream.writeSSE({ event, data: JSON.stringify(data) }); });
    stream.onAbort(() => { closed = true; unsubscribe(); });
    while (!closed) { await stream.sleep(15_000); await stream.writeSSE({ event: 'ping', data: '{}' }); const latest = await loadRequest(id); if (['done', 'error', 'cancelled', 'interrupted'].includes(latest.status)) break; }
    closed = true; unsubscribe();
  });
});
app.post('/api/requests/:id/cancel', async (c) => {
  const originError = requireExactOrigin(c); if (originError) return originError;
  try { await cancelRequest(c.req.param('id'), c.get('actor')); return c.json({ ok: true }); } catch (error) { return c.json({ error: (error as Error).message }, 404); }
});

app.post('/api/uploads', async (c) => {
  const originError = requireExactOrigin(c); if (originError) return originError;
  const body = await c.req.parseBody({ all: true }); const value = body.file;
  if (!(value instanceof File)) return c.json({ error: 'multipart 字段 file 必须是一张图片' }, 400);
  try { const meta = await saveUpload(c.get('actor'), value); return c.json({ ...meta, url: `/api/uploads/${meta.id}` }, 201); }
  catch (error) { return c.json({ error: (error as Error).message }, 400); }
});
app.get('/api/uploads/:id', async (c) => {
  try { const { meta, bytes } = await readAttachmentBytes(c.get('actor'), c.req.param('id')); return new Response(new Uint8Array(bytes), { headers: { 'content-type': meta.mime, 'content-length': String(bytes.byteLength), 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' } }); }
  catch (error) { return c.json({ error: (error as Error).message }, 404); }
});

app.post('/api/ui-jobs/:id/publish', async (c) => {
  const originError = requireExactOrigin(c); if (originError) return originError;
  try { return c.json(await publishUiJob(c.get('actor'), c.req.param('id'))); } catch (error) { return c.json({ error: (error as Error).message }, 409); }
});

app.get('/ops', requireAuth, async (c) => {
  const deployment = await deploymentInfo();
  return c.html(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>前端恢复</title><style>body{font:16px system-ui;max-width:720px;margin:48px auto;padding:20px;color:#191817}code{background:#f3f1ef;padding:3px 6px;border-radius:4px}button{padding:10px 16px}</style><h1>前端恢复</h1><p>当前产物：<code>${escapeHtml(deployment.current ?? '初始构建')}</code></p><p>源码版本：<code>${escapeHtml(deployment.source_revision ?? '未记录')}</code></p><form method="post" action="/ops/rollback"><button type="submit">恢复上一个可用版本</button></form>`);
});
app.post('/ops/rollback', requireAuth, async (c) => {
  const originError = requireExactOrigin(c); if (originError) return originError;
  try { await rollbackUi(); return c.redirect('/ops', 303); } catch (error) { return c.text((error as Error).message, 409); }
});

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
app.get('*', async (c) => {
  const root = await currentWebRoot(); const requested = c.req.path === '/' ? 'index.html' : c.req.path.slice(1); let target = path.resolve(root, requested);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`) && target !== path.resolve(root, 'index.html')) return c.notFound();
  try { if (!(await stat(target)).isFile()) throw new Error('not file'); }
  catch { target = path.resolve(root, 'index.html'); }
  try { const bytes = await readFile(target); return new Response(new Uint8Array(bytes), { headers: { 'content-type': MIME[path.extname(target)] ?? 'application/octet-stream' } }); }
  catch { return c.text('前端尚未构建。请先运行 pnpm build。', 503); }
});

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!)); }

await ensureDataRepo(businessDate()); await markInterruptedRequests();
serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => console.log(`Fitness Agent listening on http://127.0.0.1:${info.port}`));
