'use client';

import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import { Button } from '@/components/ui/button';

interface RunningTotalProps {
  onGenerateQuote: () => void;
}

export function RunningTotal({ onGenerateQuote }: RunningTotalProps) {
  const total = useTakeoffStore((s) => s.getRunningTotal());
  const progress = total.region_count > 0
    ? (total.confirmed_count / total.region_count) * 100
    : 0;

  return (
    <div className="border-t border-zinc-800 p-4 bg-zinc-900/50 space-y-3">
      {/* Label + Net SF */}
      <div>
        <p className="text-xs text-zinc-500 mb-1">Running Total</p>
        <p className="text-3xl font-bold text-white tabular-nums">
          {Math.round(total.net_sf).toLocaleString()}
        </p>
        <p className="text-[10px] text-zinc-500 mt-0.5">net SF</p>
      </div>

      {/* Regions confirmed */}
      <p className="text-xs text-zinc-400">
        {total.confirmed_count} of {total.region_count} regions confirmed
      </p>

      {/* Progress bar */}
      <div className="h-px bg-zinc-800 rounded overflow-hidden">
        <div
          className="h-full bg-green-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Generate Quote button */}
      <Button
        onClick={onGenerateQuote}
        disabled={total.confirmed_count === 0}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Generate Quote →
      </Button>
    </div>
  );
}
