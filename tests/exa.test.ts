import { describe, expect, it } from 'vitest';
import { assertPublicUrl } from '../server/exa.js';

describe('public URL policy', () => {
  it.each(['http://127.0.0.1/x', 'http://10.0.0.1/', 'http://169.254.169.254/latest', 'http://localhost/', 'file:///etc/passwd', 'https://user:pass@example.com/'])('rejects non-public target %s', (value) => {
    expect(() => assertPublicUrl(value)).toThrow();
  });
  it('accepts a normal public https URL', () => {
    expect(assertPublicUrl('https://example.org/article').href).toBe('https://example.org/article');
  });
});
