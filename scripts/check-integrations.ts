import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Type } from 'typebox';
import sharp from 'sharp';

const modelKey = process.env.MODEL_API_KEY; const exaKey = process.env.EXA_API_KEY;
if (!modelKey || !exaKey) throw new Error('需要 MODEL_API_KEY 和 EXA_API_KEY');
const provider = process.env.MODEL_PROVIDER ?? 'openai'; const modelId = process.env.MODEL_ID ?? 'gpt-5.6-terra'; const baseUrl = process.env.MODEL_BASE_URL;
if (!baseUrl) throw new Error('需要 MODEL_BASE_URL');

const temporary = await mkdtemp(path.join(os.tmpdir(), 'fitness-integrations-'));
try {
  process.env.RUNTIME_DIR = path.join(temporary, 'runtime'); process.env.DATA_REPO = path.join(temporary, 'data');
  const agentDir = path.join(temporary, 'agent'); await mkdir(agentDir, { recursive: true });
  const modelsPath = path.join(agentDir, 'models.json'); await writeFile(modelsPath, JSON.stringify({ providers: { [provider]: { baseUrl } } }));
  const pi = await import('@earendil-works/pi-coding-agent'); const runtime = await pi.ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath });
  await runtime.setRuntimeApiKey(provider, modelKey); const model = runtime.getModel(provider, modelId); if (!model) throw new Error(`Pi 未找到模型 ${provider}/${modelId}`);
  let toolCalled = false; let answer = ''; const events = new Set<string>();
  const probe = pi.defineTool({ name: 'integration_probe', label: '集成探针', description: '测试工具调用。', parameters: Type.Object({ value: Type.String() }), execute: async () => { toolCalled = true; return { content: [{ type: 'text' as const, text: 'PROBE_OK' }], details: {} }; } });
  const { session } = await pi.createAgentSession({ cwd: temporary, agentDir, modelRuntime: runtime, model, thinkingLevel: 'high', sessionManager: pi.SessionManager.inMemory(), tools: ['integration_probe'], customTools: [probe] });
  const unsubscribe = session.subscribe((event: any) => { events.add(`${event.type}:${event.assistantMessageEvent?.type ?? ''}`); if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') answer += String(event.assistantMessageEvent.delta ?? ''); });
  const redPixel = (await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer()).toString('base64');
  await session.prompt('先调用 integration_probe，参数 value=ok；再判断图片主色，只回复 PI_OK RED。', { images: [{ type: 'image', mimeType: 'image/png', data: redPixel }] });
  const last = [...session.state.messages].reverse().find((message: any) => message.role === 'assistant') as any;
  if (!answer && Array.isArray(last?.content)) answer = last.content.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('');
  unsubscribe(); session.dispose();
  const modelResult = { model: model.id, baseUrl: model.baseUrl, thinking: 'high', toolCalled, answer: answer.trim(), events: [...events], stopReason: last?.stopReason ?? null, error: last?.errorMessage ?? null, contentTypes: Array.isArray(last?.content) ? last.content.map((part: any) => part.type) : [] };
  if (!toolCalled || !modelResult.answer) { console.log(JSON.stringify(modelResult)); throw new Error('Pi 模型、图像或工具调用未完成'); }

  const { createRequest, loadRequest } = await import('../server/requests.js'); const { webRead, webSearch } = await import('../server/exa.js');
  const requestId = `integration_${Date.now()}`; await createRequest({ id: requestId, actor: 'zhuzhu', text: '虚构公开资料集成测试', attachment_ids: [], attachment_hashes: [] });
  const sources = await webSearch(requestId, 'zhuzhu', 'OpenAI Responses API official documentation', AbortSignal.timeout(30_000));
  const read = await webRead(requestId, 'zhuzhu', 'https://developers.openai.com/api/docs/models/gpt-5.6-terra', true, AbortSignal.timeout(30_000)); const record = await loadRequest(requestId);
  console.log(JSON.stringify({ ...modelResult, searchResults: sources.length, readChars: read.text.length, webCalls: record.web_calls.map(({ kind, status, provider_request_id }) => ({ kind, status, provider_request_id })) }));
} finally { await rm(temporary, { recursive: true, force: true }); }
