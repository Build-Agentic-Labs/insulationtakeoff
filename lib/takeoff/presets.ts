import type { AssemblyScope, ZoneType } from '@/lib/types/takeoff';
import type { Surface } from '@/lib/types/takeoff-v2';

export type DrawingPreset = 'wall' | 'zone' | 'surface';

export type WallPresetKey =
  | 'exterior_2x6'
  | 'exterior_2x4'
  | 'garage_shared'
  | 'basement_wall'
  | 'knee_wall'
  | 'rim_joist';

export type SurfacePresetKey =
  | 'attic_floor'
  | 'crawlspace_floor'
  | 'garage_ceiling'
  | 'sound_floor'
  | 'cathedral_ceiling'
  | 'cantilever_floor';

export interface WallPreset {
  key: WallPresetKey;
  label: string;
  scope: AssemblyScope;
  defaultHeightFt: number;
  thicknessIn: 4 | 6 | 8 | 10 | 12;
  framingType: '2x4' | '2x6' | 'cmu' | 'icf' | 'other';
}

export interface SurfacePreset {
  key: SurfacePresetKey;
  label: string;
  scope: Surface['assemblyScope'];
}

export interface ZonePreset {
  key: ZoneType;
  label: string;
}

export const WALL_PRESET_OPTIONS: WallPreset[] = [
  {
    key: 'exterior_2x6',
    label: 'Exterior 2x6',
    scope: 'exterior_wall_2x6',
    defaultHeightFt: 9,
    thicknessIn: 6,
    framingType: '2x6',
  },
  {
    key: 'exterior_2x4',
    label: 'Exterior 2x4',
    scope: 'exterior_wall_2x4',
    defaultHeightFt: 9,
    thicknessIn: 4,
    framingType: '2x4',
  },
  {
    key: 'garage_shared',
    label: 'Garage Shared',
    scope: 'garage_wall',
    defaultHeightFt: 9,
    thicknessIn: 6,
    framingType: '2x6',
  },
  {
    key: 'basement_wall',
    label: 'Basement Wall',
    scope: 'basement_wall',
    defaultHeightFt: 9,
    thicknessIn: 8,
    framingType: 'cmu',
  },
  {
    key: 'knee_wall',
    label: 'Knee Wall',
    scope: 'knee_wall',
    defaultHeightFt: 5,
    thicknessIn: 6,
    framingType: '2x6',
  },
  {
    key: 'rim_joist',
    label: 'Rim Joist',
    scope: 'rim_joist',
    defaultHeightFt: 1,
    thicknessIn: 12,
    framingType: 'other',
  },
];

export const SURFACE_PRESET_OPTIONS: SurfacePreset[] = [
  { key: 'attic_floor', label: 'Attic Floor', scope: 'attic_floor' },
  { key: 'crawlspace_floor', label: 'Crawlspace Floor', scope: 'crawlspace_floor' },
  { key: 'garage_ceiling', label: 'Garage Ceiling', scope: 'garage_ceiling' },
  { key: 'sound_floor', label: 'Sound Floor', scope: 'sound_floor' },
  { key: 'cathedral_ceiling', label: 'Cathedral Ceiling', scope: 'cathedral_ceiling' },
  { key: 'cantilever_floor', label: 'Cantilever Floor', scope: 'cantilever_floor' },
];

export const ZONE_PRESET_OPTIONS: ZonePreset[] = [
  { key: 'conditioned', label: 'Living / Heated Area' },
  { key: 'unconditioned_garage', label: 'Garage / Shared Wall' },
  { key: 'unconditioned_attic', label: 'Attic / Ceiling Insulation' },
  { key: 'unconditioned_crawl', label: 'Crawlspace / Floor Insulation' },
  { key: 'unconditioned_storage', label: 'Storage / Manual Review' },
];

export function getWallPreset(key: WallPresetKey): WallPreset {
  return WALL_PRESET_OPTIONS.find((preset) => preset.key === key) ?? WALL_PRESET_OPTIONS[0];
}

export function getSurfacePreset(key: SurfacePresetKey): SurfacePreset {
  return SURFACE_PRESET_OPTIONS.find((preset) => preset.key === key) ?? SURFACE_PRESET_OPTIONS[0];
}

export function getWallPresetByScope(scope: AssemblyScope | undefined): WallPreset | null {
  if (!scope) return null;
  return WALL_PRESET_OPTIONS.find((preset) => preset.scope === scope) ?? null;
}

export function getSurfacePresetByScope(scope: AssemblyScope | undefined): SurfacePreset | null {
  if (!scope) return null;
  return SURFACE_PRESET_OPTIONS.find((preset) => preset.scope === scope) ?? null;
}
