"use client";

import { use, useEffect, useState, ReactNode } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { getActiveCompanyId } from '@/lib/supabase/company';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PDFViewer } from '@/components/pdf/PDFViewer';
import {
  FileCheck,
  Plus,
  Loader2,
  Trash2,
  Home,
  Warehouse,
  ArrowUp,
  Building,
  Save,
  X,
  DoorOpen,
  SquareIcon,
  Ruler,
  CheckCircle2,
  Circle,
  Pencil,
  Layers,
  ChevronDown,
  ChevronRight,
  LucideIcon,
  Activity,
  Scan,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { DemoInstructions } from '@/components/demo/DemoInstructions';
import { DemoTooltip } from '@/components/demo/DemoTooltip';
import { ScopeCard } from '@/components/extraction/ScopeCard';
import type { TakeoffEnvelopeV1 } from '@/lib/types/takeoff-envelope';
import { resolveActiveMode as resolveMode, type ModeResolution } from '@/lib/extraction/resolveActiveMode';

// ─── Interfaces ─────────────────────────────────────────────

interface Room {
  id: string;
  name: string;
  type: 'living' | 'garage' | 'attic' | 'crawlspace';
  area_sqft: number | null;
  perimeter_ft: number | null;
  height_ft: number | null;
  wall_sf: number | null;
  floor_sf: number | null;
  ceiling_sf: number | null;
  wall_composition: string | null;
  stud_size: string | null;
}

interface Opening {
  id: string;
  project_id: string;
  type: 'door' | 'window';
  label: string;
  width_ft: number | null;
  height_ft: number | null;
  area_sqft: number | null;
  count: number;
  confidence: number | null;
}

interface Project {
  id: string;
  name: string;
  status: string;
  pdf_url: string | null;
  active_extraction_mode: 'ocr' | 'vision' | null;
  plan_preset: string | null;
}

interface ExtractionRun {
  id: string;
  mode: 'ocr' | 'vision' | 'hybrid';
  status: string;
  attempt: number;
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

type ActiveMode = 'ocr' | 'vision' | null;

const ROOM_TYPES = [
  { value: 'living', label: 'Living Space', icon: Home },
  { value: 'garage', label: 'Garage', icon: Warehouse },
  { value: 'attic', label: 'Attic', icon: ArrowUp },
  { value: 'crawlspace', label: 'Crawlspace', icon: Building },
];

// ─── Segment Card Component ─────────────────────────────────

interface SegmentCardProps {
  id: string;
  title: string;
  icon: LucideIcon;
  heroValue: string;
  heroLabel: string;
  verified: boolean;
  onToggleVerify: () => void;
  children: ReactNode;
  editing?: boolean;
  onEdit?: () => void;
  onCancelEdit?: () => void;
  tooltip?: ReactNode;
}

function SegmentCard({
  id,
  title,
  icon: Icon,
  heroValue,
  heroLabel,
  verified,
  onToggleVerify,
  children,
  editing,
  onEdit,
  onCancelEdit,
  tooltip,
}: SegmentCardProps) {
  return (
    <Card
      className={`transition-colors ${
        verified
          ? 'border-[#b9cbaa] bg-[#edf5e8]'
          : 'ev-card'
      }`}
    >
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`h-9 w-9 rounded-lg flex items-center justify-center ${
                verified
                  ? 'border border-[#b9cbaa] bg-[#edf5e8] text-[#47644a]'
                  : 'ev-icon-box'
              }`}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {title}
                {tooltip}
              </CardTitle>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-bold text-[var(--takeoff-ink)]">
                  {heroValue}
                </span>
                <span className="text-sm text-[var(--takeoff-text-muted)]">{heroLabel}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onEdit && !editing && (
              <Button variant="ghost" size="sm" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Edit
              </Button>
            )}
            {editing && onCancelEdit && (
              <Button variant="ghost" size="sm" onClick={onCancelEdit}>
                <X className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
            )}
            <button
              onClick={onToggleVerify}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                verified
                  ? 'border border-[#b9cbaa] bg-[#edf5e8] text-[#47644a] hover:bg-[#e2efda]'
                  : 'border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] text-[var(--takeoff-text-muted)] hover:bg-white hover:text-[var(--takeoff-ink)]'
              }`}
            >
              {verified ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Circle className="h-4 w-4" />
              )}
              {verified ? 'Verified' : 'Verify'}
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 px-4 pb-4">{children}</CardContent>
    </Card>
  );
}

// ─── Active Run Banner ──────────────────────────────────────

interface ActiveRunBannerProps {
  activeMode: ActiveMode;
  hasOcr: boolean;
  hasVision: boolean;
  envelope: TakeoffEnvelopeV1 | null;
  ocrRun: ExtractionRun | null;
  resolution: ModeResolution | null;
  onRerunPage?: (pageIndex: number) => void;
  isRerunning?: boolean;
  planPreset?: string | null;
}

function ActiveRunBanner({
  activeMode,
  hasOcr,
  hasVision,
  envelope,
  ocrRun,
  resolution,
  onRerunPage,
  isRerunning,
  planPreset,
}: ActiveRunBannerProps) {
  const activeRun = activeMode === 'ocr' ? ocrRun : null;

  // Build "why review" reasons from envelope
  const reviewReasons: string[] = [];
  if (activeMode === 'ocr' && envelope) {
    if (envelope.status === 'review') {
      // Page selection confidence
      if (envelope.page_selection?.confidence < 0.7) {
        reviewReasons.push(
          `Page selection confidence ${Math.round(envelope.page_selection.confidence * 100)}% (below 70% threshold)`
        );
      }
      // Completeness flags
      const c = envelope.completeness;
      if (c.ceiling_area === 'estimated') reviewReasons.push('Ceiling area is estimated (not measured)');
      if (c.garage_ceiling_area === 'estimated') reviewReasons.push('Garage ceiling area is estimated');
      if (c.crawlspace_area === 'estimated') reviewReasons.push('Crawlspace area is estimated');
      if (c.crawlspace_area === 'missing') reviewReasons.push('Crawlspace area is missing');
      if (c.net_sf === 'missing') reviewReasons.push('Net wall SF is missing (openings phase incomplete)');
      // Missing components
      if (c.missing_components?.length > 0) {
        reviewReasons.push(`Missing: ${c.missing_components.join(', ')}`);
      }
      // Degradation
      if (c.degradation_reason) {
        reviewReasons.push(`Degraded: ${c.degradation_reason}`);
      }
      // Foundation issues
      const foundationIssues = envelope.review.items.filter(
        i => i.severity === 'warning' || i.severity === 'error'
      );
      for (const issue of foundationIssues.slice(0, 3)) {
        reviewReasons.push(issue.message);
      }
    }
  }

  return (
    <div className="ev-card space-y-2 rounded-[18px] px-4 py-3">
      {/* Active source indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--takeoff-accent)]" />
          <span className="text-sm font-semibold text-[var(--takeoff-ink)]">Active Run</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-1.5 text-xs font-medium text-[var(--takeoff-ink)]">
          <Scan className="h-3 w-3" />
          {activeMode === 'ocr' ? 'Automated takeoff' : 'Manual / saved takeoff'}
        </div>
      </div>

      {/* Debug info */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-[var(--takeoff-text-muted)]">
        {activeMode === 'ocr' && envelope && (
          <>
            <span>run_id: {envelope.run_id?.slice(0, 8) || '—'}</span>
            <span>mode: {envelope.mode_used}</span>
            <span>status: <span className={
              envelope.status === 'complete' ? 'text-green-400' :
              envelope.status === 'review' ? 'text-amber-400' : 'text-red-400'
            }>{envelope.status}</span></span>
            <span>confidence: {Math.round(envelope.telemetry.overall_confidence * 100)}%</span>
            <span>page: {envelope.page_selection?.selected_page_index ?? '—'} ({envelope.page_selection?.source})</span>
            <span>preset: <span className="text-[var(--takeoff-ink)]">{planPreset || 'auto'}</span></span>
          </>
        )}
        {activeRun?.finished_at && (
          <span>ran: {new Date(activeRun.finished_at).toLocaleString()}</span>
        )}
      </div>

      {/* Completeness flags */}
      {activeMode === 'ocr' && envelope?.completeness && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {Object.entries({
            gross_sf: envelope.completeness.gross_sf,
            exterior_lf: envelope.completeness.exterior_lf,
            openings: envelope.completeness.openings,
            net_sf: envelope.completeness.net_sf,
            ceiling: envelope.completeness.ceiling_area,
            garage: envelope.completeness.garage_ceiling_area,
            crawlspace: envelope.completeness.crawlspace_area,
            rim_joist: envelope.completeness.rim_joist,
          }).map(([key, status]) => (
            <span
              key={key}
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono ${
                status === 'final'
                  ? 'bg-green-900/40 text-green-400 border border-green-800/40'
                  : status === 'estimated'
                    ? 'bg-amber-900/30 text-amber-400 border border-amber-800/40'
                    : 'bg-red-900/30 text-red-400 border border-red-800/40'
              }`}
            >
              {key}: {status}
            </span>
          ))}
        </div>
      )}

      {/* Stale envelope — structural gate */}
      {resolution?.staleEnvelope && activeMode === 'ocr' && (
        <div className="bg-amber-950/50 border-2 border-amber-600/60 rounded-lg px-4 py-3 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-300">Stale Automated Takeoff</p>
              <p className="text-xs text-amber-400/80 mt-0.5">
                The most recent automated takeoff run <span className="font-medium text-red-400">failed</span>
                {resolution.failedRun?.finished_at
                  ? ` at ${new Date(resolution.failedRun.finished_at).toLocaleString()}`
                  : ''}. The data below is from an older successful run.
              </p>
            </div>
          </div>
          <p className="text-[11px] text-amber-500/70 italic">
            Values may not reflect your latest document. Re-run automated takeoff when the source file changes.
          </p>
        </div>
      )}

      {/* Why review — reason surface */}
      {reviewReasons.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-zinc-800">
          <p className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">Why review needed</p>
          {reviewReasons.slice(0, 4).map((reason, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-zinc-400">
              <span className="text-amber-500 shrink-0">•</span>
              <span>{reason}</span>
            </div>
          ))}
        </div>
      )}

      {/* Data source warning */}
      {hasOcr && hasVision && !resolution?.staleEnvelope && (
        <p className="text-[11px] text-amber-400/80">
          Saved room/opening data also exists. The old extracted-data switcher is hidden while automated takeoff is the active workflow.
        </p>
      )}

      {/* Page override — low confidence page selection */}
      {activeMode === 'ocr' && envelope && onRerunPage && (
        envelope.page_selection?.confidence < 0.70 || envelope.page_selection?.source === 'fallback'
      ) && envelope.page_selection?.candidates && envelope.page_selection.candidates.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-zinc-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            <p className="text-xs font-semibold text-amber-300">
              Low confidence page selection ({Math.round(envelope.page_selection.confidence * 100)}%)
            </p>
          </div>
          <p className="text-[11px] text-zinc-400">
            The auto-selected page may not be the floor plan. Pick the correct page and re-run:
          </p>
          <div className="grid gap-1.5">
            {envelope.page_selection.candidates.slice(0, 5).map((candidate) => (
              <button
                key={candidate.page_index}
                disabled={isRerunning}
                onClick={() => onRerunPage(candidate.page_index)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${
                  candidate.page_index === envelope.page_selection?.selected_page_index
                    ? 'bg-cyan-900/40 border border-cyan-700/50 text-cyan-300'
                    : 'bg-zinc-800/60 border border-zinc-700/40 text-zinc-300 hover:bg-zinc-700/60 hover:border-zinc-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium">Page {candidate.page_index + 1}</span>
                  {candidate.page_index === envelope.page_selection?.selected_page_index && (
                    <span className="text-[10px] text-cyan-400/70">(current)</span>
                  )}
                  {candidate.reasons?.length > 0 && (
                    <span className="text-zinc-500 truncate max-w-[200px]">
                      {candidate.reasons[0]}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">score: {candidate.score.toFixed(3)}</span>
                  {candidate.page_index !== envelope.page_selection?.selected_page_index && (
                    <RotateCcw className="h-3 w-3 text-cyan-400" />
                  )}
                </div>
              </button>
            ))}
          </div>
          {isRerunning && (
              <div className="flex items-center gap-2 text-xs text-cyan-400">
                <Loader2 className="h-3 w-3 animate-spin" />
              Re-running automated takeoff on selected page...
              </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Review Page ───────────────────────────────────────

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [roomsExpanded, setRoomsExpanded] = useState(false);

  // Takeoff envelope from pdfengine (if OCR extraction was used)
  const [envelope, setEnvelope] = useState<TakeoffEnvelopeV1 | null>(null);
  const [envelopeSource, setEnvelopeSource] = useState<'run' | 'document' | null>(null);
  const [isRerunning, setIsRerunning] = useState(false);

  // Active run tracking — prevents mixing automated and saved measurement data
  const [activeMode, setActiveMode] = useState<ActiveMode>(null);
  const [extractionRuns, setExtractionRuns] = useState<ExtractionRun[]>([]);
  const [modeResolution, setModeResolution] = useState<ModeResolution | null>(null);

  // Segment verification (UI-only, not persisted)
  const [verifiedSegments, setVerifiedSegments] = useState<Set<string>>(new Set());

  // Segment editing
  const [editingSegment, setEditingSegment] = useState<string | null>(null);

  // Inline edit state for walls
  const [wallEditForm, setWallEditForm] = useState({
    wall_sf: '',
    perimeter_ft: '',
    height_ft: '',
    wall_composition: '',
    stud_size: '',
  });

  // Inline edit state for ceiling
  const [ceilingEditValue, setCeilingEditValue] = useState('');

  // Inline edit state for floor
  const [floorEditValue, setFloorEditValue] = useState('');

  // Inline edit state for openings (doors/windows)
  const [editingOpenings, setEditingOpenings] = useState<Opening[]>([]);

  // New room form
  const [newRoom, setNewRoom] = useState({
    name: '',
    type: 'living' as Room['type'],
    area_sqft: '',
    perimeter_ft: '',
    height_ft: '',
    wall_sf: '',
    floor_sf: '',
    ceiling_sf: '',
    wall_composition: '',
    stud_size: '',
  });

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      const companyId = await getActiveCompanyId();
      const { data: projectData } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .eq('company_id', companyId)
        .single();

      setProject(projectData);

      const { data: roomsData } = await supabase
        .from('rooms')
        .select('*')
        .eq('project_id', id)
        .eq('company_id', companyId)
        .order('created_at', { ascending: true });

      console.log('Rooms loaded:', roomsData);
      setRooms(roomsData || []);

      const { data: openingsData } = await supabase
        .from('openings')
        .select('*')
        .eq('project_id', id)
        .eq('company_id', companyId)
        .order('created_at', { ascending: true });

      console.log('Openings loaded:', openingsData);
      setOpenings(openingsData || []);

      // Load extraction runs FIRST — we need them to determine which envelope to show
      const { data: runsData } = await supabase
        .from('extraction_runs')
        .select('id, mode, status, attempt, started_at, finished_at, error, takeoff_envelope')
        .eq('project_id', id)
        .eq('company_id', companyId)
        .order('finished_at', { ascending: false });

      const runs = (runsData || []) as (ExtractionRun & { takeoff_envelope?: any })[];
      setExtractionRuns(runs);

      // Check if ANY document has an envelope (for mode resolution hasEnvelope flag)
      const { data: docsData } = await supabase
        .from('documents')
        .select('takeoff_envelope')
        .eq('project_id', id)
        .eq('company_id', companyId)
        .not('takeoff_envelope', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);

      const hasDocEnvelope = !!docsData?.[0]?.takeoff_envelope;

      // Resolve active mode using shared helper
      const resolution = resolveMode({
        persistedMode: (projectData?.active_extraction_mode as ActiveMode) || null,
        runs: runs.map(r => ({
          id: r.id,
          mode: r.mode,
          status: r.status,
          finished_at: r.finished_at,
        })),
        hasEnvelope: hasDocEnvelope || runs.some(r => (r.mode === 'ocr' || r.mode === 'hybrid') && r.takeoff_envelope),
        hasRooms: (roomsData?.length ?? 0) > 0,
      });

      setModeResolution(resolution);
      setActiveMode(resolution.mode);

      // Run-tied envelope: prefer envelope from the specific activeRun
      let loadedEnvelope: TakeoffEnvelopeV1 | null = null;
      let source: 'run' | 'document' | null = null;

      if (resolution.mode === 'ocr' && resolution.activeRun) {
        // Find the run's envelope
        const activeRunData = runs.find(r => r.id === resolution.activeRun!.id);
        if (activeRunData?.takeoff_envelope) {
          loadedEnvelope = activeRunData.takeoff_envelope as unknown as TakeoffEnvelopeV1;
          source = 'run';
        }
      }

      // Fallback: use documents.takeoff_envelope (legacy/backfill)
      if (!loadedEnvelope && resolution.mode === 'ocr' && hasDocEnvelope) {
        loadedEnvelope = docsData![0].takeoff_envelope as unknown as TakeoffEnvelopeV1;
        source = 'document';
      }

      setEnvelope(loadedEnvelope);
      setEnvelopeSource(source);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Re-run OCR on a specific page (user override)
  const handleRerunPage = async (pageIndex: number) => {
    setIsRerunning(true);
    try {
      const response = await fetch('/api/extract-ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          idempotencyKey: crypto.randomUUID(), // force new run
          pageOverride: pageIndex,
          planName: project?.plan_preset || undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('Page override rerun failed:', data.error);
        return;
      }

      // Reload data to pick up new envelope
      await loadData();
    } catch (error) {
      console.error('Error re-running OCR:', error);
    } finally {
      setIsRerunning(false);
    }
  };

  // ─── CRUD: Rooms ──────────────────────────────────────────

  const handleAddRoom = async () => {
    if (!newRoom.name.trim()) return;

    setIsSaving(true);
    try {
      const companyId = await getActiveCompanyId();
      const { data, error } = await supabase
        .from('rooms')
        .insert({
          company_id: companyId,
          project_id: id,
          name: newRoom.name.trim(),
          type: newRoom.type,
          area_sqft: newRoom.area_sqft ? parseFloat(newRoom.area_sqft) : null,
          perimeter_ft: newRoom.perimeter_ft ? parseFloat(newRoom.perimeter_ft) : null,
          height_ft: newRoom.height_ft ? parseFloat(newRoom.height_ft) : null,
          wall_sf: newRoom.wall_sf ? parseFloat(newRoom.wall_sf) : null,
          floor_sf: newRoom.floor_sf ? parseFloat(newRoom.floor_sf) : null,
          ceiling_sf: newRoom.ceiling_sf ? parseFloat(newRoom.ceiling_sf) : null,
          wall_composition: newRoom.wall_composition || null,
          stud_size: newRoom.stud_size || null,
        })
        .select()
        .single();

      if (error) throw error;

      setRooms([...rooms, data]);
      setNewRoom({
        name: '',
        type: 'living',
        area_sqft: '',
        perimeter_ft: '',
        height_ft: '',
        wall_sf: '',
        floor_sf: '',
        ceiling_sf: '',
        wall_composition: '',
        stud_size: '',
      });
      setShowAddRoom(false);
    } catch (error) {
      console.error('Error adding room:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateRoom = async (roomId: string, updates: Partial<Room>) => {
    setIsSaving(true);
    try {
      const companyId = await getActiveCompanyId();
      const { error } = await supabase
        .from('rooms')
        .update(updates)
        .eq('id', roomId)
        .eq('company_id', companyId);

      if (error) throw error;

      setRooms(rooms.map(r => r.id === roomId ? { ...r, ...updates } : r));
      setEditingRoom(null);
    } catch (error) {
      console.error('Error updating room:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    if (!confirm('Are you sure you want to delete this room?')) return;

    try {
      const companyId = await getActiveCompanyId();
      const { error } = await supabase
        .from('rooms')
        .delete()
        .eq('id', roomId)
        .eq('company_id', companyId);

      if (error) throw error;

      setRooms(rooms.filter(r => r.id !== roomId));
    } catch (error) {
      console.error('Error deleting room:', error);
    }
  };

  // ─── CRUD: Openings ───────────────────────────────────────

  const handleUpdateOpening = async (openingId: string, updates: Partial<Opening>) => {
    setIsSaving(true);
    try {
      const companyId = await getActiveCompanyId();
      const { error } = await supabase
        .from('openings')
        .update(updates)
        .eq('id', openingId)
        .eq('company_id', companyId);

      if (error) throw error;

      setOpenings(openings.map(o => o.id === openingId ? { ...o, ...updates } : o));
    } catch (error) {
      console.error('Error updating opening:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddOpening = async (type: 'door' | 'window') => {
    setIsSaving(true);
    try {
      const companyId = await getActiveCompanyId();
      const { data, error } = await supabase
        .from('openings')
        .insert({
          company_id: companyId,
          project_id: id,
          type,
          label: type === 'door' ? `Door ${doors.length + 1}` : `Window ${windows.length + 1}`,
          width_ft: type === 'door' ? 3 : 3,
          height_ft: type === 'door' ? 6.67 : 4,
          area_sqft: type === 'door' ? 20 : 12,
          count: 1,
        })
        .select()
        .single();

      if (error) throw error;

      setOpenings([...openings, data]);
      setEditingOpenings([...editingOpenings, data]);
    } catch (error) {
      console.error('Error adding opening:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteOpening = async (openingId: string) => {
    setIsSaving(true);
    try {
      const companyId = await getActiveCompanyId();
      const { error } = await supabase
        .from('openings')
        .delete()
        .eq('id', openingId)
        .eq('company_id', companyId);

      if (error) throw error;

      setOpenings(openings.filter(o => o.id !== openingId));
      setEditingOpenings(editingOpenings.filter(o => o.id !== openingId));
    } catch (error) {
      console.error('Error deleting opening:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Segment edit handlers ────────────────────────────────

  const startEditWalls = () => {
    setEditingSegment('walls');
    setWallEditForm({
      wall_sf: mainRoom?.wall_sf?.toString() || '',
      perimeter_ft: mainRoom?.perimeter_ft?.toString() || '',
      height_ft: mainRoom?.height_ft?.toString() || '',
      wall_composition: mainRoom?.wall_composition || '',
      stud_size: mainRoom?.stud_size || '',
    });
  };

  const saveWallEdits = async () => {
    if (!mainRoom) return;
    const updates: Partial<Room> = {
      wall_sf: wallEditForm.wall_sf ? parseFloat(wallEditForm.wall_sf) : null,
      perimeter_ft: wallEditForm.perimeter_ft ? parseFloat(wallEditForm.perimeter_ft) : null,
      height_ft: wallEditForm.height_ft ? parseFloat(wallEditForm.height_ft) : null,
      wall_composition: wallEditForm.wall_composition || null,
      stud_size: wallEditForm.stud_size || null,
    };
    await handleUpdateRoom(mainRoom.id, updates);
    setEditingSegment(null);
  };

  const startEditCeiling = () => {
    setEditingSegment('ceiling');
    setCeilingEditValue(mainRoom?.ceiling_sf?.toString() || '');
  };

  const saveCeilingEdit = async () => {
    if (!mainRoom) return;
    await handleUpdateRoom(mainRoom.id, {
      ceiling_sf: ceilingEditValue ? parseFloat(ceilingEditValue) : null,
    });
    setEditingSegment(null);
  };

  const startEditFloor = () => {
    setEditingSegment('floor');
    setFloorEditValue(mainRoom?.floor_sf?.toString() || '');
  };

  const saveFloorEdit = async () => {
    if (!mainRoom) return;
    await handleUpdateRoom(mainRoom.id, {
      floor_sf: floorEditValue ? parseFloat(floorEditValue) : null,
    });
    setEditingSegment(null);
  };

  const startEditOpenings = (type: 'door' | 'window') => {
    setEditingSegment(type === 'door' ? 'doors' : 'windows');
    const filtered = openings.filter(o => o.type === type);
    setEditingOpenings(filtered.map(o => ({ ...o })));
  };

  const saveOpeningEdits = async () => {
    setIsSaving(true);
    try {
      for (const edited of editingOpenings) {
        const original = openings.find(o => o.id === edited.id);
        if (!original) continue;
        const changed =
          original.label !== edited.label ||
          original.width_ft !== edited.width_ft ||
          original.height_ft !== edited.height_ft ||
          original.count !== edited.count ||
          original.area_sqft !== edited.area_sqft;
        if (changed) {
          await handleUpdateOpening(edited.id, {
            label: edited.label,
            width_ft: edited.width_ft,
            height_ft: edited.height_ft,
            area_sqft: edited.width_ft && edited.height_ft
              ? edited.width_ft * edited.height_ft
              : edited.area_sqft,
            count: edited.count,
          });
        }
      }
    } finally {
      setIsSaving(false);
      setEditingSegment(null);
    }
  };

  const updateEditingOpening = (idx: number, field: keyof Opening, value: string | number) => {
    setEditingOpenings(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      // Auto-recalculate area when dimensions change
      if (field === 'width_ft' || field === 'height_ft') {
        const w = field === 'width_ft' ? Number(value) : updated[idx].width_ft;
        const h = field === 'height_ft' ? Number(value) : updated[idx].height_ft;
        if (w && h) {
          updated[idx].area_sqft = w * h;
        }
      }
      return updated;
    });
  };

  // ─── Verification ─────────────────────────────────────────

  const toggleVerify = (segmentId: string) => {
    setVerifiedSegments(prev => {
      const next = new Set(prev);
      if (next.has(segmentId)) {
        next.delete(segmentId);
      } else {
        next.add(segmentId);
      }
      return next;
    });
  };

  // ─── Helpers ──────────────────────────────────────────────

  const getRoomIcon = (type: string) => {
    const roomType = ROOM_TYPES.find(t => t.value === type);
    const Icon = roomType?.icon || Home;
    return <Icon className="h-5 w-5" />;
  };

  const getRoomTypeLabel = (type: string) => {
    return ROOM_TYPES.find(t => t.value === type)?.label || type;
  };

  // ─── Active run helpers ──────────────────────────────────

  const ocrRun = extractionRuns.find(r => (r.mode === 'ocr' || r.mode === 'hybrid') && (r.status === 'complete' || r.status === 'review')) || null;
  const hasOcrData = !!envelope;
  const hasVisionData = rooms.length > 0;

  // ─── Derived calculations ─────────────────────────────────

  // Saved room/opening values (used when activeMode is not automated takeoff)
  const mainRoom = rooms.find(r => r.type === 'living' && r.wall_sf);
  const visionGrossWallSF = mainRoom?.wall_sf || 0;
  const visionFloorSF = mainRoom?.floor_sf || 0;
  const visionCeilingSF = mainRoom?.ceiling_sf || 0;
  const visionWallComposition = mainRoom?.wall_composition || null;
  const visionStudSize = mainRoom?.stud_size || null;
  const visionPerimeterFt = mainRoom?.perimeter_ft || 0;
  const visionWallHeightFt = mainRoom?.height_ft || 0;

  const doors = openings.filter(o => o.type === 'door');
  const windows = openings.filter(o => o.type === 'window');

  const visionTotalDoorSF = doors.reduce((sum, d) => sum + (d.area_sqft || 0) * (d.count || 1), 0);
  const visionTotalWindowSF = windows.reduce((sum, w) => sum + (w.area_sqft || 0) * (w.count || 1), 0);
  const visionNetWallSF = visionGrossWallSF - visionTotalDoorSF - visionTotalWindowSF;

  // OCR-sourced values (used when activeMode === 'ocr')
  const ocrGrossWallSF = envelope?.summary?.gross_sf || 0;
  const ocrNetWallSF = envelope?.summary?.net_sf || 0;
  const ocrOpeningAreaSF = envelope?.summary?.opening_area_sf || 0;
  const ocrExteriorLF = envelope?.summary?.exterior_lf || 0;
  const ocrCeilingSF = envelope?.summary?.estimated_ceiling_sf || 0;
  const ocrCrawlspaceSF = envelope?.summary?.estimated_crawlspace_sf || 0;
  const ocrOpeningCount = envelope?.summary?.opening_count || 0;
  // Derive door/window from envelope openings items
  const ocrDoorItems = envelope?.openings?.items?.filter(i => i.opening_type === 'door' || i.opening_type === 'door_arc') || [];
  const ocrWindowItems = envelope?.openings?.items?.filter(i => i.opening_type === 'window' || i.opening_type === 'window_break') || [];
  const ocrTotalDoorSF = ocrDoorItems.reduce((sum, d) => sum + (d.area_sf || 0), 0);
  const ocrTotalWindowSF = ocrWindowItems.reduce((sum, w) => sum + (w.area_sf || 0), 0);

  // Active-mode derived values — render from one source only.
  // When activeMode is null during load, use saved room/opening values to avoid showing zeros.
  const isOcrActive = activeMode === 'ocr';
  const grossWallSF = isOcrActive ? ocrGrossWallSF : visionGrossWallSF;
  const netWallSF = isOcrActive ? ocrNetWallSF : visionNetWallSF;
  const totalDoorSF = isOcrActive ? ocrTotalDoorSF : visionTotalDoorSF;
  const totalWindowSF = isOcrActive ? ocrTotalWindowSF : visionTotalWindowSF;
  const floorSF = isOcrActive ? ocrCrawlspaceSF : visionFloorSF;
  const ceilingSF = isOcrActive ? ocrCeilingSF : visionCeilingSF;
  const wallComposition = isOcrActive ? null : visionWallComposition;
  const studSize = isOcrActive ? null : visionStudSize;
  const perimeterFt = isOcrActive ? ocrExteriorLF : visionPerimeterFt;
  const wallHeightFt = isOcrActive ? 0 : visionWallHeightFt;

  // Data source diagnostic — proves no mixing
  const dataSource = isOcrActive ? 'envelope' : 'manual';

  // Build the list of visible segments for progress tracking
  const segmentIds: string[] = ['walls', 'doors', 'windows', 'ceiling'];
  if (floorSF > 0) segmentIds.push('floor');
  segmentIds.push('rooms');

  const verifiedCount = segmentIds.filter(s => verifiedSegments.has(s)).length;
  const totalSegments = segmentIds.length;
  const allVerified = verifiedCount === totalSegments;

  // ─── Loading / Not Found states ───────────────────────────

  if (isLoading) {
    return (
      <div className="takeoff-shell takeoff-light-theme flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="takeoff-shell takeoff-light-theme min-h-screen p-8">
        <p className="text-[var(--takeoff-text-muted)]">Project not found</p>
      </div>
    );
  }

  const hasPdf = !!project.pdf_url;

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="takeoff-shell takeoff-light-theme flex h-screen flex-col text-[var(--takeoff-ink)]">
      {/* Header */}
      <div className="border-b border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.84)] px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between">
          <div>
            <p className="ev-label">Review Workspace</p>
            <h1 className="ev-title mt-1 text-2xl">{project.name}</h1>
            <p className="ev-muted text-sm">
              {project.status === 'manual'
                ? 'Add and manage room measurements'
                : 'Review and verify extracted measurements'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/projects/${project.id}`}>
              <Button variant="outline">Back to Project</Button>
            </Link>
            <Link href={`/projects/${project.id}/quote`}>
              <Button
                className={
                  allVerified
                    ? 'border-[#47644a] bg-[#47644a] text-white hover:bg-[#355239]'
                    : ''
                }
              >
                <FileCheck className="mr-2 h-4 w-4" />
                Generate Quote
                {!allVerified && verifiedCount > 0 && (
                  <span className="ml-2 text-xs opacity-75">
                    ({verifiedCount}/{totalSegments})
                  </span>
                )}
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <div className="mx-auto h-full max-w-[1480px] p-4">
          <div className={`grid gap-4 h-full ${hasPdf ? 'grid-cols-2' : 'grid-cols-1 max-w-3xl mx-auto'}`}>
            {/* PDF Viewer */}
            {hasPdf && (
              <Card className="ev-card flex flex-col overflow-hidden">
                <CardHeader className="py-3">
                  <CardTitle className="text-lg">Source Document</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 p-0">
                  <PDFViewer url={project.pdf_url!} />
                </CardContent>
              </Card>
            )}

            {/* Right panel: Segment Cards */}
            <div className="overflow-auto space-y-3">
              {/* Active Run Banner */}
              {(hasOcrData || hasVisionData) && activeMode && (
                <ActiveRunBanner
                  activeMode={activeMode}
                  hasOcr={hasOcrData}
                  hasVision={hasVisionData}
                  envelope={envelope}
                  ocrRun={ocrRun}
                  resolution={modeResolution}
                  onRerunPage={handleRerunPage}
                  isRerunning={isRerunning}
                  planPreset={project?.plan_preset}
                />
              )}

              {/* Demo Instructions */}
              <DemoInstructions
                title="Step 3: Review Extracted Data"
                steps={[
                  "Review each segment (Walls, Doors, Windows, Ceiling, Rooms) extracted from your document",
                  "Click 'Edit' to correct any values that don't match your plans",
                  "Click 'Verify' on each segment to confirm the data is accurate",
                  "Once all segments are verified, click 'Generate Quote' to proceed"
                ]}
                tip="Net Wall SF = Gross Wall SF minus door and window openings. This is the actual insulation area."
              />

              {/* Progress Bar */}
              <div className="ev-card flex items-center gap-4 rounded-[18px] px-4 py-3">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-[var(--takeoff-ink)]">
                      Verification Progress
                    </span>
                    <span className="text-sm text-[var(--takeoff-text-muted)]">
                      {verifiedCount} of {totalSegments} segments verified
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[var(--takeoff-paper)]">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        allVerified ? 'bg-[#6f8b5e]' : 'bg-[var(--takeoff-ink)]'
                      }`}
                      style={{ width: `${totalSegments > 0 ? (verifiedCount / totalSegments) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                {allVerified && (
                  <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                )}
              </div>

              {/* ── Scope Card (pdfengine envelope) ── */}
              {envelope && (
                <ScopeCard
                  envelope={envelope}
                  onDownload={() => {
                    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `takeoff_${id}_v1.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                />
              )}

              {/* ── Data Source Diagnostic ── */}
              <div className="bg-zinc-950 border border-yellow-700/50 rounded-lg p-3 font-mono text-xs space-y-1">
                <div className="text-yellow-500 font-bold mb-1">DATA SOURCE DIAGNOSTIC</div>
                <div className="text-zinc-400">
                  activeMode = <span className="text-yellow-300">{JSON.stringify(activeMode)}</span>
                  {' | '}isOcrActive = <span className="text-yellow-300">{String(isOcrActive)}</span>
                  {' | '}dataSource = <span className={dataSource === 'envelope' ? 'text-cyan-400' : 'text-purple-400'}>{dataSource}</span>
                  {' | '}envelopeSource = <span className="text-yellow-300">{JSON.stringify(envelopeSource)}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-zinc-400 mt-1">
                  <div>source_walls = <span className={isOcrActive ? 'text-cyan-400' : 'text-purple-400'}>{isOcrActive ? `envelope (gross=${ocrGrossWallSF}, net=${ocrNetWallSF})` : `manual (gross=${visionGrossWallSF})`}</span></div>
                  <div>source_doors = <span className={isOcrActive ? 'text-cyan-400' : 'text-purple-400'}>{isOcrActive ? `envelope (${ocrDoorItems.length} items, ${ocrTotalDoorSF} sf)` : `manual (${doors.length} items, ${visionTotalDoorSF} sf)`}</span></div>
                  <div>source_windows = <span className={isOcrActive ? 'text-cyan-400' : 'text-purple-400'}>{isOcrActive ? `envelope (${ocrWindowItems.length} items, ${ocrTotalWindowSF} sf)` : `manual (${windows.length} items, ${visionTotalWindowSF} sf)`}</span></div>
                  <div>source_net = <span className={isOcrActive ? 'text-cyan-400' : 'text-purple-400'}>{isOcrActive ? `envelope (${ocrNetWallSF} sf)` : `manual (${visionNetWallSF} sf)`}</span></div>
                  <div>rendered_gross = <span className="text-white">{grossWallSF}</span></div>
                  <div>rendered_net = <span className="text-white">{netWallSF}</span></div>
                  <div>rendered_doors = <span className="text-white">{totalDoorSF}</span></div>
                  <div>rendered_windows = <span className="text-white">{totalWindowSF}</span></div>
                </div>
                {isOcrActive && envelope?.summary && (
                  <div className="mt-1 pt-1 border-t border-zinc-800 text-zinc-500">
                    raw envelope.summary: gross_sf={envelope.summary.gross_sf}, net_sf={envelope.summary.net_sf}, opening_area_sf={envelope.summary.opening_area_sf}, exterior_lf={envelope.summary.exterior_lf}, opening_count={envelope.summary.opening_count}
                  </div>
                )}
              </div>

              {/* ── Segment 1: Exterior Walls ── */}
              <SegmentCard
                id="walls"
                title="Exterior Walls"
                icon={Ruler}
                heroValue={netWallSF > 0 ? Math.round(netWallSF).toLocaleString() : '—'}
                heroLabel="Net Wall SF"
                verified={verifiedSegments.has('walls')}
                onToggleVerify={() => toggleVerify('walls')}
                editing={editingSegment === 'walls'}
                onEdit={activeMode !== 'ocr' && mainRoom ? startEditWalls : undefined}
                onCancelEdit={() => setEditingSegment(null)}
                tooltip={
                  <DemoTooltip>
                    Exterior wall insulation area. Net Wall SF = Gross walls minus door/window openings. Wall composition (e.g., 2x6 studs) determines insulation thickness.
                  </DemoTooltip>
                }
              >
                {editingSegment === 'walls' ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs">Gross Wall SF</Label>
                        <Input
                          type="number"
                          value={wallEditForm.wall_sf}
                          onChange={(e) => setWallEditForm({ ...wallEditForm, wall_sf: e.target.value })}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Perimeter (ft)</Label>
                        <Input
                          type="number"
                          value={wallEditForm.perimeter_ft}
                          onChange={(e) => setWallEditForm({ ...wallEditForm, perimeter_ft: e.target.value })}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Wall Height (ft)</Label>
                        <Input
                          type="number"
                          value={wallEditForm.height_ft}
                          onChange={(e) => setWallEditForm({ ...wallEditForm, height_ft: e.target.value })}
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Wall Composition</Label>
                        <Input
                          placeholder="e.g., 2x6 @ 16in OC"
                          value={wallEditForm.wall_composition}
                          onChange={(e) => setWallEditForm({ ...wallEditForm, wall_composition: e.target.value })}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Stud Size</Label>
                        <Input
                          placeholder="e.g., 2x4, 2x6"
                          value={wallEditForm.stud_size}
                          onChange={(e) => setWallEditForm({ ...wallEditForm, stud_size: e.target.value })}
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditingSegment(null)} disabled={isSaving}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={saveWallEdits} disabled={isSaving}>
                        {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Breakdown */}
                    <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3 space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">
                          {activeMode === 'ocr'
                            ? `${Math.round(perimeterFt)} LF exterior perimeter`
                            : perimeterFt > 0 && wallHeightFt > 0
                              ? `${perimeterFt} ft perimeter × ${wallHeightFt} ft height`
                              : 'Gross Wall SF'}
                        </span>
                        <span className="font-medium">{grossWallSF > 0 ? Math.round(grossWallSF).toLocaleString() : '—'}</span>
                      </div>
                      {/* Per-bucket breakdown for OCR mode */}
                      {activeMode === 'ocr' && envelope?.buckets && envelope.buckets.length > 0 && (
                        <div className="pl-3 space-y-1 border-l-2 border-zinc-300 dark:border-zinc-600">
                          {envelope.buckets.map((b) => (
                            <div key={b.height_ft} className="flex justify-between text-zinc-400">
                              <span>{b.height_ft}' walls ({b.segment_count} seg)</span>
                              <span>{Math.round(b.gross_sf).toLocaleString()} sf gross / {Math.round(b.net_sf).toLocaleString()} net</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* NET by bucket */}
                      {activeMode === 'ocr' && envelope?.net?.by_bucket_net && Object.keys(envelope.net.by_bucket_net).length > 0 && (
                        <div className="pl-3 space-y-1 border-l-2 border-cyan-700/50">
                          <span className="text-[11px] uppercase tracking-wider text-zinc-500">Net by height</span>
                          {Object.entries(envelope.net.by_bucket_net).map(([height, sf]) => (
                            <div key={height} className="flex justify-between text-zinc-400">
                              <span>{height} net</span>
                              <span className="text-cyan-400">{Math.round(sf as number).toLocaleString()} sf</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-zinc-500">− Door openings ({activeMode === 'ocr' ? ocrDoorItems.length : doors.length})</span>
                        <span className="text-red-500">−{Math.round(totalDoorSF).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">− Window openings ({activeMode === 'ocr' ? ocrWindowItems.length : windows.length})</span>
                        <span className="text-red-500">−{Math.round(totalWindowSF).toLocaleString()}</span>
                      </div>
                      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-1.5 flex justify-between font-bold">
                        <span>Net Wall SF</span>
                        <span className="text-cyan-600 dark:text-cyan-400">
                          {netWallSF > 0 ? Math.round(netWallSF).toLocaleString() : '—'}
                        </span>
                      </div>
                    </div>
                    {/* Source badge */}
                    <div className="flex gap-2 flex-wrap">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        activeMode === 'ocr'
                          ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300'
                          : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                      }`}>
                        Source: {activeMode === 'ocr' ? 'Automated Takeoff' : 'Manual / Saved Measurements'}
                      </span>
                      {studSize && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                          {studSize} studs
                        </span>
                      )}
                      {wallComposition && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                          {wallComposition}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </SegmentCard>

              {/* ── Segment 2: Doors ── */}
              <SegmentCard
                id="doors"
                title="Doors"
                icon={DoorOpen}
                heroValue={totalDoorSF > 0 ? `${Math.round(totalDoorSF).toLocaleString()}` : '—'}
                heroLabel="Total Door Deduction SF"
                verified={verifiedSegments.has('doors')}
                onToggleVerify={() => toggleVerify('doors')}
                editing={editingSegment === 'doors'}
                onEdit={activeMode !== 'ocr' ? () => startEditOpenings('door') : undefined}
                onCancelEdit={() => setEditingSegment(null)}
                tooltip={
                  <DemoTooltip>
                    Door openings are deducted from wall area since they don't need insulation. Total SF = Width × Height × Quantity.
                  </DemoTooltip>
                }
              >
                {editingSegment === 'doors' ? (
                  <div className="space-y-2">
                    <div className="rounded-lg border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                            <th className="text-left px-3 py-2 font-medium text-zinc-500">Label</th>
                            <th className="text-right px-3 py-2 font-medium text-zinc-500">W (ft)</th>
                            <th className="text-right px-3 py-2 font-medium text-zinc-500">H (ft)</th>
                            <th className="text-right px-3 py-2 font-medium text-zinc-500">Qty</th>
                            <th className="text-right px-3 py-2 font-medium text-zinc-500">Total SF</th>
                            <th className="px-2 py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {editingOpenings.filter(o => o.type === 'door').map((door, idx) => (
                            <tr key={door.id} className="border-t">
                              <td className="px-2 py-1.5">
                                <Input
                                  value={door.label}
                                  onChange={(e) => updateEditingOpening(idx, 'label', e.target.value)}
                                  className="h-8 text-sm"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <Input
                                  type="number"
                                  value={door.width_ft ?? ''}
                                  onChange={(e) => updateEditingOpening(idx, 'width_ft', parseFloat(e.target.value) || 0)}
                                  className="h-8 text-sm w-20 ml-auto"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <Input
                                  type="number"
                                  value={door.height_ft ?? ''}
                                  onChange={(e) => updateEditingOpening(idx, 'height_ft', parseFloat(e.target.value) || 0)}
                                  className="h-8 text-sm w-20 ml-auto"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <Input
                                  type="number"
                                  value={door.count}
                                  onChange={(e) => updateEditingOpening(idx, 'count', parseInt(e.target.value) || 1)}
                                  className="h-8 text-sm w-16 ml-auto"
                                />
                              </td>
                              <td className="px-3 py-1.5 text-right font-medium text-sm">
                                {door.area_sqft ? `${Math.round(door.area_sqft * door.count)} sf` : '—'}
                              </td>
                              <td className="px-2 py-1.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteOpening(door.id)}
                                  className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between">
                      <Button variant="outline" size="sm" onClick={() => handleAddOpening('door')}>
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Add Door
                      </Button>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditingSegment(null)} disabled={isSaving}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={saveOpeningEdits} disabled={isSaving}>
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    {activeMode === 'ocr' && ocrDoorItems.length > 0 ? (
                      <div className="rounded-lg border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                              <th className="text-left px-3 py-2 font-medium text-zinc-500">ID</th>
                              <th className="text-left px-3 py-2 font-medium text-zinc-500">Type</th>
                              <th className="text-right px-3 py-2 font-medium text-zinc-500">Size</th>
                              <th className="text-right px-3 py-2 font-medium text-zinc-500">Area</th>
                              <th className="text-left px-3 py-2 font-medium text-zinc-500">Source</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ocrDoorItems.map(item => (
                              <tr key={item.opening_id} className="border-t">
                                <td className="px-3 py-2 font-mono text-xs">{item.opening_id.slice(0, 8)}</td>
                                <td className="px-3 py-2">{item.opening_type}</td>
                                <td className="px-3 py-2 text-right text-zinc-500">
                                  {item.width_ft && item.height_ft
                                    ? `${item.width_ft.toFixed(1)}' × ${item.height_ft.toFixed(1)}'`
                                    : '—'}
                                </td>
                                <td className="px-3 py-2 text-right font-medium">
                                  {item.area_sf ? `${Math.round(item.area_sf)} sf` : '—'}
                                </td>
                                <td className="px-3 py-2 text-xs text-zinc-500">{item.source}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : doors.length > 0 ? (
                      <div className="rounded-lg border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                              <th className="text-left px-3 py-2 font-medium text-zinc-500">Label</th>
                              <th className="text-right px-3 py-2 font-medium text-zinc-500">Size</th>
                              <th className="text-right px-3 py-2 font-medium text-zinc-500">Area</th>
                              <th className="text-right px-3 py-2 font-medium text-zinc-500">Qty</th>
                              <th className="text-right px-3 py-2 font-medium text-zinc-500">Total SF</th>
                            </tr>
                          </thead>
                          <tbody>
                            {doors.map(door => (
                              <tr key={door.id} className="border-t">
                                <td className="px-3 py-2">{door.label}</td>
                                <td className="px-3 py-2 text-right text-zinc-500">
                                  {door.width_ft && door.height_ft
                                    ? `${door.width_ft}' × ${door.height_ft}'`
                                    : '—'}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {door.area_sqft ? `${Math.round(door.area_sqft)} sf` : '—'}
                                </td>
                                <td className="px-3 py-2 text-right">{door.count}</td>
                                <td className="px-3 py-2 text-right font-medium">
                                  {door.area_sqft
                                    ? `${Math.round(door.area_sqft * door.count)} sf`
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-400 italic">No doors recorded</p>
                    )}
                  </div>
                )}
              </SegmentCard>

              {/* ── Segment 3: Windows ── */}
              <SegmentCard
                id="windows"
                title="Windows"
                icon={SquareIcon}
                heroValue={totalWindowSF > 0 ? `${Math.round(totalWindowSF).toLocaleString()}` : '—'}
                heroLabel="Total Window Deduction SF"
                verified={verifiedSegments.has('windows')}
                onToggleVerify={() => toggleVerify('windows')}
                editing={editingSegment === 'windows'}
                onEdit={activeMode !== 'ocr' ? () => startEditOpenings('window') : undefined}
                onCancelEdit={() => setEditingSegment(null)}
                tooltip={
                  <DemoTooltip>
                    Window openings are deducted from wall area. Group similar windows together with a quantity count to simplify the list.
                  </DemoTooltip>
                }
              >
                {editingSegment === 'windows' ? (
                  <div className="space-y-2">
                    <div className="rounded-lg border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                            <th className="text-left px-3 py-2 font-medium text-zinc-500">Label</th>
                            <th className="text-right px-3 py-2 font-medium text-zinc-500">W (ft)</th>
                            <th className="text-right px-3 py-2 font-medium text-zinc-500">H (ft)</th>
                            <th className="text-right px-3 py-2 font-medium text-zinc-500">Qty</th>
                            <th className="text-right px-3 py-2 font-medium text-zinc-500">Total SF</th>
                            <th className="px-2 py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {editingOpenings.filter(o => o.type === 'window').map((win, idx) => (
                            <tr key={win.id} className="border-t">
                              <td className="px-2 py-1.5">
                                <Input
                                  value={win.label}
                                  onChange={(e) => updateEditingOpening(idx, 'label', e.target.value)}
                                  className="h-8 text-sm"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <Input
                                  type="number"
                                  value={win.width_ft ?? ''}
                                  onChange={(e) => updateEditingOpening(idx, 'width_ft', parseFloat(e.target.value) || 0)}
                                  className="h-8 text-sm w-20 ml-auto"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <Input
                                  type="number"
                                  value={win.height_ft ?? ''}
                                  onChange={(e) => updateEditingOpening(idx, 'height_ft', parseFloat(e.target.value) || 0)}
                                  className="h-8 text-sm w-20 ml-auto"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <Input
                                  type="number"
                                  value={win.count}
                                  onChange={(e) => updateEditingOpening(idx, 'count', parseInt(e.target.value) || 1)}
                                  className="h-8 text-sm w-16 ml-auto"
                                />
                              </td>
                              <td className="px-3 py-1.5 text-right font-medium text-sm">
                                {win.area_sqft ? `${Math.round(win.area_sqft * win.count)} sf` : '—'}
                              </td>
                              <td className="px-2 py-1.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteOpening(win.id)}
                                  className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between">
                      <Button variant="outline" size="sm" onClick={() => handleAddOpening('window')}>
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Add Window
                      </Button>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditingSegment(null)} disabled={isSaving}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={saveOpeningEdits} disabled={isSaving}>
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    {activeMode === 'ocr' && ocrWindowItems.length > 0 ? (
                      <div className="rounded-lg border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                              <th className="text-left px-3 py-2 font-medium text-zinc-500">ID</th>
                              <th className="text-left px-3 py-2 font-medium text-zinc-500">Type</th>
                              <th className="text-right px-3 py-2 font-medium text-zinc-500">Size</th>
                              <th className="text-right px-3 py-2 font-medium text-zinc-500">Area</th>
                              <th className="text-left px-3 py-2 font-medium text-zinc-500">Source</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ocrWindowItems.map(item => (
                              <tr key={item.opening_id} className="border-t">
                                <td className="px-3 py-2 font-mono text-xs">{item.opening_id.slice(0, 8)}</td>
                                <td className="px-3 py-2">{item.opening_type}</td>
                                <td className="px-3 py-2 text-right text-zinc-500">
                                  {item.width_ft && item.height_ft
                                    ? `${item.width_ft.toFixed(1)}' × ${item.height_ft.toFixed(1)}'`
                                    : '—'}
                                </td>
                                <td className="px-3 py-2 text-right font-medium">
                                  {item.area_sf ? `${Math.round(item.area_sf)} sf` : '—'}
                                </td>
                                <td className="px-3 py-2 text-xs text-zinc-500">{item.source}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : windows.length > 0 ? (
                      <div className="rounded-lg border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                              <th className="text-left px-3 py-2 font-medium text-zinc-500">Label</th>
                              <th className="text-right px-3 py-2 font-medium text-zinc-500">Size</th>
                              <th className="text-right px-3 py-2 font-medium text-zinc-500">Area</th>
                              <th className="text-right px-3 py-2 font-medium text-zinc-500">Qty</th>
                              <th className="text-right px-3 py-2 font-medium text-zinc-500">Total SF</th>
                            </tr>
                          </thead>
                          <tbody>
                            {windows.map(win => (
                              <tr key={win.id} className="border-t">
                                <td className="px-3 py-2">{win.label}</td>
                                <td className="px-3 py-2 text-right text-zinc-500">
                                  {win.width_ft && win.height_ft
                                    ? `${win.width_ft}' × ${win.height_ft}'`
                                    : '—'}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {win.area_sqft ? `${Math.round(win.area_sqft)} sf` : '—'}
                                </td>
                                <td className="px-3 py-2 text-right">{win.count}</td>
                                <td className="px-3 py-2 text-right font-medium">
                                  {win.area_sqft
                                    ? `${Math.round(win.area_sqft * win.count)} sf`
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-400 italic">No windows recorded</p>
                    )}
                  </div>
                )}
              </SegmentCard>

              {/* ── Segment 4: Ceiling / Attic ── */}
              <SegmentCard
                id="ceiling"
                title="Ceiling / Attic"
                icon={ArrowUp}
                heroValue={ceilingSF > 0 ? ceilingSF.toLocaleString() : '—'}
                heroLabel="Ceiling SF"
                verified={verifiedSegments.has('ceiling')}
                onToggleVerify={() => toggleVerify('ceiling')}
                editing={editingSegment === 'ceiling'}
                onEdit={activeMode !== 'ocr' && mainRoom ? startEditCeiling : undefined}
                onCancelEdit={() => setEditingSegment(null)}
                tooltip={
                  <DemoTooltip>
                    Ceiling/attic insulation area, typically equal to the home's footprint. Blown-in insulation is common for attics.
                  </DemoTooltip>
                }
              >
                {editingSegment === 'ceiling' ? (
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs">Ceiling SF</Label>
                      <Input
                        type="number"
                        value={ceilingEditValue}
                        onChange={(e) => setCeilingEditValue(e.target.value)}
                        className="mt-1 max-w-xs"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditingSegment(null)} disabled={isSaving}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={saveCeilingEdit} disabled={isSaving}>
                        {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Ceiling Area</span>
                        <span className="font-medium">{ceilingSF > 0 ? `${ceilingSF.toLocaleString()} sf` : '—'}</span>
                      </div>
                    </div>
                    <p className="text-xs text-zinc-400">
                      {activeMode === 'ocr'
                        ? 'Source: Automated takeoff (estimated from footprint)'
                        : mainRoom
                          ? `Source: ${mainRoom.name} (living area footprint)`
                          : 'No living room data available — add a room first'}
                    </p>
                  </div>
                )}
              </SegmentCard>

              {/* ── Segment 5: Floor / Crawlspace (conditional) ── */}
              {floorSF > 0 && (
                <SegmentCard
                  id="floor"
                  title="Floor / Crawlspace"
                  icon={Layers}
                  heroValue={floorSF.toLocaleString()}
                  heroLabel="Floor SF"
                  verified={verifiedSegments.has('floor')}
                  onToggleVerify={() => toggleVerify('floor')}
                  editing={editingSegment === 'floor'}
                  onEdit={activeMode !== 'ocr' && mainRoom ? startEditFloor : undefined}
                  onCancelEdit={() => setEditingSegment(null)}
                  tooltip={
                    <DemoTooltip>
                      Floor insulation for homes with crawlspaces or raised foundations. Not needed for slab-on-grade construction.
                    </DemoTooltip>
                  }
                >
                  {editingSegment === 'floor' ? (
                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs">Floor SF</Label>
                        <Input
                          type="number"
                          value={floorEditValue}
                          onChange={(e) => setFloorEditValue(e.target.value)}
                          className="mt-1 max-w-xs"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditingSegment(null)} disabled={isSaving}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={saveFloorEdit} disabled={isSaving}>
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Floor Area</span>
                          <span className="font-medium">{floorSF > 0 ? `${floorSF.toLocaleString()} sf` : '—'}</span>
                        </div>
                      </div>
                      <p className="text-xs text-zinc-400">
                        Source: {mainRoom?.name || 'Living room'} floor area
                      </p>
                    </div>
                  )}
                </SegmentCard>
              )}

              {/* ── Segment 6: Rooms (collapsible) ── */}
              <Card
                className={`transition-colors ${
                  verifiedSegments.has('rooms')
                    ? 'border-green-300 dark:border-green-800 bg-green-50/30 dark:bg-green-950/10'
                    : 'border-zinc-200 dark:border-zinc-700'
                }`}
              >
                <CardHeader className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setRoomsExpanded(!roomsExpanded)}
                      className="flex items-center gap-3 text-left"
                    >
                      <div
                        className={`h-9 w-9 rounded-lg flex items-center justify-center ${
                          verifiedSegments.has('rooms')
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        <Home className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          Rooms
                          {roomsExpanded ? (
                            <ChevronDown className="h-4 w-4 text-zinc-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-zinc-400" />
                          )}
                        </CardTitle>
                        <span className="text-sm text-zinc-500">{rooms.length} room{rooms.length !== 1 ? 's' : ''}</span>
                      </div>
                    </button>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setShowAddRoom(true); setRoomsExpanded(true); }}>
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Add Room
                      </Button>
                      <button
                        onClick={() => toggleVerify('rooms')}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                          verifiedSegments.has('rooms')
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                        }`}
                      >
                        {verifiedSegments.has('rooms') ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Circle className="h-4 w-4" />
                        )}
                        {verifiedSegments.has('rooms') ? 'Verified' : 'Verify'}
                      </button>
                    </div>
                  </div>
                </CardHeader>

                {roomsExpanded && (
                  <CardContent className="pt-0 px-4 pb-4 space-y-3">
                    {/* Add Room Form */}
                    {showAddRoom && (
                      <Card className="border-l-4 border-l-primary">
                        <CardContent className="pt-4">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <h3 className="font-medium">Add New Room</h3>
                              <Button variant="ghost" size="sm" onClick={() => setShowAddRoom(false)}>
                                <X className="h-4 w-4" />
                              </Button>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <Label>Room Name</Label>
                                <Input
                                  placeholder="e.g., Master Bedroom"
                                  value={newRoom.name}
                                  onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label>Type</Label>
                                <select
                                  value={newRoom.type}
                                  onChange={(e) => setNewRoom({ ...newRoom, type: e.target.value as any })}
                                  className="mt-1 w-full px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                >
                                  {ROOM_TYPES.map((type) => (
                                    <option key={type.value} value={type.value}>
                                      {type.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                              <div>
                                <Label>Area (sq ft)</Label>
                                <Input
                                  type="number"
                                  placeholder="0"
                                  value={newRoom.area_sqft}
                                  onChange={(e) => setNewRoom({ ...newRoom, area_sqft: e.target.value })}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label>Perimeter (ft)</Label>
                                <Input
                                  type="number"
                                  placeholder="0"
                                  value={newRoom.perimeter_ft}
                                  onChange={(e) => setNewRoom({ ...newRoom, perimeter_ft: e.target.value })}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label>Height (ft)</Label>
                                <Input
                                  type="number"
                                  placeholder="0"
                                  value={newRoom.height_ft}
                                  onChange={(e) => setNewRoom({ ...newRoom, height_ft: e.target.value })}
                                  className="mt-1"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                              <div>
                                <Label>Wall SF</Label>
                                <Input
                                  type="number"
                                  placeholder="0"
                                  value={newRoom.wall_sf}
                                  onChange={(e) => setNewRoom({ ...newRoom, wall_sf: e.target.value })}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label>Floor SF</Label>
                                <Input
                                  type="number"
                                  placeholder="0"
                                  value={newRoom.floor_sf}
                                  onChange={(e) => setNewRoom({ ...newRoom, floor_sf: e.target.value })}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label>Ceiling SF</Label>
                                <Input
                                  type="number"
                                  placeholder="0"
                                  value={newRoom.ceiling_sf}
                                  onChange={(e) => setNewRoom({ ...newRoom, ceiling_sf: e.target.value })}
                                  className="mt-1"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <Label>Wall Composition</Label>
                                <Input
                                  placeholder="e.g., 2x6 @ 16in OC"
                                  value={newRoom.wall_composition}
                                  onChange={(e) => setNewRoom({ ...newRoom, wall_composition: e.target.value })}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label>Stud Size</Label>
                                <Input
                                  placeholder="e.g., 2x4, 2x6"
                                  value={newRoom.stud_size}
                                  onChange={(e) => setNewRoom({ ...newRoom, stud_size: e.target.value })}
                                  className="mt-1"
                                />
                              </div>
                            </div>

                            <div className="flex justify-end gap-2">
                              <Button variant="outline" onClick={() => setShowAddRoom(false)}>
                                Cancel
                              </Button>
                              <Button onClick={handleAddRoom} disabled={isSaving || !newRoom.name.trim()}>
                                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                                Add Room
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Empty State */}
                    {rooms.length === 0 && !showAddRoom && (
                      <div className="py-8 text-center">
                        <Home className="h-10 w-10 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
                        <h3 className="text-sm font-semibold text-zinc-900 dark:text-white mb-1">
                          No rooms yet
                        </h3>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                          {project.status === 'manual'
                            ? 'Start by adding rooms and their measurements'
                            : 'No data extracted yet. Run extraction or add rooms manually'}
                        </p>
                        <Button size="sm" onClick={() => setShowAddRoom(true)}>
                          <Plus className="h-4 w-4 mr-2" />
                          Add Your First Room
                        </Button>
                      </div>
                    )}

                    {/* Room Cards */}
                    {rooms.map((room) => (
                      <Card key={room.id} className="border-zinc-200 dark:border-zinc-700">
                        <CardContent className="pt-4">
                          {editingRoom === room.id ? (
                            <RoomEditForm
                              room={room}
                              onSave={(updates) => handleUpdateRoom(room.id, updates)}
                              onCancel={() => setEditingRoom(null)}
                              isSaving={isSaving}
                            />
                          ) : (
                            <div className="flex items-start justify-between">
                              <div className="flex items-start gap-3">
                                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                                  {getRoomIcon(room.type)}
                                </div>
                                <div>
                                  <h3 className="font-medium text-zinc-900 dark:text-white">
                                    {room.name}
                                  </h3>
                                  <p className="text-sm text-zinc-500">
                                    {getRoomTypeLabel(room.type)}
                                  </p>
                                  <div className="flex gap-4 mt-2 text-sm flex-wrap">
                                    {room.area_sqft != null && (
                                      <span className="text-zinc-600 dark:text-zinc-300">
                                        <strong>{room.area_sqft.toLocaleString()}</strong> sq ft
                                      </span>
                                    )}
                                    {room.perimeter_ft != null && (
                                      <span className="text-zinc-600 dark:text-zinc-300">
                                        <strong>{room.perimeter_ft}</strong> ft perimeter
                                      </span>
                                    )}
                                    {room.height_ft != null && (
                                      <span className="text-zinc-600 dark:text-zinc-300">
                                        <strong>{room.height_ft}</strong> ft height
                                      </span>
                                    )}
                                    {room.wall_sf != null && (
                                      <span className="text-cyan-600 dark:text-cyan-400">
                                        <strong>{room.wall_sf.toLocaleString()}</strong> wall sf
                                      </span>
                                    )}
                                    {room.floor_sf != null && (
                                      <span className="text-cyan-600 dark:text-cyan-400">
                                        <strong>{room.floor_sf.toLocaleString()}</strong> floor sf
                                      </span>
                                    )}
                                    {room.ceiling_sf != null && (
                                      <span className="text-cyan-600 dark:text-cyan-400">
                                        <strong>{room.ceiling_sf.toLocaleString()}</strong> ceiling sf
                                      </span>
                                    )}
                                  </div>
                                  {(room.stud_size || room.wall_composition) && (
                                    <div className="flex gap-2 mt-2 flex-wrap">
                                      {room.stud_size && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                                          {room.stud_size}
                                        </span>
                                      )}
                                      {room.wall_composition && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                                          {room.wall_composition}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingRoom(room.id)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteRoom(room.id)}
                                  className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </CardContent>
                )}
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Room Edit Form ─────────────────────────────────────────

function RoomEditForm({
  room,
  onSave,
  onCancel,
  isSaving,
}: {
  room: Room;
  onSave: (updates: Partial<Room>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState({
    name: room.name,
    type: room.type,
    area_sqft: room.area_sqft?.toString() || '',
    perimeter_ft: room.perimeter_ft?.toString() || '',
    height_ft: room.height_ft?.toString() || '',
    wall_sf: room.wall_sf?.toString() || '',
    floor_sf: room.floor_sf?.toString() || '',
    ceiling_sf: room.ceiling_sf?.toString() || '',
    wall_composition: room.wall_composition || '',
    stud_size: room.stud_size || '',
  });

  const handleSave = () => {
    onSave({
      name: form.name,
      type: form.type,
      area_sqft: form.area_sqft ? parseFloat(form.area_sqft) : null,
      perimeter_ft: form.perimeter_ft ? parseFloat(form.perimeter_ft) : null,
      height_ft: form.height_ft ? parseFloat(form.height_ft) : null,
      wall_sf: form.wall_sf ? parseFloat(form.wall_sf) : null,
      floor_sf: form.floor_sf ? parseFloat(form.floor_sf) : null,
      ceiling_sf: form.ceiling_sf ? parseFloat(form.ceiling_sf) : null,
      wall_composition: form.wall_composition || null,
      stud_size: form.stud_size || null,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Room Name</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="mt-1"
          />
        </div>
        <div>
          <Label>Type</Label>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as any })}
            className="mt-1 w-full px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
          >
            {ROOM_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Area (sq ft)</Label>
          <Input
            type="number"
            value={form.area_sqft}
            onChange={(e) => setForm({ ...form, area_sqft: e.target.value })}
            className="mt-1"
          />
        </div>
        <div>
          <Label>Perimeter (ft)</Label>
          <Input
            type="number"
            value={form.perimeter_ft}
            onChange={(e) => setForm({ ...form, perimeter_ft: e.target.value })}
            className="mt-1"
          />
        </div>
        <div>
          <Label>Height (ft)</Label>
          <Input
            type="number"
            value={form.height_ft}
            onChange={(e) => setForm({ ...form, height_ft: e.target.value })}
            className="mt-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Wall SF</Label>
          <Input
            type="number"
            value={form.wall_sf}
            onChange={(e) => setForm({ ...form, wall_sf: e.target.value })}
            className="mt-1"
          />
        </div>
        <div>
          <Label>Floor SF</Label>
          <Input
            type="number"
            value={form.floor_sf}
            onChange={(e) => setForm({ ...form, floor_sf: e.target.value })}
            className="mt-1"
          />
        </div>
        <div>
          <Label>Ceiling SF</Label>
          <Input
            type="number"
            value={form.ceiling_sf}
            onChange={(e) => setForm({ ...form, ceiling_sf: e.target.value })}
            className="mt-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Wall Composition</Label>
          <Input
            placeholder="e.g., 2x6 @ 16in OC"
            value={form.wall_composition}
            onChange={(e) => setForm({ ...form, wall_composition: e.target.value })}
            className="mt-1"
          />
        </div>
        <div>
          <Label>Stud Size</Label>
          <Input
            placeholder="e.g., 2x4, 2x6"
            value={form.stud_size}
            onChange={(e) => setForm({ ...form, stud_size: e.target.value })}
            className="mt-1"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving || !form.name.trim()}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save Changes
        </Button>
      </div>
    </div>
  );
}
