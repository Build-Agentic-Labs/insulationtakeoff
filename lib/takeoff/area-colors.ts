import { ZONE_COLORS, type ZoneCeilingType, type ZoneType } from '@/lib/types/takeoff';

export interface AreaColorZone {
  zoneType?: ZoneType | null;
  ceilingType?: ZoneCeilingType | null;
  roofPitchRise?: number | null;
  roofPitchRun?: number | null;
}

export type AreaColor = { fill: string; stroke: string };

const ROOF_PITCH_COLORS: AreaColor[] = [
  { fill: '#a855f7', stroke: '#9333ea' },
  { fill: '#14b8a6', stroke: '#0f766e' },
  { fill: '#f59e0b', stroke: '#d97706' },
  { fill: '#0ea5e9', stroke: '#0284c7' },
  { fill: '#ec4899', stroke: '#db2777' },
  { fill: '#84cc16', stroke: '#65a30d' },
  { fill: '#6366f1', stroke: '#4f46e5' },
  { fill: '#f97316', stroke: '#ea580c' },
];

export function roofPitchColorKey(zone: AreaColorZone) {
  if (zone.zoneType !== 'unconditioned_attic' || zone.ceilingType !== 'vaulted') return null;
  if (
    typeof zone.roofPitchRise !== 'number' ||
    !Number.isFinite(zone.roofPitchRise) ||
    zone.roofPitchRise <= 0 ||
    typeof zone.roofPitchRun !== 'number' ||
    !Number.isFinite(zone.roofPitchRun) ||
    zone.roofPitchRun <= 0
  ) {
    return null;
  }

  return `${Math.round(zone.roofPitchRise)}/${Math.round(zone.roofPitchRun)}`;
}

export function buildRoofPitchColorMap(zones: AreaColorZone[]) {
  const pitchKeys = Array.from(new Set(zones.map(roofPitchColorKey).filter(Boolean) as string[]))
    .sort((left, right) => {
      const [leftRise, leftRun] = left.split('/').map(Number);
      const [rightRise, rightRun] = right.split('/').map(Number);
      return leftRun - rightRun || leftRise - rightRise;
    });

  return new Map(
    pitchKeys.map((pitchKey, index) => [
      pitchKey,
      ROOF_PITCH_COLORS[index % ROOF_PITCH_COLORS.length],
    ]),
  );
}

export function resolveAreaZoneColor(
  zone: AreaColorZone,
  roofPitchColorByKey?: Map<string, AreaColor>,
): AreaColor {
  const pitchKey = roofPitchColorKey(zone);
  if (pitchKey && roofPitchColorByKey?.has(pitchKey)) {
    return roofPitchColorByKey.get(pitchKey) ?? ZONE_COLORS.unconditioned_attic;
  }

  return ZONE_COLORS[zone.zoneType ?? 'conditioned'] ?? ZONE_COLORS.conditioned;
}
