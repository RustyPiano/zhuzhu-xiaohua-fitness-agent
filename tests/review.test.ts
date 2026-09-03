import { describe, expect, it } from 'vitest';
import { emptyLog, type ReviewSnapshot } from '../shared/contracts.js';
import { describeDay, reviewWeightPoints, reviewWeightSummaries, summarizeReview } from '../web/src/ReviewPage.js';

const source = { recorded_by: 'zhuzhu' as const, request_id: 'review-test', attachment_ids: [], recorded_at: '2026-09-01T08:00:00+08:00' };
const review = (): ReviewSnapshot => ({
  revision: 'revision', start: '2026-08-26', end: '2026-09-01',
  days: Array.from({ length: 7 }, (_, index) => {
    const date = `2026-0${index < 6 ? '8' : '9'}-${index < 6 ? String(26 + index).padStart(2, '0') : '01'}`;
    return { date, plan: null, logs: { zhuzhu: emptyLog(date, 'zhuzhu'), xiaohua: emptyLog(date, 'xiaohua') } };
  }),
});

describe('seven-day review uses only actual logs', () => {
  it('counts recorded entries without treating missing days as zero events', () => {
    const value = review(); const log = value.days[6].logs.zhuzhu;
    log.meals.push({ id: 'meal', meal: 'dinner', items: [], occurred_at: null, source });
    log.sets.push({ id: 'set', exercise_id: 'squat', equipment: null, load: null, load_unit: null, reps: null, side: 'both', kind: 'work', source });
    expect(summarizeReview(value, ['zhuzhu'])).toEqual({ meals: 1, sets: 1, cardio: 0, measurements: 0 });
  });

  it('keeps completion status separate from event counts', () => {
    const log = emptyLog('2026-09-01', 'zhuzhu'); log.training_status = 'complete';
    expect(describeDay(log)).toEqual(['训练 完整记录']);
  });

  it('uses the latest daily weight and refuses to merge different units', () => {
    const value = review(); const log = value.days[6].logs.zhuzhu;
    log.measurements.push({ id: 'old', metric: 'weight', value: 60, unit: 'kg', measured_at: '2026-09-01T07:00:00+08:00', notes: [], source });
    log.measurements.push({ id: 'new', metric: 'weight', value: 59.8, unit: 'kg', measured_at: '2026-09-01T08:00:00+08:00', notes: [], source });
    expect(reviewWeightPoints(value, ['zhuzhu']).points.map(({ value: weight }) => weight)).toEqual([59.8]);
    value.days[5].logs.xiaohua.measurements.push({ id: 'jin', metric: 'weight', value: 100, unit: '斤', measured_at: null, notes: [], source });
    expect(reviewWeightPoints(value, ['zhuzhu', 'xiaohua']).mixedUnits).toBe(true);
  });

  it('averages only daily weight samples for each person', () => {
    const value = review();
    value.days[5].logs.zhuzhu.measurements.push({ id: 'first', metric: 'weight', value: 60, unit: 'kg', measured_at: null, notes: [], source });
    value.days[6].logs.zhuzhu.measurements.push({ id: 'second', metric: 'weight', value: 59.8, unit: 'kg', measured_at: null, notes: [], source });
    expect(reviewWeightSummaries(value, ['zhuzhu'])).toEqual([{ person: 'zhuzhu', samples: 2, average: 59.9, unit: 'kg', mixedUnits: false }]);
  });
});
