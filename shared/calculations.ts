import type { DayLog, NutritionValue } from './contracts.js';

export type NutrientSummary = { known_total: number | null; known_items: number; unknown_items: number };
export type NutritionSummary = { nutrients: Record<keyof NutritionValue, NutrientSummary>; logged_items: number };

export function summarizeNutrition(log: DayLog): NutritionSummary {
  const nutrient = (): NutrientSummary => ({ known_total: null, known_items: 0, unknown_items: 0 });
  const result: NutritionSummary = { nutrients: { kcal: nutrient(), protein_g: nutrient(), carbs_g: nutrient(), fat_g: nutrient() }, logged_items: 0 };
  for (const meal of log.meals) for (const item of meal.items) {
    result.logged_items += 1;
    for (const key of ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const) {
      const value = item.nutrition[key]; const summary = result.nutrients[key];
      if (value === null) summary.unknown_items += 1;
      else { summary.known_total = (summary.known_total ?? 0) + value; summary.known_items += 1; }
    }
  }
  return result;
}

export function averageKnown(values: Array<number | null>): { average: number | null; samples: number } {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return { average: known.length ? known.reduce((a, b) => a + b, 0) / known.length : null, samples: known.length };
}
