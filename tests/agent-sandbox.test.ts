import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bashTimeoutMs, sandboxContainerArgs } from '../server/agent-sandbox.js';
import { PODMAN_KEEP_ID } from '../server/podman.js';
import { uiSandboxContainerArgs } from '../server/ui-jobs.js';

describe('Agent sandbox command', () => {
  it('mounts only the isolated workspace and disables network', () => {
    const root = path.join('/srv/fitness/runtime', 'agent-workspaces', 'zhuzhu');
    const args = sandboxContainerArgs({ root, app: path.join(root, 'app'), data: path.join(root, 'data'), inbox: path.join(root, 'inbox'), appBaseRevision: 'a', dataBaseRevision: 'b' }, 'fitness-agent-check:locked', ['sh', '-lc', 'true']);
    expect(args).toContain('--network=none'); expect(args).toContain('--read-only'); expect(args).toContain('--cap-drop=ALL');
    expect(args).toContain('--interactive');
    expect(args).toContain(PODMAN_KEEP_ID);
    expect(args).toContain('fsize=2097152:2097152');
    const mounts = args.filter((value, index) => args[index - 1] === '-v').join('\n');
    expect(mounts).toContain(`${root}/app:/workspace/app:rw`); expect(mounts).toContain(`${root}/inbox:/workspace/inbox:ro`);
    expect(mounts).toContain(`${root}/app/.git:/workspace/app/.git:ro`); expect(mounts).toContain(`${root}/data/.git:/workspace/data/.git:ro`);
    expect(args).toContain('GIT_OPTIONAL_LOCKS=0'); expect(args).toContain('GIT_NO_REPLACE_OBJECTS=1');
    expect(mounts).not.toContain('/srv/fitness/uploads'); expect(mounts).not.toContain('/etc/fitness-agent.env'); expect(mounts).not.toContain('podman.sock');
  });

  it('uses the same writable-mount identity for UI checks', () => {
    const args = uiSandboxContainerArgs('/srv/fitness/runtime/ui-checks/candidate', 'fitness-agent-check:locked');
    expect(args).toContain(PODMAN_KEEP_ID); expect(args).toContain('--network=none'); expect(args).toContain('--cap-drop=ALL');
    expect(args.at(-1)).toContain('pnpm --config.verify-deps-before-run=false');
    expect(args).toContain('/srv/fitness/runtime/ui-checks/candidate:/workspace:Z');
    expect(args.join('\n')).not.toContain('/srv/fitness/data-repo'); expect(args.join('\n')).not.toContain('/etc/fitness-agent.env'); expect(args.join('\n')).not.toContain('podman.sock');
  });

  it('delegates cgroups to the rootless Podman service', () => {
    expect(readFileSync(path.resolve('deploy/fitness-agent.service'), 'utf8')).toContain('Delegate=yes');
  });

  it('converts Pi timeout seconds to milliseconds and caps it', () => {
    expect(bashTimeoutMs()).toBe(120_000); expect(bashTimeoutMs(300)).toBe(300_000); expect(bashTimeoutMs(2_000)).toBe(900_000);
  });
});
