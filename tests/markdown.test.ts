import { describe, expect, it } from 'vitest';
import { safeExternalUrl } from '../web/src/AgentPage.js';

describe('conversation links', () => {
  it('allows public HTTP links and rejects executable or relative links', () => {
    expect(safeExternalUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('/api/logout')).toBeNull();
  });
});
