'use client';

import { MousePointer2, Square, ZoomIn, ZoomOut } from 'lucide-react';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';

interface ToolBarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function ToolBar({ onZoomIn, onZoomOut }: ToolBarProps) {
  const tool = useTakeoffStore((s) => s.tool);
  const setTool = useTakeoffStore((s) => s.setTool);

  const activeClass =
    'bg-blue-600/20 border-blue-500 text-blue-400';
  const inactiveClass =
    'bg-zinc-900 border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400';

  return (
    <div className="flex items-center gap-1">
      {/* Pointer tool */}
      <button
        onClick={() => setTool('pointer')}
        title="Pointer"
        aria-label="Pointer tool"
        className={`w-7 h-7 flex items-center justify-center rounded border transition-colors ${
          tool === 'pointer' ? activeClass : inactiveClass
        }`}
      >
        <MousePointer2 className="h-3.5 w-3.5" />
      </button>

      {/* Rectangle tool */}
      <button
        onClick={() => setTool('rectangle')}
        title="Draw region"
        aria-label="Rectangle tool"
        className={`w-7 h-7 flex items-center justify-center rounded border transition-colors ${
          tool === 'rectangle' ? activeClass : inactiveClass
        }`}
      >
        <Square className="h-3.5 w-3.5" />
      </button>

      {/* Divider */}
      <div className="w-px h-4 bg-zinc-700 mx-1" />

      {/* Zoom out */}
      <button
        onClick={onZoomOut}
        title="Zoom out"
        aria-label="Zoom out"
        className={`w-7 h-7 flex items-center justify-center rounded border transition-colors ${inactiveClass}`}
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </button>

      {/* Zoom in */}
      <button
        onClick={onZoomIn}
        title="Zoom in"
        aria-label="Zoom in"
        className={`w-7 h-7 flex items-center justify-center rounded border transition-colors ${inactiveClass}`}
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
