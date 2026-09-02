import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sandboxContainerArgs } from '../server/agent-sandbox.js';

describe('Agent sandbox command', () => {
  it('mounts only the isolated workspace and disables network', () => {
    const root = path.join('/srv/fitness/runtime', 'agent-workspaces', 'zhuzhu');
    const args = sandboxContainerArgs({ root, app: path.join(root, 'app'), data: path.join(root, 'data'), inbox: path.join(root, 'inbox'), appBaseRevision: 'a', dataBaseRevision: 'b' }, 'fitness-agent-check:locked', ['sh', '-lc', 'true']);
    expect(args).toContain('--network=none'); expect(args).toContain('--read-only'); expect(args).toContain('--cap-drop=ALL');
    const mounts = args.filter((value, index) => args[index - 1] === '-v').join('\n');
    expect(mounts).toContain(`${root}/app:/workspace/app:rw`); expect(mounts).toContain(`${root}/inbox:/workspace/inbox:ro`);
    expect(mounts).not.toContain('/srv/fitness/uploads'); expect(mounts).not.toContain('/etc/fitness-agent.env'); expect(mounts).not.toContain('podman.sock');
  });
});
