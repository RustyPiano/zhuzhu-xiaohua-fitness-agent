import { describe, expect, it } from 'vitest';
import { assertAllowedDataPath, validateBusinessJson } from '../shared/validation.js';
import { emptyLog } from '../shared/contracts.js';

describe('data boundary', () => {
  it.each(['../secrets', '/etc/passwd', 'logs/2026-09-01/../../x.json', '.git/config', 'server/index.ts'])('rejects unsafe path %s', (value) => {
    expect(() => assertAllowedDataPath(value)).toThrow();
  });

  it('accepts only the two fixed log subjects', () => {
    expect(() => assertAllowedDataPath('logs/2026-09-01/zhuzhu.json')).not.toThrow();
    expect(() => assertAllowedDataPath('logs/2026-09-01/shared.json')).toThrow();
  });

  it('rejects a log with a mismatched person', () => {
    const log = { ...emptyLog('2026-09-01', 'zhuzhu'), person_id: 'shared' };
    expect(() => validateBusinessJson('logs/2026-09-01/zhuzhu.json', log)).toThrow('日志日期或人物无效');
  });
});
