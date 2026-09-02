import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Type } from 'typebox';
import type { PersonId, ToolReceipt } from '../shared/contracts.js';
import { PERSON_LABEL } from '../shared/contracts.js';
import { createSandboxTools } from './agent-sandbox.js';
import { finalizeDataWorkspace, prepareAgentWorkspace } from './agent-workspace.js';
import { businessDate, config } from './config.js';
import { webRead, webSearch } from './exa.js';
import { emit, loadRequest, loadThreadState, saveRequest, type RequestRecord } from './requests.js';
import { readAttachmentBytes } from './uploads.js';
import { currentUiSourceRevision, importUiWorkspace } from './ui-jobs.js';

type PiSession = { prompt: (text: string, options?: Record<string, unknown>) => Promise<void>; subscribe: (fn: (event: any) => void) => () => void; abort: () => Promise<void>; dispose: () => void };
export async function runAgent(initial: RequestRecord, signal: AbortSignal): Promise<void> {
  if (config.devMockAgent) {
    const record = await loadRequest(initial.id);
    record.messages.push({ id: randomUUID(), role: 'assistant', text: '收到，我在这里。', attachment_ids: [], receipts: [], created_at: new Date().toISOString(), status: 'complete' });
    await saveRequest(record); return;
  }
  if (!config.modelProvider || !config.modelId || !config.modelKey) throw new Error('未配置支持图片和工具调用的模型');
  if (!config.agentSandboxImage) throw new Error('Agent 暂不可用');

  const workspace = await prepareAgentWorkspace(initial.actor, initial.attachment_ids, await currentUiSourceRevision());
  const pending = await loadRequest(initial.id); pending.workspace_base_revision = workspace.dataBaseRevision; await saveRequest(pending);
  const pi = await import('@earendil-works/pi-coding-agent'); const thread = await loadThreadState(initial.actor);
  const agentDir = path.join(config.runtimeDir, 'pi-agent'); const sessionDir = thread.session_generation ? path.join(config.runtimeDir, 'sessions', initial.actor, thread.session_generation) : path.join(config.runtimeDir, 'sessions', initial.actor);
  await mkdir(agentDir, { recursive: true }); await mkdir(sessionDir, { recursive: true });
  const modelsPath = path.join(agentDir, 'models.json');
  if (config.modelBaseUrl) await writeFile(modelsPath, `${JSON.stringify({ providers: { [config.modelProvider]: { baseUrl: config.modelBaseUrl } } }, null, 2)}\n`, { mode: 0o600 });
  else await rm(modelsPath, { force: true });
  const receipts: ToolReceipt[] = [];
  const searchTool = pi.defineTool({
    name: 'web_search', label: '公开资料搜索', description: '仅在确需新资料时搜索公开网页；不要包含私人记录。', parameters: Type.Object({ query: Type.String() }),
    execute: async (_id, params) => { const found = await webSearch(initial.id, initial.actor, params.query, signal); receipts.push(...found); return { content: [{ type: 'text' as const, text: JSON.stringify(found) }], details: {} }; },
  });
  const webReadTool = pi.defineTool({
    name: 'web_read', label: '读取公开网页', description: '通过 Exa Contents 读取一个公开 URL。', parameters: Type.Object({ url: Type.String(), fresh: Type.Optional(Type.Boolean()) }),
    execute: async (_id, params) => { const result = await webRead(initial.id, initial.actor, params.url, params.fresh ?? false, signal); receipts.push(result.receipt); return { content: [{ type: 'text' as const, text: JSON.stringify({ ...result, text: result.text.slice(0, 20_000) }) }], details: {} }; },
  });
  const settings = pi.SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: 1 } });
  const loader = new pi.DefaultResourceLoader({ cwd: workspace.root, agentDir, settingsManager: settings, appendSystemPrompt: ['你是珠珠与小花共同使用的私人健身 Coding Agent，显示名称是“饲养员”。使用工作区 AGENTS.md 的规则，回答简洁、诚实、使用中文。'] });
  await loader.reload();
  const modelRuntime = await pi.ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath });
  await modelRuntime.setRuntimeApiKey(config.modelProvider, config.modelKey);
  const model = modelRuntime.getModel(config.modelProvider, config.modelId);
  if (!model) throw new Error(`Pi 未找到模型 ${config.modelProvider}/${config.modelId}`);
  const sessionManager = pi.SessionManager.continueRecent(workspace.root, sessionDir);
  const { session } = await pi.createAgentSession({ cwd: workspace.root, agentDir, modelRuntime, model, thinkingLevel: config.modelThinkingLevel, resourceLoader: loader, settingsManager: settings, sessionManager, tools: ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls', 'web_search', 'web_read'], customTools: [...createSandboxTools(pi, workspace), searchTool, webReadTool] });
  const runtime = session as unknown as PiSession;
  const images = [] as Array<{ type: 'image'; mimeType: string; data: string }>;
  for (const id of initial.attachment_ids) { const { meta, bytes } = await readAttachmentBytes(initial.actor, id); images.push({ type: 'image', mimeType: meta.mime, data: bytes.toString('base64') }); }
  let response = '';
  const unsubscribe = runtime.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') { const delta = String(event.assistantMessageEvent.delta ?? ''); response += delta; emit(initial.id, 'text_delta', { delta }); }
    else if (event.type === 'tool_execution_end') emit(initial.id, 'tool_result', { tool: event.toolName, status: event.isError ? 'error' : 'done' });
  });
  const abort = () => { void runtime.abort(); }; signal.addEventListener('abort', abort, { once: true });
  try {
    const prompt = `可信请求上下文：actor=${initial.actor}（${PERSON_LABEL[initial.actor]}），request_id=${initial.id}，当前日期=${businessDate()}，data_base_revision=${workspace.dataBaseRevision}，app_base_revision=${workspace.appBaseRevision}。\n附件位于 inbox/，且已作为图像输入传入。直接读写 data/ 或 app/ 完成任务；不要声称已保存或已发布，宿主 Finalizer 会在你结束后处理。\n\n用户消息：${initial.text || '（仅发送了图片，请先询问用途）'}`;
    await runtime.prompt(prompt, { images });
    const data = initial.committed_revision ? null : await finalizeDataWorkspace(workspace, initial.actor, initial.id, initial.attachment_ids);
    if (data) {
      const saved = await loadRequest(initial.id); saved.committed_revision = data.revision; await saveRequest(saved);
      const dated = data.paths.map((name) => /^(?:logs|plans)\/(\d{4}-\d{2}-\d{2})/.exec(name)?.[1]).find(Boolean);
      const named = data.paths.map((name) => /(?:people\/|logs\/\d{4}-\d{2}-\d{2}\/|memory\/)(zhuzhu|xiaohua)/.exec(name)?.[1] as PersonId | undefined).find(Boolean);
      const receipt: ToolReceipt = { type: 'data', status: 'saved', subject: named ?? initial.actor, date: dated ?? businessDate(), summary: `已保存：${data.paths.join('、')}`, revision: data.revision }; receipts.push(receipt); emit(initial.id, 'data_committed', receipt);
    }
    let ui: Awaited<ReturnType<typeof importUiWorkspace>> = { job: null, ignored: [] };
    try { ui = await importUiWorkspace(initial.actor, initial.id, initial.text.slice(0, 120) || '更新前端', workspace.app, workspace.appBaseRevision); }
    catch (error) { receipts.push({ type: 'ui', status: 'failed', job_id: 'host-finalizer', summary: error instanceof Error ? error.message : '前端候选处理失败' }); }
    if (ui.job) { const receipt: ToolReceipt = { type: 'ui', status: ui.job.status, job_id: ui.job.id, summary: ui.job.error ?? ui.job.summary, preview_url: ui.job.status === 'passed' ? `${config.previewOrigin.replace(/\/$/, '')}/candidates/${ui.job.id}/` : undefined }; receipts.push(receipt); emit(initial.id, 'tool_result', { tool: 'host_finalizer', status: ui.job.status }); }
    if (ui.ignored.length) receipts.push({ type: 'ui', status: 'not_publishable', job_id: 'isolated-workspace', summary: `运行时 Agent 不能发布这些路径：${ui.ignored.join('、')}` });
    const record = await loadRequest(initial.id); if (ui.job) record.app_candidate_id = ui.job.id;
    record.messages.push({ id: randomUUID(), role: 'assistant', text: response || '模型已结束本轮，但没有返回文字。', attachment_ids: [], receipts, created_at: new Date().toISOString(), status: 'complete' }); await saveRequest(record);
  } finally { unsubscribe(); signal.removeEventListener('abort', abort); runtime.dispose(); }
}
