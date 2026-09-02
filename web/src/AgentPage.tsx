import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import {
  AssistantRuntimeProvider, AttachmentPrimitive, ComposerPrimitive, useExternalStoreRuntime, type AttachmentAdapter, type ThreadMessageLike,
} from '@assistant-ui/react';
import type { AppendMessage } from '@assistant-ui/react';
import type { Bootstrap, ThreadMessage, ToolReceipt } from '../../shared/contracts';
import { PERSON_LABEL } from '../../shared/contracts';
import { api, getThread } from './api';
import { CheckIcon, DumbbellIcon, MealIcon, PaperclipIcon, PlusIcon, SendIcon, StopIcon } from './icons';

type RequestResponse = { request_id: string; status: string; existing: boolean };
const AGENT_NAME = '饲养员';

export function safeExternalUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function MarkdownText({ text }: { text: string }) {
  return <div className="message-text markdown-text"><Markdown skipHtml components={{
    a: ({ href, children }) => {
      const safe = safeExternalUrl(href);
      return safe ? <a href={safe} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
    },
    img: ({ alt }) => <span className="markdown-image">{alt ? `[图片：${alt}]` : '[图片]'}</span>,
  }}>{text}</Markdown></div>;
}

function Receipt({ receipt }: { receipt: ToolReceipt }) {
  if (receipt.type === 'data') return <div className="receipt data-receipt"><div className="receipt-title"><span><CheckIcon/>已保存</span></div><dl><div><dt>人物</dt><dd>{PERSON_LABEL[receipt.subject]}</dd></div><div><dt>日期</dt><dd>{receipt.date}</dd></div><div><dt>内容</dt><dd>{receipt.summary}</dd></div></dl></div>;
  if (receipt.type === 'source') { const url = safeExternalUrl(receipt.url); return <div className="receipt source-receipt"><span>来源 · {receipt.status === 'read' ? '已阅读全文' : '搜索片段'}</span>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{receipt.title}</a> : <strong>{receipt.title}</strong>}{receipt.snippet ? <p>{receipt.snippet}</p> : null}</div>; }
  return <UiReceipt receipt={receipt}/>;
}

function UiReceipt({ receipt }: { receipt: Extract<ToolReceipt, { type: 'ui' }> }) {
  const [status, setStatus] = useState(receipt.status); const [publishing, setPublishing] = useState(false); const [failure, setFailure] = useState('');
  async function publish() {
    setPublishing(true); setFailure('');
    try { await api(`/api/ui-jobs/${receipt.job_id}/publish`, { method: 'POST', body: '{}' }); setStatus('published'); setPublishing(false); }
    catch (error) { setFailure(error instanceof Error ? error.message : '发布失败'); setPublishing(false); }
  }
  const statusLabel: Record<string, string> = { editing: '编辑中', checking: '检查中', passed: '可以预览', failed: '需要调整', published: '已发布' };
  return <div className="receipt ui-receipt"><span>界面更新 · {statusLabel[status] ?? status}</span><strong>{receipt.summary}</strong><div className="receipt-actions">{receipt.preview_url ? <a href={receipt.preview_url} target="_blank" rel="noopener noreferrer">查看预览</a> : null}{status === 'passed' ? <button type="button" onClick={publish} disabled={publishing}>{publishing ? '发布中…' : '发布'}</button> : null}{status === 'published' ? <button type="button" onClick={() => window.location.reload()}>刷新页面</button> : null}</div>{failure ? <small role="alert">{failure}</small> : null}</div>;
}

const progressLabel = (tool?: string) => ({ web_search: '正在搜索资料', web_read: '正在阅读资料', host_finalizer: '正在保存', read: '正在查看内容', write: '正在整理内容', edit: '正在调整内容', bash: '正在检查结果', grep: '正在查找内容', find: '正在查找内容', ls: '正在查看文件' })[tool ?? ''] ?? '正在处理';

function MessageRow({ message, actor }: { message: ThreadMessage; actor: Bootstrap['actor'] }) {
  const isUser = message.role === 'user';
  return <article className={`message-row ${isUser ? `user-message ${actor}` : 'assistant-message'}`}>
    <div className={`avatar ${isUser ? actor : 'agent'}`}>{isUser ? PERSON_LABEL[actor].slice(0, 1) : '饲'}</div>
    <div className="message-body"><div className="message-meta"><strong>{isUser ? PERSON_LABEL[actor] : AGENT_NAME}</strong><time>{new Date(message.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div>
      {message.attachment_ids.length ? <div className="sent-attachments">{message.attachment_ids.map((id) => <img key={id} src={`/api/uploads/${id}`} alt="用户上传的图片" />)}</div> : null}
      {message.text ? isUser ? <p className="message-text">{message.text}</p> : <MarkdownText text={message.text}/> : null}
      {message.receipts.map((receipt, index) => <Receipt key={`${receipt.type}-${index}`} receipt={receipt}/>)}
    </div>
  </article>;
}

function AttachmentChip() { return <div className="attachment-chip"><AttachmentPrimitive.unstable_Thumb/><AttachmentPrimitive.Name/><AttachmentPrimitive.Remove aria-label="移除附件">×</AttachmentPrimitive.Remove></div>; }

function AgentRuntime({ bootstrap, initialText }: { bootstrap: Bootstrap; initialText: string }) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]); const [running, setRunning] = useState(false); const [activeRequest, setActiveRequest] = useState<string | null>(null); const [error, setError] = useState('');
  const [streamText, setStreamText] = useState(''); const [toolProgress, setToolProgress] = useState<string[]>([]); const [liveReceipt, setLiveReceipt] = useState<ToolReceipt | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => { const value = await getThread(); setMessages(value.messages); }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' }); }, [messages]);

  const watch = useCallback(async (id: string) => {
    setRunning(true); setActiveRequest(id); setStreamText(''); setToolProgress([]); setLiveReceipt(null);
    const outcome = await new Promise<'done' | 'disconnected'>((resolve) => {
      const stream = new EventSource(`/api/requests/${id}/events`);
      const finish = (value: 'done' | 'disconnected') => { stream.close(); resolve(value); };
      stream.addEventListener('text_delta', (event) => { const value = JSON.parse((event as MessageEvent).data) as { delta?: string }; if (value.delta) setStreamText((current) => current + value.delta); });
      stream.addEventListener('tool_result', (event) => { const value = JSON.parse((event as MessageEvent).data) as { tool?: string }; if (value.tool) setToolProgress((current) => [...current.slice(-2), progressLabel(value.tool)]); });
      stream.addEventListener('data_committed', (event) => setLiveReceipt(JSON.parse((event as MessageEvent).data) as ToolReceipt));
      stream.addEventListener('done', () => finish('done')); stream.onerror = () => finish('disconnected');
    });
    let terminal: { status: string; error: string | null } | null = null;
    if (outcome === 'disconnected') {
      for (;;) {
        const request = await api<{ status: string; error: string | null }>(`/api/requests/${id}`);
        if (['done', 'error', 'cancelled', 'interrupted'].includes(request.status)) { terminal = request; break; }
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
      }
    } else terminal = await api<{ status: string; error: string | null }>(`/api/requests/${id}`);
    if (terminal && ['error', 'interrupted'].includes(terminal.status)) setError(terminal.error ?? '请求未完成');
    await refresh(); setRunning(false); setActiveRequest(null); setStreamText(''); setToolProgress([]); setLiveReceipt(null);
  }, [refresh]);

  const attachmentAdapter = useMemo<AttachmentAdapter>(() => ({
    accept: 'image/jpeg,image/png,image/webp',
    async add({ file }) { return { id: crypto.randomUUID(), type: 'image', name: file.name, contentType: file.type, file, status: { type: 'requires-action', reason: 'composer-send' } }; },
    async send(attachment) {
      const form = new FormData(); form.append('file', attachment.file);
      const result = await api<{ id: string; mime: string; url: string }>('/api/uploads', { method: 'POST', body: form });
      return { ...attachment, id: result.id, contentType: result.mime, status: { type: 'complete' }, content: [{ type: 'image', image: result.url }] };
    },
    async remove() { /* draft removal does not delete a reusable upload */ },
  }), []);

  const onNew = useCallback(async (message: AppendMessage) => {
    const text = message.content.filter((part): part is { type: 'text'; text: string } => part.type === 'text').map((part) => part.text).join('\n').trim();
    const attachmentIds = message.role === 'user' ? (message.attachments ?? []).map((attachment) => attachment.id) : [];
    setError('');
    try {
      const result = await api<RequestResponse>('/api/messages', { method: 'POST', body: JSON.stringify({ client_request_id: crypto.randomUUID(), text, attachment_ids: attachmentIds }) });
      await refresh(); await watch(result.request_id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '发送失败'); setRunning(false); throw reason; }
  }, [refresh, watch]);

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message): ThreadMessageLike => ({ id: message.id, role: message.role, content: [{ type: 'text', text: message.text }], createdAt: new Date(message.created_at), status: message.role === 'assistant' ? (message.status === 'error' ? { type: 'incomplete', reason: 'error' } : message.status === 'running' ? { type: 'running' } : { type: 'complete', reason: 'stop' }) : undefined }),
    onNew, onCancel: activeRequest ? async () => { await api(`/api/requests/${activeRequest}/cancel`, { method: 'POST', body: '{}' }); } : undefined,
    isRunning: running, adapters: { attachments: attachmentAdapter },
  });
  useEffect(() => { if (initialText) runtime.thread.composer.setText(initialText); }, [initialText, runtime]);

  async function newThread() { if (running || !confirm('开始新会话？当前内容仍会保留。')) return; await api('/api/thread/new', { method: 'POST', body: '{}' }); runtime.thread.reset(); setMessages([]); }
  const used = bootstrap.web.budget.used_microusd / 1_000_000;
  return <AssistantRuntimeProvider runtime={runtime}>
    <main className="agent-page">
      <aside className="thread-rail"><button className="new-thread" onClick={newThread}><PlusIcon/>新会话</button><div className="thread-item active"><span className={`avatar ${bootstrap.actor}`}>{PERSON_LABEL[bootstrap.actor].slice(0, 1)}</span><div><strong>{PERSON_LABEL[bootstrap.actor]}</strong><small>这次会话</small></div></div><div className="budget-card"><span>本月联网用量</span><b>${used.toFixed(3)} / ${(bootstrap.web.budget.stop_microusd / 1_000_000).toFixed(0)}</b><div><i style={{ width: `${Math.min(100, used / (bootstrap.web.budget.stop_microusd / 1_000_000) * 100)}%` }}/></div><small>{bootstrap.web.configured ? (bootstrap.web.budget.stopped ? '本月额度已用完' : '珠珠与小花共用') : '联网暂不可用'}</small></div></aside>
      <section className="conversation"><div className="conversation-scroll" ref={viewport}>{messages.length ? messages.map((message) => <MessageRow key={message.id} message={message} actor={bootstrap.actor}/>) : <div className="conversation-empty"><h1>想记录什么？</h1><p>饮食、训练、计划，直接告诉饲养员。</p><div className="conversation-suggestions"><button onClick={() => runtime.thread.composer.setText('帮我记一顿饭：')}><MealIcon/>记一顿饭</button><button onClick={() => runtime.thread.composer.setText('帮我安排一次训练：')}><DumbbellIcon/>安排训练</button></div></div>}{running && (streamText || toolProgress.length || liveReceipt) ? <article className="message-row assistant-message live-message"><div className="avatar agent">饲</div><div className="message-body"><div className="message-meta"><strong>{AGENT_NAME}</strong><span>处理中</span></div>{streamText ? <MarkdownText text={streamText}/> : null}{toolProgress.map((item, index) => <small className="tool-progress" key={`${item}-${index}`}>{item}</small>)}{liveReceipt ? <Receipt receipt={liveReceipt}/> : null}</div></article> : null}{running ? <div className="thinking-row"><span/><span/><span/>正在整理</div> : null}</div>
        <ComposerPrimitive.Root className="composer-shell">
          <ComposerPrimitive.Attachments components={{ Attachment: AttachmentChip }}/>
          <ComposerPrimitive.Input className="composer-input" placeholder={bootstrap.agent.configured ? `给${AGENT_NAME}发消息…` : '当前 Agent 不可用'} rows={2} disabled={!bootstrap.agent.configured}/>
          <div className="composer-actions"><ComposerPrimitive.AddAttachment className="icon-button" aria-label="添加图片" disabled={!bootstrap.agent.configured}><PaperclipIcon/></ComposerPrimitive.AddAttachment><span>最多 4 张图片</span><div className="composer-buttons"><ComposerPrimitive.Cancel className="secondary-button"><StopIcon/>停止</ComposerPrimitive.Cancel><ComposerPrimitive.Send className="send-button" disabled={!bootstrap.agent.configured}><SendIcon/>发送</ComposerPrimitive.Send></div></div>
        </ComposerPrimitive.Root>
        {!bootstrap.agent.configured ? <p className="composer-error" role="status">{bootstrap.agent.reason}</p> : null}
        {error ? <p className="composer-error" role="alert">{error}</p> : null}
      </section>
    </main>
  </AssistantRuntimeProvider>;
}

export function AgentPage(props: { bootstrap: Bootstrap; initialText: string }) { return <AgentRuntime {...props}/>; }
