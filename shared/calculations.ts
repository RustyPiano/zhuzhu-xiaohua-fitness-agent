import type { DayLog, NutritionValue } from './contracts.js';

export type NutritionSummary = NutritionValue & { unknown_items: number; logged_items: number };

export function summarizeNutrition(log: DayLog): NutritionSummary {
  const result: NutritionSummary = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, unknown_items: 0, logged_items: 0 };
  for (const meal of log.meals) for (const item of meal.items) {
    result.logged_items += 1;
    const n = item.nutrition;
    if ([n.kcal, n.protein_g, n.carbs_g, n.fat_g].every((v) => v === null)) result.unknown_items += 1;
    for (const key of ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const) {
      const value = n[key];
      if (value !== null) result[key] = (result[key] ?? 0) + value;
    }
  }
  if (!result.logged_items) return { kcal: null, protein_g: null, carbs_g: null, fat_g: null, unknown_items: 0, logged_items: 0 };
  return result;
}

export function averageKnown(values: Array<number | null>): { average: number | null; samples: number } {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return { average: known.length ? known.reduce((a, b) => a + b, 0) / known.length : null, samples: known.length };
}
