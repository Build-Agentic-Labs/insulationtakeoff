'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Loader2, DoorOpen, RectangleHorizontal } from 'lucide-react';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import type { RegionAnalysisResult, DetectedOpening } from '@/lib/types/takeoff';

const HEIGHT_OPTIONS = [8, 9, 10] as const;

interface RegionModalProps {
  regionId: string;
  onAnalyze: (regionId: string) => Promise<RegionAnalysisResult>;
}

type LoadState = 'loading' | 'error' | 'ready';

export function RegionModal({ regionId, onAnalyze }: RegionModalProps) {
  const session = useTakeoffStore((s) => s.session);
  const confirmRegion = useTakeoffStore((s) => s.confirmRegion);
  const rejectRegion = useTakeoffStore((s) => s.rejectRegion);
  const closeModal = useTakeoffStore((s) => s.closeModal);

  const region = session?.regions.find((r) => r.id === regionId) ?? null;

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [wallLength, setWallLength] = useState<number>(0);
  const [wallHeight, setWallHeight] = useState<number | null>(null);
  const [openings, setOpenings] = useState<DetectedOpening[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [lengthInput, setLengthInput] = useState<string>('');
  const [customHeight, setCustomHeight] = useState<string>('');
  const [useCustomHeight, setUseCustomHeight] = useState(false);

  const hasFetched = useRef(false);

  const runAnalysis = () => {
    setLoadState('loading');
    setErrorMsg(null);
    hasFetched.current = true;

    onAnalyze(regionId)
      .then((result) => {
        setWallLength(result.suggested_wall_length_lf);
        setLengthInput(String(result.suggested_wall_length_lf));
        setOpenings(result.openings);

        if (result.detected_height_ft !== null) {
          setWallHeight(result.detected_height_ft);
          setUseCustomHeight(!HEIGHT_OPTIONS.includes(result.detected_height_ft as typeof HEIGHT_OPTIONS[number]));
          if (!HEIGHT_OPTIONS.includes(result.detected_height_ft as typeof HEIGHT_OPTIONS[number])) {
            setCustomHeight(String(result.detected_height_ft));
          }
        } else {
          setWallHeight(null);
        }
        setLoadState('ready');
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Analysis failed. Please try again.';
        setErrorMsg(msg);
        setLoadState('error');
      });
  };

  useEffect(() => {
    if (!hasFetched.current) {
      runAnalysis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveHeight = useCustomHeight
    ? (parseFloat(customHeight) || null)
    : wallHeight;

  const grossSf = effectiveHeight !== null ? wallLength * effectiveHeight : 0;
  const openingsSf = openings.reduce((sum, o) => sum + o.area_sf, 0);
  const netSf = Math.max(0, grossSf - openingsSf);

  const handleLengthBlur = () => {
    const parsed = parseFloat(lengthInput);
    if (!isNaN(parsed) && parsed > 0) {
      setWallLength(parsed);
    } else {
      setLengthInput(String(wallLength));
    }
  };

  const handleHeightQuickPick = (h: number) => {
    setWallHeight(h);
    setUseCustomHeight(false);
    setCustomHeight('');
  };

  const handleCustomHeightChange = (val: string) => {
    setCustomHeight(val);
    setUseCustomHeight(true);
    setWallHeight(null);
  };

  const handleConfirm = () => {
    if (effectiveHeight === null) return;
    confirmRegion(regionId, {
      wall_length_lf: wallLength,
      wall_height_ft: effectiveHeight,
      gross_sf: grossSf,
      net_sf: netSf,
      openings,
    });
  };

  const handleReject = () => rejectRegion(regionId);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) closeModal();
  };

  const label = region?.label ?? 'Region';
  const source = region?.source ?? 'ai';

  const heightIsSelected = effectiveHeight !== null && !isNaN(effectiveHeight) && effectiveHeight > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleOverlayClick}
    >
      <div
        className="w-[420px] max-h-[90vh] flex flex-col bg-zinc-50 border border-zinc-200 rounded-xl shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="region-modal-title"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-200 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2
                id="region-modal-title"
                className="text-sm font-semibold text-zinc-900 truncate"
              >
                {label}
              </h2>
              <span className="inline-flex text-[10px] font-semibold px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 shrink-0 uppercase tracking-wide">
                {source === 'ai' ? 'AI' : 'Manual'}
              </span>
            </div>
          </div>
          <button
            onClick={handleReject}
            className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors"
          >
            Reject
          </button>
          <button
            onClick={closeModal}
            className="shrink-0 p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200 transition-colors"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loadState === 'loading' && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="h-7 w-7 text-blue-600 animate-spin" />
              <p className="text-sm text-zinc-500">Analyzing region&hellip;</p>
            </div>
          )}

          {loadState === 'error' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <p className="text-sm text-red-400 text-center">{errorMsg}</p>
              <button
                onClick={runAnalysis}
                className="text-sm font-semibold px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {loadState === 'ready' && (
            <>
              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-zinc-100 rounded-lg px-3 py-3 text-center">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Length LF</p>
                  {editMode ? (
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={lengthInput}
                      onChange={(e) => setLengthInput(e.target.value)}
                      onBlur={handleLengthBlur}
                      className="w-full text-center text-base font-semibold text-white bg-zinc-100 border border-zinc-200 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500"
                    />
                  ) : (
                    <p className="text-base font-semibold text-white tabular-nums">
                      {wallLength.toFixed(1)}
                    </p>
                  )}
                </div>
                <div className="bg-zinc-100 rounded-lg px-3 py-3 text-center">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Height</p>
                  <p className="text-base font-semibold text-white tabular-nums">
                    {heightIsSelected ? `${effectiveHeight}'` : '—'}
                  </p>
                </div>
                <div className="bg-zinc-100 rounded-lg px-3 py-3 text-center">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Gross SF</p>
                  <p className="text-base font-semibold text-white tabular-nums">
                    {heightIsSelected ? Math.round(grossSf).toLocaleString() : '—'}
                  </p>
                </div>
              </div>

              {/* Height selector */}
              <div>
                <p className="text-xs font-medium text-zinc-500 mb-2">
                  Wall Height
                  {!heightIsSelected && (
                    <span className="ml-2 text-zinc-500 font-normal">(not detected — please select)</span>
                  )}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {HEIGHT_OPTIONS.map((h) => {
                    const isActive = !useCustomHeight && wallHeight === h;
                    return (
                      <button
                        key={h}
                        onClick={() => handleHeightQuickPick(h)}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                          isActive
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'bg-zinc-100 border-zinc-200 text-zinc-700 hover:border-zinc-200 hover:text-zinc-900'
                        }`}
                      >
                        {h}&apos;
                      </button>
                    );
                  })}
                  <input
                    type="number"
                    min={1}
                    step={0.5}
                    placeholder="Custom"
                    value={customHeight}
                    onChange={(e) => handleCustomHeightChange(e.target.value)}
                    className={`w-24 text-sm px-3 py-2 rounded-lg border bg-zinc-100 text-zinc-900 placeholder-zinc-600 focus:outline-none transition-colors ${
                      useCustomHeight && customHeight !== ''
                        ? 'border-blue-500'
                        : 'border-zinc-200 focus:border-zinc-200'
                    }`}
                  />
                </div>
              </div>

              {/* Openings list */}
              {openings.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-zinc-500 mb-2">Openings</p>
                  <div className="space-y-1.5">
                    {openings.map((opening) => (
                      <div
                        key={opening.id}
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-100 border border-zinc-200"
                      >
                        <div className="flex items-center gap-2">
                          {opening.type === 'door' ? (
                            <DoorOpen className="h-4 w-4 text-zinc-500 shrink-0" />
                          ) : (
                            <RectangleHorizontal className="h-4 w-4 text-zinc-500 shrink-0" />
                          )}
                          <span className="text-sm text-zinc-700">{opening.label}</span>
                        </div>
                        <span className="text-sm font-semibold text-red-400 tabular-nums">
                          -{opening.area_sf.toFixed(1)} SF
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* NET result */}
              <div className="rounded-xl bg-green-50 border border-green-200 px-5 py-4 text-center">
                <p className="text-[10px] text-green-400/70 uppercase tracking-widest mb-1">Net Insulation SF</p>
                <p className="text-4xl font-bold text-green-400 tabular-nums">
                  {heightIsSelected ? Math.round(netSf).toLocaleString() : '—'}
                </p>
                {heightIsSelected && openingsSf > 0 && (
                  <p className="text-xs text-zinc-500 mt-1.5">
                    {Math.round(grossSf).toLocaleString()} gross &minus; {Math.round(openingsSf).toLocaleString()} openings
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {loadState === 'ready' && (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-zinc-200 shrink-0">
            <button
              onClick={() => setEditMode((prev) => !prev)}
              className={`text-sm font-semibold px-4 py-2 rounded-lg border transition-colors ${
                editMode
                  ? 'bg-zinc-100 border-zinc-200 text-zinc-900'
                  : 'bg-transparent border-zinc-200 text-zinc-500 hover:text-zinc-900 hover:border-zinc-200'
              }`}
            >
              {editMode ? 'Done Editing' : 'Edit Values'}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!heightIsSelected}
              className="flex items-center gap-2 text-sm font-semibold px-5 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Confirm
              {heightIsSelected && (
                <span className="tabular-nums">({Math.round(netSf).toLocaleString()} SF)</span>
              )}
              <span aria-hidden>→</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
