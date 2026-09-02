import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyLog } from '../shared/contracts.js';

const exec = promisify(execFile);
let temporary = '';

async function initApp(root: string): Promise<void> {
  await mkdir(path.join(root, 'web', 'src'), { recursive: true }); await writeFile(path.join(root, 'web', 'src', 'main.ts'), 'export {};\n');
  await exec('git', ['init', '--initial-branch=main'], { cwd: root }); await exec('git', ['config', 'user.name', 'Test'], { cwd: root }); await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await exec('git', ['add', '.'], { cwd: root }); await exec('git', ['commit', '-m', 'initial'], { cwd: root });
}

afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  for (const name of ['APP_REPO', 'DATA_REPO', 'RUNTIME_DIR', 'UPLOADS_DIR', 'DEV_FIXTURES']) delete process.env[name];
  temporary = ''; vi.resetModules();
});

describe('isolated Agent workspace finalizer', () => {
  it('rejects oversized candidate files before reading them', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'fitness-agent-workspace-')); const base = path.join(temporary, 'base'); const candidate = path.join(temporary, 'candidate'); await mkdir(base); await mkdir(candidate); await writeFile(path.join(candidate, 'large.ts'), Buffer.alloc(2 * 1024 * 1024 + 1));
    const { filesystemChanges } = await import('../server/agent-workspace.js'); await expect(filesystemChanges(base, candidate, () => true)).rejects.toThrow('单文件限制');
  });

  it('commits validated data and stamps new record provenance on the host', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'fitness-agent-workspace-'));
    const app = path.join(temporary, 'app'); await mkdir(app); await initApp(app);
    process.env.APP_REPO = app; process.env.DATA_REPO = path.join(temporary, 'data'); process.env.RUNTIME_DIR = path.join(temporary, 'runtime'); process.env.UPLOADS_DIR = path.join(temporary, 'uploads'); process.env.DEV_FIXTURES = 'false';
    const dataRepo = await import('../server/data-repo.js'); await dataRepo.ensureDataRepo('2026-09-02');
    const workspaceModule = await import('../server/agent-workspace.js'); const workspace = await workspaceModule.prepareAgentWorkspace('zhuzhu', []);
    const log = emptyLog('2026-09-02', 'xiaohua');
    log.meals.push({ id: 'meal-1', meal: 'lunch', items: [], occurred_at: null, source: { recorded_by: 'xiaohua', request_id: 'spoofed', attachment_ids: ['not-allowed'], recorded_at: '2000-01-01T00:00:00.000Z' } });
    log.measurements.push({ id: 'weight-1', metric: 'weight', value: 60, unit: 'kg', measured_at: null, notes: [], source: { recorded_by: 'xiaohua', request_id: 'spoofed', attachment_ids: ['not-allowed'], recorded_at: '2000-01-01T00:00:00.000Z' } });
    const target = path.join(workspace.data, 'logs', '2026-09-02', 'xiaohua.json'); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(log, null, 2)}\n`);
    await rm(path.join(workspace.data, '.git'), { recursive: true, force: true });
    const result = await workspaceModule.finalizeDataWorkspace(workspace, 'zhuzhu', 'request-12345678', []);
    expect(result?.paths).toEqual(['logs/2026-09-02/xiaohua.json']);
    const saved = JSON.parse(await readFile(path.join(process.env.DATA_REPO, 'logs', '2026-09-02', 'xiaohua.json'), 'utf8'));
    expect(saved.meals[0].source).toMatchObject({ recorded_by: 'zhuzhu', request_id: 'request-12345678', attachment_ids: [] });
    expect(saved.measurements[0].source).toMatchObject({ recorded_by: 'zhuzhu', request_id: 'request-12345678', attachment_ids: [] });
  });

  it('rejects a business date that disagrees with its path', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'fitness-agent-workspace-'));
    const app = path.join(temporary, 'app'); await mkdir(app); await initApp(app);
    process.env.APP_REPO = app; process.env.DATA_REPO = path.join(temporary, 'data'); process.env.RUNTIME_DIR = path.join(temporary, 'runtime'); process.env.UPLOADS_DIR = path.join(temporary, 'uploads');
    const dataRepo = await import('../server/data-repo.js'); await dataRepo.ensureDataRepo('2026-09-02');
    const workspaceModule = await import('../server/agent-workspace.js'); const workspace = await workspaceModule.prepareAgentWorkspace('zhuzhu', []);
    const log = emptyLog('2026-09-01', 'zhuzhu'); const target = path.join(workspace.data, 'logs', '2026-09-02', 'zhuzhu.json');
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(log, null, 2)}\n`);
    await expect(workspaceModule.finalizeDataWorkspace(workspace, 'zhuzhu', 'request-12345678', [])).rejects.toThrow('人物或日期与路径不一致');
    await expect(readFile(path.join(process.env.DATA_REPO, 'logs', '2026-09-02', 'zhuzhu.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('identifies invalid candidate JSON without exposing a parser error', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'fitness-agent-workspace-'));
    const app = path.join(temporary, 'app'); await mkdir(app); await initApp(app);
    process.env.APP_REPO = app; process.env.DATA_REPO = path.join(temporary, 'data'); process.env.RUNTIME_DIR = path.join(temporary, 'runtime'); process.env.UPLOADS_DIR = path.join(temporary, 'uploads');
    const dataRepo = await import('../server/data-repo.js'); await dataRepo.ensureDataRepo('2026-09-02');
    const workspaceModule = await import('../server/agent-workspace.js'); const workspace = await workspaceModule.prepareAgentWorkspace('zhuzhu', []);
    const target = path.join(workspace.data, 'memory', 'zhuzhu.json'); await writeFile(target, '');
    await expect(workspaceModule.finalizeDataWorkspace(workspace, 'zhuzhu', 'request-12345678', [])).rejects.toThrow('memory/zhuzhu.json 不是有效 JSON，未保存任何数据');
  });
});
