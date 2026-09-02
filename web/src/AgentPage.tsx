import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AssistantRuntimeProvider, AttachmentPrimitive, ComposerPrimitive, useExternalStoreRuntime, type AttachmentAdapter, type ThreadMessageLike,
} from '@assistant-ui/react';
import type { AppendMessage } from '@assistant-ui/react';
import type { Bootstrap, ThreadMessage, ToolReceipt } from '../../shared/contracts';
import { PERSON_LABEL } from '../../shared/contracts';
import { api, getThread } from './api';
import { CheckIcon, PaperclipIcon, PlusIcon, SendIcon } from './icons';

type RequestResponse = { request_id: string; status: string; existing: boolean };
const AGENT_NAME = '饲养员';

function Receipt({ receipt }: { receipt: ToolReceipt }) {
  if (receipt.type === 'data') return <div className="receipt data-receipt"><div className="receipt-title"><span><CheckIcon/>已保存</span><code>{receipt.revision.slice(0, 8)}</code></div><dl><div><dt>人物</dt><dd>{PERSON_LABEL[receipt.subject]}</dd></div><div><dt>日期</dt><dd>{receipt.date}</dd></div><div><dt>变更</dt><dd>{receipt.summary}</dd></div></dl></div>;
  if (receipt.type === 'source') return <div className="receipt source-receipt"><span>来源 · {receipt.status === 'read' ? '已阅读全文' : '搜索片段'}</span><a href={receipt.url} target="_blank" rel="noopener noreferrer">{receipt.title}</a>{receipt.snippet ? <p>{receipt.snippet}</p> : null}</div>;
  return <div className="receipt ui-receipt"><span>界面修改 · {receipt.status}</span><strong>{receipt.summary}</strong>{receipt.preview_url ? <a href={receipt.preview_url} target="_blank" rel="noopener noreferrer">打开隔离预览</a> : null}</div>;
}

function MessageRow({ message, actor }: { message: ThreadMessage; actor: Bootstrap['actor'] }) {
  const isUser = message.role === 'user';
  return <article className={`message-row ${isUser ? 'user-message' : 'assistant-message'}`}>
    <div className={`avatar ${isUser ? actor : 'agent'}`}>{isUser ? PERSON_LABEL[actor].slice(0, 1) : '饲'}</div>
    <div className="message-body"><div className="message-meta"><strong>{isUser ? PERSON_LABEL[actor] : AGENT_NAME}</strong><time>{new Date(message.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div>
      {message.attachment_ids.length ? <div className="sent-attachments">{message.attachment_ids.map((id) => <img key={id} src={`/api/uploads/${id}`} alt="用户上传的图片" />)}</div> : null}
      {message.text ? <p className="message-text">{message.text}</p> : null}
      {message.receipts.map((receipt, index) => <Receipt key={`${receipt.type}-${index}`} receipt={receipt}/>)}
    </div>
  </article>;
}

function AttachmentChip() { return <div className="attachment-chip"><AttachmentPrimitive.unstable_Thumb/><AttachmentPrimitive.Name/><AttachmentPrimitive.Remove aria-label="移除附件">×</AttachmentPrimitive.Remove></div>; }

function AgentRuntime({ bootstrap, initialText }: { bootstrap: Bootstrap; initialText: string }) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]); const [running, setRunning] = useState(false); const [activeRequest, setActiveRequest] = useState<string | null>(null); const [error, setError] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => { const value = await getThread(); setMessages(value.messages); }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' }); }, [messages]);

  const watch = useCallback(async (id: string) => {
    setRunning(true); setActiveRequest(id);
    await new Promise<void>((resolve) => {
      const stream = new EventSource(`/api/requests/${id}/events`);
      const finish = () => { stream.close(); resolve(); };
      stream.addEventListener('done', finish); stream.addEventListener('error', finish);
      window.setTimeout(finish, 125_000);
    });
    await refresh(); setRunning(false); setActiveRequest(null);
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

  async function newThread() { if (running || !confirm('开启新会话？当前原始对话会保留，但不会继续显示在新会话中。')) return; await api('/api/thread/new', { method: 'POST', body: '{}' }); runtime.thread.reset(); setMessages([]); }
  const used = bootstrap.web.budget.used_microusd / 1_000_000;
  return <AssistantRuntimeProvider runtime={runtime}>
    <main className="agent-page">
      <aside className="thread-rail"><button className="new-thread" onClick={newThread}><PlusIcon/>新会话</button><div className="thread-item active"><span className={`avatar ${bootstrap.actor}`}>{PERSON_LABEL[bootstrap.actor].slice(0, 1)}</span><div><strong>{PERSON_LABEL[bootstrap.actor]}</strong><small>当前私人会话</small></div></div><div className="budget-card"><span>本应用估算用量</span><b>${used.toFixed(3)} / ${(bootstrap.web.budget.stop_microusd / 1_000_000).toFixed(0)}</b><div><i style={{ width: `${Math.min(100, used / (bootstrap.web.budget.stop_microusd / 1_000_000) * 100)}%` }}/></div><small>{bootstrap.web.configured ? (bootstrap.web.budget.stopped ? '已暂停新的联网请求' : '两人及代码任务共用') : bootstrap.web.reason}</small></div></aside>
      <section className="conversation"><div className="conversation-scroll" ref={viewport}>{messages.length ? messages.map((message) => <MessageRow key={message.id} message={message} actor={bootstrap.actor}/>) : <div className="conversation-empty"><h1>从一件具体的事开始</h1><p>可以记录饮食或训练、调整未来计划、上传营养标签，或查阅公开资料。计划不会自动变成实际记录。</p></div>}{running ? <div className="thinking-row"><span/><span/><span/>正在处理并等待真实工具结果</div> : null}</div>
        <ComposerPrimitive.Root className="composer-shell">
          <ComposerPrimitive.Attachments components={{ Attachment: AttachmentChip }}/>
          <ComposerPrimitive.Input className="composer-input" placeholder={`给${AGENT_NAME}发消息…`} rows={2}/>
          <div className="composer-actions"><ComposerPrimitive.AddAttachment className="icon-button" aria-label="添加图片"><PaperclipIcon/></ComposerPrimitive.AddAttachment><span>JPEG · PNG · 静态 WebP，最多 4 张</span><div className="composer-buttons"><ComposerPrimitive.Cancel className="secondary-button">停止</ComposerPrimitive.Cancel><ComposerPrimitive.Send className="send-button"><SendIcon/>发送</ComposerPrimitive.Send></div></div>
        </ComposerPrimitive.Root>
        {error ? <p className="composer-error" role="alert">{error}</p> : null}
      </section>
    </main>
  </AssistantRuntimeProvider>;
}

export function AgentPage(props: { bootstrap: Bootstrap; initialText: string }) { return <AgentRuntime {...props}/>; }
