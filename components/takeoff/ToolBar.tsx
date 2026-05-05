'use client';

import { CircleDot, MousePointer2, Pen, Pentagon, Ruler } from 'lucide-react';
import { useTakeoffStore, type ToolMode } from '@/lib/stores/takeoff-store';
import {
  SURFACE_PRESET_OPTIONS,
  WALL_PRESET_OPTIONS,
  ZONE_PRESET_OPTIONS,
  type DrawingPreset,
} from '@/lib/takeoff/presets';

const TOP_LEVEL_TOOLS: { mode: ToolMode; icon: typeof MousePointer2; label: string; shortcut: string }[] = [
  { mode: 'pointer', icon: MousePointer2, label: 'Inspect', shortcut: 'V' },
  { mode: 'calibrate', icon: Ruler, label: 'Calibrate', shortcut: 'C' },
];

const DRAW_FAMILIES: Array<{
  preset: DrawingPreset;
  icon: typeof Pen;
  label: string;
  description: string;
}> = [
  { preset: 'wall', icon: Pen, label: 'Wall Runs', description: 'Linear wall objects' },
  { preset: 'zone', icon: CircleDot, label: 'Areas', description: 'Thermal areas for wall context' },
  { preset: 'surface', icon: Pentagon, label: 'Surfaces', description: 'Attic, crawl, and floor scopes' },
];

function panelButtonTone(active: boolean, disabled = false) {
  if (disabled) {
    return 'cursor-not-allowed border-white/8 bg-white/[0.03] text-[var(--takeoff-text-subtle)]';
  }

  if (active) {
    return 'border-white bg-[var(--takeoff-paper-strong)] text-[var(--takeoff-ink)]';
  }

  return 'border-white/10 bg-transparent text-[var(--takeoff-text)] hover:border-white/20 hover:bg-white/[0.05]';
}

export function ToolBar() {
  const tool = useTakeoffStore((s) => s.tool);
  const drawingPreset = useTakeoffStore((s) => s.drawingPreset);
  const wallPreset = useTakeoffStore((s) => s.wallPreset);
  const zonePreset = useTakeoffStore((s) => s.zonePreset);
  const surfacePreset = useTakeoffStore((s) => s.surfacePreset);
  const setTool = useTakeoffStore((s) => s.setTool);
  const startCalibration = useTakeoffStore((s) => s.startCalibration);
  const startTrace = useTakeoffStore((s) => s.startTrace);
  const setDrawingPreset = useTakeoffStore((s) => s.setDrawingPreset);
  const setWallPreset = useTakeoffStore((s) => s.setWallPreset);
  const setZonePreset = useTakeoffStore((s) => s.setZonePreset);
  const setSurfacePreset = useTakeoffStore((s) => s.setSurfacePreset);
  const getCalibration = useTakeoffStore((s) => s.getCalibration);

  const cal = getCalibration();
  const isFullyCalibrated = !!cal?.verification;

  const handleTopLevel = (mode: ToolMode) => {
    if (mode === 'calibrate') {
      startCalibration();
      return;
    }

    setTool(mode);
  };

  const handleDrawFamily = (preset: DrawingPreset) => {
    if (!isFullyCalibrated) return;
    setDrawingPreset(preset);
    startTrace(preset === 'wall' ? 'linear' : 'area');
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {TOP_LEVEL_TOOLS.map(({ mode, icon: Icon, label, shortcut }) => {
          const isActive = tool === mode;
          return (
            <button
              key={mode}
              onClick={() => handleTopLevel(mode)}
              title={`${label} (${shortcut})`}
              className={`flex min-h-[68px] flex-col items-start justify-between rounded-[18px] border px-3 py-3 text-left transition-colors ${panelButtonTone(isActive)}`}
            >
              <Icon className="h-4 w-4" />
              <div>
                <div className="text-xs font-medium">{label}</div>
                <div className={`takeoff-mono mt-1 text-[10px] ${isActive ? 'text-[var(--takeoff-text-subtle)]' : 'text-[var(--takeoff-text-muted)]'}`}>
                  {shortcut}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-2.5">
        <div className="takeoff-label mb-2 text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
          Object Family
        </div>
        <div className="space-y-2">
          {DRAW_FAMILIES.map(({ preset, icon: Icon, label, description }) => {
            const isActive = tool === 'trace' && drawingPreset === preset;
            return (
              <button
                key={preset}
                onClick={() => handleDrawFamily(preset)}
                disabled={!isFullyCalibrated}
                className={`flex w-full items-start gap-2 rounded-[16px] border px-3 py-2 text-left transition-colors ${panelButtonTone(isActive, !isFullyCalibrated)}`}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="text-xs font-medium">{label}</div>
                  <div className={`mt-0.5 text-[10px] ${isActive ? 'text-[var(--takeoff-text-subtle)]' : 'text-[var(--takeoff-text-muted)]'}`}>
                    {description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {!isFullyCalibrated ? (
        <div className="rounded-[20px] border border-white/10 bg-black/10 px-3 py-3 text-[11px] leading-relaxed text-[var(--takeoff-text-muted)]">
          Verify two dimensions before drawing wall objects, takeoff areas, or surfaces.
        </div>
      ) : (
        <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-2.5">
          <div className="takeoff-label mb-2 text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Active Preset
          </div>

          {drawingPreset === 'wall' && (
            <div className="grid grid-cols-2 gap-2">
              {WALL_PRESET_OPTIONS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => setWallPreset(preset.key)}
                  className={`rounded-[16px] border px-3 py-2 text-left text-xs font-medium transition-colors ${
                    wallPreset === preset.key
                      ? 'border-white bg-[var(--takeoff-paper-strong)] text-[var(--takeoff-ink)]'
                      : 'border-white/10 bg-transparent text-[var(--takeoff-text)] hover:border-white/16'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          {drawingPreset === 'zone' && (
            <div className="grid grid-cols-2 gap-2">
              {ZONE_PRESET_OPTIONS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => setZonePreset(preset.key)}
                  className={`rounded-[16px] border px-3 py-2 text-left text-xs font-medium transition-colors ${
                    zonePreset === preset.key
                      ? 'border-white bg-[var(--takeoff-paper-strong)] text-[var(--takeoff-ink)]'
                      : 'border-white/10 bg-transparent text-[var(--takeoff-text)] hover:border-white/16'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          {drawingPreset === 'surface' && (
            <div className="grid grid-cols-2 gap-2">
              {SURFACE_PRESET_OPTIONS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => setSurfacePreset(preset.key)}
                  className={`rounded-[16px] border px-3 py-2 text-left text-xs font-medium transition-colors ${
                    surfacePreset === preset.key
                      ? 'border-white bg-[var(--takeoff-paper-strong)] text-[var(--takeoff-ink)]'
                      : 'border-white/10 bg-transparent text-[var(--takeoff-text)] hover:border-white/16'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
