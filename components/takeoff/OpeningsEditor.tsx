'use client';

import { useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import type { Opening, OpeningType } from '@/lib/types/takeoff';
import { OPENING_PRESETS, openingAreaSf } from '@/lib/types/takeoff';

interface OpeningsEditorProps {
  traceId: string;
  segmentIndex: number;
  openings: Opening[];
}

const OPENING_LABELS: Record<OpeningType, string> = {
  door: 'Door',
  window: 'Window',
  garage_door: 'Garage Door',
  sliding_door: 'Sliding Door',
  french_door: 'French Door',
  door_opening: 'Door Opening',
};

export function OpeningsEditor({ traceId, segmentIndex, openings }: OpeningsEditorProps) {
  const setSegmentOpenings = useTakeoffStore((s) => s.setSegmentOpenings);

  const handleAdd = useCallback((type: OpeningType) => {
    const preset = OPENING_PRESETS[type];
    const newOpening: Opening = {
      id: uuid(),
      type,
      width_ft: preset.width_ft,
      height_ft: preset.height_ft,
      quantity: 1,
    };
    setSegmentOpenings(traceId, segmentIndex, [...openings, newOpening]);
  }, [traceId, segmentIndex, openings, setSegmentOpenings]);

  const handleRemove = useCallback((openingId: string) => {
    setSegmentOpenings(
      traceId,
      segmentIndex,
      openings.filter((o) => o.id !== openingId),
    );
  }, [traceId, segmentIndex, openings, setSegmentOpenings]);

  const handleQuantityChange = useCallback((openingId: string, qty: number) => {
    setSegmentOpenings(
      traceId,
      segmentIndex,
      openings.map((o) => o.id === openingId ? { ...o, quantity: Math.max(1, qty) } : o),
    );
  }, [traceId, segmentIndex, openings, setSegmentOpenings]);

  const totalSf = openings.reduce((sum, o) => sum + openingAreaSf(o), 0);

  return (
    <div className="space-y-2">
      {openings.map((opening) => (
        <div
          key={opening.id}
          className="rounded-[14px] border border-[var(--takeoff-line)] bg-white px-2.5 py-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-muted)]">
                {OPENING_LABELS[opening.type]}
              </div>
              <div className="takeoff-mono mt-1 text-[10px] text-[var(--takeoff-text-subtle)]">
                {opening.width_ft}x{opening.height_ft}&apos;
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="takeoff-mono text-[10px] text-[var(--takeoff-text-subtle)]">×</span>
              <input
                type="number"
                min={1}
                max={20}
                value={opening.quantity}
                onChange={(e) => handleQuantityChange(opening.id, parseInt(e.target.value) || 1)}
                onClick={(e) => e.stopPropagation()}
                className="takeoff-mono w-9 rounded-[10px] border border-[var(--takeoff-line)] bg-white px-1 py-1 text-center text-[10px] text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
              />
              <span className="takeoff-mono w-12 text-right text-[10px] text-[var(--takeoff-accent)]">
                -{Math.round(openingAreaSf(opening))}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); handleRemove(opening.id); }}
                className="text-[var(--takeoff-text-subtle)] transition-colors hover:text-[var(--takeoff-accent)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-1.5">
        {(['door', 'window', 'garage_door', 'sliding_door', 'french_door', 'door_opening'] as OpeningType[]).map((type) => (
          <button
            key={type}
            onClick={(e) => { e.stopPropagation(); handleAdd(type); }}
            className="takeoff-mono inline-flex items-center gap-1 rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-2.5 py-1 text-[9px] font-medium text-[var(--takeoff-text-muted)] transition-colors hover:border-[#9eb29d] hover:bg-white hover:text-[var(--takeoff-ink)]"
          >
            <Plus className="h-2.5 w-2.5" />
            {OPENING_LABELS[type]}
          </button>
        ))}
      </div>

      {totalSf > 0 && (
        <div className="takeoff-mono text-[10px] font-medium text-[var(--takeoff-accent)]">
          Opening deductions: -{Math.round(totalSf)} SF
        </div>
      )}
    </div>
  );
}
