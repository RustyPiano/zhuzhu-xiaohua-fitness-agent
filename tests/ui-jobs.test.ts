import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

const exec = promisify(execFile); let temporary = '';
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); for (const name of ['APP_REPO', 'RUNTIME_DIR', 'RELEASES_DIR']) delete process.env[name]; temporary = ''; vi.resetModules(); });

describe('UI releases', () => {
  it('rolls artifact and trusted source baseline back together', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'fitness-ui-')); const app = path.join(temporary, 'app'); const runtime = path.join(temporary, 'runtime'); const releases = path.join(temporary, 'releases');
    await mkdir(path.join(app, 'web', 'src'), { recursive: true }); await writeFile(path.join(app, 'web', 'src', 'main.ts'), 'export const version = "A";\n');
    await exec('git', ['init', '--initial-branch=main'], { cwd: app }); await exec('git', ['config', 'user.name', 'Test'], { cwd: app }); await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: app }); await exec('git', ['add', '.'], { cwd: app }); await exec('git', ['commit', '-m', 'A'], { cwd: app }); const a = (await exec('git', ['rev-parse', 'HEAD'], { cwd: app })).stdout.trim();
    await writeFile(path.join(app, 'web', 'src', 'main.ts'), 'export const version = "B";\n'); await exec('git', ['commit', '-am', 'B'], { cwd: app }); const b = (await exec('git', ['rev-parse', 'HEAD'], { cwd: app })).stdout.trim();
    const artifactA = path.join(releases, 'candidates', 'a'); const artifactB = path.join(releases, 'candidates', 'b'); await mkdir(artifactA, { recursive: true }); await mkdir(artifactB, { recursive: true }); await writeFile(path.join(artifactA, 'index.html'), 'A'); await writeFile(path.join(artifactB, 'index.html'), 'B');
    const hash = (name: string, value: string) => createHash('sha256').update(name).update(value).digest('hex'); await mkdir(runtime, { recursive: true });
    await writeFile(path.join(runtime, 'deployment.json'), JSON.stringify({ current: { job_id: 'b', source_revision: b, artifact_path: artifactB, artifact_hash: hash('index.html', 'B') }, previous: { job_id: 'a', source_revision: a, artifact_path: artifactA, artifact_hash: hash('index.html', 'A') }, updated_at: new Date().toISOString() }));
    process.env.APP_REPO = app; process.env.RUNTIME_DIR = runtime; process.env.RELEASES_DIR = releases; const ui = await import('../server/ui-jobs.js'); const deployment = await ui.rollbackUi();
    expect(deployment.current?.job_id).toBe('a'); expect(await readFile(path.join(app, 'web', 'src', 'main.ts'), 'utf8')).toContain('"A"'); expect(deployment.current?.source_revision).toBe((await exec('git', ['rev-parse', 'HEAD'], { cwd: app })).stdout.trim()); expect(deployment.current?.source_revision).not.toBe(a);
  });
});
