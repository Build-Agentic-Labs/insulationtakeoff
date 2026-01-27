"use client";

interface ScanningOverlayProps {
  isActive: boolean;
}

export function ScanningOverlay({ isActive }: ScanningOverlayProps) {
  if (!isActive) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(34,211,238,1) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,1) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Animated scan line */}
      <div
        className="absolute left-0 right-0 h-[2px] animate-scan-sweep"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.2) 20%, rgba(34,211,238,0.8) 50%, rgba(34,211,238,0.2) 80%, transparent 100%)',
        }}
      >
        {/* Glow beneath the scan line */}
        <div
          className="absolute left-0 right-0 top-0 h-16"
          style={{
            background:
              'linear-gradient(180deg, rgba(34,211,238,0.15) 0%, transparent 100%)',
          }}
        />
      </div>

      {/* Corner brackets */}
      <div className="absolute inset-4">
        {/* Top-left */}
        <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-cyan-400/60" />
        {/* Top-right */}
        <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-cyan-400/60" />
        {/* Bottom-left */}
        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-cyan-400/60" />
        {/* Bottom-right */}
        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-cyan-400/60" />
      </div>

      {/* Dim overlay */}
      <div className="absolute inset-0 bg-zinc-900/20" />
    </div>
  );
}
