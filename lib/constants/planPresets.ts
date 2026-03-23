/** Known pdfengine plan presets. Values must match PLAN_CONFIGS keys in
 *  pdfengine/packages/shared/src/config/plan_config.py exactly. */
export const PLAN_PRESETS = [
  { value: 'Gamache', label: 'Gamache' },
  { value: 'Eddie', label: 'Eddie' },
  { value: 'Haas', label: 'Haas' },
  { value: 'Kinloch', label: 'Kinloch' },
] as const;

export type PlanPresetValue = (typeof PLAN_PRESETS)[number]['value'] | null;

/** Set of canonical preset values for fast lookup / validation. */
export const VALID_PRESET_VALUES = new Set(PLAN_PRESETS.map(p => p.value));

/**
 * Validate and canonicalize a plan name string.
 * Accepts case-insensitive input, returns the canonical value or null if unknown.
 */
export function canonicalizePreset(input: string | undefined | null): string | null {
  if (!input) return null;
  const match = PLAN_PRESETS.find(p => p.value.toLowerCase() === input.toLowerCase());
  return match ? match.value : null;
}

/**
 * Conservative auto-detection: match project name against known presets.
 * Returns the preset value if exactly one key is a case-insensitive substring
 * of the project name. Returns null if zero or multiple matches (ambiguous).
 */
export function detectPlanPreset(projectName: string): PlanPresetValue {
  const lower = projectName.toLowerCase();
  const matches = PLAN_PRESETS.filter(p => lower.includes(p.value.toLowerCase()));
  return matches.length === 1 ? matches[0].value : null;
}
