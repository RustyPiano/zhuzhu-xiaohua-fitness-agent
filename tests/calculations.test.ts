import { describe, expect, it } from 'vitest';
import { averageKnown, summarizeNutrition } from '../shared/calculations.js';
import { emptyLog } from '../shared/contracts.js';

describe('statistics keep missing data distinct from zero', () => {
  it('does not turn an unlogged day into zero intake', () => {
    const summary = summarizeNutrition(emptyLog('2026-09-01', 'zhuzhu'));
    expect(summary.logged_items).toBe(0); expect(summary.nutrients.kcal).toEqual({ known_total: null, known_items: 0, unknown_items: 0 });
  });

  it('counts known totals and reports unknown items', () => {
    const log = emptyLog('2026-09-01', 'xiaohua');
    log.meals.push({
      id: 'meal-1', meal: 'lunch', occurred_at: null,
      source: { recorded_by: 'zhuzhu', request_id: 'request-1', attachment_ids: [], recorded_at: '2026-09-01T12:00:00+08:00' },
      items: [
        { id: 'rice', name: '米饭', amount: 150, unit: 'g（熟重）', nutrition: { kcal: 180, protein_g: 4, carbs_g: 39, fat_g: 0.5 }, value_kind: 'weighed', assumptions: [] },
        { id: 'dish', name: '菜', amount: null, unit: null, nutrition: { kcal: null, protein_g: null, carbs_g: null, fat_g: null }, value_kind: 'unknown', assumptions: [] },
      ],
    });
    const summary = summarizeNutrition(log);
    expect(summary.logged_items).toBe(2); expect(summary.nutrients.kcal).toEqual({ known_total: 180, known_items: 1, unknown_items: 1 }); expect(summary.nutrients.protein_g).toEqual({ known_total: 4, known_items: 1, unknown_items: 1 });
  });

  it('averages only valid samples and exposes sample count', () => {
    expect(averageKnown([60, null, 62, null])).toEqual({ average: 61, samples: 2 });
  });
});
