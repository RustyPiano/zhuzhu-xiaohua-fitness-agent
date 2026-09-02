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
    expect(() => validateBusinessJson('logs/2026-09-01/zhuzhu.json', log)).toThrow('person_id');
  });

  it('rejects malformed nested entries and duplicate IDs', () => {
    const log = emptyLog('2026-09-01', 'zhuzhu');
    log.meals = [{ id: 'same', meal: 'lunch', items: [], occurred_at: null, source: { recorded_by: 'zhuzhu', request_id: 'request-1', attachment_ids: [], recorded_at: '2026-09-01T12:00:00+08:00' } }, { id: 'same', meal: 'dinner', items: [], occurred_at: null, source: { recorded_by: 'zhuzhu', request_id: 'request-2', attachment_ids: [], recorded_at: '2026-09-01T18:00:00+08:00' } }];
    expect(() => validateBusinessJson('logs/2026-09-01/zhuzhu.json', log)).toThrow('重复 ID');
    expect(() => validateBusinessJson('logs/2026-09-01/zhuzhu.json', { ...emptyLog('2026-09-01', 'zhuzhu'), sets: ['invalid'] })).toThrow('结构无效');
    expect(() => validateBusinessJson('logs/2026-09-01/zhuzhu.json', { ...emptyLog('2026-09-01', 'zhuzhu'), measurements: [{ weight: 60 }] })).toThrow('结构无效');
  });
});
