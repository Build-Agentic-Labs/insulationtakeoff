'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, MousePointer2, PenLine, Pentagon, Ruler } from 'lucide-react';
import { BlueprintViewer, type BlueprintViewerHandle } from '@/components/takeoff/BlueprintViewer';
import { CalibrationOverlay } from '@/components/takeoff/CalibrationOverlay';
import { WallThicknessOverlay } from '@/components/takeoff/WallThicknessOverlay';
import { WallTraceOverlay } from '@/components/takeoff/WallTraceOverlay';
import { DoorToolOverlay } from '@/components/takeoff/DoorToolOverlay';
import { WindowToolOverlay } from '@/components/takeoff/WindowToolOverlay';
import { useBlueprintPageHotkeys } from '@/components/takeoff/useBlueprintPageHotkeys';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import { SURFACE_PRESET_OPTIONS, getSurfacePreset, getWallPreset, type SurfacePresetKey, type WallPresetKey } from '@/lib/takeoff/presets';
import { formatFeetInches, parseDimensionToFeet, type OpeningType } from '@/lib/types/takeoff';

interface WallToolDemoWorkspaceProps {
  pdfUrl: string;
}

type WindowToolMode = 'idle' | 'capture' | 'place';
type DoorToolMode = 'idle' | 'capture' | 'place';

const DOOR_TYPE_LABELS: Record<Exclude<OpeningType, 'window'>, string> = {
  door: 'Door',
  french_door: 'French Door',
  garage_door: 'Garage Door',
  sliding_door: 'Sliding Door',
  door_opening: 'Door Opening',
};

function formatDoorCatalogLabel(type: Exclude<OpeningType, 'window'>, widthFt: number, heightFt: number) {
  return `${DOOR_TYPE_LABELS[type]} · ${formatFeetInches(widthFt)} x ${formatFeetInches(heightFt)}`;
}

function PagePill({
  active,
  verified,
  label,
  onClick,
}: {
  active: boolean;
  verified: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`takeoff-mono rounded-full border px-3 py-2 text-[11px] font-medium transition-colors ${
        active
          ? 'border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] text-white'
          : 'border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.92)] text-[var(--takeoff-ink)] hover:border-[#9eb29d]'
      }`}
    >
      {label} {verified ? 'Verified' : 'Pending'}
    </button>
  );
}

export function WallToolDemoWorkspace({ pdfUrl }: WallToolDemoWorkspaceProps) {
  const viewerRef = useRef<BlueprintViewerHandle>(null);

  const session = useTakeoffStore((state) => state.session);
  const activePageIndex = useTakeoffStore((state) => state.activePageIndex);
  const activeTracePoints = useTakeoffStore((state) => state.activeTracePoints);
  const activeWallFillSide = useTakeoffStore((state) => state.activeWallFillSide);
  const activeWallPresetKey = useTakeoffStore((state) => state.wallPreset);
  const drawingPreset = useTakeoffStore((state) => state.drawingPreset);
  const activeSurfacePresetKey = useTakeoffStore((state) => state.surfacePreset);
  const calibrationStep = useTakeoffStore((state) => state.calibrationStep);
  const selectedTraceId = useTakeoffStore((state) => state.selectedTraceId);
  const selectedSegmentIndex = useTakeoffStore((state) => state.selectedSegmentIndex);
  const tool = useTakeoffStore((state) => state.tool);
  const setActivePage = useTakeoffStore((state) => state.setActivePage);
  const setDrawingPreset = useTakeoffStore((state) => state.setDrawingPreset);
  const setSurfacePreset = useTakeoffStore((state) => state.setSurfacePreset);
  const setTool = useTakeoffStore((state) => state.setTool);
  const setWallPreset = useTakeoffStore((state) => state.setWallPreset);
  const updateSurfaceObject = useTakeoffStore((state) => state.updateSurfaceObject);
  const continueTrace = useTakeoffStore((state) => state.continueTrace);
  const deleteTrace = useTakeoffStore((state) => state.deleteTrace);
  const deleteTraceSegment = useTakeoffStore((state) => state.deleteTraceSegment);
  const startCalibration = useTakeoffStore((state) => state.startCalibration);
  const startTrace = useTakeoffStore((state) => state.startTrace);
  const removeLastTracePoint = useTakeoffStore((state) => state.removeLastTracePoint);
  const upsertWindowCatalogItem = useTakeoffStore((state) => state.upsertWindowCatalogItem);
  const upsertDoorCatalogItem = useTakeoffStore((state) => state.upsertDoorCatalogItem);
  const getCalibration = useTakeoffStore((state) => state.getCalibration);
  const getDerivedAreas = useTakeoffStore((state) => state.getDerivedAreas);
  const getDerivedSegments = useTakeoffStore((state) => state.getDerivedSegments);

  const [pageTrayOpen, setPageTrayOpen] = useState(false);
  const [windowToolMode, setWindowToolMode] = useState<WindowToolMode>('idle');
  const [doorToolMode, setDoorToolMode] = useState<DoorToolMode>('idle');
  const [windowWidthText, setWindowWidthText] = useState(`5'-0"`);
  const [windowHeightText, setWindowHeightText] = useState(`5'-0"`);
  const [windowSourceText, setWindowSourceText] = useState<string | null>(null);
  const [windowStatus, setWindowStatus] = useState<string | null>(null);
  const [selectedWindowCatalogId, setSelectedWindowCatalogId] = useState<string | null>(null);
  const [doorWidthText, setDoorWidthText] = useState(`3'-0"`);
  const [doorHeightText, setDoorHeightText] = useState(`6'-8"`);
  const [doorType, setDoorType] = useState<Exclude<OpeningType, 'window'>>('door');
  const [doorSourceText, setDoorSourceText] = useState<string | null>(null);
  const [doorStatus, setDoorStatus] = useState<string | null>(null);
  const [selectedDoorCatalogId, setSelectedDoorCatalogId] = useState<string | null>(null);
  const [surfaceStatus, setSurfaceStatus] = useState<string | null>(null);

  const calibration = getCalibration();
  const isVerified = Boolean(calibration?.verification);
  const showCalibrationOverlay =
    calibrationStep !== 'idle' && calibrationStep !== 'done';
  const activeWallPreset = getWallPreset(activeWallPresetKey);
  const activeSurfacePreset = getSurfacePreset(activeSurfacePresetKey);
  const sixInchPreset = getWallPreset('exterior_2x6');
  const fourInchPreset = getWallPreset('exterior_2x4');
  const isPointerMode = tool === 'pointer';
  const isTraceMode = tool === 'trace';
  const isSurfaceTraceMode = isTraceMode && drawingPreset === 'surface';
  const isCalibrateMode = showCalibrationOverlay || tool === 'calibrate';
  const selectedTrace = selectedTraceId
    ? session?.traces.find((trace) => trace.id === selectedTraceId) ?? null
    : null;
  const selectedOpenWall =
    selectedTrace && selectedTrace.type === 'linear' && !selectedTrace.isClosed
      ? selectedTrace
      : null;
  const selectedSurfaceTrace =
    selectedTrace && selectedTrace.type === 'area' && !selectedTrace.zone
      ? selectedTrace
      : null;
  const canContinueSelectedWall = isPointerMode && Boolean(selectedOpenWall);
  const canDeleteSelectedSegment =
    isPointerMode && Boolean(selectedOpenWall) && selectedSegmentIndex !== null;
  const canDeleteSelectedTrace = isPointerMode && Boolean(selectedTrace);
  const deleteSelectionLabel = (() => {
    if (canDeleteSelectedSegment) return 'Delete segment';
    if (selectedTrace?.isClosed || selectedTrace?.type === 'area') return 'Delete shape';
    if (selectedTrace) return 'Delete wall';
    return 'Delete selection';
  })();
  const parsedWindowWidthFt = parseDimensionToFeet(windowWidthText);
  const parsedWindowHeightFt = parseDimensionToFeet(windowHeightText);
  const parsedDoorWidthFt = parseDimensionToFeet(doorWidthText);
  const parsedDoorHeightFt = parseDimensionToFeet(doorHeightText);
  const windowPreset =
    parsedWindowWidthFt && parsedWindowHeightFt
      ? {
          widthFt: parsedWindowWidthFt,
          heightFt: parsedWindowHeightFt,
          label: `${formatFeetInches(parsedWindowWidthFt)} x ${formatFeetInches(parsedWindowHeightFt)}`,
          sourceText: windowSourceText,
        }
      : null;
  const doorPreset =
    parsedDoorWidthFt && parsedDoorHeightFt
      ? {
          type: doorType,
          widthFt: parsedDoorWidthFt,
          heightFt: parsedDoorHeightFt,
          label: formatDoorCatalogLabel(doorType, parsedDoorWidthFt, parsedDoorHeightFt),
          sourceText: doorSourceText,
        }
      : null;
  const selectedSegmentMetrics = useMemo(() => {
    if (!session || selectedTraceId === null || selectedSegmentIndex === null) {
      return null;
    }

    const selectedTraceForMetrics =
      session.traces.find((trace) => trace.id === selectedTraceId) ?? null;
    if (!selectedTraceForMetrics || selectedTraceForMetrics.pageIndex !== activePageIndex) {
      return null;
    }

    return (
      getDerivedSegments().find(
        (segment) =>
          segment.traceId === selectedTraceId && segment.segmentIndex === selectedSegmentIndex,
      ) ?? null
    );
  }, [activePageIndex, getDerivedSegments, selectedSegmentIndex, selectedTraceId, session]);
  const selectedAreaMetrics = useMemo(() => {
    if (!session || !selectedTraceId) {
      return null;
    }

    const selectedTraceForMetrics =
      session.traces.find((trace) => trace.id === selectedTraceId) ?? null;
    if (!selectedTraceForMetrics || selectedTraceForMetrics.pageIndex !== activePageIndex || selectedTraceForMetrics.type !== 'area' || selectedTraceForMetrics.zone) {
      return null;
    }

    return (
      getDerivedAreas().find((area) => area.traceId === selectedTraceId) ?? null
    );
  }, [activePageIndex, getDerivedAreas, selectedTraceId, session]);
  const isWindowCaptureMode = windowToolMode === 'capture';
  const isWindowPlaceMode = windowToolMode === 'place';
  const isWindowToolActive = isWindowCaptureMode || isWindowPlaceMode;
  const isDoorCaptureMode = doorToolMode === 'capture';
  const isDoorPlaceMode = doorToolMode === 'place';
  const isDoorToolActive = isDoorCaptureMode || isDoorPlaceMode;
  const canResetWindowTool =
    isWindowToolActive || Boolean(windowSourceText) || Boolean(windowStatus);
  const canResetDoorTool =
    isDoorToolActive || Boolean(doorSourceText) || Boolean(doorStatus);
  const windowCatalog = useMemo(() => session?.windowCatalog ?? [], [session?.windowCatalog]);
  const doorCatalog = useMemo(() => session?.doorCatalog ?? [], [session?.doorCatalog]);
  const matchedCatalogItem = windowPreset
    ? windowCatalog.find(
        (item) =>
          Math.abs(item.widthFt - windowPreset.widthFt) <= 0.01 &&
          Math.abs(item.heightFt - windowPreset.heightFt) <= 0.01,
      ) ?? null
    : null;
  const activeWindowCatalogId = selectedWindowCatalogId ?? matchedCatalogItem?.id ?? null;
  const matchedDoorCatalogItem = doorPreset
    ? doorCatalog.find(
        (item) =>
          item.type === doorPreset.type &&
          Math.abs(item.widthFt - doorPreset.widthFt) <= 0.01 &&
          Math.abs(item.heightFt - doorPreset.heightFt) <= 0.01,
      ) ?? null
    : null;
  const activeDoorCatalogId = selectedDoorCatalogId ?? matchedDoorCatalogItem?.id ?? null;
  const selectedSurfaceScope = selectedAreaMetrics?.classification?.assemblyScope ?? null;
  const canApplySurfacePresetToSelection =
    Boolean(selectedSurfaceTrace) &&
    selectedSurfaceScope !== activeSurfacePreset.scope;

  const cursorMode =
    showCalibrationOverlay || tool === 'trace' || isWindowToolActive || isDoorToolActive
      ? 'crosshair'
      : 'default';

  const selectedPages = useMemo(() => session?.selectedPages ?? [], [session?.selectedPages]);
  const pageAnalysis = session?.pageAnalysis ?? [];
  const activePageTitle =
    pageAnalysis.find((page) => page.pageIndex === activePageIndex)?.title?.trim() ||
    `Page ${activePageIndex + 1}`;

  const verifiedPages = selectedPages.filter((pageIndex) =>
    Boolean(session?.calibrations[pageIndex]?.verification),
  );

  const bandWidthForInches = (thicknessIn: number) => {
    const viewer = viewerRef.current;
    if (!viewer || !calibration) return null;

    const origin = viewer.pageCoordsToCss(0, 0);
    const offset = viewer.pageCoordsToCss(
      calibration.pdfPointsPerFoot * (thicknessIn / 12),
      0,
    );

    if (!origin || !offset) return null;

    return Math.abs(offset.x - origin.x);
  };

  const fourInchBandWidth = bandWidthForInches(4);
  const sixInchBandWidth = bandWidthForInches(6);

  useEffect(() => {
    if (!selectedWindowCatalogId) return;
    if (windowCatalog.some((item) => item.id === selectedWindowCatalogId)) return;
    setSelectedWindowCatalogId(null);
  }, [selectedWindowCatalogId, windowCatalog]);

  useEffect(() => {
    if (!selectedDoorCatalogId) return;
    if (doorCatalog.some((item) => item.id === selectedDoorCatalogId)) return;
    setSelectedDoorCatalogId(null);
  }, [selectedDoorCatalogId, doorCatalog]);

  const handleTraceWall = (presetKey: WallPresetKey) => {
    if (!isVerified) return;
    setWindowToolMode('idle');
    setDoorToolMode('idle');
    setSurfaceStatus(null);
    setDrawingPreset('wall');
    setWallPreset(presetKey);
    startTrace('linear');
  };

  const handleTraceSurface = (presetKey: SurfacePresetKey = activeSurfacePresetKey) => {
    if (!isVerified) return;
    setWindowToolMode('idle');
    setDoorToolMode('idle');
    setSurfaceStatus(null);
    setDrawingPreset('surface');
    setSurfacePreset(presetKey);
    startTrace('area');
  };

  const handleApplySurfacePresetToSelection = () => {
    if (!selectedSurfaceTrace) return;

    updateSurfaceObject(selectedSurfaceTrace.id, {
      assemblyScope: activeSurfacePreset.scope,
      label: activeSurfacePreset.label,
    });
    setSurfaceStatus(`Applied ${activeSurfacePreset.label} to the selected area.`);
  };

  useEffect(() => {
    if (windowToolMode === 'idle') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setWindowToolMode('idle');
      setWindowStatus(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [windowToolMode]);

  useEffect(() => {
    if (doorToolMode === 'idle') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setDoorToolMode('idle');
      setDoorStatus(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [doorToolMode]);

  useBlueprintPageHotkeys({
    activePageIndex,
    selectedPages,
    setActivePage,
    disabled: tool === 'trace' || showCalibrationOverlay,
    onBeforeNavigate: () => setPageTrayOpen(false),
  });

  const handleStartCaptureWindow = () => {
    setTool('pointer');
    setDoorToolMode('idle');
    setWindowToolMode('capture');
    setWindowStatus('Drag a box around the printed window size.');
  };

  const handleStartPlaceWindow = () => {
    if (!windowPreset) return;
    setTool('pointer');
    setDoorToolMode('idle');
    setWindowToolMode('place');
    setWindowStatus(`Placing ${windowPreset.label} openings on wall segments.`);
  };

  const handleResetWindowTool = () => {
    setWindowToolMode('idle');
    setWindowSourceText(null);
    setWindowStatus(null);
  };

  const handleStartCaptureDoor = () => {
    setTool('pointer');
    setWindowToolMode('idle');
    setDoorToolMode('capture');
    setDoorStatus('Drag a box around the printed door size.');
  };

  const handleStartPlaceDoor = () => {
    if (!doorPreset) return;
    setTool('pointer');
    setWindowToolMode('idle');
    setDoorToolMode('place');
    setDoorStatus(`Placing ${doorPreset.label} openings on wall segments.`);
  };

  const handleResetDoorTool = () => {
    setDoorToolMode('idle');
    setDoorSourceText(null);
    setDoorStatus(null);
  };

  const handleSelectWindowCatalogItem = (catalogItemId: string) => {
    const catalogItem = windowCatalog.find((item) => item.id === catalogItemId);
    if (!catalogItem) return;

    setSelectedWindowCatalogId(catalogItem.id);
    setWindowWidthText(formatFeetInches(catalogItem.widthFt));
    setWindowHeightText(formatFeetInches(catalogItem.heightFt));
    setWindowSourceText(catalogItem.sourceText ?? null);
    setWindowToolMode('idle');
    setWindowStatus(
      `Selected ${catalogItem.label} from this plan set's window catalog. Click Place windows to stamp it onto wall segments.`,
    );
  };

  const handleSaveCurrentWindowToCatalog = () => {
    if (!windowPreset) return;

    const result = upsertWindowCatalogItem({
      widthFt: windowPreset.widthFt,
      heightFt: windowPreset.heightFt,
      label: windowPreset.label,
      sourceText: windowSourceText,
      pageIndex: activePageIndex,
    });

    if (!result) return;

    setSelectedWindowCatalogId(result.id);
    setWindowStatus(
      result.isNew
        ? `Saved ${windowPreset.label} to this plan set's window catalog.`
        : `Updated the existing ${windowPreset.label} catalog item for this plan set.`,
    );
  };

  const handleSelectDoorCatalogItem = (catalogItemId: string) => {
    const catalogItem = doorCatalog.find((item) => item.id === catalogItemId);
    if (!catalogItem) return;

    setSelectedDoorCatalogId(catalogItem.id);
    setDoorType(catalogItem.type);
    setDoorWidthText(formatFeetInches(catalogItem.widthFt));
    setDoorHeightText(formatFeetInches(catalogItem.heightFt));
    setDoorSourceText(catalogItem.sourceText ?? null);
    setDoorToolMode('idle');
    setDoorStatus(
      `Selected ${catalogItem.label} from this plan set's door catalog. Click Place doors to stamp it onto wall segments.`,
    );
  };

  const handleSaveCurrentDoorToCatalog = () => {
    if (!doorPreset) return;

    const result = upsertDoorCatalogItem({
      type: doorPreset.type,
      widthFt: doorPreset.widthFt,
      heightFt: doorPreset.heightFt,
      label: doorPreset.label,
      sourceText: doorSourceText,
      pageIndex: activePageIndex,
    });

    if (!result) return;

    setSelectedDoorCatalogId(result.id);
    setDoorStatus(
      result.isNew
        ? `Saved ${doorPreset.label} to this plan set's door catalog.`
        : `Updated the existing ${doorPreset.label} catalog item for this plan set.`,
    );
  };

  const instructionText = (() => {
    switch (calibrationStep) {
      case 'primary_a':
        return 'Pick the first endpoint of a known dimension.';
      case 'primary_input':
        return 'Enter the first dimension to establish scale.';
      case 'verify_a':
        return 'Pick a second known dimension to verify scale.';
      case 'verify_input':
        return 'Enter the second dimension to lock the 6-inch wall tool.';
      default:
        if (isWindowCaptureMode) {
          return 'Drag a box around a compact printed window size note. Confirmed captures are added to this plan set’s window catalog and capture stays armed so you can move straight to the next window.';
        }
        if (isDoorCaptureMode) {
          return 'Drag a box around a compact printed door size note. The door prompt is tuned for regular doors, French doors, garage doors, sliding doors, and door openings. Width-only notes like 3\'-0" METAL default to 6\'-8" tall, and you can update that if needed.';
        }
        if (isWindowPlaceMode && windowPreset) {
          return `Click any wall segment to place one ${windowPreset.label} window. Each click adds another opening and subtracts ${Math.round(windowPreset.widthFt * windowPreset.heightFt)} SF from that segment once the wall height is defined.`;
        }
        if (isDoorPlaceMode && doorPreset) {
          return `Click any wall segment to place one ${doorPreset.label}. Each click adds another door opening and subtracts ${Math.round(doorPreset.widthFt * doorPreset.heightFt)} SF from that segment once the wall height is defined.`;
        }
        if (tool === 'trace' && drawingPreset === 'surface' && activeTracePoints.length > 0) {
          return `Outline the ${activeSurfacePreset.label.toLowerCase()} boundary. Double-click or press Enter to close the shape, then Select / Edit if you need to fine-tune the area points.`;
        }
        if (tool === 'trace' && activeTracePoints.length > 0) {
          return `Keep tracing the exterior edge with the ${activeWallPreset.thicknessIn}" wall tool. The arrow near the cursor shows which side the wall band will fill, and Tab flips it to the ${activeWallFillSide === 'left' ? 'right' : 'left'} side. You can drag a placed point to adjust it, Backspace to undo, or press Esc repeatedly to back out step-by-step until you return to Select / Edit.`;
        }
        if (tool === 'pointer' && selectedSurfaceTrace && selectedAreaMetrics) {
          return `This surface area is selected. It currently measures ${Math.round(selectedAreaMetrics.areaSf)} SF with ${Math.round(selectedAreaMetrics.perimeterLf)} LF of perimeter. Drag points to fine-tune it or switch the surface preset below.`;
        }
        if (tool === 'pointer' && selectedTraceId) {
          if (selectedSegmentIndex !== null) {
            if (selectedOpenWall) {
              return 'This wall segment is selected. Press Delete or use Delete segment to split it out, or switch to Continue wall to keep tracing from the end.';
            }
            return 'This closed shape is selected. Press Delete or use Delete shape to remove the entire shape.';
          }
          if (selectedOpenWall) {
            return 'This wall is selected. Drag any point to fine-tune it, or use Continue wall to keep tracing from the endpoint.';
          }
          return 'This shape is selected. Drag any point to fine-tune it, or press Delete to remove the whole shape.';
        }
        if (tool === 'pointer') {
          return 'Use Select / Edit mode to click a completed wall, then drag any point to fine-tune it or click a segment to target it for deletion.';
        }
        return isVerified
          ? 'Trace wall centerlines and compare the red band against the wall thickness on the sheet.'
          : 'Run the two-step calibration first, then the 6-inch wall tool will unlock.';
    }
  })();

  return (
    <div className="takeoff-shell takeoff-light-theme h-full overflow-hidden text-[var(--takeoff-ink)]">
      <div className="relative h-full overflow-hidden rounded-[8px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.74)] shadow-[0_30px_72px_rgba(31,39,33,0.12)]">
        <div className="absolute inset-0 z-10 overflow-hidden rounded-[8px] border border-[var(--takeoff-line)] bg-[var(--takeoff-canvas)] shadow-[0_18px_36px_rgba(31,39,33,0.12)]">
          <div className="takeoff-dot-grid h-full overflow-hidden rounded-[8px] bg-[var(--takeoff-canvas)]">
            <BlueprintViewer
              ref={viewerRef}
              pdfUrl={pdfUrl}
              pageNumber={activePageIndex + 1}
              cursorMode={cursorMode}
              disableLeftMousePan
            >
              {(dims) => (
                <>
                  <WallThicknessOverlay
                    viewerRef={viewerRef}
                    pageWidth={dims.width}
                    pageHeight={dims.height}
                    defaultThicknessIn={6}
                  />
                  <WallTraceOverlay
                    viewerRef={viewerRef}
                    pageWidth={dims.width}
                    pageHeight={dims.height}
                    pdfUrl={pdfUrl}
                  />
                  <WindowToolOverlay
                    viewerRef={viewerRef}
                    pageWidth={dims.width}
                    pageHeight={dims.height}
                    pdfUrl={pdfUrl}
                    mode={windowToolMode}
                    preset={windowPreset}
                    onCaptureComplete={({
                      sourceText,
                      detectedWidthFt,
                      detectedHeightFt,
                      detectionMethod,
                      confirmed,
                      disposition,
                    }) => {
                      setWindowSourceText(sourceText || null);

                      if (confirmed && detectedWidthFt && detectedHeightFt) {
                        setWindowToolMode('capture');
                        setWindowWidthText(formatFeetInches(detectedWidthFt));
                        setWindowHeightText(formatFeetInches(detectedHeightFt));
                        const catalogResult = upsertWindowCatalogItem({
                          widthFt: detectedWidthFt,
                          heightFt: detectedHeightFt,
                          label: `${formatFeetInches(detectedWidthFt)} x ${formatFeetInches(detectedHeightFt)}`,
                          sourceText,
                          pageIndex: activePageIndex,
                        });
                        setSelectedWindowCatalogId(catalogResult?.id ?? null);
                        setWindowStatus(
                          detectionMethod === 'vision'
                            ? `${catalogResult?.isNew ? 'Added' : 'Updated'} ${formatFeetInches(detectedWidthFt)} x ${formatFeetInches(detectedHeightFt)} in the window catalog from vision. Capture is still active for the next window.`
                            : `Detected ${formatFeetInches(detectedWidthFt)} x ${formatFeetInches(detectedHeightFt)} from the captured note.`,
                        );
                        return;
                      }

                      setWindowToolMode('capture');
                      setSelectedWindowCatalogId(null);
                      setWindowWidthText('');
                      setWindowHeightText('');

                      if (disposition === 'invalid_target') {
                        setWindowStatus(
                          sourceText
                            ? `"${sourceText}" does not look like a window dimension. Drag a compact window size note like 6'-0" x 5'-0".`
                            : 'That selection does not look like a window dimension. Drag a compact window size note like 6\'-0" x 5\'-0".',
                        );
                        return;
                      }

                      setWindowStatus(
                        sourceText
                          ? `${detectionMethod === 'vision' ? 'Vision saw' : 'Captured'} "${sourceText}", but it was not confident enough to confirm the size. Type the width and height manually or drag a new box.`
                          : 'The vision model could not confidently confirm a dimension from that box. Type the width and height manually or drag a new box.',
                      );
                    }}
                    onPlacement={({ segmentIndex, openingArea, openingCount }) => {
                      setWindowStatus(
                        `Placed on segment ${segmentIndex + 1}. Openings on that segment now total ${Math.round(openingArea)} SF across ${openingCount} window${openingCount === 1 ? '' : 's'}.`,
                      );
                    }}
                  />
                  <DoorToolOverlay
                    viewerRef={viewerRef}
                    pageWidth={dims.width}
                    pageHeight={dims.height}
                    pdfUrl={pdfUrl}
                    mode={doorToolMode}
                    preset={doorPreset}
                    onCaptureComplete={({
                      sourceText,
                      detectedWidthFt,
                      detectedHeightFt,
                      detectedOpeningType,
                      designationRaw,
                      designationNormalized,
                      dimensionFormat,
                      detectionMethod,
                      confirmed,
                      disposition,
                    }) => {
                      setDoorSourceText(sourceText || null);

                      if (confirmed && detectedWidthFt && detectedHeightFt) {
                        setDoorToolMode('capture');
                        setDoorType(detectedOpeningType);
                        setDoorWidthText(formatFeetInches(detectedWidthFt));
                        setDoorHeightText(formatFeetInches(detectedHeightFt));
                        const catalogResult = upsertDoorCatalogItem({
                          type: detectedOpeningType,
                          widthFt: detectedWidthFt,
                          heightFt: detectedHeightFt,
                          label: formatDoorCatalogLabel(
                            detectedOpeningType,
                            detectedWidthFt,
                            detectedHeightFt,
                          ),
                          sourceText,
                          designationRaw,
                          designationNormalized,
                          dimensionFormat,
                          pageIndex: activePageIndex,
                        });
                        setSelectedDoorCatalogId(catalogResult?.id ?? null);
                        setDoorStatus(
                          disposition === 'width_only'
                            ? `${catalogResult?.isNew ? 'Added' : 'Updated'} ${formatDoorCatalogLabel(detectedOpeningType, detectedWidthFt, detectedHeightFt)} from a width-only note. Defaulted the height to ${formatFeetInches(detectedHeightFt)}. Capture is still active for the next door.`
                            : detectionMethod === 'vision'
                              ? `${catalogResult?.isNew ? 'Added' : 'Updated'} ${formatDoorCatalogLabel(detectedOpeningType, detectedWidthFt, detectedHeightFt)} in the door catalog from vision. Capture is still active for the next door.`
                              : `Detected ${formatDoorCatalogLabel(detectedOpeningType, detectedWidthFt, detectedHeightFt)} from the captured note.`,
                        );
                        return;
                      }

                      setDoorToolMode('capture');
                      setSelectedDoorCatalogId(null);
                      setDoorWidthText('');
                      setDoorHeightText('');

                      if (disposition === 'invalid_target') {
                        setDoorStatus(
                          sourceText
                            ? `"${sourceText}" does not look like a door dimension. Drag a compact door size note like 3068 or 16'-0" x 7'-0" OH.`
                            : 'That selection does not look like a door dimension. Drag a compact door size note like 3068 or 16\'-0" x 7\'-0" OH.',
                        );
                        return;
                      }

                      setDoorStatus(
                        sourceText
                          ? `${detectionMethod === 'vision' ? 'Vision saw' : 'Captured'} "${sourceText}", but it was not confident enough to confirm the door size. Type the width and height manually, adjust the type, or drag a new box.`
                          : 'The vision model could not confidently confirm a door dimension from that box. Type the width and height manually, adjust the type, or drag a new box.',
                      );
                    }}
                    onPlacement={({ segmentIndex, openingArea, openingCount }) => {
                      setDoorStatus(
                        `Placed on segment ${segmentIndex + 1}. Door openings on that segment now total ${Math.round(openingArea)} SF across ${openingCount} opening${openingCount === 1 ? '' : 's'}.`,
                      );
                    }}
                  />
                  {showCalibrationOverlay && (
                    <CalibrationOverlay
                      viewerRef={viewerRef}
                      pageWidth={dims.width}
                      pageHeight={dims.height}
                    />
                  )}
                </>
              )}
            </BlueprintViewer>
          </div>
        </div>

        <div className="pointer-events-none absolute left-4 top-4 bottom-20 z-20 w-[min(24rem,calc(100%-2rem))]">
          <div className="takeoff-hide-scrollbar pointer-events-auto flex h-full min-h-0 flex-col overflow-y-auto rounded-[20px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.9)] px-4 py-4 shadow-[0_18px_36px_rgba(31,39,33,0.12)] backdrop-blur-xl">
            <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
              Wall tool demo
            </div>
            <div className="mt-1 text-[15px] font-medium text-[var(--takeoff-ink)]">
              {activePageTitle}
            </div>
            <div className="mt-2 text-[12px] leading-5 text-[var(--takeoff-text-muted)]">
              {instructionText}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setWindowToolMode('idle');
                  setDoorToolMode('idle');
                  setTool('pointer');
                }}
                className={`takeoff-mono inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-medium transition-colors ${
                  isPointerMode && !isWindowToolActive && !isDoorToolActive
                    ? 'border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] text-white'
                    : 'border-[var(--takeoff-line)] bg-white text-[var(--takeoff-ink)]'
                }`}
              >
                <MousePointer2 className="h-3.5 w-3.5" />
                Select / Edit
              </button>
              <button
                onClick={() => {
                  setWindowToolMode('idle');
                  setDoorToolMode('idle');
                  startCalibration();
                }}
                className={`takeoff-mono inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-medium transition-colors ${
                  isCalibrateMode
                    ? 'border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] text-white'
                    : 'border-[var(--takeoff-line)] bg-white text-[var(--takeoff-ink)]'
                }`}
              >
                <Ruler className="h-3.5 w-3.5" />
                {calibration ? 'Recalibrate' : 'Calibrate'}
              </button>
              <button
                onClick={() => handleTraceWall(sixInchPreset.key)}
                disabled={!isVerified}
                className={`takeoff-mono inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)] ${
                  isTraceMode && activeWallPresetKey === sixInchPreset.key
                    ? 'border-[#7f1d1d] bg-[#7f1d1d] text-white'
                    : 'border-[rgba(127,29,29,0.28)] bg-white text-[#7f1d1d]'
                }`}
              >
                <PenLine className="h-3.5 w-3.5" />
                Trace {sixInchPreset.thicknessIn}&quot; wall
              </button>
              <button
                onClick={() => handleTraceWall(fourInchPreset.key)}
                disabled={!isVerified}
                className={`takeoff-mono inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)] ${
                  isTraceMode && activeWallPresetKey === fourInchPreset.key
                    ? 'border-[#92400e] bg-[#92400e] text-white'
                    : 'border-[rgba(146,64,14,0.28)] bg-white text-[#92400e]'
                }`}
              >
                <PenLine className="h-3.5 w-3.5" />
                Trace {fourInchPreset.thicknessIn}&quot; wall
              </button>
              <button
                onClick={() => handleTraceSurface()}
                disabled={!isVerified}
                className={`takeoff-mono inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)] ${
                  isSurfaceTraceMode
                    ? 'border-[#6d28d9] bg-[#6d28d9] text-white'
                    : 'border-[rgba(109,40,217,0.24)] bg-white text-[#6d28d9]'
                }`}
              >
                <Pentagon className="h-3.5 w-3.5" />
                Trace area
              </button>
              <button
                onClick={() => removeLastTracePoint()}
                disabled={tool !== 'trace' || activeTracePoints.length === 0}
                className="takeoff-mono inline-flex items-center gap-1.5 rounded-full border border-[var(--takeoff-line)] bg-white px-3 py-1.5 text-[10px] font-medium text-[var(--takeoff-ink)] disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)]"
              >
                Undo point
              </button>
              <button
                onClick={handleStartCaptureWindow}
                className={`takeoff-mono inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-semibold transition-colors ${
                  isWindowCaptureMode
                    ? 'border-[#1d4ed8] bg-[#1d4ed8] text-white'
                    : 'border-[rgba(29,78,216,0.24)] bg-white text-[#1d4ed8]'
                }`}
              >
                Capture window
              </button>
              <button
                onClick={handleStartCaptureDoor}
                className={`takeoff-mono inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-semibold transition-colors ${
                  isDoorCaptureMode
                    ? 'border-[#047857] bg-[#047857] text-white'
                    : 'border-[rgba(4,120,87,0.24)] bg-white text-[#047857]'
                }`}
              >
                Capture door
              </button>
              <button
                onClick={handleStartPlaceWindow}
                disabled={!windowPreset}
                className={`takeoff-mono inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)] ${
                  isWindowPlaceMode
                    ? 'border-[#a16207] bg-[#a16207] text-white'
                    : 'border-[rgba(161,98,7,0.24)] bg-white text-[#a16207]'
                }`}
              >
                Place windows
              </button>
              <button
                onClick={handleStartPlaceDoor}
                disabled={!doorPreset}
                className={`takeoff-mono inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)] ${
                  isDoorPlaceMode
                    ? 'border-[#0f766e] bg-[#0f766e] text-white'
                    : 'border-[rgba(15,118,110,0.24)] bg-white text-[#0f766e]'
                }`}
              >
                Place doors
              </button>
              <button
                onClick={handleSaveCurrentWindowToCatalog}
                disabled={!windowPreset}
                className="takeoff-mono inline-flex items-center gap-1.5 rounded-full border border-[var(--takeoff-line)] bg-white px-3 py-1.5 text-[10px] font-medium text-[var(--takeoff-ink)] disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)]"
              >
                Save window
              </button>
              <button
                onClick={handleSaveCurrentDoorToCatalog}
                disabled={!doorPreset}
                className="takeoff-mono inline-flex items-center gap-1.5 rounded-full border border-[var(--takeoff-line)] bg-white px-3 py-1.5 text-[10px] font-medium text-[var(--takeoff-ink)] disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)]"
              >
                Save door
              </button>
              <button
                onClick={handleResetWindowTool}
                disabled={!canResetWindowTool}
                className="takeoff-mono inline-flex items-center gap-1.5 rounded-full border border-[var(--takeoff-line)] bg-white px-3 py-1.5 text-[10px] font-medium text-[var(--takeoff-ink)] disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)]"
              >
                {isWindowToolActive ? 'Cancel window' : 'Reset window'}
              </button>
              <button
                onClick={handleResetDoorTool}
                disabled={!canResetDoorTool}
                className="takeoff-mono inline-flex items-center gap-1.5 rounded-full border border-[var(--takeoff-line)] bg-white px-3 py-1.5 text-[10px] font-medium text-[var(--takeoff-ink)] disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)]"
              >
                {isDoorToolActive ? 'Cancel door' : 'Reset door'}
              </button>
              <button
                onClick={() => {
                  if (selectedOpenWall) {
                    continueTrace(selectedOpenWall.id);
                  }
                }}
                disabled={!canContinueSelectedWall}
                className="takeoff-mono inline-flex items-center gap-1.5 rounded-full border border-[var(--takeoff-line)] bg-white px-3 py-1.5 text-[10px] font-medium text-[var(--takeoff-ink)] disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)]"
              >
                Continue wall
              </button>
              <button
                onClick={() => {
                  if (selectedOpenWall && selectedSegmentIndex !== null) {
                    deleteTraceSegment(selectedOpenWall.id, selectedSegmentIndex);
                    return;
                  }
                  if (selectedTrace) {
                    deleteTrace(selectedTrace.id);
                  }
                }}
                disabled={!canDeleteSelectedTrace}
                className="takeoff-mono inline-flex items-center gap-1.5 rounded-full border border-[var(--takeoff-line)] bg-white px-3 py-1.5 text-[10px] font-medium text-[var(--takeoff-ink)] disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)]"
              >
                {deleteSelectionLabel}
              </button>
            </div>

            <div className="mt-3 rounded-[18px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.72)] px-3 py-3">
              <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                Surface area tool
              </div>
              <label className="mt-2 block space-y-1">
                <span className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                  Surface preset
                </span>
                <select
                  value={activeSurfacePresetKey}
                  onChange={(event) => {
                    const nextPreset = event.target.value as SurfacePresetKey;
                    setSurfacePreset(nextPreset);
                    setSurfaceStatus(`Next area trace will use ${getSurfacePreset(nextPreset).label}.`);
                  }}
                  className="takeoff-mono w-full rounded-[12px] border border-[var(--takeoff-line)] bg-white px-2.5 py-2 text-[11px] text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
                >
                  {SURFACE_PRESET_OPTIONS.map((preset) => (
                    <option key={preset.key} value={preset.key}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="takeoff-mono rounded-full border border-[rgba(109,40,217,0.18)] bg-[rgba(109,40,217,0.08)] px-2.5 py-1 text-[10px] font-medium text-[#6d28d9]">
                  Active preset: {activeSurfacePreset.label}
                </span>
                {selectedAreaMetrics && (
                  <span className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-white px-2.5 py-1 text-[10px] text-[var(--takeoff-ink)]">
                    {Math.round(selectedAreaMetrics.areaSf)} SF · {Math.round(selectedAreaMetrics.perimeterLf)} LF perimeter
                  </span>
                )}
              </div>
              {surfaceStatus ? (
                <div className="takeoff-mono mt-2 text-[10px] text-[var(--takeoff-text-muted)]">
                  {surfaceStatus}
                </div>
              ) : (
                <div className="takeoff-mono mt-2 text-[10px] text-[var(--takeoff-text-subtle)]">
                  Use this tool for attic floors, crawlspace floors, garage ceilings, sound floors, cathedral ceilings, and other closed surface areas that bill by square footage.
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => handleTraceSurface()}
                  disabled={!isVerified}
                  className="takeoff-mono inline-flex items-center gap-1.5 rounded-full border border-[rgba(109,40,217,0.24)] bg-white px-3 py-1.5 text-[10px] font-semibold text-[#6d28d9] transition-colors disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)]"
                >
                  <Pentagon className="h-3.5 w-3.5" />
                  Start area trace
                </button>
                <button
                  onClick={handleApplySurfacePresetToSelection}
                  disabled={!canApplySurfacePresetToSelection}
                  className="takeoff-mono inline-flex items-center gap-1.5 rounded-full border border-[var(--takeoff-line)] bg-white px-3 py-1.5 text-[10px] font-medium text-[var(--takeoff-ink)] disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)]"
                >
                  Apply to selected area
                </button>
              </div>
            </div>

            <div className="mt-3 rounded-[18px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.72)] px-3 py-3">
              <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                Window tool
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                    Width
                  </span>
                  <input
                    value={windowWidthText}
                    onChange={(event) => setWindowWidthText(event.target.value)}
                    placeholder={`5'-0"`}
                    className="takeoff-mono w-full rounded-[12px] border border-[var(--takeoff-line)] bg-white px-2.5 py-2 text-[11px] text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
                  />
                </label>
                <label className="space-y-1">
                  <span className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                    Height
                  </span>
                  <input
                    value={windowHeightText}
                    onChange={(event) => setWindowHeightText(event.target.value)}
                    placeholder={`5'-0"`}
                    className="takeoff-mono w-full rounded-[12px] border border-[var(--takeoff-line)] bg-white px-2.5 py-2 text-[11px] text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
                  />
                </label>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="takeoff-mono rounded-full border border-[rgba(161,98,7,0.16)] bg-[rgba(161,98,7,0.08)] px-2.5 py-1 text-[10px] font-medium text-[#92400e]">
                  {windowPreset
                    ? `${windowPreset.label} · ${Math.round(windowPreset.widthFt * windowPreset.heightFt)} SF each`
                    : 'Enter a valid width and height to place windows'}
                </span>
                {windowSourceText && (
                  <span className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-white px-2.5 py-1 text-[10px] text-[var(--takeoff-text-muted)]">
                    Source: {windowSourceText}
                  </span>
                )}
              </div>
              {!windowStatus && (
                <div className="takeoff-mono mt-2 text-[10px] text-[var(--takeoff-text-subtle)]">
                  Window capture uses the vision model only on the selected crop. Confirmed captures auto-lock in. Unconfirmed captures stay open for manual entry.
                </div>
              )}
              {windowStatus && (
                <div className="takeoff-mono mt-2 text-[10px] text-[var(--takeoff-text-muted)]">
                  {windowStatus}
                </div>
              )}
              {!isVerified && (
                <div className="takeoff-mono mt-2 text-[10px] text-[var(--takeoff-text-subtle)]">
                  Window capture works without scale. Calibrate this page when you want gross/net wall SF previews to update on the canvas.
                </div>
              )}

              <div className="mt-3 rounded-[14px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.76)] px-2.5 py-2.5">
                <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                  Window catalog
                </div>
                {windowCatalog.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {windowCatalog.map((catalogItem) => {
                      const isActive = catalogItem.id === activeWindowCatalogId;

                      return (
                        <button
                          key={catalogItem.id}
                          onClick={() => handleSelectWindowCatalogItem(catalogItem.id)}
                          className={`rounded-[12px] border px-2.5 py-2 text-left transition-colors ${
                            isActive
                              ? 'border-[#1d4ed8] bg-[rgba(29,78,216,0.08)]'
                              : 'border-[var(--takeoff-line)] bg-white hover:border-[#b6c4d9]'
                          }`}
                        >
                          <div className="takeoff-mono text-[10px] font-semibold text-[var(--takeoff-ink)]">
                            {catalogItem.label}
                          </div>
                          <div className="takeoff-mono mt-1 text-[9px] text-[var(--takeoff-text-subtle)]">
                            {Math.round(catalogItem.areaSf)} SF · scanned {catalogItem.captureCount}x
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="takeoff-mono mt-2 text-[10px] text-[var(--takeoff-text-subtle)]">
                    Confirmed window captures appear here so you can place them again without rescanning.
                  </div>
                )}
              </div>

              <div className="mt-3 rounded-[18px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.72)] px-3 py-3">
                <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                  Door tool
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                      Width
                    </span>
                    <input
                      value={doorWidthText}
                      onChange={(event) => setDoorWidthText(event.target.value)}
                      placeholder={`3'-0"`}
                      className="takeoff-mono w-full rounded-[12px] border border-[var(--takeoff-line)] bg-white px-2.5 py-2 text-[11px] text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                      Height
                    </span>
                    <input
                      value={doorHeightText}
                      onChange={(event) => setDoorHeightText(event.target.value)}
                      placeholder={`6'-8"`}
                      className="takeoff-mono w-full rounded-[12px] border border-[var(--takeoff-line)] bg-white px-2.5 py-2 text-[11px] text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
                    />
                  </label>
                </div>
                <label className="mt-2 block space-y-1">
                  <span className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                    Type
                  </span>
                  <select
                    value={doorType}
                    onChange={(event) => setDoorType(event.target.value as Exclude<OpeningType, 'window'>)}
                    className="takeoff-mono w-full rounded-[12px] border border-[var(--takeoff-line)] bg-white px-2.5 py-2 text-[11px] text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
                  >
                    {Object.entries(DOOR_TYPE_LABELS).map(([type, label]) => (
                      <option key={type} value={type}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="takeoff-mono rounded-full border border-[rgba(5,150,105,0.16)] bg-[rgba(5,150,105,0.08)] px-2.5 py-1 text-[10px] font-medium text-[#047857]">
                    {doorPreset
                      ? `${doorPreset.label} · ${Math.round(doorPreset.widthFt * doorPreset.heightFt)} SF each`
                      : 'Enter a valid width, height, and type to place doors'}
                  </span>
                  {doorSourceText && (
                    <span className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-white px-2.5 py-1 text-[10px] text-[var(--takeoff-text-muted)]">
                      Source: {doorSourceText}
                    </span>
                  )}
                </div>
                {!doorStatus && (
                  <div className="takeoff-mono mt-2 text-[10px] text-[var(--takeoff-text-subtle)]">
                    Door capture uses the vision model only on the selected crop. It is tuned for regular, French, garage, sliding, and open doorway callouts. Width-only notes default to 6&apos;-8&quot; so you can adjust from there if needed.
                  </div>
                )}
                {doorStatus && (
                  <div className="takeoff-mono mt-2 text-[10px] text-[var(--takeoff-text-muted)]">
                    {doorStatus}
                  </div>
                )}
                {!isVerified && (
                  <div className="takeoff-mono mt-2 text-[10px] text-[var(--takeoff-text-subtle)]">
                    Door capture works without scale. Calibrate this page when you want gross/net wall SF previews to update on the canvas.
                  </div>
                )}

                <div className="mt-3 rounded-[14px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.76)] px-2.5 py-2.5">
                  <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                    Door catalog
                  </div>
                  {doorCatalog.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {doorCatalog.map((catalogItem) => {
                        const isActive = catalogItem.id === activeDoorCatalogId;

                        return (
                          <button
                            key={catalogItem.id}
                            onClick={() => handleSelectDoorCatalogItem(catalogItem.id)}
                            className={`rounded-[12px] border px-2.5 py-2 text-left transition-colors ${
                              isActive
                                ? 'border-[#047857] bg-[rgba(5,150,105,0.08)]'
                                : 'border-[var(--takeoff-line)] bg-white hover:border-[#9acdc0]'
                            }`}
                          >
                            <div className="takeoff-mono text-[10px] font-semibold text-[var(--takeoff-ink)]">
                              {catalogItem.label}
                            </div>
                            <div className="takeoff-mono mt-1 text-[9px] text-[var(--takeoff-text-subtle)]">
                              {Math.round(catalogItem.areaSf)} SF · scanned {catalogItem.captureCount}x
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="takeoff-mono mt-2 text-[10px] text-[var(--takeoff-text-subtle)]">
                      Confirmed door captures appear here so you can place them again without rescanning.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <span
                className={`takeoff-mono rounded-full border px-2.5 py-1 text-[10px] font-medium ${
                  isVerified
                    ? 'border-[var(--takeoff-line)] bg-[var(--takeoff-paper-strong)] text-[var(--takeoff-ink)]'
                    : 'border-[var(--takeoff-warning)]/30 bg-[rgba(212,168,67,0.08)] text-[var(--takeoff-warning)]'
                }`}
              >
                {isVerified ? 'Scale verified' : 'Calibration required'}
              </span>
              <span
                className="takeoff-mono rounded-full border bg-white px-2.5 py-1 text-[10px]"
                style={{
                  borderColor: 'rgba(127,29,29,0.22)',
                  color: '#7f1d1d',
                }}
              >
                6&quot; band {sixInchBandWidth ? `${sixInchBandWidth.toFixed(1)} px` : 'pending'}
              </span>
              <span
                className="takeoff-mono rounded-full border bg-white px-2.5 py-1 text-[10px]"
                style={{
                  borderColor: 'rgba(146,64,14,0.22)',
                  color: '#92400e',
                }}
              >
                4&quot; band {fourInchBandWidth ? `${fourInchBandWidth.toFixed(1)} px` : 'pending'}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <span
                className="takeoff-mono rounded-full border px-2.5 py-1 text-[10px] font-medium"
                style={{
                  borderColor:
                    activeWallPreset.thicknessIn === 6
                      ? 'rgba(127,29,29,0.2)'
                      : activeWallPreset.thicknessIn === 4
                        ? 'rgba(146,64,14,0.2)'
                        : 'rgba(31,39,33,0.12)',
                  backgroundColor:
                    activeWallPreset.thicknessIn === 6
                      ? 'rgba(127,29,29,0.08)'
                      : activeWallPreset.thicknessIn === 4
                        ? 'rgba(146,64,14,0.08)'
                        : 'rgba(255,255,255,0.92)',
                  color:
                    activeWallPreset.thicknessIn === 6
                      ? '#7f1d1d'
                      : activeWallPreset.thicknessIn === 4
                        ? '#92400e'
                        : 'var(--takeoff-ink)',
                }}
              >
                Active wall tool: {activeWallPreset.thicknessIn}&quot;
              </span>
              {isTraceMode && drawingPreset === 'wall' && (
                <span className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-white px-2.5 py-1 text-[10px] text-[var(--takeoff-text-muted)]">
                  Fill side: {activeWallFillSide} · Tab flips
                </span>
              )}
              <span
                className="takeoff-mono rounded-full border px-2.5 py-1 text-[10px] font-medium"
                style={{
                  borderColor: 'rgba(109,40,217,0.2)',
                  backgroundColor: 'rgba(109,40,217,0.08)',
                  color: '#6d28d9',
                }}
              >
                Active area preset: {activeSurfacePreset.label}
              </span>
              {selectedSegmentMetrics && (
                <span className="takeoff-mono rounded-full border border-[rgba(161,98,7,0.16)] bg-[rgba(161,98,7,0.08)] px-2.5 py-1 text-[10px] text-[#92400e]">
                  Segment gross {Math.round(selectedSegmentMetrics.grossSf)} SF · openings {Math.round(selectedSegmentMetrics.openingsSf)} SF · net {Math.round(selectedSegmentMetrics.netSf)} SF
                </span>
              )}
              {selectedAreaMetrics && (
                <span className="takeoff-mono rounded-full border border-[rgba(109,40,217,0.16)] bg-[rgba(109,40,217,0.08)] px-2.5 py-1 text-[10px] text-[#6d28d9]">
                  Selected area {Math.round(selectedAreaMetrics.areaSf)} SF · perimeter {Math.round(selectedAreaMetrics.perimeterLf)} LF
                </span>
              )}
            </div>
          </div>
        </div>

        {selectedPages.length > 1 && (
          <div className="absolute bottom-4 left-4 z-20">
            {pageTrayOpen && (
              <div className="mb-2 w-[280px] overflow-hidden rounded-[18px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.9)] p-2 shadow-[0_18px_36px_rgba(31,39,33,0.16)] backdrop-blur-xl">
                <div className="mb-2 flex items-center justify-between px-1 pb-1">
                  <div>
                    <div className="takeoff-label text-[9px] text-[var(--takeoff-text-subtle)]">
                      Pages
                    </div>
                    <div className="mt-1 text-[12px] font-medium text-[var(--takeoff-ink)]">
                      Switch calibrated pages
                    </div>
                  </div>
                </div>
                <div className="takeoff-hide-scrollbar max-h-[320px] space-y-2 overflow-y-auto pr-1">
                  {selectedPages.map((pageIndex) => (
                    <PagePill
                      key={pageIndex}
                      active={pageIndex === activePageIndex}
                      verified={verifiedPages.includes(pageIndex)}
                      label={`P${pageIndex + 1}`}
                      onClick={() => {
                        setActivePage(pageIndex);
                        setPageTrayOpen(false);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => setPageTrayOpen((current) => !current)}
              className="flex h-11 items-center gap-2 rounded-full border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.9)] px-3.5 text-[11px] font-medium text-[var(--takeoff-ink)] shadow-[0_12px_24px_rgba(31,39,33,0.12)] backdrop-blur-xl transition-colors hover:border-[#9eb29d]"
            >
              <div className="flex min-w-0 flex-col text-left">
                <span className="takeoff-mono text-[9px] text-[var(--takeoff-text-subtle)]">
                  Pages
                </span>
                <span className="truncate text-[11px] font-medium">
                  P{activePageIndex + 1} · {activePageTitle}
                </span>
              </div>
              <div className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-2 py-0.5 text-[9px] text-[var(--takeoff-text-subtle)]">
                {verifiedPages.length}/{selectedPages.length}
              </div>
              {pageTrayOpen ? (
                <ChevronDown className="h-4 w-4 text-[var(--takeoff-text-subtle)]" />
              ) : (
                <ChevronUp className="h-4 w-4 rotate-180 text-[var(--takeoff-text-subtle)]" />
              )}
            </button>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-4 right-4 z-20">
          <div className="pointer-events-auto rounded-[18px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.88)] px-3 py-3 text-[11px] leading-5 text-[var(--takeoff-text-muted)] shadow-[0_16px_32px_rgba(31,39,33,0.08)] backdrop-blur-xl">
            <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
              Controls
            </div>
            <div className="mt-1">Enter: finish trace</div>
            <div>← / →: previous or next page</div>
            <div>Tab: flip fill side</div>
            <div>Backspace: undo last point</div>
            <div>Delete: remove selected segment or shape</div>
            <div>Esc: step back, then return to Select / Edit</div>
            <div>Capture window: drag a box around the size note</div>
            <div>Capture door: drag a box around the door callout</div>
            <div>Place windows: click a wall segment to subtract the opening</div>
            <div>Place doors: click a wall segment to subtract the opening</div>
            <div>Arrow by cursor: fill direction</div>
            <div>Pointer mode: drag points or select a segment</div>
            <div>Space: pan</div>
          </div>
        </div>
      </div>
    </div>
  );
}
