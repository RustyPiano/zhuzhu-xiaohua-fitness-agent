import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { PersonId } from '../shared/contracts.js';
import { config } from './config.js';

export type UiJob = {
  id: string; actor: PersonId; request_id: string; branch: string; worktree: string; summary: string;
  status: 'editing' | 'checking' | 'passed' | 'failed' | 'published'; created_at: string; updated_at: string;
  source_hash: string | null; artifact_hash: string | null; checks: string[]; error: string | null;
};
type Deployment = { current: string | null; previous: string | null; source_revision: string | null; artifact_hash: string | null; updated_at: string };

const jobsDir = () => path.join(config.runtimeDir, 'ui-jobs');
const worktreesDir = () => path.join(config.runtimeDir, 'ui-worktrees');
const deploymentPath = () => path.join(config.runtimeDir, 'deployment.json');

function command(bin: string, args: string[], cwd: string, timeout = 15 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
    let out = ''; let err = ''; const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('命令超时')); }, timeout);
    child.stdout.on('data', (data) => { if (out.length < 100_000) out += String(data); });
    child.stderr.on('data', (data) => { if (err.length < 100_000) err += String(data); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error((err || out).trim().slice(-20_000))); });
  });
}
async function atomic(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true }); const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await rename(temp, target);
}
async function saveJob(job: UiJob): Promise<void> { job.updated_at = new Date().toISOString(); await atomic(path.join(jobsDir(), `${job.id}.json`), job); }
export async function loadUiJob(id: string): Promise<UiJob> {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('UI job ID 无效'); return JSON.parse(await readFile(path.join(jobsDir(), `${id}.json`), 'utf8')) as UiJob;
}
function allowedUiPath(relative: string): boolean {
  return !relative.startsWith('/') && !relative.includes('..') && !relative.includes('\\') && /^(web\/(src|public)\/).+/.test(relative);
}
async function treeHash(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(directory: string): Promise<void> {
    const names = (await readdir(directory)).sort();
    for (const name of names) {
      const full = path.join(directory, name); const relative = path.relative(root, full); const info = await lstat(full);
      if (info.isSymbolicLink()) throw new Error('候选前端不允许符号链接');
      if (info.isDirectory()) await visit(full); else { hash.update(relative); hash.update(await readFile(full)); }
    }
  }
  await visit(path.join(root, 'web')); return hash.digest('hex');
}

async function directoryHash(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(directory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const full = path.join(directory, name); const info = await lstat(full);
      if (info.isSymbolicLink()) throw new Error('产物不允许符号链接');
      if (info.isDirectory()) await visit(full); else { hash.update(path.relative(root, full)); hash.update(await readFile(full)); }
    }
  }
  await visit(root); return hash.digest('hex');
}

export async function beginUiJob(actor: PersonId, requestId: string, summary: string): Promise<UiJob> {
  if (!config.uiSandboxImage) throw new Error('未配置固定 UI_SANDBOX_IMAGE，前端代码执行已关闭');
  const id = randomUUID(); const branch = `ui/${id}`; const worktree = path.join(worktreesDir(), id);
  await mkdir(worktreesDir(), { recursive: true });
  await command('git', ['worktree', 'add', '-b', branch, worktree, 'main'], config.appRepo);
  const now = new Date().toISOString();
  const job: UiJob = { id, actor, request_id: requestId, branch, worktree, summary, status: 'editing', created_at: now, updated_at: now, source_hash: null, artifact_hash: null, checks: [], error: null };
  await saveJob(job); return job;
}

export async function writeUiFile(actor: PersonId, id: string, relative: string, content: string): Promise<UiJob> {
  const job = await loadUiJob(id); if (job.actor !== actor) throw new Error('无权修改此候选'); if (!allowedUiPath(relative)) throw new Error('仅允许修改 web/src 和 web/public');
  if (Buffer.byteLength(content) > 512_000) throw new Error('单个 UI 文件超过 512 KiB');
  const target = path.join(job.worktree, relative); await mkdir(path.dirname(target), { recursive: true });
  try { if ((await lstat(target)).isSymbolicLink()) throw new Error('不允许修改符号链接'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await writeFile(target, content, 'utf8'); job.status = 'editing'; job.source_hash = null; job.artifact_hash = null; job.checks = []; await saveJob(job); return job;
}

export async function checkUiJob(actor: PersonId, id: string): Promise<UiJob> {
  const job = await loadUiJob(id); if (job.actor !== actor) throw new Error('无权检查此候选'); if (!config.uiSandboxImage) throw new Error('UI 沙箱不可用');
  job.status = 'checking'; job.error = null; await saveJob(job);
  const temporary = path.join(config.runtimeDir, 'ui-checks', `${id}-${randomUUID()}`); await mkdir(temporary, { recursive: true });
  try {
    await cp(job.worktree, temporary, { recursive: true, filter: (source) => !source.includes(`${path.sep}.git`) && !source.includes(`${path.sep}node_modules`) && !source.includes(`${path.sep}.local`) });
    const output = await command('podman', ['run', '--rm', '--network=none', '--userns=keep-id', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=1g', '--cpus=2', '-v', `${temporary}:/workspace:Z`, '-w', '/workspace', config.uiSandboxImage, 'sh', '-lc', 'ln -s /opt/project/node_modules /workspace/node_modules && pnpm typecheck && pnpm test && pnpm build'], config.appRepo);
    const sourceHash = await treeHash(job.worktree); const built = path.join(temporary, 'dist', 'web');
    await stat(built); const release = path.join(config.releasesDir, 'candidates', id); await rm(release, { recursive: true, force: true }); await mkdir(path.dirname(release), { recursive: true }); await cp(built, release, { recursive: true });
    job.status = 'passed'; job.source_hash = sourceHash; job.artifact_hash = await directoryHash(built); job.checks = ['typecheck', 'unit tests', 'build']; job.error = output.slice(-4_000) || null;
  } catch (error) { job.status = 'failed'; job.error = error instanceof Error ? error.message : '检查失败'; }
  finally { await rm(temporary, { recursive: true, force: true }); await saveJob(job); }
  return job;
}

async function readDeployment(): Promise<Deployment> {
  try { return JSON.parse(await readFile(deploymentPath(), 'utf8')) as Deployment; } catch { return { current: null, previous: null, source_revision: null, artifact_hash: null, updated_at: new Date().toISOString() }; }
}
export async function publishUiJob(actor: PersonId, id: string): Promise<UiJob> {
  const job = await loadUiJob(id); if (job.actor !== actor) throw new Error('无权发布此候选'); if (job.status !== 'passed' || !job.source_hash || !job.artifact_hash) throw new Error('候选尚未通过固定检查');
  if (await treeHash(job.worktree) !== job.source_hash) throw new Error('候选源码在检查后已改变，必须重新检查');
  await command('git', ['add', '--', 'web/src', 'web/public'], job.worktree).catch(async () => command('git', ['add', '--', 'web/src'], job.worktree));
  await command('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', `ui: ${job.summary}`], job.worktree);
  await command('git', ['merge', '--ff-only', job.branch], config.appRepo);
  const revision = await command('git', ['rev-parse', 'HEAD'], config.appRepo); const previous = await readDeployment();
  const deployment: Deployment = { current: path.join(config.releasesDir, 'candidates', id), previous: previous.current, source_revision: revision, artifact_hash: job.artifact_hash, updated_at: new Date().toISOString() };
  await atomic(deploymentPath(), deployment); job.status = 'published'; await saveJob(job); return job;
}

export async function rollbackUi(): Promise<Deployment> {
  const deployment = await readDeployment(); if (!deployment.previous) throw new Error('没有可回滚的上一个前端产物');
  const next = { ...deployment, current: deployment.previous, previous: deployment.current, updated_at: new Date().toISOString() }; await atomic(deploymentPath(), next); return next;
}
export async function currentWebRoot(): Promise<string> {
  const deployment = await readDeployment(); return deployment.current ?? path.join(config.appRepo, 'dist', 'web');
}
export async function deploymentInfo(): Promise<Deployment> { return readDeployment(); }
