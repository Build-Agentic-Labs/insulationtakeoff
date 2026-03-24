'use client';

import { CheckCircle2 } from 'lucide-react';
import type { TakeoffRegion } from '@/lib/types/takeoff';

interface RegionCardProps {
  region: TakeoffRegion;
  onClick: () => void;
}

export function RegionCard({ region, onClick }: RegionCardProps) {
  const isConfirmed = region.status === 'confirmed';
  const borderColor = isConfirmed
    ? 'border-green-500/30 hover:border-green-500/50'
    : 'border-blue-500/30 hover:border-blue-500/50';

  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg bg-zinc-900 border px-4 py-3 transition-all text-left hover:bg-zinc-800 ${borderColor}`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: Label + Dimensions */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-semibold text-zinc-100 truncate">
              {region.label}
            </h3>
            {isConfirmed ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-green-500/20 text-green-400 shrink-0">
                <CheckCircle2 className="h-3 w-3" />
                Done
              </span>
            ) : (
              <span className="inline-flex text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 shrink-0">
                Analyze →
              </span>
            )}
          </div>

          {isConfirmed ? (
            <p className="text-xs text-zinc-400 mb-2">
              {region.wall_length_lf?.toFixed(1)}' LF × {region.wall_height_ft?.toFixed(1)}'
            </p>
          ) : (
            <p className="text-xs text-zinc-500 mb-2">
              AI detected • not yet confirmed
            </p>
          )}
        </div>

        {/* Right: Net SF + Opening count */}
        <div className="text-right shrink-0">
          {isConfirmed && (
            <>
              <p className="text-lg font-semibold text-white tabular-nums">
                {Math.round(region.net_sf ?? 0).toLocaleString()}
              </p>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                {region.openings.length} opening{region.openings.length !== 1 ? 's' : ''}
              </p>
            </>
          )}
        </div>
      </div>
    </button>
  );
}
