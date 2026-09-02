export type PersonId = 'zhuzhu' | 'xiaohua';
export type MemorySubject = PersonId | 'shared';
export type ViewSubject = MemorySubject;

export type PersonProfile = {
  schema_version: 1;
  person_id: PersonId;
  display_name: string;
  height_cm: number | null;
  age_at_confirmation: number | null;
  confirmed_at: string | null;
  training_experience: string | null;
  goal: string | null;
  constraints: Array<{ text: string; source: string }>;
};

export type NutritionValue = {
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
};

export type MealItem = {
  id: string;
  name: string;
  amount: number | null;
  unit: string | null;
  nutrition: NutritionValue;
  value_kind: 'label' | 'weighed' | 'estimated' | 'unknown';
  assumptions: string[];
};

export type ExercisePlan = {
  exercise_id: string;
  name: string;
  equipment: string | null;
  sets: number | null;
  reps: string | null;
  load: number | null;
  load_unit: string | null;
  rest_seconds: number | null;
  notes: string[];
};

export type PersonDayPlan = {
  nutrition: {
    targets: NutritionValue;
    meals: Array<{ meal: 'breakfast' | 'lunch' | 'dinner' | 'snack'; label: string; items: MealItem[] }>;
  };
  training: { type: string | null; exercises: ExercisePlan[]; cardio: string | null };
};

export type DayPlan = {
  schema_version: 1;
  date: string;
  status: 'draft' | 'active';
  title: string | null;
  people: Record<PersonId, PersonDayPlan>;
  notes: string[];
};

export type SourceRef = {
  recorded_by: PersonId;
  request_id: string;
  attachment_ids: string[];
  recorded_at: string;
};

export type MealLog = {
  id: string;
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  items: MealItem[];
  occurred_at: string | null;
  source: SourceRef;
};

export type SetLog = {
  id: string;
  exercise_id: string;
  equipment: string | null;
  load: number | null;
  load_unit: string | null;
  reps: number | null;
  side: 'both' | 'left' | 'right' | null;
  kind: 'warmup' | 'work';
  source: SourceRef;
};

export type CardioLog = {
  id: string;
  activity: string;
  duration_minutes: number | null;
  distance_km: number | null;
  intensity: string | null;
  occurred_at: string | null;
  notes: string[];
  source: SourceRef;
};

export type MeasurementLog = {
  id: string;
  metric: 'weight' | 'waist' | 'body_fat' | 'other';
  value: number;
  unit: string;
  measured_at: string | null;
  notes: string[];
  source: SourceRef;
};

export type DayLog = {
  schema_version: 1;
  date: string;
  person_id: PersonId;
  plan_revision: string | null;
  nutrition_status: 'unlogged' | 'partial' | 'complete';
  meals: MealLog[];
  training_status: 'unlogged' | 'partial' | 'complete';
  sets: SetLog[];
  cardio: CardioLog[];
  measurements: MeasurementLog[];
  notes: string[];
};

export type MemoryFile = {
  schema_version: 1;
  items: Array<{
    id: string;
    key: string;
    text: string;
    evidence: 'explicit_statement' | 'confirmed_inference';
    source: { actor: PersonId; request_id: string };
    updated_at: string;
  }>;
};

export type DaySnapshot = {
  revision: string;
  date: string;
  plan: DayPlan | null;
  logs: Record<PersonId, DayLog>;
};

export type AttachmentMeta = {
  id: string;
  owner: PersonId;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  created_at: string;
};

export type ToolReceipt =
  | { type: 'data'; status: 'saved'; subject: PersonId; date: string; summary: string; revision: string }
  | { type: 'source'; status: 'searched' | 'read'; title: string; url: string; snippet?: string }
  | { type: 'ui'; status: string; job_id: string; summary: string; preview_url?: string };

export type ThreadMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  created_at: string;
  attachment_ids: string[];
  receipts: ToolReceipt[];
  status?: 'running' | 'complete' | 'error';
};

export type WebBudgetStatus = {
  month: string;
  used_microusd: number;
  warn_microusd: number;
  stop_microusd: number;
  warning: boolean;
  stopped: boolean;
};

export type Bootstrap = {
  actor: PersonId;
  timezone: string;
  today: string;
  app_version: string;
  agent: { configured: boolean; reason: string | null };
  image: { configured: boolean; max_files: number; max_bytes: number; max_pixels: number; reason: string | null };
  web: { provider: 'exa'; configured: boolean; reason: string | null; budget: WebBudgetStatus };
  ui_editing: { configured: boolean; reason: string | null };
};

export const PERSON_LABEL: Record<PersonId, string> = { zhuzhu: '珠珠', xiaohua: '小花' };

export function emptyLog(date: string, person: PersonId): DayLog {
  return {
    schema_version: 1, date, person_id: person, plan_revision: null,
    nutrition_status: 'unlogged', meals: [], training_status: 'unlogged', sets: [],
    cardio: [], measurements: [], notes: [],
  };
}
