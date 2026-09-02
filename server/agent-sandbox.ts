import { spawn } from 'node:child_process';
import path from 'node:path';
import type * as Pi from '@earendil-works/pi-coding-agent';
import { config } from './config.js';
import type { AgentWorkspace } from './agent-workspace.js';

type PiModule = typeof Pi;
type ExecResult = { stdout: Buffer; stderr: Buffer; exitCode: number | null };

export const bashTimeoutMs = (seconds?: number): number => Math.min(seconds === undefined ? 120_000 : Math.max(0, seconds) * 1_000, 15 * 60_000);

export function sandboxContainerArgs(workspace: AgentWorkspace, image: string, command: string[]): string[] {
  return ['run', '--rm', '--network=none', '--read-only', '--userns=keep-id', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--pids-limit=256', '--memory=1g', '--cpus=2', '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m', '-e', 'HOME=/tmp/home',
    '-e', 'GIT_OPTIONAL_LOCKS=0', '-e', 'GIT_NO_REPLACE_OBJECTS=1',
    '-v', `${path.join(workspace.root, 'AGENTS.md')}:/workspace/AGENTS.md:ro,Z`, '-v', `${workspace.app}:/workspace/app:rw,Z`,
    '-v', `${path.join(workspace.app, '.git')}:/workspace/app/.git:ro,Z`, '-v', `${workspace.data}:/workspace/data:rw,Z`,
    '-v', `${path.join(workspace.data, '.git')}:/workspace/data/.git:ro,Z`, '-v', `${workspace.inbox}:/workspace/inbox:ro,Z`, '-w', '/workspace', image, ...command];
}

function execute(workspace: AgentWorkspace, command: string[], options: { input?: Buffer; signal?: AbortSignal; timeout?: number; onData?: (data: Buffer) => void } = {}): Promise<ExecResult> {
  if (!config.agentSandboxImage) throw new Error('未配置 AGENT_SANDBOX_IMAGE，原生工具已关闭');
  return new Promise((resolve, reject) => {
    const child = spawn('podman', sandboxContainerArgs(workspace, config.agentSandboxImage!, command), { stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let captured = 0; const maxCapture = 4 * 1024 * 1024;
    let timedOut = false; let cancelled = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, bashTimeoutMs(options.timeout));
    const abort = () => { cancelled = true; child.kill('SIGKILL'); }; options.signal?.addEventListener('abort', abort, { once: true });
    const collect = (target: Buffer[], chunk: Buffer) => { const data = Buffer.from(chunk); if (captured < maxCapture) { const kept = data.subarray(0, maxCapture - captured); target.push(kept); captured += kept.byteLength; } options.onData?.(data); };
    child.stdout!.on('data', (chunk) => collect(stdout, chunk));
    child.stderr!.on('data', (chunk) => collect(stderr, chunk));
    child.on('error', (error) => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); reject(error); });
    child.on('close', (exitCode) => {
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
      if (timedOut) reject(new Error(`沙箱命令超时（${bashTimeoutMs(options.timeout)} ms）`));
      else if (cancelled) reject(new Error('沙箱命令已取消'));
      else resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode });
    });
    if (options.input) child.stdin!.end(options.input);
  });
}

function containerPath(workspace: AgentWorkspace, absolute: string): string {
  const relative = path.relative(workspace.root, absolute);
  if (!relative || relative === '.') return '/workspace';
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('路径越出 Agent 工作区');
  return `/workspace/${relative.split(path.sep).join('/')}`;
}

async function checked(workspace: AgentWorkspace, command: string[], input?: Buffer): Promise<Buffer> {
  const result = await execute(workspace, command, { input, timeout: 60 });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString('utf8').trim() || `沙箱命令退出 ${result.exitCode}`);
  return result.stdout;
}

const text = (value: Buffer) => value.toString('utf8').slice(0, 64 * 1024).trimEnd() || '(无输出)';
function requestedPath(value: unknown): string {
  const resolved = path.posix.resolve('/workspace', typeof value === 'string' ? value : '.');
  if (resolved !== '/workspace' && !resolved.startsWith('/workspace/')) throw new Error('路径越出 Agent 工作区');
  return resolved;
}

export function createSandboxTools(pi: PiModule, workspace: AgentWorkspace): any[] {
  const read = pi.createReadToolDefinition(workspace.root, { operations: {
    readFile: (absolute) => checked(workspace, ['sh', '-c', 'cat -- "$1"', 'sh', containerPath(workspace, absolute)]),
    access: async (absolute) => { await checked(workspace, ['sh', '-c', 'test -r "$1"', 'sh', containerPath(workspace, absolute)]); },
    detectImageMimeType: async () => null,
  } });
  const write = pi.createWriteToolDefinition(workspace.root, { operations: {
    mkdir: async (absolute) => { await checked(workspace, ['sh', '-c', 'mkdir -p -- "$1"', 'sh', containerPath(workspace, absolute)]); },
    writeFile: async (absolute, content) => { await checked(workspace, ['sh', '-c', 'mkdir -p -- "$(dirname "$1")" && cat > "$1"', 'sh', containerPath(workspace, absolute)], Buffer.from(content)); },
  } });
  const edit = pi.createEditToolDefinition(workspace.root, { operations: {
    readFile: (absolute) => checked(workspace, ['sh', '-c', 'cat -- "$1"', 'sh', containerPath(workspace, absolute)]),
    writeFile: async (absolute, content) => { await checked(workspace, ['sh', '-c', 'cat > "$1"', 'sh', containerPath(workspace, absolute)], Buffer.from(content)); },
    access: async (absolute) => { await checked(workspace, ['sh', '-c', 'test -r "$1" && test -w "$1"', 'sh', containerPath(workspace, absolute)]); },
  } });
  const bash = pi.createBashToolDefinition(workspace.root, { exposeSessionEnvironment: false, operations: {
    exec: async (command, _cwd, options) => {
      const result = await execute(workspace, ['sh', '-lc', 'test -e app/node_modules || ln -s /opt/project/node_modules app/node_modules; ' + command], { signal: options.signal, timeout: options.timeout, onData: options.onData });
      return { exitCode: result.exitCode };
    },
  } });
  const grepBase = pi.createGrepToolDefinition(workspace.root);
  const grep = { ...grepBase, execute: async (_id: string, args: any, signal?: AbortSignal) => {
    const target = requestedPath(args.path);
    const command = ['rg', '--line-number', '--color=never', '--hidden', '--max-count', String(Math.max(1, args.limit ?? 100))];
    if (args.ignoreCase) command.push('--ignore-case'); if (args.literal) command.push('--fixed-strings'); if (args.glob) command.push('--glob', String(args.glob));
    command.push('--', String(args.pattern), target);
    const result = await execute(workspace, command, { signal, timeout: 60 });
    if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error(result.stderr.toString('utf8').trim() || 'grep 失败');
    return { content: [{ type: 'text' as const, text: text(result.stdout).replaceAll('/workspace/', '') }], details: {} };
  } };
  const findBase = pi.createFindToolDefinition(workspace.root);
  const find = { ...findBase, execute: async (_id: string, args: any, signal?: AbortSignal) => {
    const target = requestedPath(args.path);
    const pattern = String(args.pattern); const matcher = pattern.includes('/') ? ['-path', `*/${pattern}`] : ['-name', pattern];
    const result = await execute(workspace, ['find', target, '-path', '*/.git', '-prune', '-o', ...matcher, '-print'], { signal, timeout: 60 });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString('utf8').trim() || 'find 失败');
    const lines = result.stdout.toString('utf8').split('\n').filter(Boolean).slice(0, Math.max(1, args.limit ?? 1000));
    return { content: [{ type: 'text' as const, text: lines.map((line) => line.replace(/^\/workspace\/?/, '')).join('\n') || 'No files found matching pattern' }], details: {} };
  } };
  const lsBase = pi.createLsToolDefinition(workspace.root);
  const ls = { ...lsBase, execute: async (_id: string, args: any, signal?: AbortSignal) => {
    const target = requestedPath(args.path);
    const result = await execute(workspace, ['sh', '-c', 'ls -A1p -- "$1" | sort -f', 'sh', target], { signal, timeout: 60 });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString('utf8').trim() || 'ls 失败');
    const lines = result.stdout.toString('utf8').split('\n').filter(Boolean).slice(0, Math.max(1, args.limit ?? 500));
    return { content: [{ type: 'text' as const, text: lines.join('\n') || '(empty directory)' }], details: {} };
  } };
  return [read, write, edit, bash, grep, find, ls];
}
