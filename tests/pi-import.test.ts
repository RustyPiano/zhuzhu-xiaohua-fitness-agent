import { describe, expect, it } from 'vitest';

describe('locked Pi SDK surface', () => {
  it('exposes the APIs used by the server adapter', async () => {
    const pi = await import('@earendil-works/pi-coding-agent');
    expect(pi.createAgentSession).toBeTypeOf('function');
    expect(pi.defineTool).toBeTypeOf('function');
    expect(pi.createReadToolDefinition).toBeTypeOf('function');
    expect(pi.createBashToolDefinition).toBeTypeOf('function');
    expect(pi.ModelRuntime.create).toBeTypeOf('function');
    expect(pi.SessionManager.inMemory).toBeTypeOf('function');
  });
});
