import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { PersonId } from '../shared/contracts.js';
import { config } from './config.js';
import { filesystemChanges } from './agent-workspace.js';
import { loadRequest, saveRequest } from './requests.js';
import { PODMAN_KEEP_ID } from './podman.js';

export type UiJob = {
  id: string; actor: PersonId; request_id: string; branch: string; worktree: string; summary: string;
  status: 'editing' | 'checking' | 'passed' | 'failed' | 'published'; created_at: string; updated_at: string;
  base_revision: string; source_hash: string | null; artifact_hash: string | null; checks: string[]; error: string | null;
};
export type Release = { job_id: string; source_revision: string; artifact_path: string; artifact_hash: string };
export type Deployment = { current: Release | null; previous: Release | null; updated_at: string };
type UiOperation = { kind: 'publish' | 'rollback'; id: string; base_revision: string; target: Release; previous: Release | null; revision?: string };

const jobsDir = () => path.join(config.runtimeDir, 'ui-jobs');
const worktreesDir = () => path.join(config.runtimeDir, 'ui-worktrees');
const deploymentPath = () => path.join(config.runtimeDir, 'deployment.json');
const operationPath = () => path.join(config.runtimeDir, 'deployment-operation.json');

function command(bin: string, args: string[], cwd: string, timeout = 15 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = bin === 'git' ? { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } : { ...process.env, GIT_CONFIG_NOSYSTEM: '1' };
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env });
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
async function markReceiptPublished(job: UiJob): Promise<void> {
  try { const request = await loadRequest(job.request_id); for (const message of request.messages) for (const receipt of message.receipts) if (receipt.type === 'ui' && receipt.job_id === job.id) receipt.status = 'published'; await saveRequest(request); } catch { /* request recovery remains independent */ }
}
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

export function uiSandboxContainerArgs(workspace: string, image: string): string[] {
  const pnpm = 'pnpm --config.verify-deps-before-run=false';
  return ['run', '--rm', '--network=none', PODMAN_KEEP_ID, '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=1g', '--cpus=2', '-v', `${workspace}:/workspace:Z`, '-w', '/workspace', image, 'sh', '-lc', `test -d /opt/project/node_modules || { echo "沙箱镜像缺少 /opt/project/node_modules" >&2; exit 127; }; ln -s /opt/project/node_modules /workspace/node_modules && ${pnpm} exec tsc -p tsconfig.web.json --noEmit && ${pnpm} exec vite build && cp -R dist/web .candidate-production && VITE_PREVIEW_MODE=true ${pnpm} exec vite build`];
}

export async function beginUiJob(actor: PersonId, requestId: string, summary: string, requestedBase?: string): Promise<UiJob> {
  if (!config.uiSandboxImage) throw new Error('未配置固定 UI_SANDBOX_IMAGE，前端代码执行已关闭');
  const baseRevision = requestedBase ?? await currentUiSourceRevision();
  const id = randomUUID(); const branch = `ui/${id}`; const worktree = path.join(worktreesDir(), id);
  await mkdir(worktreesDir(), { recursive: true });
  await command('git', ['worktree', 'add', '-b', branch, worktree, baseRevision], config.appRepo);
  const now = new Date().toISOString();
  const job: UiJob = { id, actor, request_id: requestId, branch, worktree, summary, status: 'editing', created_at: now, updated_at: now, base_revision: baseRevision, source_hash: null, artifact_hash: null, checks: [], error: null };
  await saveJob(job); return job;
}

export async function importUiWorkspace(actor: PersonId, requestId: string, summary: string, source: string, base: string): Promise<{ job: UiJob | null; ignored: string[] }> {
  if (!await command('git', ['status', '--porcelain', '--untracked-files=all'], source)) return { job: null, ignored: [] };
  const job = await beginUiJob(actor, requestId, summary, base);
  const ignoredPath = (name: string) => ['.git', 'node_modules', 'dist', '.local'].some((part) => name === part || name.startsWith(`${part}/`));
  const changed = await filesystemChanges(job.worktree, source, () => true, ignoredPath); const web = changed.filter(allowedUiPath); const ignored = changed.filter((name) => !allowedUiPath(name));
  if (!web.length) { await command('git', ['worktree', 'remove', '--force', job.worktree], config.appRepo); await rm(path.join(jobsDir(), `${job.id}.json`), { force: true }); return { job: null, ignored }; }
  try {
    for (const relative of web) {
      const from = path.join(source, relative); const to = path.join(job.worktree, relative);
      try { const info = await lstat(from); if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${relative} 必须是普通文件`); await mkdir(path.dirname(to), { recursive: true }); await cp(from, to); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') await rm(to, { force: true }); else throw error; }
    }
    return { job: await checkUiJob(actor, job.id), ignored };
  } catch (error) {
    job.status = 'failed'; job.error = error instanceof Error ? error.message : '候选 diff 应用失败'; await saveJob(job);
    return { job, ignored };
  }
}

export async function checkUiJob(actor: PersonId, id: string): Promise<UiJob> {
  const job = await loadUiJob(id); if (job.actor !== actor) throw new Error('无权检查此候选'); if (!config.uiSandboxImage) throw new Error('UI 沙箱不可用');
  job.status = 'checking'; job.error = null; await saveJob(job);
  const temporary = path.join(config.runtimeDir, 'ui-checks', `${id}-${randomUUID()}`); await mkdir(temporary, { recursive: true });
  try {
    await cp(job.worktree, temporary, { recursive: true, filter: (source) => !source.includes(`${path.sep}.git`) && !source.includes(`${path.sep}node_modules`) && !source.includes(`${path.sep}.local`) });
    const output = await command('podman', uiSandboxContainerArgs(temporary, config.uiSandboxImage), config.appRepo);
    const sourceHash = await treeHash(job.worktree); const built = path.join(temporary, 'dist', 'web');
    await stat(built); const release = path.join(config.releasesDir, 'candidates', id); await rm(release, { recursive: true, force: true }); await mkdir(path.dirname(release), { recursive: true }); await cp(built, release, { recursive: true });
    await cp(path.join(temporary, '.candidate-production'), path.join(release, 'production'), { recursive: true });
    job.status = 'passed'; job.source_hash = sourceHash; job.artifact_hash = await directoryHash(path.join(release, 'production')); job.checks = ['web typecheck', 'production build', 'preview build']; job.error = output.slice(-4_000) || null;
  } catch (error) { job.status = 'failed'; job.error = error instanceof Error ? error.message : '检查失败'; }
  finally { await rm(temporary, { recursive: true, force: true }); await saveJob(job); }
  return job;
}

async function readDeployment(): Promise<Deployment> {
  try {
    const value = JSON.parse(await readFile(deploymentPath(), 'utf8')) as any;
    if (typeof value.current === 'string') return { current: value.source_revision && value.artifact_hash ? { job_id: path.basename(value.current), source_revision: value.source_revision, artifact_path: value.current, artifact_hash: value.artifact_hash } : null, previous: null, updated_at: value.updated_at ?? new Date().toISOString() };
    return value as Deployment;
  } catch { return { current: null, previous: null, updated_at: new Date().toISOString() }; }
}
export async function currentUiSourceRevision(): Promise<string> { return command('git', ['rev-parse', 'HEAD'], config.appRepo); }
async function findOperationRevision(operation: UiOperation): Promise<string | null> {
  if (operation.revision) return operation.revision;
  const trailer = operation.kind === 'publish' ? `Ui-Job-Id: ${operation.id}` : `Ui-Rollback-Id: ${operation.id}`;
  const found = await command('git', ['log', '-n', '200', '--format=%H', '--fixed-strings', '--grep', trailer], config.appRepo).catch(() => ''); return found.split('\n').find(Boolean) ?? null;
}
export async function recoverUiDeployment(): Promise<void> {
  let operation: UiOperation; try { operation = JSON.parse(await readFile(operationPath(), 'utf8')) as UiOperation; } catch { return; }
  const revision = await findOperationRevision(operation);
  if (!revision) { await rm(operationPath(), { force: true }); return; }
  if (await directoryHash(operation.target.artifact_path) !== operation.target.artifact_hash) throw new Error('待恢复的 UI 产物校验失败');
  const merged = await command('git', ['merge-base', '--is-ancestor', revision, 'HEAD'], config.appRepo).then(() => true).catch(() => false);
  if (!merged) { if (await command('git', ['rev-parse', 'HEAD'], config.appRepo) !== operation.base_revision) throw new Error('UI 恢复时应用源码已分叉'); await command('git', ['merge', '--ff-only', revision], config.appRepo); }
  await atomic(deploymentPath(), { current: { ...operation.target, source_revision: revision }, previous: operation.previous, updated_at: new Date().toISOString() } satisfies Deployment);
  if (operation.kind === 'publish') { const job = await loadUiJob(operation.id); job.status = 'published'; await saveJob(job); await markReceiptPublished(job); }
  await rm(operationPath(), { force: true });
}
export async function publishUiJob(actor: PersonId, id: string): Promise<UiJob> {
  await recoverUiDeployment(); const job = await loadUiJob(id); if (job.actor !== actor) throw new Error('无权发布此候选');
  if ((await readDeployment()).current?.job_id === id) { job.status = 'published'; await saveJob(job); await markReceiptPublished(job); return job; }
  if (job.status !== 'passed' || !job.source_hash || !job.artifact_hash) throw new Error('候选尚未通过固定检查');
  if (await treeHash(job.worktree) !== job.source_hash) throw new Error('候选源码在检查后已改变，必须重新检查');
  if (await command('git', ['rev-parse', 'HEAD'], config.appRepo) !== job.base_revision) throw new Error('应用源码已更新，请重新生成候选');
  const previous = await readDeployment(); const target: Release = { job_id: id, source_revision: '', artifact_path: path.join(config.releasesDir, 'candidates', id, 'production'), artifact_hash: job.artifact_hash };
  const operation: UiOperation = { kind: 'publish', id, base_revision: job.base_revision, target, previous: previous.current }; await atomic(operationPath(), operation);
  await command('git', ['add', '-A', '--', 'web'], job.worktree);
  await command('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', `ui: ${job.summary}`, '-m', `Ui-Job-Id: ${id}`], job.worktree);
  operation.revision = await command('git', ['rev-parse', 'HEAD'], job.worktree); await atomic(operationPath(), operation);
  await command('git', ['merge', '--ff-only', job.branch], config.appRepo);
  const revision = await command('git', ['rev-parse', 'HEAD'], config.appRepo);
  const deployment: Deployment = { current: { ...target, source_revision: revision }, previous: previous.current, updated_at: new Date().toISOString() };
  await atomic(deploymentPath(), deployment); job.status = 'published'; await saveJob(job); await markReceiptPublished(job); await rm(operationPath(), { force: true }); return job;
}

export async function rollbackUi(): Promise<Deployment> {
  await recoverUiDeployment(); const deployment = await readDeployment(); if (!deployment.previous) throw new Error('没有可回滚的上一个前端产物');
  if (await directoryHash(deployment.previous.artifact_path) !== deployment.previous.artifact_hash) throw new Error('上一个前端产物校验失败，拒绝回滚');
  const operationId = randomUUID(); const head = await command('git', ['rev-parse', 'HEAD'], config.appRepo); const operation: UiOperation = { kind: 'rollback', id: operationId, base_revision: head, target: deployment.previous, previous: deployment.current }; await atomic(operationPath(), operation);
  const worktree = path.join(worktreesDir(), `rollback-${operationId}`); const branch = `rollback/${operationId}`;
  await command('git', ['worktree', 'add', '-b', branch, worktree, head], config.appRepo);
  try {
    for (const relative of ['web/src', 'web/public']) {
      await rm(path.join(worktree, relative), { recursive: true, force: true });
      await command('git', ['checkout', deployment.previous.source_revision, '--', relative], worktree).catch(() => undefined);
    }
    await command('git', ['add', '-A', '--', 'web'], worktree);
    await command('git', ['commit', '-m', `ui: rollback to ${deployment.previous.job_id}`, '-m', `Ui-Rollback-Id: ${operationId}`], worktree);
    const revision = await command('git', ['rev-parse', 'HEAD'], worktree); operation.revision = revision; await atomic(operationPath(), operation); await command('git', ['merge', '--ff-only', revision], config.appRepo);
    const restored = { ...deployment.previous, source_revision: revision };
    const next: Deployment = { current: restored, previous: deployment.current, updated_at: new Date().toISOString() }; await atomic(deploymentPath(), next); await rm(operationPath(), { force: true }); return next;
  } finally { await command('git', ['worktree', 'remove', '--force', worktree], config.appRepo).catch(() => undefined); }
}
export async function currentWebRoot(): Promise<string> {
  const deployment = await readDeployment(); return deployment.current?.artifact_path ?? path.join(config.appRepo, 'dist', 'web');
}
export async function deploymentInfo(): Promise<Deployment> { return readDeployment(); }
